// Nạp backend/.env vào process.env TRƯỚC mọi import khác của test.
// (Vitest không tự nạp .env; Prisma chỉ nạp cho riêng nó. Import file này
// ĐẦU TIÊN trong mỗi file test — side effect module chạy trước phần còn lại.)
import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^"|"$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
