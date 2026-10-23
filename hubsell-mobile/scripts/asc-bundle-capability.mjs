/**
 * Bật / xem capability của App ID trên Apple Developer qua App Store Connect API
 * (23/10/2026: thêm Push Notifications cho vn.hubsell.app mà không cần Apple ID + 2FA;
 * EAS build non-interactive không tự bật → profile thiếu aps-environment → Xcode fail).
 *
 *   node scripts/asc-bundle-capability.mjs list
 *   node scripts/asc-bundle-capability.mjs enable PUSH_NOTIFICATIONS
 *
 * Bật xong, profile cũ bị Apple đánh Invalid → chạy lại `eas build` với env EXPO_ASC_*
 * (gotcha 18/10) để EAS tạo profile mới.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const eas = require("../eas.json");
const app = require("../app.json");
const ios = eas.submit.production.ios;
const BUNDLE = app.expo.ios.bundleIdentifier;
const KEY = readFileSync(join(process.cwd(), ios.ascApiKeyPath), "utf8");

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: ios.ascApiKeyId, typ: "JWT" });
  const body = b64({ iss: ios.ascApiKeyIssuerId, iat: now, exp: now + 1100, aud: "appstoreconnect-v1" });
  const s = createSign("SHA256");
  s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign({ key: KEY, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

const BASE = "https://api.appstoreconnect.apple.com";
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 600)}`);
  return json;
}

const [cmd, capType] = process.argv.slice(2);
const b = await api("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}&include=bundleIdCapabilities`);
const bundle = b.data.find((x) => x.attributes.identifier === BUNDLE);
if (!bundle) throw new Error(`Không thấy App ID ${BUNDLE}`);
const caps = (b.included ?? []).map((c) => c.attributes.capabilityType);
console.log(`App ID ${BUNDLE} (${bundle.id}) — capability: ${caps.join(", ") || "(trống)"}`);

if (cmd === "enable") {
  if (!capType) throw new Error("Thiếu tên capability, ví dụ PUSH_NOTIFICATIONS");
  if (caps.includes(capType)) {
    console.log(`${capType} đã bật sẵn.`);
  } else {
    await api("POST", "/v1/bundleIdCapabilities", {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType: capType },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
      },
    });
    console.log(`Đã bật ${capType}. Profile cũ sẽ bị Apple đánh Invalid — build lại với EXPO_ASC_* để EAS tạo profile mới.`);
  }
}
