/**
 * Google Play Developer API — đọc trạng thái các kênh phát hành mà không cần đăng nhập Play Console
 * (17/10/2026: trình duyệt tích hợp của Claude không đăng nhập Google, nên hỏi thẳng API).
 * Khóa: service account JSON trong eas.json (submit.production.android.serviceAccountKeyPath),
 * tài khoản eas-submit@hubsell-play đã được mời vào Play Console. Chỉ ĐỌC: tạo edit tạm rồi xóa.
 *
 *   node scripts/play-status.mjs            # kênh production/beta/alpha/internal + danh sách AAB đã tải
 *   node scripts/play-status.mjs --json     # in JSON thô
 *
 * status của release: completed = phát hành đầy đủ; inProgress = đang phát hành theo tỷ lệ (userFraction);
 * draft = còn nháp, phải vào Console bấm; halted = đã dừng.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const eas = require("../eas.json");
const app = require("../app.json");
const PKG = app.expo.android.package;
const key = JSON.parse(readFileSync(join(process.cwd(), eas.submit.production.android.serviceAccountKeyPath), "utf8"));
const asJson = process.argv.includes("--json");

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}`,
  }).then((r) => r.json());
  if (!res.access_token) throw new Error(`Không lấy được token: ${JSON.stringify(res)}`);
  return res.access_token;
}

const BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const H = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
};

const edit = await api("POST", "/edits", "{}");
try {
  const [tracks, bundles] = await Promise.all([
    api("GET", `/edits/${edit.id}/tracks`),
    api("GET", `/edits/${edit.id}/bundles`),
  ]);
  if (asJson) {
    console.log(JSON.stringify({ tracks, bundles }, null, 2));
  } else {
    console.log(`Gói ${PKG}`);
    for (const t of tracks.tracks ?? []) {
      const rels = t.releases ?? [];
      if (!rels.length) {
        console.log(`- ${t.track}: (trống)`);
        continue;
      }
      for (const r of rels) {
        const frac = r.userFraction != null ? ` ${Math.round(r.userFraction * 100)}%` : "";
        console.log(`- ${t.track}: ${r.name ?? "?"} [vc ${(r.versionCodes ?? []).join(",")}] → ${r.status}${frac}`);
      }
    }
    const vcs = (bundles.bundles ?? []).map((b) => b.versionCode).join(", ");
    console.log(`AAB đã tải lên: vc ${vcs || "(chưa có)"}`);
  }
} finally {
  await api("DELETE", `/edits/${edit.id}`).catch(() => {});
}
