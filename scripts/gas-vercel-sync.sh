#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=_gas-env.sh
source "${ROOT_DIR}/scripts/_gas-env.sh"
gas_load_env_from_local "${ROOT_DIR}"

if [[ ! -f "${ROOT_DIR}/.vercel/project.json" ]]; then
  if [[ -n "${VERCEL_ORG_ID:-}" && -n "${VERCEL_PROJECT_ID:-}" ]]; then
    mkdir -p "${ROOT_DIR}/.vercel"
    printf '%s\n' "{\"orgId\":\"${VERCEL_ORG_ID}\",\"projectId\":\"${VERCEL_PROJECT_ID}\"}" >"${ROOT_DIR}/.vercel/project.json"
    echo "OK: VERCEL_ORG_ID / VERCEL_PROJECT_ID から .vercel/project.json を生成しました（CI 向け）。"
  else
    echo "ERROR: Vercel と未連携です。手元: npx vercel link。CI: VERCEL_ORG_ID と VERCEL_PROJECT_ID を環境変数に設定してください。"
    exit 1
  fi
fi

if [[ -z "${GAS_WEBAPP_URL:-}" || -z "${GAS_SHARED_SECRET:-}" ]]; then
  echo "ERROR: GAS_WEBAPP_URL と GAS_SHARED_SECRET が必要です（.env.local または環境変数）。"
  exit 1
fi

# スペース区切り。Preview も同じ値にしたい場合の既定。
GAS_VERCEL_ENVS="${GAS_VERCEL_ENVS:-production preview}"

cd "${ROOT_DIR}"

vc_sync() {
  local name="$1" value="$2" env="$3" sensitive="${4:-0}"
  local -a add_args=(env add "${name}" "${env}" --value "${value}" -y --non-interactive)
  local -a upd_args=(env update "${name}" "${env}" --value "${value}" -y --non-interactive)
  [[ "${sensitive}" == 1 ]] && add_args+=(--sensitive) && upd_args+=(--sensitive)

  if npx vercel "${upd_args[@]}" 2>/dev/null; then
    echo "OK: Vercel ${name} (${env}) を更新しました。"
    return 0
  fi
  if npx vercel "${add_args[@]}" 2>/dev/null; then
    echo "OK: Vercel ${name} (${env}) を追加しました。"
    return 0
  fi
  echo "ERROR: Vercel ${name} (${env}) の同期に失敗しました。npx vercel login を確認してください。"
  return 1
}

for env in ${GAS_VERCEL_ENVS}; do
  vc_sync GAS_WEBAPP_URL "${GAS_WEBAPP_URL}" "${env}" 0
  vc_sync GAS_SHARED_SECRET "${GAS_SHARED_SECRET}" "${env}" 1
done

echo "==> 完了: Vercel の GAS_WEBAPP_URL / GAS_SHARED_SECRET を同期しました（${GAS_VERCEL_ENVS}）。ダッシュボードで再デプロイすると本番に反映されます。"
