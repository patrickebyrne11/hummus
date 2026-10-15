"""Cognee Cloud memory + local JSON mirror.

Every decision is written to data/audit_log.jsonl first, then to Cognee in a
background thread, so the demo never waits on Cognee. `why()` asks Cognee and
falls back to the local log + policy via the LLM if Cognee errors or is slow.

Cognee Cloud API (tested against our tenant): serve() -> remember() -> recall().
recall() must be scoped with datasets=[...] or the cloud returns 409, and a
memory takes a few seconds after remember() before recall() can see it.

    python memory.py --seed    # load policy + past decisions into Cognee
    python memory.py --ask "Why didn't you buy from CheapBeans?"
"""
import asyncio
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

DATA = Path(__file__).parent / "data"
AUDIT_LOG = DATA / "audit_log.jsonl"
POLICY = DATA / "policy.md"

POLICY_DATASET = "beancounter_policy"
DECISIONS_DATASET = "beancounter_decisions"
WHY_TIMEOUT_S = 25

# Gives the agent a history to recall: where last-paid prices came from and why CheapBeans is off the list.
PAST_DECISIONS = [
    "2026-10-01: The owner rejected CheapBeans Ltd as a coffee bean supplier after a quality complaint "
    "(stale beans, customers noticed). CheapBeans Ltd is not an approved supplier under policy §2.",
    "2026-10-06: Bought 24 L oat milk from Booker Wholesale at £1.60/L (total £38.40). Auto-approved under §3.",
    "2026-10-08: Bought 4 x croissants (x12) from Booker Wholesale at £9.00 each (total £36.00). Auto-approved under §3.",
    "2026-10-09: Bought 10 kg coffee beans from Bean Bros Roasters at £14.00/kg (total £140.00). "
    "Over £75 so the owner approved it under §4.",
]

# One worker so background writes to Cognee happen in order, one serve() session at a time.
_writer = ThreadPoolExecutor(max_workers=1)


async def _remember(texts, dataset):
    import cognee
    await cognee.serve(url=os.environ["COGNEE_SERVICE_URL"], api_key=os.environ["COGNEE_API_KEY"])
    try:
        for text in texts:
            await cognee.remember(text, dataset_name=dataset)
    finally:
        await cognee.disconnect()


async def _recall(question):
    import cognee
    await cognee.serve(url=os.environ["COGNEE_SERVICE_URL"], api_key=os.environ["COGNEE_API_KEY"])
    try:
        results = await cognee.recall(query_text=question, datasets=[POLICY_DATASET, DECISIONS_DATASET])
    finally:
        await cognee.disconnect()
    return "\n".join(r["text"] for r in results if r.get("text"))


def decision_text(d):
    """One plain-English line per decision: what Cognee stores and what the 'why' answers cite."""
    return (f"Decision {d['id']}: {d['action']} {d['qty']} {d['item']} from {d['supplier']} "
            f"at £{d['unit_price']} (total £{d['total']}). Clauses {', '.join(d['clause_ids'])}. "
            f"Evidence: {d['evidence']}. Approved by: {d.get('approved_by', 'agent')}. "
            f"Stripe PaymentIntent: {d.get('payment_intent', 'none')}.")


def record_decision(d):
    """Append to the local audit log, then send to Cognee in the background. Never blocks or raises."""
    with AUDIT_LOG.open("a") as f:
        f.write(json.dumps(d) + "\n")
    future = _writer.submit(asyncio.run, _remember([decision_text(d)], DECISIONS_DATASET))
    future.add_done_callback(lambda fut: fut.exception() and print(f"[memory] Cognee write failed: {fut.exception()}"))


def why(question):
    """Answer 'why did you…' from Cognee memory; fall back to audit log + policy via the LLM."""
    try:
        answer = _writer.submit(asyncio.run, _recall(question)).result(timeout=WHY_TIMEOUT_S)
        if answer:
            return {"source": "cognee", "answer": answer}
    except Exception as e:
        print(f"[memory] Cognee recall failed, using fallback: {e}")
    return {"source": "audit_log", "answer": _why_fallback(question)}


def _why_fallback(question):
    import anthropic
    log = AUDIT_LOG.read_text() if AUDIT_LOG.exists() else ""
    client = anthropic.Anthropic(api_key=os.environ.get("LLM_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"))
    msg = client.messages.create(
        model=os.environ.get("LLM_MODEL", "claude-sonnet-5-5"), max_tokens=400,
        system="Answer the owner's question using only this purchasing policy and audit log. "
               "Cite the clause ids (§) and the evidence, and the Stripe PaymentIntent id if there is one.",
        messages=[{"role": "user", "content": f"POLICY:\n{POLICY.read_text()}\n\nAUDIT LOG:\n{log}\n\nQUESTION: {question}"}],
    )
    return msg.content[0].text


def seed():
    """Load the policy and past decisions into Cognee. Run once, a minute before the demo."""
    asyncio.run(_remember([POLICY.read_text()], POLICY_DATASET))
    asyncio.run(_remember(PAST_DECISIONS, DECISIONS_DATASET))
    print(f"Seeded Cognee: policy -> {POLICY_DATASET}, {len(PAST_DECISIONS)} past decisions -> {DECISIONS_DATASET}")


if __name__ == "__main__":
    if "--seed" in sys.argv:
        seed()
    if "--ask" in sys.argv:
        print(why(sys.argv[sys.argv.index("--ask") + 1]))
