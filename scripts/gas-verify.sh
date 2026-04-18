#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=_gas-env.sh
source "${ROOT_DIR}/scripts/_gas-env.sh"
# CI では GAS_WEBAPP_URL を環境変数で渡す。手元では未設定なら .env.local を読む。
if [[ -z "${GAS_WEBAPP_URL:-}" ]]; then
  gas_load_env_from_local "${ROOT_DIR}"
fi

if [[ -z "${GAS_WEBAPP_URL:-}" ]]; then
  echo "ERROR: GAS_WEBAPP_URL が未設定です。.env.local にウェブアプリの /exec URL を書いてください。"
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

code="$(curl -sS -o "${tmp}" -w "%{http_code}" -L --max-time 25 -X GET "${GAS_WEBAPP_URL}" || true)"
body="$(cat "${tmp}")"

if [[ "${code}" != "200" ]]; then
  echo "ERROR: GAS ウェブアプリ GET が HTTP ${code} でした。デプロイを管理で「種類: ウェブアプリ」の URL を .env.local の GAS_WEBAPP_URL に貼り直してください。"
  exit 1
fi

if ! grep -q "personal-kakeibo GAS OK" <<<"${body}"; then
  echo "ERROR: GAS 応答に期待文字列がありません（ウェブアプリではない URL の可能性）。"
  exit 1
fi

echo "OK: GAS ウェブアプリ (${GAS_WEBAPP_URL}) が応答しています。"
