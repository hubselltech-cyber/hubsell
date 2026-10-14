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
//       so HAI ĐƯỜNG CỘNG của quảng cáo trên cùng dòng gọn đọc từ sổ (duyệt mảng đơn ↔ gom
//       trong database, docs/QUANG-CAO-GOM-TRONG-DATABASE.md): Shopee/Lazada biên lãi từng nhóm,
//       nhịp bán, ba kết quả cuối; TikTok hòa vốn từng nhóm, tự kiểm mẫu số, đà bán, hai kết
//       quả cuối. --explain (kèm --channel): in kế hoạch chạy thật của câu gom.
//       (Tầng so "dòng gọn từ sổ ↔ từ đơn gốc" và lệnh params-compare đã gỡ 14/10/2026
//       cùng đường đọc đơn cũ; so sổ ↔ đơn gốc dùng lệnh `compare` / `audit`.)
//
// Chạy trên Render Shell của WORKER (đừng redeploy khi đang chạy). Chỉ đọc
// đơn theo lô ≤ 500 nên không dồn tải; `drain` tự dừng khi hết dòng bẩn.
// Lệnh ads-compare in chữ KHÔNG DẤU để đọc được trên Render Shell.
// ============================================================

import { ChannelName } from "@prisma/client";
import { compareMarginSources } from "../src/integrations/shopee/ads-margin-compare";
import { loadAdsGroupSets, marginGroupOptions } from "../src/integrations/shopee/ads-margin-source";
import { compareBreakevenSources } from "../src/integrations/tiktok-ads/breakeven-compare";
import { loadBreakevenInputs } from "../src/integrations/tiktok-ads/breakeven-source";
import { adsGroupMappingOf, marginWindowRange, type AdsInsightChannel } from "../src/lib/ads-margin";
import { parseDateRange } from "../src/lib/date-range";
import { tiktokGroupMappingOf, tiktokMarginWindowRange } from "../src/lib/tiktok-breakeven";
import { prisma } from "../src/lib/prisma";
import {
  auditLedger,
  compareLedger,
  drainLedgerOnce,
  ensureLedgerPartitions,
  explainLedgerMarginByGroup,
  explainLedgerTiktokBreakevenByGroup,
  ledgerStatus,
  markLedgerScope,
} from "../src/services/order-ledger";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

// ------------------------------------------------------------
// status / partitions / drain / mark / audit / compare
// ------------------------------------------------------------

async function status(): Promise<void> {
  console.log(JSON.stringify(await ledgerStatus(), null, 2));
}

async function partitions(): Promise<void> {
  const n = await ensureLedgerPartitions(Number(arg("ahead") ?? 3) || 3);
  console.log(`Tạo ${n} phân mảnh mới`);
}

async function drain(): Promise<void> {
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
}

async function mark(): Promise<void> {
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
}

async function audit(): Promise<void> {
  // --min-age <phút>: 0 = lấy cả dòng vừa tính (mặc định 60 như job đêm).
  const minAgeMs = Math.max(0, Number(arg("min-age") ?? 60) || 0) * 60_000;
  const r = await auditLedger(Number(arg("sample") ?? 200) || 200, { minAgeMs });
  console.log(JSON.stringify({ ...r, mismatches: r.mismatches.slice(0, 10) }, null, 2));
}

