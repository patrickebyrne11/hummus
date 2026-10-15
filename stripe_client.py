"""Stripe test-mode wrapper. The demo account plays the supplier marketplace.

The shop owner's card is saved on a Stripe Customer ("Bean & Leaf Coffee").
Every purchase is a PaymentIntent charged off-session to that card, with the
audit trail (supplier, clauses, evidence) stored in PaymentIntent metadata.
"""
import json
import os
from pathlib import Path

import stripe
from dotenv import load_dotenv

load_dotenv()
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

SHOP_FILE = Path(__file__).parent / "data" / "shop.json"


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
    return stripe.PaymentIntent.create(
        amount=amount, currency="gbp", customer=customer_id, payment_method=pm_id,
        confirm=True, off_session=True,
        description=f"PO: {qty} x {item} from {supplier}",
        metadata={  # audit trail lives on the money itself; values must be str <= 500 chars
            "supplier": supplier, "item": item, "qty": str(qty), "unit_price": str(unit_price),
            "clauses": ",".join(clause_ids), "evidence": str(evidence)[:500],
            "approved_by": approved_by,
        },
    )


def refund(payment_intent_id):
    return stripe.Refund.create(payment_intent=payment_intent_id)


def dashboard_url(payment_intent_id):
    return f"https://dashboard.stripe.com/test/payments/{payment_intent_id}"
