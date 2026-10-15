"""BeanCounter: Streamlit UI. One page, one process.

    streamlit run app.py
"""
import json
import random

import pandas as pd
import streamlit as st

import agent
import memory
import policy
import stripe_client

st.set_page_config(page_title="BeanCounter", page_icon="☕", layout="wide")

ACTION_STYLE = {
    "auto_buy": ("✅", "Auto-bought", "green"),
    "approved": ("✅", "Approved & paid", "green"),
    "needs_approval": ("⏳", "Needs owner approval", "orange"),
    "already_pending": ("⏳", "Already awaiting approval", "orange"),
    "blocked": ("⛔", "Blocked & escalated", "red"),
    "rejected": ("✖️", "Rejected by owner", "gray"),
    "no_action": ("➖", "No action", "gray"),
}


def money(x):
    return f"£{x:,.2f}"


def pi_link(pi):
    return f"[{pi}]({stripe_client.dashboard_url(pi)})" if pi else "—"


def decision_card(rec):
    icon, label, color = ACTION_STYLE.get(rec["action"], ("•", rec["action"], "gray"))
    with st.container(border=True):
        top = st.columns([3, 2, 2])
        top[0].markdown(f"**{icon} {rec['item_name']}**  \n:{color}[{label}]")
        top[1].markdown(f"**{rec['supplier'] or '—'}**  \n{rec['qty']} × {money(rec['unit_price'])}")
        top[2].markdown(f"**{money(rec['total'])}**  \nClauses {' '.join(rec['clause_ids'])}")
        st.caption(rec["reasoning"])
        for sk in rec.get("skipped_quotes", []):
            st.caption(f"↳ skipped {sk['supplier']} at {money(sk['unit_price'])} ({sk['clause']}: {sk['reason']})")
        if rec.get("payment_intent"):
            st.markdown(f"Stripe: {pi_link(rec['payment_intent'])}")


# ---------------------------------------------------------------- header
st.title("☕ BeanCounter")
st.markdown("**Bean & Leaf Coffee's finance team.** Watches stock, buys from the cheapest approved "
            "supplier within the owner's written policy, and explains every pound.")

spent = memory.spent_today()
m = st.columns(4)
m[0].metric("Spent today", money(spent), help="§5 daily cap")
m[1].metric("Daily cap left", money(policy.DAILY_CAP - spent))
m[2].metric("Auto-approve limit", money(policy.AUTO_APPROVE_LIMIT), help="§3 / §4")
m[3].metric("Pending approvals", len(agent.pending()))

with st.expander("📜 Purchasing policy (enforced in code by policy.py)"):
    st.markdown(policy.load_policy_text().replace("\n§", "\n\n§"))

left, right = st.columns([3, 2], gap="large")

# ---------------------------------------------------------------- 1. stock
with left:
    st.subheader("1 · Stock")
    stock = agent.load_stock()
    df = pd.DataFrame([
        {"Item": s["name"], "On hand": s["qty"], "Reorder below": s["reorder_level"], "Par": s["par"],
         "Last paid": money(s["last_price"]), "Status": "🔴 Low" if policy.is_low(s) else "🟢 OK"}
        for s in stock.values()
    ])
    st.dataframe(df, hide_index=True, width="stretch")

    c1, c2, c3 = st.columns([2, 1, 2])
    item_id = c1.selectbox("Update qty", list(stock), format_func=lambda k: stock[k]["name"],
                           label_visibility="collapsed")
    new_qty = c2.number_input("Qty", min_value=0, value=stock[item_id]["qty"], step=1,
                              label_visibility="collapsed", key=f"qty_{item_id}")
    if c3.button("Save count", width="stretch"):
        stock[item_id]["qty"] = int(new_qty)
        agent.save_stock(stock)
        st.rerun()
    if st.button("☕ Simulate a morning rush", help="Sells some stock of every item"):
        for s in stock.values():
            s["qty"] = max(0, s["qty"] - random.randint(1, max(1, s["par"] // 4)))
        agent.save_stock(stock)
        st.rerun()

# ---------------------------------------------------------------- 2. run agent
    st.subheader("2 · Run the agent")
    if st.button("▶ Run BeanCounter", type="primary", width="stretch"):
        with st.spinner("Scanning stock, quoting suppliers, checking policy…"):
            st.session_state.last_run = agent.run()
        st.rerun()
    for rec in st.session_state.get("last_run", []):
        decision_card(rec)

# ---------------------------------------------------------------- 3. approvals
with right:
    st.subheader("3 · Pending approvals")
    pend = agent.pending()
    if not pend:
        st.info("Nothing waiting for you.")
    for rec in pend:
        with st.container(border=True):
            st.markdown(f"**{rec['item_name']}** from **{rec['supplier']}**  \n"
                        f"{rec['qty']} × {money(rec['unit_price'])} = **{money(rec['total'])}**")
            st.caption(f"{' '.join(rec['clause_ids'])} · {rec['reasoning']}")
            a, r = st.columns(2)
            if a.button("Approve", key=f"ap_{rec['id']}", type="primary", width="stretch"):
                out = agent.approve(rec["id"])
                st.session_state.flash = (f"Paid {money(out['total'])} to {out['supplier']}: "
                                          f"{out['payment_intent']}") if out.get("payment_intent") \
                    else f"Guard blocked it: {out['reasoning']}"
                st.rerun()
            if r.button("Reject", key=f"rj_{rec['id']}", width="stretch"):
                agent.reject(rec["id"])
                st.session_state.flash = f"Rejected {rec['item_name']} from {rec['supplier']}"
                st.rerun()
    if st.session_state.get("flash"):
        st.success(st.session_state.pop("flash"))

# ---------------------------------------------------------------- 4. why
    st.subheader("4 · Ask why")
    q = st.text_input("Question", placeholder="Why did you buy oat milk from Booker?",
                      label_visibility="collapsed")
    if st.button("Ask", width="stretch") and q:
        with st.spinner("Asking Cognee memory…"):
            ans = memory.why(q)
        st.caption(f"Answered from **{ans['source']}** memory")
        st.markdown(ans["answer"])
        if ans["source"] == "cognee":  # pin the answer to hard evidence: clause, numbers, Stripe PI
            with st.expander("Evidence from the audit log", expanded=True):
                st.text(memory._why_from_log(q))

# ---------------------------------------------------------------- 5. audit log
st.subheader("5 · Audit log")
log = memory.read_log()
if not log:
    st.caption("No decisions yet.")
else:
    st.dataframe(pd.DataFrame([{
        "Time": r.get("ts", "")[11:19], "Item": r.get("item_name", r["item"]), "Action": r["action"],
        "Supplier": r.get("supplier") or "", "Total": money(r["total"]),
        "Clauses": " ".join(r["clause_ids"]), "By": r.get("approved_by") or "",
        "Stripe": stripe_client.dashboard_url(r["payment_intent"]) if r.get("payment_intent") else None,
    } for r in reversed(log)]), hide_index=True, width="stretch",
        column_config={"Stripe": st.column_config.LinkColumn("Stripe", display_text=r"payments/(pi_\w+)")})
