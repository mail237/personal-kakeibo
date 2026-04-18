#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAS_DIR="${ROOT_DIR}/gas"

# 手元の .env.local に GAS_SCRIPT_ID 等があれば読み込む（export 済みの環境は上書きしない）
if [[ -f "${ROOT_DIR}/.env.local" ]]; then
  while IFS= read -r raw || [[ -n "${raw}" ]]; do
    line="${raw%%#*}"
    line="${line%"${line##*[![:space:]]}"}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" ]] && continue
    if [[ "${line}" =~ ^GAS_SCRIPT_ID=(.*)$ ]]; then
      v="${BASH_REMATCH[1]}"
      v="${v%"${v##*[![:space:]]}"}"
      v="${v#"${v%%[![:space:]]*}"}"
      v="${v%\"}"
      v="${v#\"}"
      [[ -n "${v}" && -z "${GAS_SCRIPT_ID:-}" ]] && export GAS_SCRIPT_ID="${v}"
    elif [[ "${line}" =~ ^GAS_DEPLOYMENT_ID=(.*)$ ]]; then
      v="${BASH_REMATCH[1]}"
      v="${v%"${v##*[![:space:]]}"}"
      v="${v#"${v%%[![:space:]]*}"}"
      v="${v%\"}"
      v="${v#\"}"
      [[ -n "${v}" && -z "${GAS_DEPLOYMENT_ID:-}" ]] && export GAS_DEPLOYMENT_ID="${v}"
    fi
  done <"${ROOT_DIR}/.env.local"
fi

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
