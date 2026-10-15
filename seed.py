"""One-off setup. Run once after filling in .env:

    python seed.py            # Stripe customer + card, reset stock + audit log
    python seed.py --hello    # also fire a hello-world PaymentIntent to prove the pipe works
    python seed.py --new-customer   # create a fresh Stripe customer instead of reusing data/shop.json

Cognee seeding (policy + past decisions) is added in build-order row 4.
"""
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

DATA = Path(__file__).parent / "data"

# Pristine stock. The agent mutates data/stock.json after each purchase, so
# `python seed.py` restores this so every demo starts from the same place.
SEED_STOCK = {
  "oat_milk_l":      {"name": "Oat milk (L)",      "qty": 4,  "reorder_level": 10, "par": 30, "last_price": 1.60},
  "coffee_beans_kg": {"name": "Coffee beans (kg)", "qty": 2,  "reorder_level": 5,  "par": 12, "last_price": 14.00},
  "cups_12oz":       {"name": "12oz cups (x50)",   "qty": 8,  "reorder_level": 4,  "par": 12, "last_price": 6.50},
  "croissants":      {"name": "Croissants (x12)",  "qty": 1,  "reorder_level": 3,  "par": 6,  "last_price": 9.00},
}


def seed_stripe():
    import stripe_client
    if stripe_client.SHOP_FILE.exists() and "--new-customer" not in sys.argv:
        cus_id, pm_id = stripe_client.load_shop()
        print(f"Reusing Stripe customer {cus_id} (pass --new-customer to create a fresh one)")
        return cus_id, pm_id
    cus_id, pm_id = stripe_client.setup_shop_customer()
    print(f"Stripe customer: {cus_id}")
    print(f"Payment method:  {pm_id}")
    print(f"Saved to {stripe_client.SHOP_FILE}")
    return cus_id, pm_id


def reset_data():
    import json
    (DATA / "audit_log.jsonl").write_text("")
    (DATA / "stock.json").write_text(json.dumps(SEED_STOCK, indent=2))
    print("Reset data/audit_log.jsonl and data/stock.json")


def hello_world_payment(cus_id, pm_id):
    import stripe_client
    pi = stripe_client.pay_supplier(
        cus_id, pm_id, supplier="Booker Wholesale", item="hello_world", qty=1, unit_price=1.00,
        clause_ids=["§0"], evidence="hello-world smoke test from seed.py", approved_by="seed",
    )
    print(f"Hello-world PaymentIntent: {pi.id} status={pi.status} amount={pi.amount}p")
    print(f"Dashboard: {stripe_client.dashboard_url(pi.id)}")
    return pi


if __name__ == "__main__":
    cus_id, pm_id = seed_stripe()
    reset_data()
    if "--hello" in sys.argv:
        hello_world_payment(cus_id, pm_id)
