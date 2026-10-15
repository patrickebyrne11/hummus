# BeanCounter: autonomous restocking agent for a coffee shop

Hackathon: Briefcase × Stripe, Track 01 "Agents that spend" + Cognee side quest.
Hard deadline: record the demo at 20:30, submit by 21:00. Build the smallest thing that demos end to end.

## One-line pitch
A corner coffee shop has no finance team. BeanCounter watches stock, finds the cheapest approved
supplier, and buys within the owner's written policy. Small orders go through on their own; big ones
wait for one-tap approval. Every pound it spends points back to a policy clause and the evidence behind it.

## What the judges score (keep this in front of you)
| Points | Criterion | How we hit it |
|---|---|---|
| 35 | Works end to end | Real PaymentIntents in Stripe test mode, Dashboard visible in the video |
| 25 | Autonomy with control | Auto-buys under the limit, needs approval above it. **Hard guard in code**, not just the LLM prompt |
| 20 | Explains every pound | Clause and evidence stored in Stripe `metadata` AND Cognee. A "Why did you buy this?" query |
| 20 | Product / creativity | A real small-business pain; the agent is "the finance team" |

## Scope rules (non-negotiable for a 2-hour build)
- **The market scan is mocked.** `data/suppliers.json` holds 3 suppliers with prices. No scraping.
- **Stock input is a JSON file plus a manual form in the UI.** "Automatic" means a `simulate_sales()` button that
  decrements stock. No POS integration.
- **Payment model:** the shop owner's card is saved on a Stripe Customer, "Bean & Leaf Coffee". A purchase is a
  PaymentIntent charged to that card with `metadata.supplier=...`. The demo account plays the supplier
  marketplace. No Connect, no Issuing.
- **Notifications appear in the Streamlit UI** as a pending-approval card with Approve and Reject buttons. No email or Slack.
- **One process, one Streamlit app.** No backend server and no webhooks.

## Stack
- Python 3.11, `streamlit`, `stripe`, `cognee`, `python-dotenv`, and an LLM SDK (`anthropic` or `openai`)
- `.env` holds `STRIPE_SECRET_KEY=sk_test_...` and `LLM_API_KEY=...`. **`.env` goes in `.gitignore`, because the repo is public.**

## File structure
```
beancounter/
  app.py              # Streamlit UI: stock table, run agent, approvals queue, "why?" box, audit log
  agent.py            # orchestration: detect low stock -> quote -> policy check -> buy or escalate
  policy.py           # DETERMINISTIC policy engine (the hard guard). Returns decision + clause id
  stripe_client.py    # setup_shop_customer(), pay_supplier(), refund()
  memory.py           # Cognee wrapper + local JSON mirror (fallback so the demo never breaks)
  data/
    policy.md         # the written policy, loaded into Cognee
    stock.json        # current stock, par levels, reorder levels
    suppliers.json    # mocked market prices
    audit_log.jsonl   # local mirror of every decision
  seed.py             # one-off: create the Stripe customer + attach pm_card_visa, load policy into Cognee
  README.md
  .env.example
```

## data/policy.md (create exactly this; the clause IDs are referenced everywhere)
```
# Bean & Leaf Coffee — Purchasing Policy

§1 Reorder trigger: reorder an item when stock falls below its reorder level. Order up to par level.
§2 Approved suppliers only: Metro Wholesale, FreshDairy Co, BeanDirect. Any other supplier is forbidden.
§3 Auto-approve: a single order of £75 or less may be placed without the owner.
§4 Owner approval: any single order over £75 requires the owner's approval.
§5 Daily cap: total spend per day must not exceed £250, approved or not.
§6 Price sanity: do not buy if the unit price is more than 15% above that item's last paid price. Escalate instead.
§7 Cheapest approved supplier: choose the lowest unit price among approved suppliers that have stock.
```

## data/stock.json (seed)
```json
{
  "oat_milk_l":      {"name": "Oat milk (L)",      "qty": 4,  "reorder_level": 10, "par": 30, "last_price": 1.60},
  "coffee_beans_kg": {"name": "Coffee beans (kg)", "qty": 2,  "reorder_level": 5,  "par": 12, "last_price": 14.00},
  "cups_12oz":       {"name": "12oz cups (x50)",   "qty": 8,  "reorder_level": 4,  "par": 12, "last_price": 6.50},
  "croissants":      {"name": "Croissants (x12)",  "qty": 1,  "reorder_level": 3,  "par": 6,  "last_price": 9.00}
}
```

