/**
 * TÀI KHOẢN NHÂN VIÊN KHO CHO NGƯỜI DUYỆT APP STORE / GOOGLE PLAY (23/09/2026)
 *
 * Người duyệt của Apple/Google cần thấy CẢ HAI luồng của app di động:
 *   · chủ shop  → đăng nhập bằng chính tài khoản reviewer@hubsell.vn (role ADMIN,
 *                 đã seed bằng seed-isv-reviewer.ts, worker bồi đơn giữ "sống");
 *   · nhân viên kho → tài khoản phụ "<username chủ>/<staff>" có quyền
 *                 Đối soát đơn hoàn → app mở thẳng màn Quét đơn hoàn.
 *
 * Script này chỉ tạo/cập nhật tài khoản phụ đó dưới đúng chủ shop có email
 * truyền vào; không đụng đơn hàng hay gian. Chủ shop chưa có username thì
 * tự sinh từ email (giống lúc tạo nhân viên đầu tiên qua UI) — với
 * reviewer@hubsell.vn sẽ là "reviewer" → đăng nhập "reviewer/reviewer_kho".
 *
 * Idempotent: tồn tại rồi thì cập nhật mật khẩu (nếu truyền), họ tên, quyền,
 * phạm vi gian (mọi gian ACTIVE của chủ).
 *
 *   # Local (DATABASE_URL trong .env) — xem trước, rồi ghi thật
 *   npx tsx scripts/seed-reviewer-staff.ts --password=<mật khẩu>
 *   npx tsx scripts/seed-reviewer-staff.ts --password=<mật khẩu> --apply
 *
 *   # Production (PowerShell trên máy anh Trung, chuỗi Session pooler Supabase)
 *   $env:DATABASE_URL='postgresql://...'; npx tsx scripts/seed-reviewer-staff.ts --production --password=<mật khẩu> --apply
 *
 * Tùy chọn: --email=reviewer@hubsell.vn · --staff=reviewer_kho · --name="Nhân viên kho (demo)"
 */
import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

import { ensureOwnerUsername, USERNAME_REGEX } from "../src/lib/username";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const EMAIL = (arg("email") ?? "reviewer@hubsell.vn").toLowerCase();
const STAFF = (arg("staff") ?? "reviewer_kho").toLowerCase();
const NAME = arg("name") ?? "Nhân viên kho (demo)";
const PASSWORD = arg("password");
const APPLY = flag("apply");
const IS_PRODUCTION_FLAG = flag("production");

/** Quyền tối thiểu để app di động rẽ vào luồng kho + thấy Kho vật lý trên web. */
const PERMISSIONS = ["warehouse.products", "warehouse.returns"];

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const looksProd = !/localhost|127\.0\.0\.1/.test(dbUrl);
  if (looksProd && !IS_PRODUCTION_FLAG) {
    throw new Error(
      "DATABASE_URL không phải local. Chạy trên production phải thêm --production để xác nhận ý định.",
    );
  }
  if (!USERNAME_REGEX.test(STAFF)) {
    throw new Error("--staff: 3-30 ký tự, chỉ chữ thường/số/dấu chấm/gạch dưới");
  }
  if (PASSWORD !== undefined && PASSWORD.length < 6) {
    throw new Error("--password phải có ít nhất 6 ký tự");
  }

  const owner = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      ownerId: true,
      isPlatformAdmin: true,
      channels: {
        where: { status: "ACTIVE" },
        select: { id: true, shopName: true, channelName: true },
        orderBy: { channelName: "asc" },
      },
    },
  });
  if (!owner) throw new Error(`Không thấy chủ shop ${EMAIL}. Chạy seed-isv-reviewer.ts trước.`);
  if (owner.isPlatformAdmin) throw new Error("TỪ CHỐI: email này là tài khoản quản trị nền tảng (HQ).");
  if (owner.ownerId || owner.role !== Role.ADMIN) throw new Error("TỪ CHỐI: email này không phải chủ shop.");
  if (owner.channels.length === 0) throw new Error("Chủ shop chưa có gian ACTIVE nào — reviewer sẽ không thấy đơn để quét.");

  const existing = await prisma.user.findUnique({
    where: { ownerId_staffUsername: { ownerId: owner.id, staffUsername: STAFF } },
    select: { id: true, fullName: true, permissions: true, staffChannels: { select: { channelId: true } } },
  });
  if (!existing && !PASSWORD) {
    throw new Error("Nhân viên chưa tồn tại — phải truyền --password=<mật khẩu> để tạo mới.");
  }

  const ownerUsername = owner.username ?? `(sẽ sinh từ email, dự kiến "${EMAIL.split("@")[0].replace(/[^a-z0-9._]/g, "")}")`;
  console.log(`${APPLY ? "✍️  GHI THẬT" : "👀 XEM TRƯỚC"} · DB ${looksProd ? "PRODUCTION" : "local"}`);
  console.log(`   Chủ shop:   ${owner.email} · username ${ownerUsername}`);
  console.log(`   Nhân viên:  ${STAFF} · ${existing ? "ĐÃ CÓ → cập nhật" : "chưa có → tạo mới"} · họ tên "${NAME}"`);
  console.log(`   Quyền:      ${PERMISSIONS.join(", ")}`);
  console.log(`   Phạm vi gian (${owner.channels.length}):`);
  for (const c of owner.channels) {
    console.log(`     - ${c.channelName} · ${c.shopName} (${c.id})`);
  }
  console.log(`   Mật khẩu:   ${PASSWORD ? "đặt mới theo --password" : "giữ nguyên"}`);

  if (!APPLY) {
    console.log("\nChưa ghi gì. Thêm --apply để thực hiện.");
    return;
  }

  const finalOwnerUsername = await ensureOwnerUsername({
    id: owner.id,
    email: owner.email,
    username: owner.username,
  });

  const channelIds = owner.channels.map((c) => c.id);
  let staffId: string;
  if (existing) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName: NAME,
          permissions: PERMISSIONS,
          ...(PASSWORD ? { passwordHash: await bcrypt.hash(PASSWORD, 10) } : {}),
        },
      }),
      prisma.staffChannel.deleteMany({ where: { staffId: existing.id } }),
      prisma.staffChannel.createMany({
        data: channelIds.map((channelId) => ({ staffId: existing.id, channelId })),
      }),
    ]);
    staffId = existing.id;
  } else {
    const created = await prisma.user.create({
      data: {
        email: null,
        staffUsername: STAFF,
        passwordHash: await bcrypt.hash(PASSWORD!, 10),
        fullName: NAME,
        role: Role.SALES,
        ownerId: owner.id,
        permissions: PERMISSIONS,
        staffChannels: { create: channelIds.map((channelId) => ({ channelId })) },
      },
      select: { id: true },
    });
    staffId = created.id;
  }

  console.log(`\n✅ Xong (user ${staffId}).`);
  console.log(`   Đăng nhập app di động / web: ${finalOwnerUsername}/${STAFF}${PASSWORD ? " / " + PASSWORD : ""}`);
  console.log(`   Chủ shop cho người duyệt:     ${owner.email} (mật khẩu như đã seed)`);
}

main()
  .catch((err) => {
    console.error("❌", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
