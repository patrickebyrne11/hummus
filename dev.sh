#!/usr/bin/env bash
# Start BeanCounter: Python API (agent, policy guard, Stripe, Cognee) + Stockwise Next.js UI.
#   ./dev.sh   then open http://localhost:3000
set -e
cd "$(dirname "$0")"
.venv/bin/uvicorn api:app --host 127.0.0.1 --port 8000 &
API=$!
trap 'kill $API 2>/dev/null' EXIT
(cd stockwise && [ -d node_modules ] || npm install)
cd stockwise && npm run dev -- --port 3000