/** So khớp SUM trong DB ↔ tính lại trong RAM: --owner <userId> hoặc --all (mọi chủ shop có gian). */
async function compare(): Promise<void> {
  const range = parseDateRange({ from: arg("from"), to: arg("to") });
  const channel = arg("channel");
  const owners = flag("all")
    ? (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId)
    : arg("owner")
      ? [arg("owner")!]
      : [];
  if (owners.length === 0) throw new Error("Cần --owner <userId> hoặc --all");
  let allMatch = true;
  for (const userId of owners) {
    const r = await compareLedger({ userId, ...(channel ? { id: channel } : {}) }, range, { fresh: flag("fresh") });
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
}

// ------------------------------------------------------------
// ads-compare
// ------------------------------------------------------------

/** TikTok: hai đường cộng hòa vốn (mảng dòng gọn từ sổ ↔ gom trong database) — nguyên liệu, tự kiểm, đà bán, kết quả cuối. */
async function compareTiktokRows(ch: AdsInsightChannel): Promise<{ ok: boolean; line: string }> {
  const m = await compareBreakevenSources(ch);
  const lech = [...m.baseMismatches, ...m.checkMismatches, ...m.paceMismatches, ...m.endToEndMismatches];
  const line =
    `GOM ${m.ok ? "khop" : "LECH"}: nhom=${m.groups} don=${m.rowsOrders} lechTienMax=${m.maxMoneyDiff.toFixed(4)} ` +
    `soGoc=${m.baseMismatches.length} tuKiem=${m.checkMismatches.length} daBan=${m.paceMismatches.length} ketQuaCuoi=${m.endToEndMismatches.length} ` +
    `(rows ${m.timing.rowsMs}ms, sql ${m.timing.sqlMs}ms)` +
    (m.capped ? " CHAM PHANH 8000 DON - duong rows chi dai dien don moi nhat, khong ket luan duoc" : "") +
    (lech.length ? ` LECH DAU: ${lech.slice(0, 5).join(" ; ")}` : "");
  return { ok: m.ok, line };
}

/** Shopee/Lazada: hai đường cộng biên lãi (mảng dòng gọn từ sổ ↔ gom trong database) — biên lãi từng nhóm, nhịp bán, kết quả cuối. */
async function compareMarginRows(ch: AdsInsightChannel): Promise<{ ok: boolean; line: string }> {
  const m = await compareMarginSources(ch);
  const lech = [...m.baseMismatches, ...m.paceMismatches, ...m.endToEndMismatches];
  const line =
    `GOM ${m.ok ? "khop" : "LECH"}: nhom=${m.groups} don=${m.rowsOrders} lechTienMax=${m.maxMoneyDiff.toFixed(4)} ` +
    `soGoc=${m.baseMismatches.length} nhipBan=${m.paceMismatches.length} ketQuaCuoi=${m.endToEndMismatches.length} ` +
    `(rows ${m.timing.rowsMs}ms, sql ${m.timing.sqlMs}ms)` +
    (m.capped ? " CHAM PHANH 20000 DON - duong rows chi dai dien don moi nhat, khong ket luan duoc" : "") +
    (lech.length ? ` LECH DAU: ${lech.slice(0, 5).join(" ; ")}` : "");
  return { ok: m.ok, line };
}

/** Kế hoạch chạy thật của câu gom (biên lãi Shopee/Lazada, hòa vốn TikTok) cho một gian, bỏ các mảnh tháng không chạy tới. */
async function explainGroupQuery(ch: AdsInsightChannel): Promise<string> {
  const scope = { userId: ch.userId, id: ch.id, channelName: ch.channelName };
  let plan: string[];
  if (ch.channelName === ChannelName.TIKTOK) {
    const range = tiktokMarginWindowRange();
    const inputs = await loadBreakevenInputs(ch.id);
    plan = await explainLedgerTiktokBreakevenByGroup(scope, range, tiktokGroupMappingOf(inputs.sets, inputs.checks), {
      paceNow: range.lte,
    });
  } else {
    const range = marginWindowRange();
    plan = await explainLedgerMarginByGroup(
      scope,
      range,
      adsGroupMappingOf(await loadAdsGroupSets(ch.id)),
      marginGroupOptions(ch.channelName, range)
    );
  }
  const kept: string[] = [];
  let skip = false;
  for (const l of plan) {
    const isNode = l.includes("->") || !l.startsWith(" ");
    if (isNode) skip = l.includes("(never executed)");
    if (!skip) kept.push(l);
  }
  return kept.join("\n");
}

async function adsCompare(): Promise<void> {
  const platform = arg("platform")?.toUpperCase();
  const channelId = arg("channel");
  const channels: AdsInsightChannel[] = await prisma.channel.findMany({
    where: {
      ...(channelId ? { id: channelId } : {}),
      channelName: platform
        ? (platform as ChannelName)
        : { in: [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK] },
    },
    select: { id: true, userId: true, channelName: true },
    orderBy: [{ channelName: "asc" }, { id: "asc" }],
  });
  let allMatch = true;
  for (const ch of channels) {
    const isTiktok = ch.channelName === ChannelName.TIKTOK;
    const { ok, line } = isTiktok ? await compareTiktokRows(ch) : await compareMarginRows(ch);
    allMatch &&= ok;
    console.log(`${ok ? "KHOP" : "LECH"} ${ch.channelName} ${ch.id} ${line}`);
    if (channelId && flag("explain")) console.log(await explainGroupQuery(ch));
  }
  console.log(allMatch ? `TAT CA KHOP (${channels.length} gian)` : "CO LECH - xem tren");
  if (!allMatch) process.exitCode = 2;
}

// ------------------------------------------------------------

const COMMANDS: Record<string, () => Promise<void>> = {
  status,
  partitions,
  drain,
  mark,
  audit,
  compare,
  "ads-compare": adsCompare,
};

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "status";
  const run = COMMANDS[cmd];
  if (!run) throw new Error(`Lệnh lạ: ${cmd}`);
  await run();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
