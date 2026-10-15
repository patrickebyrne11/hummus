"""Stripe test-mode wrapper.

The shop owner's card is saved on a Stripe Customer ("Bean & Leaf Coffee").
Every purchase is a PaymentIntent charged off-session to that card, with the
audit trail (supplier, clauses, evidence) stored in PaymentIntent metadata.

Each approved supplier has a Stripe Connect account (see .env). When that
account can accept transfers, the purchase is a destination charge so the
money lands with the supplier. If it can't (test accounts that haven't
finished onboarding), the charge stays on the platform and the supplier's
account id is still recorded in metadata, so the demo never breaks.
"""
import json
import os
from pathlib import Path

import stripe
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

SHOP_FILE = Path(__file__).parent / "data" / "shop.json"

# Approved supplier name -> Connect account id (from .env). Must match policy §2.
SUPPLIER_ACCOUNTS = {
    "Booker Wholesale": os.environ.get("STRIPE_SUPPLIER_BOOKER", ""),
    "Bidfood": os.environ.get("STRIPE_SUPPLIER_BIDFOOD", ""),
    "Bean Bros Roasters": os.environ.get("STRIPE_SUPPLIER_BEANBROS", ""),
}


def setup_shop_customer():
    """Create the shop Customer, attach the Stripe test card, make it default."""
    cus = stripe.Customer.create(name="Bean & Leaf Coffee", email="owner@beanleaf.test")
    pm = stripe.PaymentMethod.attach("pm_card_visa", customer=cus.id)
    stripe.Customer.modify(cus.id, invoice_settings={"default_payment_method": pm.id})
    SHOP_FILE.write_text(json.dumps({"customer_id": cus.id, "payment_method_id": pm.id}, indent=2))
    return cus.id, pm.id


def load_shop():
    """Return (customer_id, payment_method_id) written by seed.py."""
    if not SHOP_FILE.exists():
        raise RuntimeError("data/shop.json missing: run `python seed.py` first")
    d = json.loads(SHOP_FILE.read_text())
    return d["customer_id"], d["payment_method_id"]


def pay_supplier(customer_id, pm_id, supplier, item, qty, unit_price, clause_ids, evidence,
                 approved_by="agent"):
    """Charge the shop's card for a purchase order. Returns the PaymentIntent."""
    amount = round(qty * unit_price * 100)  # pence
    supplier_acct = SUPPLIER_ACCOUNTS.get(supplier, "")
    params = dict(
        amount=amount, currency="gbp", customer=customer_id, payment_method=pm_id,
        confirm=True, off_session=True,
        description=f"PO: {qty} x {item} from {supplier}",
        metadata={  # audit trail lives on the money itself; values must be str <= 500 chars
            "supplier": supplier, "supplier_account": supplier_acct,
            "item": item, "qty": str(qty), "unit_price": str(unit_price),
            "clauses": ",".join(clause_ids), "evidence": str(evidence)[:500],
            "approved_by": approved_by,
        },
    )
    if supplier_acct:
        try:  # route funds to the supplier's Connect account
            return stripe.PaymentIntent.create(**params, transfer_data={"destination": supplier_acct})
        except stripe.InvalidRequestError as e:
            # Connected account can't receive transfers yet: keep the charge on the platform.
            params["metadata"]["routing_note"] = f"platform charge; destination refused: {str(e)[:120]}"
    return stripe.PaymentIntent.create(**params)


def refund(payment_intent_id):
    return stripe.Refund.create(payment_intent=payment_intent_id)


def dashboard_url(payment_intent_id):
    return f"https://dashboard.stripe.com/test/payments/{payment_intent_id}"
