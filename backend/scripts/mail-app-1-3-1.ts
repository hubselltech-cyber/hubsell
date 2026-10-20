// ============================================================
// THƯ BÁO KHÁCH: APP ĐIỆN THOẠI 1.3.1 (gửi MỘT lần, 20/10/2026)
//
// Anh Trung chốt 18/10: khách hiện tại được báo bằng một email khi bản có đăng
// nhập Google/Apple lên cả hai kho (docs/DANG-NHAP-GOOGLE-APPLE-TRONG-APP.md
// mục 10). Nội dung thư ở services/customer-mails.ts (app131EmailHtml).
//
// Người nhận: chủ shop (ownerId NULL), chưa tự xóa, có email, không phải tài
// khoản nội bộ / thử (@hubsell.vn, @hubsell.tech, .test, .local, isPlatformAdmin) và email hợp lệ
// (bỏ "..", vd khách gõ nhầm gmail..com — thư dội về).
//
// Chạy (production: đặt DATABASE_URL + SMTP như lúc chạy seed):
//   npx tsx scripts/mail-app-1-3-1.ts                 xem trước: đếm + 20 dòng đầu + tệp HTML mẫu
//   npx tsx scripts/mail-app-1-3-1.ts --to a@b.com    gửi THỬ một thư tới địa chỉ này
//   npx tsx scripts/mail-app-1-3-1.ts --apply         gửi thật cho cả danh sách
//
// Gửi tuần tự nghỉ 200 ms (docs mục 10) — một lần, vài trăm thư, không phải
// đường nóng. Mỗi thư gửi xong ghi email vào scripts/out/mail-app-1-3-1-sent.txt;
// chạy lại sẽ BỎ QUA người đã gửi, nên đứt giữa chừng cứ chạy lại --apply.
// ============================================================
import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

import { isMailerConfigured, sendMail } from "../src/lib/mailer";
import { APP_1_3_1_SUBJECT, app131EmailHtml } from "../src/services/customer-mails";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const toIdx = args.indexOf("--to");
const TEST_TO = toIdx >= 0 ? args[toIdx + 1] : null;

const OUT_DIR = join(__dirname, "out");
const SENT_LOG = join(OUT_DIR, "mail-app-1-3-1-sent.txt");
const PREVIEW = join(OUT_DIR, "mail-app-1-3-1-preview.html");
const PAUSE_MS = 200;

const EMAIL_OK = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
/** Nội bộ + tên miền thử (dev có @hubsell.test, @test.local, example.com…). */
const INTERNAL = /(@hubsell\.(vn|tech|test)|\.(test|local|invalid|example)|@example\.(com|org))$/i;

function readSent(): Set<string> {
  if (!existsSync(SENT_LOG)) return new Set();
  return new Set(
    readFileSync(SENT_LOG, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(PREVIEW, app131EmailHtml({ fullName: "Nguyễn Văn A" }), "utf8");

  if (TEST_TO) {
    if (!isMailerConfigured()) throw new Error("Chưa cấu hình SMTP — không gửi thử được");
    await sendMail({ to: TEST_TO, role: "noreply", subject: APP_1_3_1_SUBJECT, html: app131EmailHtml({ fullName: "Anh Trung" }) });
    console.log(`Đã gửi thử tới ${TEST_TO}`);
    return;
  }

  const users = await prisma.user.findMany({
    where: { ownerId: null, deletedAt: null, email: { not: null }, isPlatformAdmin: false },
    select: { id: true, email: true, fullName: true, googleId: true, appleUserId: true },
    orderBy: { createdAt: "asc" },
  });
  const sent = readSent();
  const bad: string[] = [];
  const list = users.filter((u) => {
    const e = u.email!.trim();
    if (INTERNAL.test(e)) return false;
    if (!EMAIL_OK.test(e)) {
      bad.push(e);
      return false;
    }
    return true;
  });
  const todo = list.filter((u) => !sent.has(u.email!.trim().toLowerCase()));
  const google = list.filter((u) => u.googleId).length;

  console.log(`Chủ shop nhận thư: ${list.length} (có Google: ${google}) · đã gửi trước: ${list.length - todo.length} · còn gửi: ${todo.length}`);
  if (bad.length) console.log(`Bỏ qua email sai định dạng (${bad.length}): ${bad.join(", ")}`);
  console.log(`Mẫu thư: ${PREVIEW}`);

  if (!APPLY) {
    for (const u of todo.slice(0, 20)) console.log(`- ${u.email} · ${u.fullName}${u.googleId ? " · Google" : ""}`);
    if (todo.length > 20) console.log(`… và ${todo.length - 20} người nữa`);
    console.log("Xem trước — thêm --apply để gửi thật.");
    return;
  }

  if (!isMailerConfigured()) throw new Error("Chưa cấu hình SMTP — dừng");
  let ok = 0;
  let failed = 0;
  for (const u of todo) {
    const to = u.email!.trim();
    try {
      await sendMail({ to, role: "noreply", subject: APP_1_3_1_SUBJECT, html: app131EmailHtml({ fullName: u.fullName }) });
      appendFileSync(SENT_LOG, `${to.toLowerCase()}\n`);
      ok++;
    } catch (err) {
      failed++;
      console.error(`  lỗi ${to}: ${(err as Error).message}`);
    }
    if ((ok + failed) % 50 === 0) console.log(`  … ${ok + failed}/${todo.length}`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  console.log(`Xong: gửi ${ok}, lỗi ${failed}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
