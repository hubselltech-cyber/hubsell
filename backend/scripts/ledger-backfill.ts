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
//   npx tsx scripts/ledger-backfill.ts audit [--sample 500] [--min-age 0]
//   npx tsx scripts/ledger-backfill.ts compare (--all | --owner <userId>) [--channel <id>] [--from --to] [--fresh]
//   npx tsx scripts/ledger-backfill.ts partitions
//   npx tsx scripts/ledger-backfill.ts ads-compare [--platform TIKTOK|SHOPEE|LAZADA] [--channel <id>] [--explain]
//       so dòng gọn của đơn (nguyên liệu biên lãi / hòa vốn quảng cáo) đọc từ sổ với dòng dựng
//       từ đơn gốc, từng gian — in chữ KHÔNG DẤU để đọc được trên Render Shell.
//       Shopee/Lazada so thêm HAI ĐƯỜNG CỘNG biên lãi (duyệt mảng đơn ↔ gom trong database,
//       docs/QUANG-CAO-GOM-TRONG-DATABASE.md): từng nhóm, nhịp bán, ba kết quả cuối. Phải
//       "TAT CA KHOP" trước khi bật ADS_MARGIN_SOURCE=sql. --explain (kèm --channel): in kế
//       hoạch chạy thật của câu gom.
//
// Chạy trên Render Shell của WORKER (đừng redeploy khi đang chạy). Chỉ đọc
// đơn theo lô ≤ 500 nên không dồn tải; `drain` tự dừng khi hết dòng bẩn.
// ============================================================

import { parseDateRange } from "../src/lib/date-range";
import {
  auditLedger,
  compareLedger,
  drainLedgerOnce,
  ensureLedgerPartitions,
  ledgerStatus,
  markLedgerScope,
} from "../src/services/order-ledger";
import { prisma } from "../src/lib/prisma";
import { ChannelName } from "@prisma/client";
import {
  adsGroupMappingOf,
  loadAdsGroupSets,
  loadMarginRows,
  marginGroupOptions,
  marginOverRows,
  marginWindowRange,
  pnlRowsForMargin,
} from "../src/integrations/shopee/ads-insights";
import { compareMarginSources } from "../src/integrations/shopee/ads-margin-compare";
import { explainLedgerMarginByGroup } from "../src/services/order-ledger";
import {
  loadBreakevenRows,
  tiktokBreakevenBase,
  tiktokBreakevenBaseByGroup,
} from "../src/integrations/tiktok-ads/breakeven";

