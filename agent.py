"""BeanCounter orchestration: detect low stock -> quote -> policy check -> buy or escalate.

Row 2: pure rules, no LLM. (Row 4 inserts an LLM proposal step before the guard.)

    python agent.py              # run once, print one line per item
    python agent.py approve <id> # owner approves a pending order
    python agent.py reject <id>
"""
import json
import sys
import uuid
from pathlib import Path

import memory
import policy
import stripe_client

DATA = Path(__file__).parent / "data"
STOCK_FILE = DATA / "stock.json"
SUPPLIERS_FILE = DATA / "suppliers.json"


def load_stock() -> dict:
    return json.loads(STOCK_FILE.read_text())


def save_stock(stock: dict):
    STOCK_FILE.write_text(json.dumps(stock, indent=2))


def load_quotes(item_id: str) -> list[dict]:
    """The mocked 'market scan'."""
    return [q for q in json.loads(SUPPLIERS_FILE.read_text()) if q["item"] == item_id]


def _new_record(item_id, stock_item, supplier, qty, unit_price, dec: policy.Decision) -> dict:
    return {
        "id": uuid.uuid4().hex[:8], "item": item_id, "item_name": stock_item["name"],
        "supplier": supplier, "qty": qty, "unit_price": unit_price, "total": round(qty * unit_price, 2),
        "action": dec.action, "status": "pending" if dec.action == policy.NEEDS_APPROVAL else "done",
        "clause_ids": dec.clause_ids, "evidence": dec.evidence, "reasoning": dec.reasoning,
        "skipped_quotes": dec.skipped_quotes, "payment_intent": None, "approved_by": None,
    }


def _execute_purchase(rec: dict, stock: dict, approved_by: str) -> dict:
    """Pay the supplier, then update stock. Mutates and returns rec."""
    cus_id, pm_id = stripe_client.load_shop()
    pi = stripe_client.pay_supplier(
        cus_id, pm_id, rec["supplier"], rec["item"], rec["qty"], rec["unit_price"],
        rec["clause_ids"], json.dumps(rec["evidence"]), approved_by=approved_by,
    )
    rec["payment_intent"] = pi.id
    rec["approved_by"] = approved_by
    item = stock[rec["item"]]
    item["qty"] += rec["qty"]
    item["last_price"] = rec["unit_price"]
    save_stock(stock)
    return rec


def run() -> list[dict]:
    """One agent pass over all stock. Returns the decision records (also written to the log)."""
    stock = load_stock()
    spent = memory.spent_today()
    already_pending = {(r["item"], r["supplier"], r["qty"]) for r in pending()}
    results = []
    for item_id, s in stock.items():
        quotes = load_quotes(item_id)
        best, skipped = policy.choose_supplier(quotes)
        qty = policy.reorder_qty(s)
        if best is None:
            dec = policy.Decision(policy.BLOCKED if policy.is_low(s) else policy.NO_ACTION,
                                  ["§2", "§7"], {"qty": s["qty"], "reorder_level": s["reorder_level"]},
                                  "no approved supplier has stock", skipped)
            supplier, price = None, 0.0
        else:
            supplier, price = best["supplier"], best["unit_price"]
            dec = policy.evaluate(s, supplier, qty, price, spent)
            dec.skipped_quotes = skipped
        rec = _new_record(item_id, s, supplier, qty if dec.action != policy.NO_ACTION else 0, price, dec)
        if dec.action == policy.AUTO_BUY:
            _execute_purchase(rec, stock, approved_by="agent")
            spent += rec["total"]
        elif dec.action == policy.NEEDS_APPROVAL and (item_id, supplier, qty) in already_pending:
            rec.update(action="already_pending", status="done",
                       reasoning="identical order is already awaiting owner approval")
        memory.record_decision(rec)
        results.append(rec)
    return results


def _find_pending(decision_id: str) -> dict:
    for r in memory.read_log():
        if r["id"] == decision_id and r["action"] == policy.NEEDS_APPROVAL:
            return r
    raise ValueError(f"no pending decision {decision_id}")


def approve(decision_id: str) -> dict:
    """Owner approves. The guard re-runs (§5 may have changed) before any money moves."""
    rec = _find_pending(decision_id)
    stock = load_stock()
    dec = policy.evaluate(stock[rec["item"]], rec["supplier"], rec["qty"], rec["unit_price"], memory.spent_today())
    new = {**rec, "id": uuid.uuid4().hex[:8], "parent_id": rec["id"], "status": "done"}
    if dec.action in (policy.NEEDS_APPROVAL, policy.AUTO_BUY):
        new.update(action="approved", clause_ids=["§4"] + [c for c in rec["clause_ids"] if c != "§4"],
                   reasoning=f"owner approved: {rec['reasoning']}")
        _execute_purchase(new, stock, approved_by="owner")
    else:  # the world changed since it was queued (e.g. daily cap): guard wins
        new.update(action=policy.BLOCKED, clause_ids=dec.clause_ids, evidence=dec.evidence,
                   reasoning=f"owner approved but guard blocked: {dec.reasoning}")
    return memory.record_decision(new)


def reject(decision_id: str, note: str = "") -> dict:
    rec = _find_pending(decision_id)
    new = {**rec, "id": uuid.uuid4().hex[:8], "parent_id": rec["id"], "status": "done",
           "action": "rejected", "approved_by": "owner", "reasoning": f"owner rejected. {note}".strip()}
    return memory.record_decision(new)


def pending() -> list[dict]:
    """Pending orders that have not yet been approved or rejected."""
    log = memory.read_log()
    resolved = {r.get("parent_id") for r in log if r.get("parent_id")}
    return [r for r in log if r["action"] == policy.NEEDS_APPROVAL and r["id"] not in resolved]


def _print(rec: dict):
    pi = f" PI={rec['payment_intent']}" if rec.get("payment_intent") else ""
    print(f"[{rec['action']:>14}] {rec['item_name']:<18} {rec['supplier'] or '-':<18} "
          f"{rec['qty']:>3} x £{rec['unit_price']:.2f} = £{rec['total']:.2f}  {rec['clause_ids']}{pi}")
    print(f"                 id={rec['id']}  {rec['reasoning']}")
    for q in rec.get("skipped_quotes", []):
        print(f"                 skipped {q['supplier']} £{q['unit_price']:.2f} ({q['clause']}: {q['reason']})")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        for r in run():
            _print(r)
    elif args[0] == "approve":
        _print(approve(args[1]))
    elif args[0] == "reject":
        _print(reject(args[1]))
    elif args[0] == "pending":
        for r in pending():
            _print(r)
