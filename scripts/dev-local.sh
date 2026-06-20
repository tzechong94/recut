#!/usr/bin/env bash
# Launch Recut locally (API + worker). Defaults to STUB models (no key, $0, instant).
#
#   ./scripts/dev-local.sh                 # stub mode — test the whole flow offline
#   RECUT_MODEL_BACKEND=qwen ./scripts/dev-local.sh   # live — uses key from backend/.env
#
# Then in another terminal:  cd web && npm run dev   →  http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")/../backend"
# shellcheck disable=SC1091
source .venv/bin/activate

# OS env wins over backend/.env, so stub is the default even though .env says qwen.
export RECUT_MODEL_BACKEND="${RECUT_MODEL_BACKEND:-stub}"
export RECUT_STORAGE_BACKEND="${RECUT_STORAGE_BACKEND:-local}"
export RECUT_WORK_DIR="${RECUT_WORK_DIR:-/tmp/recut}"
export RECUT_DATABASE_URL="${RECUT_DATABASE_URL:-sqlite:////tmp/recut/dev.db}"
mkdir -p "$RECUT_WORK_DIR"

echo "──────────────────────────────────────────────"
echo " Recut local   backend=$RECUT_MODEL_BACKEND   db=$RECUT_DATABASE_URL"
echo "──────────────────────────────────────────────"
if [ "$RECUT_MODEL_BACKEND" = "qwen" ]; then
  echo " LIVE mode — run ./scripts/dev-local.sh only after 'recut-doctor' passes."
else
  echo " STUB mode — no key needed. Sample reels in assets/samples/."
fi

python -m recut.api.main &  API=$!
python -m recut.worker.main &  WK=$!
trap 'echo; echo "stopping…"; kill $API $WK 2>/dev/null || true' EXIT INT TERM

sleep 1
echo " API    → http://localhost:8000  (docs: /docs)"
echo " worker → running"
echo " next   → in another terminal:  cd web && npm run dev   then open http://localhost:5173"
echo " (Ctrl+C here stops the API + worker)"
wait
