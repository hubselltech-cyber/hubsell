// ============================================================
// SỔ CÁI ĐƠN — công cụ dòng lệnh (docs/SO-CAI-DON.md)
//
// Migration 20260930230000_order_ledger đã tạo dòng nháp bẩn cho MỌI đơn sẵn
// có; worker (workers/order-ledger.ts) tính dần. Script này dùng khi cần chủ
// động: xem tiến độ, tính ngay tại chỗ (không chờ worker), đánh dấu tính lại
// một phạm vi, chạy đối soát mẫu.
//
//   npx tsx scripts/ledger-backfill.ts status
//   npx tsx scripts/ledger-backfill.ts drain [--batch 500] [--max 100000]
//   npx tsx scripts/ledger-backfill.ts mark --owner <userId> [--channel <id>] [--from yyyy-mm-dd --to yyyy-mm-dd]
//   npx tsx scripts/ledger-backfill.ts audit [--sample 500]
//   npx tsx scripts/ledger-backfill.ts partitions
//
// Chạy trên Render Shell của WORKER (đừng redeploy khi đang chạy). Chỉ đọc
// đơn theo lô ≤ 500 nên không dồn tải; `drain` tự dừng khi hết dòng bẩn.
// ============================================================

import { parseDateRange } from "../src/lib/date-range";
import {
  auditLedger,
  drainLedgerOnce,
  ensureLedgerPartitions,
  ledgerStatus,
  markLedgerScope,
} from "../src/services/order-ledger";
import { prisma } from "../src/lib/prisma";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2] ?? "status";
  if (cmd === "status") {
    const s = await ledgerStatus();
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  if (cmd === "partitions") {
    const n = await ensureLedgerPartitions(Number(arg("ahead") ?? 3) || 3);
    console.log(`Tạo ${n} phân mảnh mới`);
    return;
  }
  if (cmd === "drain") {
    const batch = Math.min(2000, Math.max(50, Number(arg("batch") ?? 500) || 500));
    const max = Number(arg("max") ?? 1_000_000) || 1_000_000;
    let total = 0;
    const t0 = Date.now();
    for (;;) {
      const r = await drainLedgerOnce(batch);
      total += r.claimed;
      if (r.claimed === 0 || total >= max) break;
      const rate = Math.round((total / Math.max(1, Date.now() - t0)) * 1000);
      console.log(`đã tính ${total} đơn (${rate} đơn/giây)`);
    }
    console.log(`XONG: ${total} đơn, ${Math.round((Date.now() - t0) / 1000)}s`);
    return;
  }
  if (cmd === "mark") {
    const owner = arg("owner");
    if (!owner) throw new Error("Thiếu --owner <userId>");
    const channel = arg("channel");
    const range = parseDateRange({ from: arg("from"), to: arg("to") });
    const r = await markLedgerScope(
      { userId: owner, ...(channel ? { id: channel } : {}) },
      range,
      `script:${arg("reason") ?? "mark"}`
    );
    console.log(`Đánh dấu ${r.marked} dòng, tạo nháp ${r.stubbed} đơn chưa có trong sổ`);
    return;
  }
  if (cmd === "audit") {
    const r = await auditLedger(Number(arg("sample") ?? 200) || 200);
    console.log(JSON.stringify({ ...r, mismatches: r.mismatches.slice(0, 10) }, null, 2));
    return;
  }
  throw new Error(`Lệnh lạ: ${cmd}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
