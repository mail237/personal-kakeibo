#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=_gas-env.sh
source "${ROOT_DIR}/scripts/_gas-env.sh"
# shellcheck source=_gas-webapp-url.sh
source "${ROOT_DIR}/scripts/_gas-webapp-url.sh"

gas_load_env_from_local "${ROOT_DIR}"
if ! gas_resolve_webapp_url "${ROOT_DIR}"; then
  echo "ERROR: GAS の URL を決められません。.env.local に GAS_DEPLOYMENT_ID か GAS_WEBAPP_URL、または gas/WEBAPP_DEPLOYMENT_ID を用意してください。"
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

code="$(curl -sS -o "${tmp}" -w "%{http_code}" -L --max-time 25 -X GET "${GAS_WEBAPP_URL}" || true)"
body="$(cat "${tmp}")"

if [[ "${code}" != "200" ]]; then
  echo "ERROR: GAS ウェブアプリ GET が HTTP ${code} でした。gas/WEBAPP_DEPLOYMENT_ID がウェブアプリ用か確認し、npm run gas:pin-webapp または npm run gas:deploy を試してください。"
  exit 1
fi

if ! grep -q "personal-kakeibo GAS OK" <<<"${body}"; then
  echo "ERROR: GAS 応答に期待文字列がありません（ウェブアプリではない URL の可能性）。"
  exit 1
fi

echo "OK: GAS ウェブアプリ (${GAS_WEBAPP_URL}) が応答しています。"