/** So hai mảng dòng gọn theo thứ tự (mới nhất trước) — trả số dòng lệch + mô tả dòng lệch đầu tiên. */
function diffCompactRows(
  a: { createdAt: Date; shippingStatus: string; isSettled: boolean; actualRevenue: number; profit: number; missingCostPrice: boolean; items: { sku: string; price: number; quantity: number }[]; tiktok?: { feeGmvMax: number } | null }[],
  b: typeof a
): { mismatched: number; first: string | null } {
  const key = (items: { sku: string; price: number; quantity: number }[]) =>
    items.map((i) => `${i.sku}|${Math.round(i.price)}|${i.quantity}`).sort().join(";");
  let mismatched = 0;
  let first: string | null = null;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    const why: string[] = [];
    if (!x || !y) why.push("thieu dong");
    else {
      if (x.createdAt.getTime() !== y.createdAt.getTime()) why.push("createdAt");
      if (x.shippingStatus !== y.shippingStatus) why.push(`status ${x.shippingStatus}/${y.shippingStatus}`);
      if (x.isSettled !== y.isSettled) why.push(`isSettled ${x.isSettled}/${y.isSettled}`);
      if (x.missingCostPrice !== y.missingCostPrice) why.push("missingCost");
      if (Math.abs(x.actualRevenue - y.actualRevenue) > 0.5) why.push(`revenue ${x.actualRevenue}/${y.actualRevenue}`);
      if (Math.abs(x.profit - y.profit) > 0.5) why.push(`profit ${x.profit}/${y.profit}`);
      if (key(x.items) !== key(y.items)) why.push("items");
      if ((x.tiktok == null) !== (y.tiktok == null)) why.push("tiktok null");
      if (Math.abs((x.tiktok?.feeGmvMax ?? 0) - (y.tiktok?.feeGmvMax ?? 0)) > 0.5) why.push("feeGmvMax");
    }
    if (why.length) {
      mismatched += 1;
      if (!first) first = `#${i} ${x?.createdAt?.toISOString() ?? "-"}: ${why.join(", ")}`;
    }
  }
  return { mismatched, first };
}

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
  if (cmd === "ads-compare") {
    const platform = arg("platform")?.toUpperCase();
    const channelId = arg("channel");
    const channels = await prisma.channel.findMany({
      where: {
        ...(channelId ? { id: channelId } : {}),
        channelName: platform
          ? (platform as ChannelName)
          : { in: [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK] },
      },
      select: { id: true, userId: true, channelName: true },
      orderBy: [{ channelName: "asc" }, { id: "asc" }],
    });
    const close = (x: number, y: number) => Math.abs(x - y) <= 1;
    let allMatch = true;
    for (const ch of channels) {
      const t0 = Date.now();
      let line: string;
      let ok: boolean;
      if (ch.channelName === ChannelName.TIKTOK) {
        const ledger = await loadBreakevenRows(ch, "ledger");
        const t1 = Date.now();
        const orders = await loadBreakevenRows(ch, "orders");
        const t2 = Date.now();
        const d = diffCompactRows(ledger, orders);
        const x = tiktokBreakevenBase(ledger, null);
        const y = tiktokBreakevenBase(orders, null);
        const groupOfSku = new Map<string, string>();
        for (const r of orders) for (const it of r.items) groupOfSku.set(it.sku, it.sku);
        const gx = tiktokBreakevenBaseByGroup(ledger, groupOfSku);
        const gy = tiktokBreakevenBaseByGroup(orders, groupOfSku);
        let groupDiff = 0;
        for (const [g, by] of gy) {
          const bx = gx.get(g);
          if (!bx || bx.settledOrders !== by.settledOrders || bx.pendingOrders !== by.pendingOrders || !close(bx.revenue, by.revenue) || !close(bx.profitBeforeAds, by.profitBeforeAds)) groupDiff += 1;
        }
        ok =
          d.mismatched === 0 && groupDiff === 0 &&
          x.settledOrders === y.settledOrders && x.cancelledOrders === y.cancelledOrders && x.pendingOrders === y.pendingOrders &&
          close(x.revenue, y.revenue) && close(x.profitBeforeAds, y.profitBeforeAds) && close(x.adFee, y.adFee) && close(x.missingCostRevenue, y.missingCostRevenue);
        line =
          `rows=${ledger.length}/${orders.length} rowDiff=${d.mismatched} skuGroups=${gy.size} groupDiff=${groupDiff} ` +
          `settled=${x.settledOrders}/${y.settledOrders} cancelled=${x.cancelledOrders}/${y.cancelledOrders} pending=${x.pendingOrders}/${y.pendingOrders} ` +
          `revenue=${Math.round(x.revenue)}/${Math.round(y.revenue)} profitBeforeAds=${Math.round(x.profitBeforeAds)}/${Math.round(y.profitBeforeAds)} adFee=${Math.round(x.adFee)}/${Math.round(y.adFee)} ` +
          `(so ${t1 - t0}ms, don goc ${t2 - t1}ms)` + (d.first ? ` FIRST: ${d.first}` : "");
      } else {
        const ledger = await loadMarginRows(ch, "ledger");
        const t1 = Date.now();
        const orders = await loadMarginRows(ch, "orders");
        const t2 = Date.now();
        const d = diffCompactRows(ledger, orders);
        const x = marginOverRows(pnlRowsForMargin(ledger, ch.channelName), null);
        const y = marginOverRows(pnlRowsForMargin(orders, ch.channelName), null);
        ok =
          d.mismatched === 0 && x.orders === y.orders && x.missingCostOrders === y.missingCostOrders &&
          x.costCoveragePct === y.costCoveragePct && close(x.revenue, y.revenue) && close(x.profit, y.profit);
        line =
          `rows=${ledger.length}/${orders.length} rowDiff=${d.mismatched} orders=${x.orders}/${y.orders} missingCost=${x.missingCostOrders}/${y.missingCostOrders} ` +
          `coverage=${x.costCoveragePct}/${y.costCoveragePct} revenue=${Math.round(x.revenue)}/${Math.round(y.revenue)} profit=${Math.round(x.profit)}/${Math.round(y.profit)} ` +
          `(so ${t1 - t0}ms, don goc ${t2 - t1}ms)` + (d.first ? ` FIRST: ${d.first}` : "");

        // Hai đường cộng biên lãi: duyệt mảng đơn trong RAM ↔ gom trong database.
        const m = await compareMarginSources(ch);
        ok &&= m.ok;
        const lech = [...m.baseMismatches, ...m.paceMismatches, ...m.endToEndMismatches];
        line +=
          ` | GOM ${m.ok ? "khop" : "LECH"}: nhom=${m.groups} don=${m.rowsOrders} lechTienMax=${m.maxMoneyDiff.toFixed(4)} ` +
          `soGoc=${m.baseMismatches.length} nhipBan=${m.paceMismatches.length} ketQuaCuoi=${m.endToEndMismatches.length} ` +
          `(rows ${m.timing.rowsMs}ms, sql ${m.timing.sqlMs}ms)` +
          (m.capped ? " CHAM PHANH 20000 DON - duong rows chi dai dien don moi nhat, khong ket luan duoc" : "") +
          (lech.length ? ` LECH DAU: ${lech.slice(0, 5).join(" ; ")}` : "");

        if (process.argv.includes("--explain") && channelId) {
          const range = marginWindowRange();
          const plan = await explainLedgerMarginByGroup(
            { userId: ch.userId, id: ch.id, channelName: ch.channelName },
            range,
            adsGroupMappingOf(await loadAdsGroupSets(ch.id)),
            marginGroupOptions(ch.channelName, range)
          );
          // Bỏ các mảnh tháng không chạy tới cho gọn.
          const kept: string[] = [];
          let skip = false;
          for (const l of plan) {
            const isNode = l.includes("->") || !l.startsWith(" ");
            if (isNode) skip = l.includes("(never executed)");
            if (!skip) kept.push(l);
          }
          line += `\n${kept.join("\n")}`;
        }
      }
      allMatch &&= ok;
      console.log(`${ok ? "KHOP" : "LECH"} ${ch.channelName} ${ch.id} ${line}`);
    }
    console.log(allMatch ? `TAT CA KHOP (${channels.length} gian)` : "CO LECH - xem tren");
    if (!allMatch) process.exitCode = 2;
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
    // --min-age <phút>: 0 = lấy cả dòng vừa tính (mặc định 60 như job đêm).
    const minAgeMs = Math.max(0, Number(arg("min-age") ?? 60) || 0) * 60_000;
    const r = await auditLedger(Number(arg("sample") ?? 200) || 200, { minAgeMs });
    console.log(JSON.stringify({ ...r, mismatches: r.mismatches.slice(0, 10) }, null, 2));
    return;
  }
  if (cmd === "compare") {
    // So khớp SUM trong DB ↔ tính lại trong RAM: --owner <userId> hoặc --all
    // (mọi chủ shop có gian), tùy chọn --channel, --from/--to, --fresh.
    const range = parseDateRange({ from: arg("from"), to: arg("to") });
    const channel = arg("channel");
    const owners = process.argv.includes("--all")
      ? (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId)
      : arg("owner")
        ? [arg("owner")!]
        : [];
    if (owners.length === 0) throw new Error("Cần --owner <userId> hoặc --all");
    let allMatch = true;
    for (const userId of owners) {
      const r = await compareLedger(
        { userId, ...(channel ? { id: channel } : {}) },
        range,
        { fresh: process.argv.includes("--fresh") }
      );
      allMatch &&= r.match;
      const a = r.ledger.all;
      console.log(
        `${r.match ? "KHỚP " : "LỆCH "} owner=${userId} đơn=${a.count} (sổ ${r.timing.ledgerMs}ms, tính lại ${r.timing.recomputeMs}ms) ` +
          `DT=${a.revenueGross} DTsàn=${a.platformRevenue} LN=${a.profitAfterTax} bẩn=${r.freshness.dirty}`
      );
      for (const d of r.diffs.slice(0, 20)) {
        console.log(`   ${d.group}.${d.metric}: sổ ${d.ledger} ≠ tính lại ${d.recomputed} (lệch ${d.diff})`);
      }
    }
    console.log(allMatch ? "TẤT CẢ KHỚP" : "CÓ LỆCH — xem trên");
    if (!allMatch) process.exitCode = 2;
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