## data/suppliers.json (seed: mocked "market scan")
```json
[
  {"supplier": "Metro Wholesale", "item": "oat_milk_l",      "unit_price": 1.55, "in_stock": true},
  {"supplier": "FreshDairy Co",   "item": "oat_milk_l",      "unit_price": 1.70, "in_stock": true},
  {"supplier": "BeanDirect",      "item": "coffee_beans_kg", "unit_price": 13.50, "in_stock": true},
  {"supplier": "Metro Wholesale", "item": "coffee_beans_kg", "unit_price": 15.20, "in_stock": true},
  {"supplier": "CheapBeans Ltd",  "item": "coffee_beans_kg", "unit_price": 9.00,  "in_stock": true},
  {"supplier": "Metro Wholesale", "item": "croissants",      "unit_price": 11.50, "in_stock": true},
  {"supplier": "Metro Wholesale", "item": "cups_12oz",       "unit_price": 6.40,  "in_stock": true}
]
```
The seed numbers are designed to produce four demo outcomes:
- **Oat milk:** 26 L at £1.55 = £40.30 at Metro Wholesale. That's the cheapest approved supplier and under £75, so it **auto-buys (§1, §3, §7)**.
- **Coffee beans:** 10 kg. CheapBeans at £9 is cheaper but not approved, so it's skipped (§2). BeanDirect at £13.50 makes £135, which is over £75, so the order **waits for approval (§4)**.
- **Croissants:** £11.50 is 27.8% above the last paid £9.00, so the order is **blocked and escalated (§6)**.
- **Cups:** stock is above the reorder level, so there's **no action (§1)**.

## Agent flow (agent.py)
1. `low = [items where qty < reorder_level]`. Evidence: `{"qty": 4, "reorder_level": 10}`.
2. For each low item, read the candidate quotes from `suppliers.json`. This is the "market scan" step.
3. **LLM step (the agent):** give it the item, the quotes, the policy text and memory context from Cognee
   (past prices and past decisions for this item). Ask for structured JSON:
   `{"supplier", "qty", "unit_price", "total", "proposed_action": "buy|escalate|skip", "clause_ids": [...], "reasoning"}`.
4. **Hard guard (policy.py):** re-check the LLM's proposal deterministically, re-computing every check from the data.
   - If the supplier is not approved, block it (§2).
   - If the price is more than 15% above the last paid price, escalate (§6).
   - If today's spend plus this order would exceed £250, block it (§5).
   - If the order is over £75, it goes to approval (§4).
   - Otherwise it's an auto-buy (§3).
   - **If the guard and the LLM disagree, the guard wins and the disagreement is logged.** Show this in the demo:
     it's the "control" story.
5. `auto_buy` calls `stripe_client.pay_supplier(...)`; `needs_approval` goes into `st.session_state.pending`.
6. Every outcome calls `memory.record_decision(...)`, which writes to Cognee and to `audit_log.jsonl`.
7. On Approve, `pay_supplier(..., approved_by="owner")` runs and the decision is recorded with clause §4 and `approved_by`.
   On Reject, record the rejection. Stock updates after a purchase.

## stripe_client.py
```python
import os, stripe
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

def setup_shop_customer():
    cus = stripe.Customer.create(name="Bean & Leaf Coffee", email="owner@beanleaf.test")
    pm = stripe.PaymentMethod.attach("pm_card_visa", customer=cus.id)
    stripe.Customer.modify(cus.id, invoice_settings={"default_payment_method": pm.id})
    return cus.id, pm.id   # save to .env or data/shop.json

def pay_supplier(customer_id, pm_id, supplier, item, qty, unit_price, clause_ids, evidence, approved_by="agent"):
    amount = round(qty * unit_price * 100)   # pence
    return stripe.PaymentIntent.create(
        amount=amount, currency="gbp", customer=customer_id, payment_method=pm_id,
        confirm=True, off_session=True,
        description=f"PO: {qty} x {item} from {supplier}",
        metadata={                      # audit trail lives on the money itself
            "supplier": supplier, "item": item, "qty": str(qty), "unit_price": str(unit_price),
            "clauses": ",".join(clause_ids), "evidence": evidence[:500], "approved_by": approved_by,
        },
    )
```
Stripe metadata values must be strings, at most 500 characters each.

