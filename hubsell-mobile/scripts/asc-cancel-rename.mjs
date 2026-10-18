/**
 * App Store Connect: RÚT bản đang WAITING_FOR_REVIEW và ĐỔI SỐ phiên bản đó
 * sang số mới (thay vì tạo phiên bản mới — ASC chỉ cho một bản chờ duyệt).
 * Dùng 17/10 (1.1.0 → 1.2.0) và 19/10 (1.2.1 → 1.3.0). Khóa: như asc-release.mjs.
 *
 *   node scripts/asc-cancel-rename.mjs <versionCũ> <versionMới>
 *
 * IN_REVIEW thì không rút được — script dừng và báo.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const eas = require("../eas.json");
const ios = eas.submit.production.ios;
const APP_ID = ios.ascAppId;
const KEY = readFileSync(join(process.cwd(), ios.ascApiKeyPath), "utf8");
const BASE = "https://api.appstoreconnect.apple.com";

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: ios.ascApiKeyId, typ: "JWT" });
  const body = b64({ iss: ios.ascApiKeyIssuerId, iat: now, exp: now + 1100, aud: "appstoreconnect-v1" });
  const s = createSign("SHA256");
  s.update(`${head}.${body}`);
  const sig = s.sign({ key: KEY, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json)}`);
  return json;
}

const [oldVer, newVer] = process.argv.slice(2);
if (!oldVer || !newVer) {
  console.error("Dùng: node scripts/asc-cancel-rename.mjs <versionCũ> <versionMới>");
  process.exit(1);
}

const versions = (await api("GET", `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20`)).data;
const target = versions.find((v) => v.attributes.versionString === oldVer);
if (!target) throw new Error(`Không thấy phiên bản ${oldVer}`);
console.log(`Phiên bản ${oldVer}: id ${target.id}, state ${target.attributes.appStoreState}`);

const subs = (await api("GET", `/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,READY_FOR_REVIEW,UNRESOLVED_ISSUES&limit=10`)).data;
for (const s of subs) {
  const st = s.attributes.state;
  console.log(`reviewSubmission ${s.id}: ${st}`);
  if (st === "IN_REVIEW") throw new Error("Đang IN_REVIEW — Apple đang xem, không rút được. Dừng.");
  if (st === "WAITING_FOR_REVIEW" || st === "READY_FOR_REVIEW" || st === "UNRESOLVED_ISSUES") {
    await api("PATCH", `/v1/reviewSubmissions/${s.id}`, {
      data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } },
    });
    console.log(`→ đã rút ${s.id}`);
  }
}

// Chờ phiên bản về trạng thái sửa được (DEVELOPER_REJECTED / PREPARE_FOR_SUBMISSION).
for (let i = 0; i < 20; i++) {
  const v = (await api("GET", `/v1/appStoreVersions/${target.id}`)).data;
  const st = v.attributes.appStoreState;
  console.log(`  state ${st}`);
  if (st === "DEVELOPER_REJECTED" || st === "PREPARE_FOR_SUBMISSION" || st === "REJECTED") break;
  await new Promise((r) => setTimeout(r, 5000));
}

await api("PATCH", `/v1/appStoreVersions/${target.id}`, {
  data: { type: "appStoreVersions", id: target.id, attributes: { versionString: newVer } },
});
console.log(`Đã đổi ${oldVer} → ${newVer} (id ${target.id}). Tiếp: asc-release.mjs whats-new ${newVer} … / attach-build ${newVer} <build> / submit ${newVer}`);
