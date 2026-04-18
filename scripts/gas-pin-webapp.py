#!/usr/bin/env python3
"""Apps Script API で「ウェブアプリ」デプロイを列挙し、gas/WEBAPP_DEPLOYMENT_ID を更新する（貼り付け不要）。"""
from __future__ import annotations

import json
import pathlib
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEBAPP_FILE = ROOT / "gas" / "WEBAPP_DEPLOYMENT_ID"
ENV_LOCAL = ROOT / ".env.local"


def load_clasprc() -> dict:
    p = pathlib.Path.home() / ".clasprc.json"
    return json.loads(p.read_text())


def oauth_access_token() -> str:
    d = load_clasprc()
    t = d.get("tokens", {}).get("default") or d.get("token", {})
    cid, csec, rt = t.get("client_id"), t.get("client_secret"), t.get("refresh_token")
    if not all([cid, csec, rt]):
        sys.exit("ERROR: ~/.clasprc.json に clasp の OAuth 情報がありません。npx clasp login を実行してください。")
    data = urllib.parse.urlencode(
        {
            "client_id": cid,
            "client_secret": csec,
            "refresh_token": rt,
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, context=ssl.create_default_context()) as r:
        return json.loads(r.read().decode())["access_token"]


def parse_env_local(key: str) -> str | None:
    if not ENV_LOCAL.is_file():
        return None
    for raw in ENV_LOCAL.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        m = re.match(r"^(" + re.escape(key) + r")=(.*)$", line)
        if not m:
            continue
        v = m.group(2).strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        return v
    return None


def script_id() -> str:
    sid = (parse_env_local("GAS_SCRIPT_ID") or "").strip() or (
        __import__("os").environ.get("GAS_SCRIPT_ID") or ""
    ).strip()
    if not sid:
        sys.exit("ERROR: GAS_SCRIPT_ID を .env.local に書くか環境変数で指定してください。")
    return sid


def main() -> None:
    access = oauth_access_token()
    sid = script_id()
    url = f"https://script.googleapis.com/v1/projects/{sid}/deployments?pageSize=50"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access}"})
    try:
        with urllib.request.urlopen(req, context=ssl.create_default_context()) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"ERROR: Apps Script API {e.code}: {e.read().decode()[:800]}")

    web_apps: list[tuple[str, str, str]] = []
    for dep in data.get("deployments", []):
        did = dep.get("deploymentId") or ""
        ut = dep.get("updateTime") or ""
        for ep in dep.get("entryPoints") or []:
            if ep.get("entryPointType") != "WEB_APP":
                continue
            wa = ep.get("webApp") or {}
            cfg = wa.get("entryPointConfig") or {}
            acc = cfg.get("access") or ""
            web_apps.append((ut, did, acc))

    if not web_apps:
        sys.exit(
            "ERROR: ウェブアプリのデプロイが見つかりません。"
            "エディタで「デプロイ」→ 種類「ウェブアプリ」を1つ作ってから再実行してください。"
        )

    # 更新が新しい順（空は末尾）
    web_apps.sort(key=lambda x: x[0], reverse=True)
    # 匿名 or 全員 を優先
    preferred = [x for x in web_apps if x[2] in ("ANYONE_ANONYMOUS", "ANYONE", "DOMAIN")]
    pick = preferred[0] if preferred else web_apps[0]
    chosen_id = pick[1]

    WEBAPP_FILE.parent.mkdir(parents=True, exist_ok=True)
    WEBAPP_FILE.write_text(chosen_id + "\n", encoding="utf-8")
    print(f"OK: gas/WEBAPP_DEPLOYMENT_ID を更新しました（{chosen_id[:24]}…）")
    print(f"    URL は次の固定形式で決まります（貼り付け不要）:")
    print(f"    https://script.google.com/macros/s/{chosen_id}/exec")
    print("    コードを反映するたび、エディタでウェブアプリのデプロイを「最新バージョン」に更新してください（npm run gas:deploy が案内します）。")


if __name__ == "__main__":
    main()
