// ============================================================
// THÔNG BÁO TÍNH NĂNG MỚI MỘT LẦN TỚI MỌI CHỦ SHOP (29/10/2026)
//
// Anh Trung 29/10: "gửi email thông báo cập nhật tính năng tới tất cả các tài
// khoản — Sao chép sản phẩm". Thư: featureCopyListingEmailHtml
// (services/customer-mails.ts, 2 ảnh hướng dẫn bước 1 → bước 2).
//
// 06/11/2026 dùng lại cho thư app điện thoại 1.4.2 (featureMobileAppEmailHtml). Anh dặn
// gửi cả khách đã rời bỏ: lọc dưới đây KHÔNG xét gói / hết hạn / ngủ đông / lần đăng nhập
// cuối, nên khách hết hạn, ngủ đông, lâu không vào đều nhận. Tài khoản đã tự xóa thì
// account-deletion.ts đã xóa email (email = null) → không còn địa chỉ để gửi.
//
// Ai nhận: CHỦ SHOP (ownerId null) có email, không phải quản trị nền tảng, chưa
// tự xóa tài khoản. Nhân viên (ownerId khác null) KHÔNG nhận — tính năng cần chủ
// shop gán lá quyền. Bỏ qua email nội bộ / demo / test (@hubsell.vn, @hubsell.tech,
// @example.com, mọi tên miền .test / .local).
//
// CHỐNG TRÙNG: vé onboarding_reminders kind "feature-<tên>" (unique chủ shop +
// kind) → chạy lại bao nhiêu lần cũng không ai nhận hai thư; gửi hỏng thì nhả vé.
// Thêm thông báo tính năng sau = thêm một mục vào FEATURES bên dưới.
//
// Chạy (Render Web Shell của worker/web, nơi có SMTP_* + DATABASE_URL prod +
// APP_FRONTEND_URL để ảnh trỏ đúng app.hubsell.vn):
//   npx tsx scripts/feature-announce-once.ts --feature=mobile-1-4-2                  xem trước (không gửi)
//   npx tsx scripts/feature-announce-once.ts --feature=mobile-1-4-2 --sample=a@x.vn  gửi 1 thư mẫu, không giành vé
//   npx tsx scripts/feature-announce-once.ts --feature=mobile-1-4-2 --apply --limit=100   gửi thật MỘT lô
// Gửi thật BẮT BUỘC --limit ≤ 100; các lô cách nhau ≥ 1 giờ (Zoho chặn 29/10). Lô sau tự bỏ người đã nhận.
// Output chủ yếu ASCII để Render Shell không vỡ chữ; email in dạng che bớt.
// ============================================================
// 06/11 tối: phần chọn người + gửi chuyển sang src/services/feature-announce.ts, dùng
// chung với worker tự gửi mỗi ngày (workers/feature-announce-drip.ts). Gửi tay vẫn được,
// nhưng thư lỗi đầu tiên là dừng cả lượt (Zoho đã chặn thì đừng gửi tiếp).
import "dotenv/config";
import { isMailerConfigured } from "../src/lib/mailer";
import { prisma } from "../src/lib/prisma";
import { vnDateLabel } from "../src/services/customer-mails";
import {
  ANNOUNCE_FEATURES,
  announceCandidates,
  isInternalEmail,
  maskEmail,
  sendAnnounceBatch,
} from "../src/services/feature-announce";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const APPLY = flag("apply");
const SAMPLE_TO = opt("sample");
const LIMIT = Number(opt("limit") ?? 0) || Infinity;
const MAX_PER_RUN = 100;
const PAUSE_BETWEEN_MS = 3000;
const FEATURE_KEY = opt("feature") ?? "";
const FEATURE = ANNOUNCE_FEATURES[FEATURE_KEY];

async function main() {
  if (!FEATURE) {
    throw new Error(`Thieu hoac sai --feature=. Co: ${Object.keys(ANNOUNCE_FEATURES).join(", ")}`);
  }

  if (SAMPLE_TO) {
    if (!isMailerConfigured()) throw new Error("Chua cau hinh SMTP_* - khong gui duoc thu mau");
    const ok = await FEATURE.send(SAMPLE_TO, "Chu shop (thu mau)");
    console.log(ok ? `Da gui thu mau toi ${SAMPLE_TO}` : `Gui thu mau toi ${SAMPLE_TO} LOI (xem log tren)`);
    return;
  }

  if (APPLY) {
    if (!isMailerConfigured()) throw new Error("Chua cau hinh SMTP_* - khong gui duoc");
    if (!(LIMIT <= MAX_PER_RUN)) throw new Error(`Gui that phai kem --limit=<= ${MAX_PER_RUN} (Zoho chan khi gui don dap)`);
    console.log(`Thong bao tinh nang "${FEATURE_KEY}" - GUI THAT toi da ${LIMIT} thu`);
    const r = await sendAnnounceBatch(FEATURE, { limit: LIMIT, pauseMs: PAUSE_BETWEEN_MS, log: console.log });
    console.log(`Xong: ${r.sent} da gui, ${r.failed} loi${r.stoppedOnError ? " (DUNG vi thu loi - thuong la Zoho chan)" : ""}.`);
    return;
  }

  // Xem trước: đếm, không gửi.
  const alreadySent = new Set(
    (await prisma.onboardingReminder.findMany({ where: { kind: FEATURE.kind }, select: { userId: true } })).map(
      (r) => r.userId
    )
  );
  let total = 0;
  let internal = 0;
  let skippedSent = 0;
  for await (const page of announceCandidates()) {
    for (const c of page) {
      total += 1;
      if (isInternalEmail(c.email)) internal += 1;
      else if (alreadySent.has(c.id)) skippedSent += 1;
      else console.log(`- ${maskEmail(c.email)} · dang ky ${vnDateLabel(c.createdAt)} · ${c.id}`);
    }
  }
  console.log(
    `Tong chu shop co email: ${total} · noi bo/demo bo qua: ${internal} · da nhan thu nay truoc: ${skippedSent} · can gui: ${total - internal - skippedSent}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
