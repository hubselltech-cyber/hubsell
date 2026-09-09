// Dọn DẤU VẾT DEMO của Trung tâm điều hành khỏi DB (09/09/2026).
//
// Trước 09/09, Dashboard trộn thẻ cảnh báo MOCK (id "al-*") với sự cố thật;
// người dùng bấm thử "Đã xử lý"/"Thảo luận"/xử lý nhanh trên thẻ mock thì
// backend vẫn lưu OpsResolvedAlert / OpsChatMessage / OpsActivity thật. Code
// mock đã gỡ (9e35f5d) nhưng các dòng nhật ký cũ vẫn hiện — script này xóa
// đúng những dòng sinh từ thẻ mock, KHÔNG đụng nhật ký của cảnh báo thật.
//
// Nhận diện:
//   · OpsResolvedAlert / OpsChatMessage: alertId LIKE 'al-%' (id mock; thật là
//     "sync-…" / "ops-…").
//   · OpsActivity: dòng do người dùng thao tác (mở đầu bằng tên vai trò
//     Command Center) VÀ nhắc tới SKU/sản phẩm/tiêu đề chỉ có trong bộ mock.
//     Dòng hệ thống (⚠️/✅/🔗/⏸️) và dòng thao tác trên cảnh báo thật giữ nguyên.
//
// Chạy (mặc định CHỈ LIỆT KÊ):
//   npx tsx scripts/cleanup-ops-demo.ts                 → DB trong .env (local)
//   npx tsx scripts/cleanup-ops-demo.ts --apply         → xóa thật
//   DATABASE_URL="<chuỗi Supabase>" npx tsx scripts/cleanup-ops-demo.ts --apply   → production
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

/** Tên vai trò Command Center đứng đầu mọi dòng nhật ký do người dùng thao tác. */
const ROLE_PREFIXES = ["Quản trị (toàn quyền)", "Nhân viên Kho", "Kế toán", "Marketing"];

/** Chuỗi CHỈ xuất hiện trong bộ thẻ/kịch bản mock (mock-service.ts + action-modal.tsx). */
const MOCK_MARKERS = [
  "SP002",
  "SH-GIAY-40",
  "SH-AO-KHOAC",
  "SH-AO-THUN",
  "SH-MU-THEU",
  "Áo khoác gió",
  "0908****21",
  "Lazada trễ đồng bộ đơn 40 phút",
  "ROAS chiến dịch áo khoác",
  "Quần jean SP002",
  "đang cháy hàng trên",
  "Bơm tồn ",
  "khai sai cân nặng",
];

function isDemoActivity(message: string): boolean {
  const roleLine = ROLE_PREFIXES.some((p) => message.startsWith(p));
  if (!roleLine) return false;
  return MOCK_MARKERS.some((m) => message.includes(m));
}

async function main() {
  const [resolved, chats, activities] = await Promise.all([
    prisma.opsResolvedAlert.findMany({ where: { alertId: { startsWith: "al-" } } }),
    prisma.opsChatMessage.findMany({ where: { alertId: { startsWith: "al-" } } }),
    prisma.opsActivity.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const demoActs = activities.filter((a) => isDemoActivity(a.message));

  console.log(`OpsResolvedAlert mock (al-*): ${resolved.length}`);
  for (const r of resolved) console.log(`  · ${r.alertId} (owner ${r.ownerId})`);
  console.log(`OpsChatMessage mock (al-*): ${chats.length}`);
  for (const c of chats) console.log(`  · ${c.alertId} — ${c.author}: ${c.body.slice(0, 60)}`);
  console.log(`OpsActivity demo: ${demoActs.length} / ${activities.length} dòng`);
  for (const a of demoActs)
    console.log(`  · ${a.createdAt.toISOString().slice(0, 10)} [${a.tag}] ${a.message.slice(0, 120)}`);
  console.log("Giữ lại (không đụng):");
  for (const a of activities.filter((a) => !isDemoActivity(a.message)))
    console.log(`  ✓ ${a.createdAt.toISOString().slice(0, 10)} [${a.tag}] ${a.message.slice(0, 120)}`);

  if (!APPLY) {
    console.log("\nChỉ liệt kê. Thêm --apply để xóa.");
    return;
  }
  const [r1, r2, r3] = await prisma.$transaction([
    prisma.opsResolvedAlert.deleteMany({ where: { alertId: { startsWith: "al-" } } }),
    prisma.opsChatMessage.deleteMany({ where: { alertId: { startsWith: "al-" } } }),
    prisma.opsActivity.deleteMany({ where: { id: { in: demoActs.map((a) => a.id) } } }),
  ]);
  console.log(`\nĐÃ XÓA: ${r1.count} resolved, ${r2.count} chat, ${r3.count} nhật ký.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
