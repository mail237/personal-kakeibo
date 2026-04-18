#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> gas:ship（push → version → 必要なら検証 / Vercel）"
bash "${ROOT_DIR}/scripts/gas-deploy.sh"

if [[ -f "${ROOT_DIR}/.vercel/project.json" ]]; then
  echo ""
  echo "==> Vercel 環境変数同期（GAS_DEPLOYMENT_ID / GAS_SHARED_SECRET）"
  bash "${ROOT_DIR}/scripts/gas-vercel-sync.sh"
else
  echo ""
  echo "SKIP: .vercel/project.json が無いため Vercel 同期を飛ばしました。"
  echo "     初回だけ: cd ${ROOT_DIR} && npx vercel link"
  echo "     その後は gas:ship で Vercel までまとめて同期できます。"
fi
