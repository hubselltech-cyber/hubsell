// ============================================================
// NHẮC MỘT LẦN: KHÁCH ĐÃ ĐĂNG KÝ LÂU MÀ VẪN CHƯA NỐI GIAN HÀNG (25/10/2026)
//
// Anh Trung 25/10: "gửi một email tới những khách hàng chưa liên kết gian hàng,
// yêu cầu họ liên kết và sử dụng". Worker onboarding-reminder chỉ nhắc khách
// đăng ký 24–48 giờ trước (từ 09/10) — nhóm đăng ký trước đó, hoặc đã nhận
// thư 1 ngày mà vẫn chưa nối, chưa ai chạm tới. Script này gửi thư
// connectNudgeEmailHtml (services/customer-mails.ts) cho nhóm đó.
//
// Ai nhận: CHỦ SHOP (ownerId null) có email, không phải quản trị nền tảng,
// chưa tự xóa tài khoản, đăng ký cách đây >= MIN_AGE_DAYS (mặc định 3 ngày —
// trẻ hơn để worker lo), CHƯA có gian nào (kể cả gian đã ngắt). Bỏ qua email
// nội bộ / demo / test (@hubsell.vn, @hubsell.tech, @example.com, mọi tên miền .test / .local).
//
// CHỐNG TRÙNG: vé onboarding_reminders kind "connect-once" (unique chủ shop +
// kind) → chạy lại script bao nhiêu lần cũng không ai nhận hai thư; gửi hỏng
// thì nhả vé để lần sau thử lại. Quy mô: đọc theo trang `id > cursor`, gửi 5
// luồng song song.
//
// Chạy (Render Web Shell của worker/web, nơi có SMTP_* + DATABASE_URL prod):
//   npx tsx scripts/connect-reminder-once.ts                    xem trước (không gửi)
//   npx tsx scripts/connect-reminder-once.ts --sample=anh@x.vn  gửi 1 thư mẫu tới địa chỉ này, không giành vé
//   npx tsx scripts/connect-reminder-once.ts --apply            gửi thật
//   npx tsx scripts/connect-reminder-once.ts --apply --limit=20 gửi thật tối đa 20 thư lượt này
//   --min-age-days=N  đổi mốc 3 ngày
// Output chủ yếu ASCII để Render Shell không vỡ chữ; email in dạng che bớt.
// ============================================================
import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { isMailerConfigured } from "../src/lib/mailer";
import { sendConnectNudgeMail, vnDateLabel } from "../src/services/customer-mails";

const prisma = new PrismaClient();
const KIND = "connect-once";
const PAGE_SIZE = 500;
const SEND_CONCURRENCY = 5;
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
const MIN_AGE_DAYS = Number(opt("min-age-days") ?? 3);

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

async function* candidates(before: Date): AsyncGenerator<Candidate[]> {
  let cursor = "";
  for (;;) {
    const rows = await prisma.user.findMany({
      where: {
        ownerId: null,
        email: { not: null },
        isPlatformAdmin: false,
        deletedAt: null,
        createdAt: { lt: before },
        channels: { none: {} },
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
async function claim(page: Candidate[]): Promise<Candidate[]> {
  const batchId = randomUUID();
  await prisma.onboardingReminder.createMany({
    data: page.map((c) => ({ userId: c.id, kind: KIND, batchId })),
    skipDuplicates: true,
  });
  const mine = await prisma.onboardingReminder.findMany({ where: { batchId }, select: { userId: true } });
  const won = new Set(mine.map((m) => m.userId));
  return page.filter((c) => won.has(c.id));
}

async function releaseTicket(c: Candidate): Promise<void> {
  await prisma.onboardingReminder.deleteMany({ where: { userId: c.id, kind: KIND } }).catch(() => undefined);
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
  if (SAMPLE_TO) {
    if (!isMailerConfigured()) throw new Error("Chua cau hinh SMTP_* - khong gui duoc thu mau");
    const ok = await sendConnectNudgeMail(SAMPLE_TO, {
      fullName: "Chu shop (thu mau)",
      signedUpAt: new Date(Date.now() - 20 * 86_400_000),
    });
    console.log(ok ? `Da gui thu mau toi ${SAMPLE_TO}` : `Gui thu mau toi ${SAMPLE_TO} LOI (xem log tren)`);
    return;
  }

  const before = new Date(Date.now() - MIN_AGE_DAYS * 86_400_000);
  const mode = APPLY ? "GUI THAT" : "xem truoc (them --apply de gui)";
  console.log(`Khach chu shop chua noi gian, dang ky truoc ${before.toISOString().slice(0, 10)} - ${mode}`);
  if (APPLY && !isMailerConfigured()) throw new Error("Chua cau hinh SMTP_* - khong gui duoc");

  const alreadySent = new Set(
    (await prisma.onboardingReminder.findMany({ where: { kind: KIND }, select: { userId: true } })).map(
      (r) => r.userId
    )
  );

  let total = 0;
  let internal = 0;
  let skippedSent = 0;
  let sent = 0;
  let failed = 0;
  let budget = LIMIT;

  for await (const page of candidates(before)) {
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
    const won = await claim(slice);
    await mapLimited(won, SEND_CONCURRENCY, async (c) => {
      const ok = await sendConnectNudgeMail(c.email, { fullName: c.fullName, signedUpAt: c.createdAt });
      if (!ok) {
        await releaseTicket(c);
        failed += 1;
        console.log(`  x ${maskEmail(c.email)} gui loi, da nha ve`);
        return;
      }
      sent += 1;
      console.log(`  + ${maskEmail(c.email)} · dang ky ${vnDateLabel(c.createdAt)}`);
    });
  }

  const remaining = total - internal - skippedSent;
  console.log(
    `Tong chua noi gian: ${total} · noi bo/demo bo qua: ${internal} · da nhan thu nay truoc: ${skippedSent} · can gui: ${remaining}`
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
