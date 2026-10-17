/**
 * Google Play Developer API — ghi "Có gì mới" (release notes, vi-VN) cho một bản phát hành trên kênh
 * production mà không cần đăng nhập Play Console (17/10/2026: `eas submit` tạo được bản phát hành nhưng
 * không ghi ghi chú; trình duyệt tích hợp không đăng nhập Google). Cùng khóa service account với
 * play-status.mjs. Chỉ sửa releaseNotes của đúng bản có versionCode đã cho, giữ nguyên status / userFraction.
 *
 *   node scripts/play-release-notes.mjs <versionCode> <tệp ghi chú .txt>     (tệp UTF-8, ≤ 500 ký tự)
 *   node scripts/play-release-notes.mjs 4 ../docs/store/whats-new-1.2.0.txt
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

const [vcArg, notesPath] = process.argv.slice(2);
const versionCode = Number(vcArg);
if (!Number.isInteger(versionCode) || !notesPath) {
  console.error("Cách dùng: node scripts/play-release-notes.mjs <versionCode> <tệp ghi chú>");
  process.exit(1);
}
const notes = readFileSync(notesPath, "utf8").replace(/\r\n/g, "\n").trim();
if (notes.length === 0 || notes.length > 500) {
  console.error(`Ghi chú phải 1–500 ký tự (đang ${notes.length})`);
  process.exit(1);
}

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
  const track = await api("GET", `/edits/${edit.id}/tracks/production`);
  const rel = (track.releases ?? []).find((r) => (r.versionCodes ?? []).includes(String(versionCode)));
  if (!rel) throw new Error(`Kênh production không có bản phát hành chứa versionCode ${versionCode}`);
  rel.releaseNotes = [{ language: "vi-VN", text: notes }];
  await api("PUT", `/edits/${edit.id}/tracks/production`, JSON.stringify(track));
  await api("POST", `/edits/${edit.id}:commit`);
  console.log(`Đã ghi "Có gì mới" (vi-VN, ${notes.length} ký tự) cho ${rel.name ?? "?"} [vc ${versionCode}] → ${rel.status}`);
} catch (err) {
  await api("DELETE", `/edits/${edit.id}`).catch(() => {});
  throw err;
}
