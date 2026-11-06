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
import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { isMailerConfigured } from "../src/lib/mailer";
import { sendFeatureMobileAppMail, vnDateLabel } from "../src/services/customer-mails";

const FEATURES: Record<string, { kind: string; send: (to: string, fullName: string) => Promise<boolean> }> = {
  // 06/11/2026: app điện thoại bản 1.4.2 (quét đóng gói, phiếu nhặt hàng, tồn kho theo mẫu).
  // Lần 29/10 (copy-listing) đã gửi xong và gỡ mẫu thư; vé cũ vẫn nằm trong onboarding_reminders.
  "mobile-1-4-2": {
    kind: "feature-mobile-1-4-2",
    send: (to, fullName) => sendFeatureMobileAppMail(to, { fullName }),
  },
};

const prisma = new PrismaClient();
const PAGE_SIZE = 500;
// 29/10: 5 luồng ~200 thư/vài phút làm Zoho chặn cả hộp gửi → 1 luồng + nghỉ giữa thư,
// và mỗi lượt chạy chỉ một lô (--limit=100), các lô cách nhau ≥ 1 giờ.
const SEND_CONCURRENCY = 1;
const PAUSE_BETWEEN_MS = 3000;
const INTERNAL_DOMAINS = new Set(["hubsell.vn", "hubsell.tech", "hubsell.test", "example.com"]);

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
const FEATURE_KEY = opt("feature") ?? "";
const FEATURE = FEATURES[FEATURE_KEY];

interface Candidate {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  const head = user.length <= 2 ? (user[0] ?? "") : user.slice(0, 2);
  return `${head}***@${domain ?? ""}`;
}

function isInternal(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_DOMAINS.has(domain) || domain.endsWith(".test") || domain.endsWith(".local");
}

async function* candidates(): AsyncGenerator<Candidate[]> {
  let cursor = "";
  for (;;) {
    const rows = await prisma.user.findMany({
      where: {
        ownerId: null,
        email: { not: null },
        isPlatformAdmin: false,
        deletedAt: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, email: true, fullName: true, createdAt: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (rows.length === 0) return;
    yield rows.map((r) => ({ id: r.id, email: r.email!, fullName: r.fullName, createdAt: r.createdAt }));
    if (rows.length < PAGE_SIZE) return;
    cursor = rows[rows.length - 1].id;
  }
}

/** Giành vé cho cả trang — trả về những khách LƯỢT NÀY giành được (chưa từng nhận). */
async function claim(kind: string, page: Candidate[]): Promise<Candidate[]> {
  const batchId = randomUUID();
  await prisma.onboardingReminder.createMany({
    data: page.map((c) => ({ userId: c.id, kind, batchId })),
    skipDuplicates: true,
  });
  const mine = await prisma.onboardingReminder.findMany({ where: { batchId }, select: { userId: true } });
  const won = new Set(mine.map((m) => m.userId));
  return page.filter((c) => won.has(c.id));
}

async function releaseTicket(kind: string, c: Candidate): Promise<void> {
  await prisma.onboardingReminder.deleteMany({ where: { userId: c.id, kind } }).catch(() => undefined);
}

async function mapLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

async function main() {
  if (!FEATURE) {
    throw new Error(`Thieu hoac sai --feature=. Co: ${Object.keys(FEATURES).join(", ")}`);
  }
  const { kind, send } = FEATURE;

  if (SAMPLE_TO) {
    if (!isMailerConfigured()) throw new Error("Chua cau hinh SMTP_* - khong gui duoc thu mau");
    const ok = await send(SAMPLE_TO, "Chu shop (thu mau)");
    console.log(ok ? `Da gui thu mau toi ${SAMPLE_TO}` : `Gui thu mau toi ${SAMPLE_TO} LOI (xem log tren)`);
    return;
  }

  const mode = APPLY ? "GUI THAT" : "xem truoc (them --apply de gui)";
  console.log(`Thong bao tinh nang "${FEATURE_KEY}" toi moi chu shop - ${mode}`);
  if (APPLY && !isMailerConfigured()) throw new Error("Chua cau hinh SMTP_* - khong gui duoc");
  if (APPLY && !(LIMIT <= MAX_PER_RUN)) throw new Error(`Gui that phai kem --limit=<= ${MAX_PER_RUN} (Zoho chan khi gui don dap)`);

  const alreadySent = new Set(
    (await prisma.onboardingReminder.findMany({ where: { kind }, select: { userId: true } })).map((r) => r.userId)
  );

  let total = 0;
  let internal = 0;
  let skippedSent = 0;
  let sent = 0;
  let failed = 0;
  let budget = LIMIT;

  for await (const page of candidates()) {
    const eligible: Candidate[] = [];
    for (const c of page) {
      total += 1;
      if (isInternal(c.email)) {
        internal += 1;
        continue;
      }
      if (alreadySent.has(c.id)) {
        skippedSent += 1;
        continue;
      }
      eligible.push(c);
    }

    if (!APPLY) {
      for (const c of eligible) {
        console.log(`- ${maskEmail(c.email)} · dang ky ${vnDateLabel(c.createdAt)} · ${c.id}`);
      }
      continue;
    }

    if (budget <= 0) continue;
    const slice = eligible.slice(0, Math.min(eligible.length, budget));
    budget -= slice.length;
    const won = await claim(kind, slice);
    await mapLimited(won, SEND_CONCURRENCY, async (c) => {
      const ok = await send(c.email, c.fullName);
      if (!ok) {
        await releaseTicket(kind, c);
        failed += 1;
        console.log(`  x ${maskEmail(c.email)} gui loi, da nha ve`);
        return;
      }
      sent += 1;
      console.log(`  + ${maskEmail(c.email)}`);
      await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS));
    });
  }

  const remaining = total - internal - skippedSent;
  console.log(
    `Tong chu shop co email: ${total} · noi bo/demo bo qua: ${internal} · da nhan thu nay truoc: ${skippedSent} · can gui: ${remaining}`
  );
  if (APPLY) {
    console.log(`Xong: ${sent} da gui, ${failed} loi${Number.isFinite(LIMIT) ? ` (gioi han ${LIMIT}/luot)` : ""}.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
