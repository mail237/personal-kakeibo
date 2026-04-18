#!/usr/bin/env bash
# shellcheck shell=bash
# personal-kakeibo: GAS 用に .env.local から変数を読み込む（既に export 済みの値は上書きしない）

gas_trim_and_unquote() {
  local v="$1"
  v="${v%"${v##*[![:space:]]}"}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%\"}"
  v="${v#\"}"
  printf "%s" "$v"
}

# 引数: リポジトリルート（.env.local があるディレクトリ）
gas_load_env_from_local() {
  local root="${1:?root dir}"
  local f="${root}/.env.local"
  [[ -f "${f}" ]] || return 0

  while IFS= read -r raw || [[ -n "${raw}" ]]; do
    local line="${raw%%#*}"
    line="${line%"${line##*[![:space:]]}"}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" ]] && continue
    [[ "${line}" =~ ^(GAS_[A-Z0-9_]+)=(.*)$ ]] || continue

    local key="${BASH_REMATCH[1]}"
    local val
    val=$(gas_trim_and_unquote "${BASH_REMATCH[2]}")
    [[ -z "${key}" || -z "${val}" ]] && continue
    [[ -z "${!key:-}" ]] || continue
    eval "export ${key}=$(printf "%q" "${val}")"
  done <"${f}"
}
