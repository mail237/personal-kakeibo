#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAS_DIR="${ROOT_DIR}/gas"

# shellcheck source=_gas-env.sh
source "${ROOT_DIR}/scripts/_gas-env.sh"
gas_load_env_from_local "${ROOT_DIR}"

if [[ -z "${GAS_SCRIPT_ID:-}" ]]; then
  echo "ERROR: GAS_SCRIPT_ID が未設定です。"
  echo "例: export GAS_SCRIPT_ID=\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\""
  exit 1
fi

if [[ ! -d "${GAS_DIR}" ]]; then
  echo "ERROR: gas ディレクトリが見つかりません: ${GAS_DIR}"
  exit 1
fi

cd "${GAS_DIR}"

# clasp は .clasp.json を参照するため、リポジトリにはコミットせず毎回生成する
cat > .clasp.json <<EOF
{
  "scriptId": "${GAS_SCRIPT_ID}",
  "rootDir": "."
}
EOF

if [[ ! -f appsscript.json ]]; then
  cat > appsscript.json <<'EOF'
{
  "timeZone": "Asia/Tokyo",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
EOF
fi

echo "==> clasp push"
npx clasp push --force

echo "OK: pushed gas/Code.gs"
