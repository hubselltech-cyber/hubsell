/**
 * App Store Connect API — làm thay giao diện web khi ASC web trả "Sorry, something went wrong"
 * (16/10/2026 khuya: trang phiên bản + danh sách app đều lỗi dù System Status xanh).
 * Khóa: asc-api-key.p8 + Key ID / Issuer trong eas.json (submit.production.ios).
 *
 *   node scripts/asc-release.mjs status
 *   node scripts/asc-release.mjs create-version 1.1.0
 *   node scripts/asc-release.mjs whats-new 1.1.0 "<nội dung>"       (locale vi)
 *   node scripts/asc-release.mjs screenshots 1.1.0 <thư mục png> [displayType]   (xóa ảnh cũ trong bộ, tải ảnh mới theo thứ tự tên)
 *   node scripts/asc-release.mjs attach-build 1.1.0 12
 *   node scripts/asc-release.mjs submit 1.1.0
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash, createSign } from "node:crypto";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const eas = require("../eas.json");
const ios = eas.submit.production.ios;
const APP_ID = ios.ascAppId;
const KEY = readFileSync(join(process.cwd(), ios.ascApiKeyPath), "utf8");

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

const BASE = "https://api.appstoreconnect.apple.com";
async function api(method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 800)}`);
  return json;
}

async function versions() {
  const r = await api("GET", `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10`);
  return r.data.map((v) => ({ id: v.id, version: v.attributes.versionString, state: v.attributes.appStoreState ?? v.attributes.appVersionState, created: v.attributes.createdDate }));
}
async function versionByString(vs) {
  const v = (await versions()).find((x) => x.version === vs);
  if (!v) throw new Error(`Không có phiên bản ${vs} — chạy create-version trước`);
  return v;
}
async function builds() {
  const r = await api("GET", `/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate,expired`);
  return r.data.map((b) => ({ id: b.id, build: b.attributes.version, state: b.attributes.processingState, uploaded: b.attributes.uploadedDate }));
}
async function localization(versionId, locale = "vi") {
  const r = await api("GET", `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`);
  const l = r.data.find((x) => x.attributes.locale === locale) ?? r.data[0];
  if (!l) throw new Error("Phiên bản chưa có localization");
  return l;
}
async function screenshotSets(locId) {
  const r = await api("GET", `/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets`);
  return r.data.map((s) => ({ id: s.id, type: s.attributes.screenshotDisplayType }));
}
async function screenshotsOf(setId) {
  const r = await api("GET", `/v1/appScreenshotSets/${setId}/appScreenshots?limit=20`);
  return r.data.map((s) => ({ id: s.id, name: s.attributes.fileName, state: s.attributes.assetDeliveryState?.state }));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "status") {
  console.log("Phiên bản:", await versions());
  try {
    console.log("Build:", await builds());
  } catch (e) {
    console.log("Build: lỗi", String(e.message).slice(0, 160));
  }
  for (const v of await versions()) {
    if (!/READY_FOR_DISTRIBUTION|PREPARE|WAITING|REVIEW|DEVELOPER/.test(v.state ?? "")) continue;
    const loc = await localization(v.id);
    console.log(`\n${v.version} (${v.state}) localization ${loc.attributes.locale}: whatsNew =`, JSON.stringify(loc.attributes.whatsNew ?? "").slice(0, 200));
    for (const s of await screenshotSets(loc.id)) console.log("  bộ ảnh", s.type, s.id, (await screenshotsOf(s.id)).map((x) => `${x.name}:${x.state}`).join(", "));
  }
} else if (cmd === "create-version") {
  const [vs] = args;
  const r = await api("POST", "/v1/appStoreVersions", {
    data: { type: "appStoreVersions", attributes: { platform: "IOS", versionString: vs, releaseType: "AFTER_APPROVAL" }, relationships: { app: { data: { type: "apps", id: APP_ID } } } },
  });
  console.log("Đã tạo", r.data.attributes.versionString, r.data.id, r.data.attributes.appStoreState ?? r.data.attributes.appVersionState);
} else if (cmd === "whats-new") {
  const [vs, text] = args;
  const v = await versionByString(vs);
  const loc = await localization(v.id);
  await api("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { whatsNew: text } } });
  console.log("Đã ghi Có gì mới cho", vs, "(", loc.attributes.locale, ")");
} else if (cmd === "screenshots") {
  const [vs, dir, wantType] = args;
  const v = await versionByString(vs);
  const loc = await localization(v.id);
  let sets = await screenshotSets(loc.id);
  let set = sets.find((s) => s.type === (wantType ?? "APP_IPHONE_67")) ?? sets[0];
  if (wantType && !sets.find((s) => s.type === wantType)) {
    const r = await api("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: wantType }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } });
    set = { id: r.data.id, type: wantType };
  }
  console.log("Bộ ảnh:", set.type, set.id, "— các bộ có:", sets.map((s) => s.type).join(", "));
  for (const old of await screenshotsOf(set.id)) {
    await api("DELETE", `/v1/appScreenshots/${old.id}`);
    console.log("  xóa", old.name);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const ids = [];
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    const r = await api("POST", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: f, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } } });
    const shot = r.data;
    for (const op of shot.attributes.uploadOperations) {
      const chunk = buf.subarray(op.offset, op.offset + op.length);
      const headers = {};
      for (const h of op.requestHeaders) headers[h.name] = h.value;
      const up = await fetch(op.url, { method: op.method, headers, body: chunk });
      if (!up.ok) throw new Error(`upload ${f} chunk → ${up.status}`);
    }
    await api("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(buf).digest("hex") } } });
    ids.push(shot.id);
    console.log("  tải", f, buf.length, "byte");
  }
  await api("PATCH", `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: "appScreenshots", id })) });
  console.log("Xong", ids.length, "ảnh, thứ tự đã đặt theo tên tệp.");
} else if (cmd === "attach-build") {
  const [vs, buildNo] = args;
  const v = await versionByString(vs);
  const b = (await builds()).find((x) => x.build === buildNo);
  if (!b) throw new Error(`Chưa thấy build ${buildNo} trên ASC — chờ xử lý xong`);
  if (b.state !== "VALID") throw new Error(`Build ${buildNo} đang ${b.state}, chưa gắn được`);
  await api("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: b.id } });
  console.log("Đã gắn build", buildNo, "vào", vs);
} else if (cmd === "submit") {
  const [vs] = args;
  const v = await versionByString(vs);
  const rs = await api("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APP_ID } } } } });
  await api("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: rs.data.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
  await api("PATCH", `/v1/reviewSubmissions/${rs.data.id}`, { data: { type: "reviewSubmissions", id: rs.data.id, attributes: { submitted: true } } });
  console.log("Đã nộp", vs, "— reviewSubmission", rs.data.id);
} else {
  console.log("Lệnh: status | create-version | whats-new | screenshots | attach-build | submit");
}
