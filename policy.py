"""Deterministic purchasing policy engine: the hard guard.

Every rule in data/policy.md is re-implemented here as plain code. The LLM
(row 4) may *propose* an order, but this module *disposes*: it recomputes
every check from the raw data and its verdict is final. Constants mirror
the clause text; if the policy changes, change both.
"""
from dataclasses import dataclass, field
from pathlib import Path

POLICY_FILE = Path(__file__).parent / "data" / "policy.md"

# §2
APPROVED_SUPPLIERS = {"Booker Wholesale", "Bidfood", "Bean Bros Roasters"}
# §3 / §4
AUTO_APPROVE_LIMIT = 75.00
# §5
DAILY_CAP = 250.00
# §6
PRICE_TOLERANCE = 0.15

# Actions the guard can return
AUTO_BUY = "auto_buy"            # §3: pay now
NEEDS_APPROVAL = "needs_approval"  # §4: queue for the owner
BLOCKED = "blocked"              # §2 / §5 / §6: do not buy, tell the owner
NO_ACTION = "no_action"          # §1 not triggered


def load_policy_text() -> str:
    return POLICY_FILE.read_text()


@dataclass
class Decision:
    action: str
    clause_ids: list[str]
    evidence: dict
    reasoning: str
    skipped_quotes: list[dict] = field(default_factory=list)


def is_low(stock_item: dict) -> bool:
    """§1 reorder trigger."""
    return stock_item["qty"] < stock_item["reorder_level"]


def reorder_qty(stock_item: dict) -> int:
    """§1: order up to par level."""
    return max(0, stock_item["par"] - stock_item["qty"])


def choose_supplier(quotes: list[dict]) -> tuple[dict | None, list[dict]]:
    """§7: cheapest approved supplier with stock. Returns (best, skipped)."""
    skipped, eligible = [], []
    for q in quotes:
        if q["supplier"] not in APPROVED_SUPPLIERS:
            skipped.append({**q, "clause": "§2", "reason": "not approved"})
        elif not q.get("in_stock", True):
            skipped.append({**q, "clause": "§7", "reason": "out of stock"})
        else:
            eligible.append(q)
    if not eligible:
        return None, skipped
    best = min(eligible, key=lambda q: q["unit_price"])
    for q in eligible:
        if q is not best:
            skipped.append({**q, "clause": "§7", "reason": "dearer"})
    return best, skipped


def evaluate(stock_item: dict, supplier: str, qty: int, unit_price: float,
             spent_today: float) -> Decision:
    """Run every check for a proposed order. Order of checks is the policy's priority."""
    total = round(qty * unit_price, 2)
    last = stock_item["last_price"]
    uplift = round(unit_price / last - 1, 6) if last else 0.0  # rounded: 16.10/14.00 must be exactly 15%
    evidence = {
        "qty": stock_item["qty"], "reorder_level": stock_item["reorder_level"], "par": stock_item["par"],
        "order_qty": qty, "supplier": supplier, "unit_price": unit_price, "total": total,
        "last_price": last, "price_uplift_pct": round(uplift * 100, 1),
        "spent_today": round(spent_today, 2), "daily_cap": DAILY_CAP, "auto_limit": AUTO_APPROVE_LIMIT,
    }

    if not is_low(stock_item):
        return Decision(NO_ACTION, ["§1"], evidence,
                        f"{stock_item['qty']} in stock, reorder below {stock_item['reorder_level']}")
    if qty <= 0:
        return Decision(NO_ACTION, ["§1"], evidence, "Already at par")

    if supplier not in APPROVED_SUPPLIERS:
        return Decision(BLOCKED, ["§2"], evidence, f"{supplier} isn't an approved supplier")

    if uplift > PRICE_TOLERANCE:
        return Decision(BLOCKED, ["§6", "§1"], evidence,
                        f"£{unit_price:.2f} is {uplift*100:.1f}% over last price £{last:.2f}. Limit is {PRICE_TOLERANCE*100:.0f}%")

    if spent_today + total > DAILY_CAP:
        return Decision(BLOCKED, ["§5", "§1"], evidence,
                        f"Would take today's spend past £{DAILY_CAP:.0f}")

    if total > AUTO_APPROVE_LIMIT:
        return Decision(NEEDS_APPROVAL, ["§4", "§1", "§7"], evidence,
                        f"£{total:.2f} is over £{AUTO_APPROVE_LIMIT:.0f}, needs your OK")

    return Decision(AUTO_BUY, ["§3", "§1", "§7"], evidence,
                    f"Under £{AUTO_APPROVE_LIMIT:.0f}, cheapest approved supplier")
