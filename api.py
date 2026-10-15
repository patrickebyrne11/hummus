"""BeanCounter HTTP API for the Stockwise (Next.js) front end.

Thin wrapper over agent.py / policy.py / memory.py: all decisions, the hard
guard, Stripe PaymentIntents and Cognee memory stay in Python.

    .venv/bin/uvicorn api:app --port 8000
"""
import json
import random

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import agent
import memory
import policy
import seed
import stripe_client

app = FastAPI(title="BeanCounter API")


def _state():
    stock = agent.load_stock()
    spent = memory.spent_today()
    log = memory.read_log()
    return {
        "stock": [{"id": k, **v, "low": policy.is_low(v)} for k, v in stock.items()],
        "metrics": {"spent_today": spent, "daily_cap": policy.DAILY_CAP,
                    "auto_limit": policy.AUTO_APPROVE_LIMIT},
        "pending": agent.pending(),
        "log": list(reversed(log)),
        "policy": [l for l in policy.load_policy_text().splitlines() if l.startswith("§")],
        "dashboard_base": stripe_client.dashboard_url(""),
    }


@app.get("/state")
def state():
    return _state()


@app.post("/run")
def run():
    return {"results": agent.run(), **_state()}


@app.post("/approve/{decision_id}")
def approve(decision_id: str):
    try:
        return {"result": agent.approve(decision_id), **_state()}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/reject/{decision_id}")
def reject(decision_id: str):
    try:
        return {"result": agent.reject(decision_id), **_state()}
    except ValueError as e:
        raise HTTPException(404, str(e))


class StockUpdate(BaseModel):
    item: str
    qty: int


@app.post("/stock")
def update_stock(u: StockUpdate):
    stock = agent.load_stock()
    if u.item not in stock:
        raise HTTPException(404, f"unknown item {u.item}")
    stock[u.item]["qty"] = max(0, u.qty)
    agent.save_stock(stock)
    return _state()


@app.post("/simulate")
def simulate():
    """Morning rush: sell some of every item."""
    stock = agent.load_stock()
    for s in stock.values():
        s["qty"] = max(0, s["qty"] - random.randint(1, max(1, s["par"] // 4)))
    agent.save_stock(stock)
    return _state()


@app.post("/reset")
def reset():
    """Back to the demo seed (stock + audit log). Keeps the Stripe customer."""
    seed.reset_data()
    return _state()


class Question(BaseModel):
    question: str


@app.post("/why")
def why(q: Question):
    ans = memory.why(q.question)
    ans["evidence"] = memory._why_from_log(q.question)
    return ans
