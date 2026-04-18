#!/usr/bin/env bash
# shellcheck shell=bash
# GAS_WEBAPP_URL を決める（明示 URL → 環境の GAS_DEPLOYMENT_ID → gas/WEBAPP_DEPLOYMENT_ID）

gas_read_webapp_deployment_id_file() {
  local root="${1:?root}"
  local f="${root}/gas/WEBAPP_DEPLOYMENT_ID"
  [[ -f "${f}" ]] || return 1
  tr -d ' \r\n\t' <"${f}"
}

# 前提: 必要なら gas_load_env_from_local を先に呼ぶこと
# gas/WEBAPP_DEPLOYMENT_ID を最優先（親シェルに古い GAS_WEBAPP_URL が残っていても上書きする）
gas_resolve_webapp_url() {
  local root="${1:?root}"
  local dep=""
  if [[ -f "${root}/gas/WEBAPP_DEPLOYMENT_ID" ]]; then
    dep="$(tr -d ' \r\n\t' <"${root}/gas/WEBAPP_DEPLOYMENT_ID")"
    if [[ -n "${dep}" ]]; then
      export GAS_DEPLOYMENT_ID="${dep}"
      export GAS_WEBAPP_URL="https://script.google.com/macros/s/${dep}/exec"
      return 0
    fi
  fi
  if [[ -n "${GAS_WEBAPP_URL:-}" ]]; then
    return 0
  fi
  dep="${GAS_DEPLOYMENT_ID:-}"
  if [[ -z "${dep}" ]]; then
    return 1
  fi
  export GAS_DEPLOYMENT_ID="${dep}"
  export GAS_WEBAPP_URL="https://script.google.com/macros/s/${dep}/exec"
  return 0
}
