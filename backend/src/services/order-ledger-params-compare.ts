// ============================================================
// ĐỐI CHIẾU HAI CÁCH VIẾT MỐC KỲ trong các câu đọc sổ cái
// (services/order-ledger.ts — LedgerParamStyle):
//   "text"  = cách cũ, chuỗi ép ::timestamp / ::date (đổi kiểu ở từng dòng quét);
//   "const" = mốc dạng hằng trên tham số số nguyên (mặc định từ 30/09/2026 tối).
// Hai cách cho cùng giá trị nên MỌI câu đọc phải trả về kết quả giống hệt. Công
// cụ này chạy từng câu đọc ở cả hai cách cho một phạm vi + danh sách kỳ, so kết
// quả từng trường, và cộng thời gian mỗi cách — dùng bởi lệnh
// `scripts/ledger-backfill.ts params-compare` (prod) và test tích hợp (DB dev).
// Chuỗi mô tả viết KHÔNG DẤU để đọc được trên Render Shell.
// ============================================================

import { ChannelName } from "@prisma/client";
import type { ChannelScope } from "../lib/channel-filter";
import { toBusinessDateKey, type DateRangeFilter } from "../lib/date-range";
import {
  ledgerCashFlowBreakdown,
  ledgerCompactOrders,
  ledgerDeclarationByChannel,
  ledgerFreshness,
  ledgerLossOrders,
  ledgerMarginByGroup,
  ledgerOverviewBreakdown,
  ledgerPnlList,
  ledgerPnlSummary,
  ledgerSkuAgg,
  ledgerSummary,
  ledgerTaxReportTotals,
  withLedgerParamStyle,
  type LedgerParamStyle,
} from "./order-ledger";

export interface ParamsCompareRange {
  label: string;
  range: DateRangeFilter;
}

export interface ParamsCompareReport {
  /** Số lượt (câu đọc × kỳ) đã so. */
  probes: number;
  mismatches: string[];
  /** Tổng mili giây theo tên câu đọc, mỗi cách. */
  timing: Map<string, { text: number; const: number }>;
  ok: boolean;
}

