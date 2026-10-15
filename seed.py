"""One-off setup. Run once after filling in .env:

    python seed.py            # Stripe customer + card, reset audit log
    python seed.py --hello    # also fire a hello-world PaymentIntent to prove the pipe works

Cognee seeding (policy + past decisions) is added in build-order row 4.
"""
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DATA = Path(__file__).parent / "data"


def seed_stripe():
    import stripe_client
    cus_id, pm_id = stripe_client.setup_shop_customer()
    print(f"Stripe customer: {cus_id}")
    print(f"Payment method:  {pm_id}")
    print(f"Saved to {stripe_client.SHOP_FILE}")
    return cus_id, pm_id


def reset_audit_log():
    (DATA / "audit_log.jsonl").write_text("")
    print("Cleared data/audit_log.jsonl")


def hello_world_payment(cus_id, pm_id):
    import stripe_client
    pi = stripe_client.pay_supplier(
        cus_id, pm_id, supplier="Metro Wholesale", item="hello_world", qty=1, unit_price=1.00,
        clause_ids=["§0"], evidence="hello-world smoke test from seed.py", approved_by="seed",
    )
    print(f"Hello-world PaymentIntent: {pi.id} status={pi.status} amount={pi.amount}p")
    print(f"Dashboard: {stripe_client.dashboard_url(pi.id)}")
    return pi


if __name__ == "__main__":
    cus_id, pm_id = seed_stripe()
    reset_audit_log()
    if "--hello" in sys.argv:
        hello_world_payment(cus_id, pm_id)
