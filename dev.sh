#!/usr/bin/env bash
# Start the Hummus app.
#   ./dev.sh   then open http://localhost:3000
set -e
cd "$(dirname "$0")/stockwise"
[ -d node_modules ] || npm install
npm run dev -- --port 3000
