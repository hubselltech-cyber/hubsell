// ============================================================
// Cộng GIỜ QUAY vào sổ giờ của một chủ shop (Video đóng hàng) — dùng khi chưa có luồng mua giờ:
// cấp giờ cho tài khoản thí điểm, hoặc nạp số để soi màn trên local.
// Chỉ CHÈN một dòng vào pack_hour_grants (services/pack-video/hours.ts); in số dư trước và sau.
//
// Chạy: npx tsx scripts/pack-video-grant-hours.ts --email=admin@hubsell.vn --hours=1000 --note="cấp thử"
//       thêm --kind=GRANT | ADJUST (mặc định GRANT); --hours âm chỉ đi với --kind=ADJUST.
// ⛔ KHÔNG ghi dòng PURCHASE ở đây: dòng mua giờ chỉ do luồng thanh toán ghi (kèm mã khoản tiền, chứng từ,
//    sổ quỹ, hóa đơn — docs/VIDEO-DONG-HANG-THIET-KE.md mục 19).
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getHoursBalance, grantHours } from "../src/services/pack-video/hours";

const KINDS = ["GRANT", "ADJUST"] as const;
type Kind = (typeof KINDS)[number];

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const fmt = (sec: number): string => `${(sec / 3600).toFixed(2)} giờ`;

async function main() {
  const email = arg("email");
  const hours = Number(arg("hours"));
  const kind = (arg("kind") ?? "GRANT").toUpperCase() as Kind;
  if (!email || !Number.isFinite(hours) || hours === 0) {
    throw new Error("Cần --email=... và --hours=<số khác 0>");
  }
  if (!KINDS.includes(kind)) throw new Error(`--kind phải là một trong: ${KINDS.join(", ")} (PURCHASE chỉ do luồng thanh toán ghi)`);
  if (hours < 0 && kind !== "ADJUST") throw new Error("Số giờ âm chỉ dùng với --kind=ADJUST");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  if (!user) throw new Error(`Không thấy tài khoản ${email}`);
  if (user.ownerId) throw new Error("Đây là tài khoản nhân viên — giờ quay ghi cho CHỦ shop");

  const before = await getHoursBalance(user.id);
  await grantHours({ ownerId: user.id, seconds: Math.round(hours * 3600), kind, note: arg("note") ?? null });
  const after = await getHoursBalance(user.id);
  console.log(`Trước: đã mua ${fmt(before.purchasedSeconds)} · đã quay ${fmt(before.usedSeconds)} · còn ${fmt(before.remainingSeconds)}`);
  console.log(`Sau:   đã mua ${fmt(after.purchasedSeconds)} · đã quay ${fmt(after.usedSeconds)} · còn ${fmt(after.remainingSeconds)}`);
}

main()
  .catch((e) => {
    console.error("LỖI:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
