# Hummus

A corner coffee shop has no finance team. Hummus gives it one.

**Hummus** reads the owner's stock list or spreadsheet, shows what's running out, finds the best wholesale deals within a budget, and checks out on Stripe once the owner approves.

The repo also holds **BeanCounter**, a Python restocking agent that buys on its own within the owner's written purchasing policy. It isn't part of the Hummus app; it runs separately with its own Streamlit dashboard.

Built for the **Briefcase × Stripe hackathon, Track 01 "Agents that spend"**, plus the **Cognee** side quest.

---

## What's in the repo

| Path | What it is |
|---|---|
| `stockwise/` | The Hummus app (Next.js) |
| `app.py` | BeanCounter's Streamlit dashboard |
| `api.py` | HTTP API over the BeanCounter agent (not used by the Hummus app) |
| `agent.py` | Restocking loop: find low stock, quote suppliers, check policy, buy or ask the owner |
| `policy.py` | The hard guard: every policy clause as plain code |
| `stripe_client.py` | Stripe test mode: shop customer, PaymentIntents with audit metadata |
| `memory.py` | Cognee Cloud memory plus a local audit log mirror |
| `seed.py` | One-off setup: Stripe customer and test card, reset stock and audit log |
| `data/` | Policy text, stock, mocked supplier prices, audit log |
| `dev.sh` | Starts the Hummus app |

---

## BeanCounter: how the agent decides

1. Find every item below its reorder level.
2. Read supplier quotes for it (the "market scan").
3. Pick the cheapest approved supplier and order up to par.
4. **Run the policy guard** (`policy.py`). It recomputes every check from the raw data:
   - supplier not approved → blocked (§2)
   - price more than 15% above last paid → blocked and escalated (§6)
   - today's spend would pass £250 → blocked (§5)
   - order over £75 → waits for the owner (§4)
   - otherwise → bought automatically (§3)
5. Pay through Stripe, or queue the order for approval.
6. Record the decision in the audit log and in Cognee.

Approving a queued order runs the guard again before any money moves, so a change since it was queued, such as hitting the daily cap, still blocks it.

**Design rule: the AI proposes, the deterministic policy engine disposes.** In Hummus, Claude suggests products, but the server computes every price, total and saving from the catalog, and checkout re-prices everything. In BeanCounter, no payment happens without passing `policy.py`. The guard is code, not a prompt. An LLM proposal step in front of the guard is designed for but not wired in yet, so BeanCounter currently runs on the rules alone.

### The policy (`data/policy.md`)

```
§1 Reorder trigger: reorder an item when stock falls below its reorder level. Order up to par level.
§2 Approved suppliers only: Booker Wholesale, Bidfood, Bean Bros Roasters. Any other supplier is forbidden.
§3 Auto-approve: a single order of £75 or less may be placed without the owner.
§4 Owner approval: any single order over £75 requires the owner's approval.
§5 Daily cap: total spend per day must not exceed £250, approved or not.
§6 Price sanity: do not buy if the unit price is more than 15% above that item's last paid price. Escalate instead.
§7 Cheapest approved supplier: choose the lowest unit price among approved suppliers that have stock.
```

With the seed data, one run shows every outcome:

| Item | Outcome | Why |
|---|---|---|
| Oat milk | bought, £40.30 | under £75, cheapest approved supplier (§3, §7) |
| Coffee beans | waits for approval, £135.00 | over £75 (§4). CheapBeans Ltd is cheaper but not approved (§2) |
| Croissants | blocked | 27.8% above last paid price (§6) |
| Cups | nothing | stock above reorder level (§1) |

---

## Stripe

- Everything runs in **test mode**.
- The shop owner's card is saved on a Stripe Customer, "Bean & Leaf Coffee". Each BeanCounter purchase is a PaymentIntent charged to that card.
- **The audit trail lives on the money.** Every PaymentIntent carries `metadata` with supplier, item, quantity, unit price, policy clauses, evidence, and who approved it.
- Each approved supplier has a Stripe Connect account. Purchases try a destination charge to the supplier. If the account hasn't finished onboarding, the charge stays on the platform and the supplier's account id is still recorded in metadata.
- Hummus pays through Stripe Checkout. Use the test card `4242 4242 4242 4242`, any future expiry and any CVC.

**Finding payments in the Dashboard.** Our key belongs to a Stripe **sandbox**, not the main account's test mode. Sign in at https://dashboard.stripe.com, then pick the sandbox from the account switcher at the top left. Links in BeanCounter's audit log open the right sandbox directly.

---

## Cognee memory

`memory.py` writes every decision to `data/audit_log.jsonl` first, then to Cognee Cloud in the background, so the demo never waits on Cognee. `python memory.py --seed` loads the policy and a short purchase history, for example why CheapBeans Ltd was dropped and where last-paid prices came from.

The **Why?** box on BeanCounter's dashboard asks Cognee and shows the matching audit-log record underneath: clause, numbers and Stripe PaymentIntent id. If Cognee is down or slow, it answers from the audit log instead.

---

## Why the supplier market is mocked

Supplier prices come from `stockwise/src/lib/catalog.ts` for Hummus and `data/suppliers.json` for BeanCounter. Real wholesalers have no open pricing APIs, and scraping would be slow and fragile in a two-hour build. Mocked prices also let us design the data so one run shows every policy outcome. Everything after the quote is real: the guard, the Stripe payments and the memory.

---

## Running it

You need Node 22+ and a Stripe test-mode key. The AI steps need either an Anthropic API key or the Claude Code CLI signed in to a Claude subscription.

```bash
cd stockwise
npm install
cp .env.example .env.local        # Stripe test key, plus how to reach Claude (below)
cd ..
./dev.sh                          # then open http://localhost:3000
```

`CLAUDE_BACKEND` in `stockwise/.env.local` picks how Hummus reaches Claude:

| Value | Uses |
|---|---|
| `api` | `ANTHROPIC_API_KEY`, which needs API credits |
| `claude-code` | the local Claude Code CLI on your Claude subscription. Only for running on your own machine |
| `demo` | no AI at all: rule-based matching and a demo checkout, for walkthroughs |

### Running BeanCounter (optional, separate)

You need Python 3.11+.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env              # Stripe test key, supplier accounts, Cognee keys
.venv/bin/python seed.py          # Stripe customer + test card, fresh stock and audit log
.venv/bin/python memory.py --seed # optional: load policy + history into Cognee
.venv/bin/streamlit run app.py
```

Run `.venv/bin/python seed.py` again to reset its demo.

---

## Keys and safety

The repo is public. `.env`, `stockwise/.env.local` and `data/shop.json` are gitignored and must never be committed. Share keys with teammates privately. Hummus refuses live Stripe keys.

## Team

Paddy, Asim, Nat and Terry.
