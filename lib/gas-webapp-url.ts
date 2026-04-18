/**
 * GAS ウェブアプリの /exec URL。
 * GAS_WEBAPP_URL が無い場合は GAS_DEPLOYMENT_ID（AKfycb…）から組み立てる（貼り付け不要）。
 */
import fs from "fs";
import path from "path";

function readPinnedDeploymentIdFromRepo(): string | null {
  try {
    const p = path.join(process.cwd(), "gas", "WEBAPP_DEPLOYMENT_ID");
    const raw = fs.readFileSync(p, "utf8").trim().replace(/\s+/g, "");
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function resolveGasWebAppUrl(): string {
  const explicit = process.env.GAS_WEBAPP_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const depId =
    process.env.GAS_DEPLOYMENT_ID?.trim() || readPinnedDeploymentIdFromRepo();
  if (depId) {
    return `https://script.google.com/macros/s/${depId}/exec`;
  }
  throw new Error(
    "GAS_WEBAPP_URL または GAS_DEPLOYMENT_ID のどちらかを設定してください。Vercel では GAS_DEPLOYMENT_ID（ウェブアプリの AKfycb…）だけで動きます。"
  );
}
