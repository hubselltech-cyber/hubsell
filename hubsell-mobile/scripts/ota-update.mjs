/**
 * Đẩy cập nhật OTA (EAS Update) cho app Hubsell — chỉ phần JS/giao diện, không cần build lại.
 * (26/10/2026: khách thấy lỗi dấu trừ tab Tài chính nhưng phải chờ build 1.4.1 + duyệt kho → thêm OTA.)
 *
 *   node scripts/ota-update.mjs "Sửa dấu trừ Lợi nhuận thực tế tab Tài chính"
 *   node scripts/ota-update.mjs --channel preview "Thử trên APK preview"
 *
 * Luật an toàn (đọc docs/DUA-APP-LEN-CH-PLAY-APP-STORE.md mục 9 trước khi chạy):
 *  - Chỉ tới được bản build CÓ expo-updates (từ 1.4.1 trở đi) và CÙNG runtimeVersion
 *    (policy appVersion → runtime = expo.version trong app.json). Đổi module native → phải build + nộp kho.
 *  - EXPO_PUBLIC_API_URL ghim cứng vào backend prod ở đây, KHÔNG lấy từ .env trên máy
 *    (tránh một lần dev trỏ IP LAN rồi đẩy nhầm cho khách).
 *  - Từ chối chạy khi cây git còn thay đổi chưa commit: bản khách nhận phải trùng một commit trên master.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROD_API_URL = "https://hubsell-backend-sg.onrender.com";

const args = process.argv.slice(2);
let channel = "production";
const ci = args.indexOf("--channel");
if (ci >= 0) {
  channel = args[ci + 1];
  args.splice(ci, 2);
}
const message = args.join(" ").trim();
if (!message) {
  console.error('Thiếu lời nhắn. Ví dụ: node scripts/ota-update.mjs "Sửa dấu trừ tab Tài chính"');
  process.exit(2);
}

const dirty = execSync("git status --porcelain .", { encoding: "utf8" }).trim();
if (dirty) {
  console.error("Cây git trong hubsell-mobile còn thay đổi chưa commit — commit trước rồi mới đẩy OTA:\n" + dirty);
  process.exit(3);
}

const app = JSON.parse(readFileSync("app.json", "utf8")).expo;
const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
console.log(`Đẩy OTA kênh "${channel}" — runtimeVersion ${app.version} (policy ${app.runtimeVersion?.policy}) — commit ${commit}`);
console.log(`API backend ghim: ${PROD_API_URL}`);

const r = spawnSync(
  "npx",
  ["eas-cli", "update", "--channel", channel, "--environment", channel === "production" ? "production" : "preview",
   "--message", `${message} (${commit})`, "--non-interactive"],
  { stdio: "inherit", shell: true, env: { ...process.env, EXPO_PUBLIC_API_URL: PROD_API_URL } },
);
process.exit(r.status ?? 1);