/** Dạng chuẩn để so: Map → mảng cặp xếp theo khóa, Date → ISO, số lớn / Decimal → chuỗi. */
function canon(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Map) {
    return [...v.entries()]
      .map(([k, x]) => [String(k), canon(x)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return String(v); // Decimal
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = canon((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

interface Probe {
  name: string;
  run: () => Promise<unknown>;
}

/** Các câu đọc của một phạm vi trong một kỳ. `channel` có thì thêm các câu chỉ chạy theo từng gian. */
function probesFor(
  scope: ChannelScope,
  range: DateRangeFilter,
  channel: { channelName: ChannelName } | null
): Probe[] {
  const since = toBusinessDateKey(range.gte);
  const probes: Probe[] = [
    { name: "freshness", run: () => ledgerFreshness(scope, range) },
    { name: "freshness.delivered", run: () => ledgerFreshness(scope, range, "delivered") },
    { name: "summary", run: () => ledgerSummary(scope, range) },
    { name: "summary.delivered", run: () => ledgerSummary(scope, range, { axis: "delivered" }) },
    { name: "summary.settled", run: () => ledgerSummary(scope, range, { axis: "settled" }) },
    { name: "cashFlow", run: () => ledgerCashFlowBreakdown(scope, range, { byDaySince: since }) },
    { name: "overview", run: () => ledgerOverviewBreakdown(scope, range, { byDaySince: since }) },
    { name: "pnlSummary", run: () => ledgerPnlSummary(scope, range, {}, { byDaySince: since }) },
    { name: "pnlSummary.loss", run: () => ledgerPnlSummary(scope, range, { lossOnly: true }) },
    {
      name: "pnlList",
      // Trang đầu, rồi đọc tiếp bằng con trỏ sau dòng thứ 10 (đường xuất Excel).
      run: async () => {
        const first = await ledgerPnlList(scope, range, {}, { limit: 50 });
        const at = first[Math.min(9, first.length - 1)];
        const next = at
          ? await ledgerPnlList(scope, range, {}, { limit: 50, cursor: { createdAt: at.createdAt, orderId: at.orderId } })
          : [];
        return { first, next };
      },
    },
    { name: "taxReport", run: () => ledgerTaxReportTotals(scope, range) },
    {
      name: "declaration.delivered",
      run: async () => sortRows(await ledgerDeclarationByChannel(scope, range, "delivered")),
    },
    {
      name: "declaration.created",
      run: async () => sortRows(await ledgerDeclarationByChannel(scope, range, "created")),
    },
    { name: "lossOrders", run: () => ledgerLossOrders(scope, range, 100) },
    { name: "lossOrders.active", run: () => ledgerLossOrders(scope, range, 3, "active") },
    { name: "skuAgg", run: () => ledgerSkuAgg(scope, range) },
  ];
  if (channel) {
    probes.push(
      {
        name: "compactOrders",
        run: () =>
          ledgerCompactOrders(scope, range, 2_000, {
            withTiktokSettlement: channel.channelName === ChannelName.TIKTOK,
          }),
      },
      {
        name: "marginByGroup",
        run: () =>
          ledgerMarginByGroup(scope, range, { groups: [], skus: [] }, {
            settledOnly: channel.channelName === ChannelName.LAZADA,
            recentSince: new Date(range.lte.getTime() - 7 * 86_400_000),
          }),
      }
    );
  }
  return probes;
}

/** Bảng kê khai gom theo sàn không có ORDER BY — xếp lại để thứ tự dòng không gây lệch giả. */
function sortRows<T extends { rows: { channelName: string }[] }>(r: T): T {
  return { ...r, rows: [...r.rows].sort((a, b) => (a.channelName < b.channelName ? -1 : 1)) };
}

async function timed(style: LedgerParamStyle, probe: Probe): Promise<{ json: string; ms: number }> {
  const t = process.hrtime.bigint();
  const result = await withLedgerParamStyle(style, probe.run);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  return { json: JSON.stringify(canon(result)), ms };
}

/**
 * So mọi câu đọc của một phạm vi ở hai cách viết mốc kỳ. Lệch thì chạy lại cặp
 * đó một lần (đơn vừa được worker ghi sổ xen giữa hai lượt đọc sẽ tự hết) rồi
 * mới ghi nhận là lệch.
 */
export async function compareLedgerParamStyles(
  scope: ChannelScope,
  ranges: ParamsCompareRange[],
  opts: { channel?: { channelName: ChannelName } | null; label?: string } = {}
): Promise<ParamsCompareReport> {
  const mismatches: string[] = [];
  const timing: ParamsCompareReport["timing"] = new Map();
  let probes = 0;
  for (const { label, range } of ranges) {
    for (const probe of probesFor(scope, range, opts.channel ?? null)) {
      probes += 1;
      let a = await timed("text", probe);
      let b = await timed("const", probe);
      if (a.json !== b.json) {
        a = await timed("text", probe);
        b = await timed("const", probe);
      }
      const t = timing.get(probe.name) ?? { text: 0, const: 0 };
      t.text += a.ms;
      t.const += b.ms;
      timing.set(probe.name, t);
      if (a.json !== b.json) {
        let i = 0;
        while (i < a.json.length && a.json[i] === b.json[i]) i += 1;
        mismatches.push(
          `${opts.label ?? ""} ${label} ${probe.name}: text ...${a.json.slice(Math.max(0, i - 40), i + 60)} | const ...${b.json.slice(Math.max(0, i - 40), i + 60)}`
        );
      }
    }
  }
  return { probes, mismatches, timing, ok: mismatches.length === 0 };
}

/** Các kỳ mặc định tính tới hôm nay (giờ VN): 7 ngày, tháng này, tháng trước, quý này, năm nay, 400 ngày. */
export function defaultCompareRanges(now: Date = new Date()): ParamsCompareRange[] {
  const DAY = 86_400_000;
  const VN = 7 * 3_600_000;
  const todayKey = toBusinessDateKey(now);
  const [y, m] = todayKey.split("-").map(Number);
  const startOf = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - VN);
  const endOf = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - VN + DAY - 1);
  const key = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const quarterStartMonth = m - ((m - 1) % 3);
  return [
    { label: "7ngay", range: { gte: new Date(startOf(todayKey).getTime() - 6 * DAY), lte: endOf(todayKey) } },
    { label: "thangnay", range: { gte: startOf(key(y, m, 1)), lte: endOf(todayKey) } },
    { label: "thangtruoc", range: { gte: startOf(key(y, m - 1, 1)), lte: endOf(key(y, m, 0)) } },
    { label: "quynay", range: { gte: startOf(key(y, quarterStartMonth, 1)), lte: endOf(todayKey) } },
    { label: "namnay", range: { gte: startOf(key(y, 1, 1)), lte: endOf(todayKey) } },
    { label: "400ngay", range: { gte: new Date(startOf(todayKey).getTime() - 399 * DAY), lte: endOf(todayKey) } },
  ];
}
