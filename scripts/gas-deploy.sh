#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${GAS_SCRIPT_ID:-}" ]]; then
  echo "ERROR: GAS_SCRIPT_ID が未設定です。"
  echo "例: export GAS_SCRIPT_ID=\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\""
  exit 1
fi

echo "==> push"
bash "${ROOT_DIR}/scripts/gas-push.sh"

cd "${ROOT_DIR}/gas"

if [[ -n "${GAS_DEPLOYMENT_ID:-}" ]]; then
  echo "==> clasp deploy (update existing deployment)"
  npx clasp deploy -i "${GAS_DEPLOYMENT_ID}" -d "auto deploy $(date -Iseconds)"
  echo "OK: deployed (deploymentId=${GAS_DEPLOYMENT_ID})"
else
  echo "==> clasp deploy (create new deployment)"
  npx clasp deploy -d "auto deploy $(date -Iseconds)"
  echo "OK: deployed"
  echo ""
  echo "NOTE:"
  echo "- 既存の WebアプリURL を固定したい場合は、上の deploy 出力に出る deploymentId を GAS_DEPLOYMENT_ID に設定して再実行してください。"
fi
