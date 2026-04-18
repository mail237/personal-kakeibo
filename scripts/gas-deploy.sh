#!/usr/bin/env bash
set -euo pipefail
#
# clasp deploy -i はウェブアプリの「入口」を消すことがあるため使わない。
# push → バージョン作成 → ブラウザでウェブアプリのデプロイだけ「最新バージョン」に差し替え。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=_gas-env.sh
source "${ROOT_DIR}/scripts/_gas-env.sh"
gas_load_env_from_local "${ROOT_DIR}"

# shellcheck source=_gas-webapp-url.sh
source "${ROOT_DIR}/scripts/_gas-webapp-url.sh"
if [[ -f "${ROOT_DIR}/gas/WEBAPP_DEPLOYMENT_ID" ]]; then
  export GAS_DEPLOYMENT_ID="$(tr -d ' \r\n\t' <"${ROOT_DIR}/gas/WEBAPP_DEPLOYMENT_ID")"
fi

if [[ -z "${GAS_SCRIPT_ID:-}" ]]; then
  echo "ERROR: GAS_SCRIPT_ID が未設定です。"
  exit 1
fi

echo "==> clasp push"
bash "${ROOT_DIR}/scripts/gas-push.sh"

cd "${ROOT_DIR}/gas"

echo "==> clasp version（スナップショット）※ ウェブアプリに載せる版を固定する"
npx clasp version "auto $(date -Iseconds)"

LATEST_VER="$(npx clasp versions 2>/dev/null | tail -1 | awk -F' - ' '{print $1}')"
echo ""
echo "==> あと 1 手（Google の制約で CLI からは安全にできません）"
if [[ -f "${ROOT_DIR}/gas/WEBAPP_DEPLOYMENT_ID" ]]; then
  echo "    gas/WEBAPP_DEPLOYMENT_ID と同じデプロイ ID の行＝ウェブアプリ（先頭 $(tr -d '\n' <"${ROOT_DIR}/gas/WEBAPP_DEPLOYMENT_ID" | head -c 20)…）"
else
  echo "    左の一覧で「ウェブアプリ」の行を選ぶ（ライブラリだけの行は違う）"
fi
echo "    鉛筆 → バージョン ${LATEST_VER:-?} → デプロイ"
echo ""

DEPLOY_UI="https://script.google.com/home/projects/${GAS_SCRIPT_ID}/deployments"
if command -v open >/dev/null 2>&1; then
  open "${DEPLOY_UI}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${DEPLOY_UI}"
else
  echo "    デプロイ管理: ${DEPLOY_UI}"
fi

if [[ "$(uname -s)" == "Darwin" ]] && command -v osascript >/dev/null 2>&1 && [[ -n "${LATEST_VER:-}" ]]; then
  osascript -e "display dialog \"ウェブアプリの行（ライブラリ専用ではない）を選び、鉛筆 → バージョン ${LATEST_VER} → デプロイ\" with title \"personal-kakeibo GAS\" buttons {\"OK\"} default button 1" 2>/dev/null || true
fi

echo ""
if [[ "${SKIP_GAS_VERIFY:-}" == "1" ]]; then
  echo "WARN: SKIP_GAS_VERIFY=1 のため GAS 応答検証をスキップしました。"
  exit 0
fi

if bash "${ROOT_DIR}/scripts/gas-verify.sh"; then
  echo "OK: GAS ウェブアプリの応答を確認しました。"
else
  echo ""
  echo "WARN: GET 検証に失敗しました（まだエディタでウェブアプリを最新版にしていないときは正常です）。"
  echo "     手動デプロイのあと: npm run gas:verify"
  if [[ "${GAS_STRICT_VERIFY:-}" == "1" ]]; then
    exit 1
  fi
fi