## memory.py (Cognee)
Check the installed Cognee version's API (`pip show cognee`). The core calls are:
```python
import cognee
from cognee import SearchType   # import path may differ by version; check docs

async def load_policy(text):
    await cognee.add(text, dataset_name="policy")
    await cognee.cognify()

async def record_decision(d: dict):          # also append d to data/audit_log.jsonl FIRST
    line = (f"Decision {d['id']}: {d['action']} {d['qty']} {d['item']} from {d['supplier']} "
            f"at £{d['unit_price']} (total £{d['total']}). Clauses {d['clause_ids']}. "
            f"Evidence: {d['evidence']}. Stripe: {d.get('payment_intent','none')}.")
    await cognee.add(line, dataset_name="decisions")
    await cognee.cognify()   # slow: run in the background or batch at the end of each agent run

async def why(question):
    return await cognee.search(query_text=question, query_type=SearchType.GRAPH_COMPLETION)
```
- **Fallback:** if Cognee errors or is slow, `why()` answers from `audit_log.jsonl` + `policy.md` via the LLM.
  The demo must never depend on cognify finishing.
- **Seed history to make memory matter:** add 3–4 past decisions to Cognee in `seed.py`, for example:
  - "2026-10-08 bought croissants at £9.00 from Metro Wholesale"
  - "Owner rejected CheapBeans Ltd on 2026-10-01: quality complaint"

  The agent can then say *why* CheapBeans isn't approved and where the last-paid price came from.

## app.py (Streamlit, one page)
1. **Stock table.** Include a manual "update qty" input and a "Simulate a morning rush" button that decrements stock.
2. **"Run BeanCounter" button.** It runs the agent and shows one card per item: action, supplier, total, clauses, reasoning.
3. **Pending approvals.** One card per pending order with Approve and Reject buttons. This is the operator notification.
4. **"Ask why" text box.** For example: "Why did you buy oat milk from Metro?" The answer cites the clause, the evidence and the Stripe PI id.
5. **Audit log table** from `audit_log.jsonl`, with links to `https://dashboard.stripe.com/test/payments/{pi_id}`.

## Build order (time-boxed)
| Until | Task | Done when |
|---|---|---|
| 19:20 | Repo, `.env`, `seed.py` (Stripe customer + PM), hello-world PaymentIntent | A PI shows in the Dashboard |
| 19:40 | `policy.py` guard + `agent.py` without the LLM (pure rules) + `pay_supplier` | Running the agent auto-buys oat milk; beans go pending; croissants are blocked |
| 19:55 | `app.py` with the stock table, run button, approvals, audit log | Clicking Approve on beans creates a PI |
| 20:10 | Add the LLM proposal step + Cognee `memory.py` + the "why" box (with the fallback) | The "why" question returns clause + evidence |
| 20:20 | README + dry run x2 | A clean run from a fresh seed |
| 20:30 | Record the video | 2:00 max |

**Cut list if behind (in this order):** LLM proposal step (the rules alone still work), Cognee cognify on every decision
(batch it at the end), simulate-sales button, styling. **Never cut:** Stripe PIs, the guard, the approval flow, metadata, the "why" answer.

## Demo video script (2:00)
- **0:00–0:15 — Problem.** A coffee shop owner restocks by hand. BeanCounter does it within a written policy.
- **0:15–0:30 — Setup.** Show the policy (§3, §4, §6) and the low stock.
- **0:30–1:05 — Run the agent.**
  - Oat milk auto-buys. Cut to the Stripe Dashboard: the PI is visible with its metadata.
  - CheapBeans is skipped (§2).
  - Beans are pending approval (§4). Croissants are blocked by the price check (§6).
- **1:05–1:25 — Approve the beans.** A second PI appears in the Dashboard.
- **1:25–1:50 — Ask why.** Ask "Why did you buy oat milk from Metro?" and "Why didn't you buy croissants?" The answers come from Cognee memory, citing the clauses and evidence.
- **1:50–2:00 — Close.** Every pound traces to a rule, the guard is in code, and memory explains the history.

## README must include
- What it does (2 lines), track + Cognee use, how to run (`pip install -r requirements.txt`, `python seed.py`, `streamlit run app.py`)
- The policy, plus the guard-vs-LLM design ("the LLM proposes, the deterministic policy engine disposes")
- A note that the supplier market is mocked, and why
