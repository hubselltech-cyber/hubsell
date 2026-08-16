// ============================================================
// TRỢ LÝ HUBSELL — tầng LUẬT của thác nước "luật-trước-LLM-sau" (chốt 16/08).
//
// Chủ shop hỏi số liệu vận hành bằng tiếng Việt tự nhiên qua bong bóng chat
// nổi mọi trang (kiểu Intercom). Router chính là TẦNG LUẬT: chấm điểm khớp
// intent bằng từ khóa không dấu → trả lời template + SỐ THẬT từ Prisma +
// deep-link, 0 đồng token. Khớp mơ hồ → chip hỏi lại, không đoán bừa. Câu
// phân tích (tại sao/so sánh/dự đoán) → dành cho tầng LLM gói cao (đang gác
// chờ thương mại hóa) nên hiện trả lời thẳng là chưa hỗ trợ.
//
// MỌI câu hỏi đều ghi assistant_query_log ngay từ ngày đầu — định kỳ đọc các
// câu miss phổ biến để bồi thành intent mới, tầng luật tự nở, tỷ lệ phải đi
// LLM tự co khi khách tăng (mục tiêu số 1: tiết kiệm token).
//
// NGUYÊN TẮC SỐ LIỆU: tái dùng đúng SSOT — computePnlRow của finance.ts cho
// mọi con số tiền (không groupBy totalAmount, không bịa phí %), date-range
// UTC+7 cho mọi mốc ngày. Số trợ lý trả phải TRÙNG số các trang báo cáo.
// ============================================================

import { Router } from "express";
import {
  ChannelName,
  ReturnStatus,
  ShippingStatus,
  TransactionDirection,
} from "@prisma/client";

import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { channelScope, type ChannelScope } from "../channel-filter";
import {
  BUSINESS_TZ_OFFSET_MS,
  businessDayStart,
  type DateRangeFilter,
} from "../date-range";
import { computePnlRow, fetchPnlOrders } from "./finance";
import {
  assistantDecisionActive,
  computeChannelAdsInsights,
} from "../integrations/shopee/ads-insights";

// ─────────────────────────── Hợp đồng trả lời ───────────────────────────

interface AssistantRow {
  label: string;
  value: string;
  /** pos = xanh (lãi), neg = đỏ (lỗ/cảnh báo) — frontend tô theo chuẩn màu. */
  tone?: "pos" | "neg";
}

export interface AssistantReply {
  outcome: "answered" | "clarify" | "miss" | "analysis";
  text: string;
  rows?: AssistantRow[];
  link?: { href: string; label: string };
  /** Chip hỏi lại khi câu mơ hồ — bấm chip là hỏi thẳng intent đó. */
  chips?: { intent: string; label: string }[];
  /** Câu mẫu gợi ý bấm-để-hỏi (màn chào + khi miss). */
  suggestions?: string[];
}

// ─────────────────────────── Chuẩn hoá & thời gian ───────────────────────────

/** Bỏ dấu tiếng Việt + lowercase — cùng kỹ thuật với command palette Ctrl+K. */
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Chuẩn hoá để so khớp: không dấu, chỉ chữ+số, một khoảng trắng giữa từ. */
function normalize(s: string): string {
  return stripDiacritics(s)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Khớp CỤM TỪ theo ranh giới từ ("lai" không được ăn vào "chay lai"… đã tách
 *  token nên chỉ cần bọc khoảng trắng hai đầu). */
function hasPhrase(norm: string, phrase: string): boolean {
  return ` ${norm} `.includes(` ${phrase} `);
}

const DAY_MS = 86_400_000;

interface Period {
  label: string;
  range: DateRangeFilter;
  /** Người dùng có NÊU RÕ mốc thời gian không — không nêu thì mỗi intent tự
   *  chọn mặc định hợp lý (lãi → hôm nay, đơn lỗ → tháng này…). */
  explicit: boolean;
}

function dayRange(start: Date, days = 1): DateRangeFilter {
  return { gte: start, lte: new Date(start.getTime() + days * DAY_MS - 1) };
}

/** Đầu tháng hiện tại theo GIỜ VN (không dùng giờ máy chủ — Render chạy UTC). */
function businessMonthStart(offsetMonths = 0): Date {
  const t = new Date(Date.now() + BUSINESS_TZ_OFFSET_MS);
  return new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offsetMonths, 1) -
      BUSINESS_TZ_OFFSET_MS
  );
}

function detectPeriod(norm: string): Period {
  const todayStart = businessDayStart(new Date());
  if (hasPhrase(norm, "hom qua")) {
    return {
      label: "Hôm qua",
      range: dayRange(new Date(todayStart.getTime() - DAY_MS)),
      explicit: true,
    };
  }
  if (hasPhrase(norm, "tuan nay") || hasPhrase(norm, "7 ngay") || hasPhrase(norm, "tuan qua")) {
    return {
      label: "7 ngày gần nhất",
      range: { gte: new Date(todayStart.getTime() - 6 * DAY_MS), lte: new Date(todayStart.getTime() + DAY_MS - 1) },
      explicit: true,
    };
  }
  if (hasPhrase(norm, "thang truoc")) {
    return {
      label: "Tháng trước",
      range: { gte: businessMonthStart(-1), lte: new Date(businessMonthStart(0).getTime() - 1) },
      explicit: true,
    };
  }
  if (hasPhrase(norm, "thang nay") || hasPhrase(norm, "trong thang") || hasPhrase(norm, "thang")) {
    return {
      label: "Tháng này",
      range: { gte: businessMonthStart(0), lte: new Date(todayStart.getTime() + DAY_MS - 1) },
      explicit: true,
    };
  }
  if (hasPhrase(norm, "hom nay") || hasPhrase(norm, "bua nay")) {
    return { label: "Hôm nay", range: dayRange(todayStart), explicit: true };
  }
  return { label: "Hôm nay", range: dayRange(todayStart), explicit: false };
}

/** Kỳ mặc định "tháng này" cho intent mà số theo-ngày quá thưa (đơn lỗ…). */
function widenToMonth(period: Period): Period {
  if (period.explicit) return period;
  const todayStart = businessDayStart(new Date());
  return {
    label: "Tháng này",
    range: { gte: businessMonthStart(0), lte: new Date(todayStart.getTime() + DAY_MS - 1) },
    explicit: false,
  };
}

const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}₫`;

// ─────────────────────────── Nguyên liệu P&L dùng chung ───────────────────────────

/** Đơn "đang tính doanh thu" — cùng hệ quy chiếu trang Tổng quan (analytics.ts):
 *  loại đơn hủy + đơn đang trong vòng hoàn chưa xử lý xong. */
const RETURNING_SET = new Set<ReturnStatus>([
  ReturnStatus.AWAITING,
  ReturnStatus.RECEIVED,
  ReturnStatus.DAMAGED,
]);

type PnlRow = ReturnType<typeof computePnlRow>;

async function loadPnlRows(
  scope: ChannelScope,
  range?: DateRangeFilter
): Promise<PnlRow[]> {
  return (await fetchPnlOrders(scope, range)).map(computePnlRow);
}

function activeRows(rows: PnlRow[]): PnlRow[] {
  return rows.filter(
    (r) =>
      r.shippingStatus !== ShippingStatus.CANCELLED &&
      !RETURNING_SET.has(r.returnStatus as ReturnStatus)
  );
}

// ─────────────────────────── Bộ intent (tầng luật) ───────────────────────────

interface ResolveCtx {
  ownerId: string;
  scope: ChannelScope;
  period: Period;
}

interface IntentDef {
  id: string;
  /** Nhãn hiện trên chip hỏi lại. */
  label: string;
  /** Câu mẫu gợi ý bấm-để-hỏi. */
  sample: string;
  /** Cụm từ khóa ĐÃ chuẩn hoá không dấu + trọng số (cụm dài/đặc thù nặng hơn). */
  phrases: { p: string; w: number }[];
  resolve(ctx: ResolveCtx): Promise<AssistantReply>;
}

const INTENTS: IntentDef[] = [
  {
    id: "profit",
    label: "Lãi/lỗ của shop",
    sample: "Hôm nay lãi bao nhiêu?",
    phrases: [
      { p: "lai", w: 1 },
      { p: "loi nhuan", w: 3 },
      { p: "lai rong", w: 3 },
      { p: "loi", w: 1 },
      { p: "an lai", w: 2 },
      { p: "kiem duoc", w: 2 },
      { p: "lai bao nhieu", w: 3 },
    ],
    async resolve({ ownerId, scope, period }) {
      const rows = activeRows(await loadPnlRows(scope, period.range));
      const revenue = rows.reduce((s, r) => s + r.revenueGross, 0);
      const cost = rows.reduce((s, r) => s + r.costSnapshot, 0);
      const fee = rows.reduce((s, r) => s + (r.revenueGross - r.platformRevenue), 0);
      const opex = Number(
        (
          await prisma.operatingExpense.aggregate({
            where: {
              userId: ownerId,
              direction: TransactionDirection.EXPENSE,
              expenseDate: period.range,
            },
            _sum: { amount: true },
          })
        )._sum.amount ?? 0
      );
      const net = revenue - cost - fee - opex;
      const missing = rows.filter((r) => r.missingCostPrice).length;

      let text =
        rows.length === 0
          ? `${period.label} chưa có đơn phát sinh nào nên chưa có lãi/lỗ để tính.`
          : `${period.label} shop ${net >= 0 ? "lãi ròng" : "lỗ"} ${fmtMoney(Math.abs(net))} trên ${rows.length} đơn phát sinh.`;
      if (missing > 0) {
        text += ` ⚠️ ${missing} đơn chưa có giá vốn nên số lãi chưa trọn vẹn.`;
      }
      return {
        outcome: "answered",
        text,
        rows:
          rows.length === 0
            ? undefined
            : [
                { label: "Doanh thu (GMV phát sinh)", value: fmtMoney(revenue) },
                { label: "Giá vốn", value: fmtMoney(cost) },
                { label: "Sàn khấu trừ (phí + thuế + voucher)", value: fmtMoney(fee) },
                { label: "Chi phí vận hành", value: fmtMoney(opex) },
                {
                  label: "Lợi nhuận ròng",
                  value: fmtMoney(net),
                  tone: net >= 0 ? "pos" : "neg",
                },
              ],
        link: { href: "/", label: "Mở Tổng quan" },
      };
    },
  },
  {
    id: "revenue",
    label: "Doanh thu",
    sample: "Doanh thu tuần này thế nào?",
    phrases: [
      { p: "doanh thu", w: 3 },
      { p: "doanh so", w: 3 },
      { p: "gmv", w: 3 },
      { p: "ban duoc bao nhieu", w: 3 },
      { p: "thu ve", w: 2 },
    ],
    async resolve({ scope, period }) {
      const rows = activeRows(await loadPnlRows(scope, period.range));
      const revenue = rows.reduce((s, r) => s + r.revenueGross, 0);
      const byShop = new Map<string, number>();
      for (const r of rows) {
        const key = `${r.shopName} (${r.channelName})`;
        byShop.set(key, (byShop.get(key) ?? 0) + r.revenueGross);
      }
      const top = [...byShop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      return {
        outcome: "answered",
        text:
          rows.length === 0
            ? `${period.label} chưa có đơn phát sinh nào.`
            : `${period.label} shop đạt doanh thu ${fmtMoney(revenue)} từ ${rows.length} đơn.`,
        rows: top.map(([label, v]) => ({ label, value: fmtMoney(v) })),
        link: { href: "/", label: "Mở Tổng quan" },
      };
    },
  },
  {
    id: "orders_pending",
    label: "Đơn chờ xử lý",
    sample: "Có bao nhiêu đơn chờ xử lý?",
    phrases: [
      { p: "cho xu ly", w: 3 },
      { p: "can xu ly", w: 3 },
      { p: "don moi", w: 2 },
      { p: "cho lay hang", w: 3 },
      { p: "chua giao", w: 2 },
      { p: "ban giao", w: 2 },
      { p: "dong goi", w: 2 },
      { p: "don cho", w: 2 },
    ],
    async resolve({ scope }) {
      const [pending, processed] = await Promise.all([
        prisma.order.count({
          where: { channel: scope, shippingStatus: ShippingStatus.PENDING },
        }),
        prisma.order.count({
          where: { channel: scope, shippingStatus: ShippingStatus.PROCESSED },
        }),
      ]);
      const total = pending + processed;
      return {
        outcome: "answered",
        text:
          total === 0
            ? "Không còn đơn nào chờ xử lý — kho đang sạch việc. 👍"
            : `Đang có ${total} đơn cần ra tay: ${pending} đơn chờ xử lý và ${processed} đơn đã đóng gói chờ bàn giao vận chuyển.`,
        rows:
          total === 0
            ? undefined
            : [
                { label: "Chờ xử lý", value: `${pending} đơn`, tone: pending > 0 ? "neg" : undefined },
                { label: "Đã xử lý, chờ bàn giao", value: `${processed} đơn` },
              ],
        link: { href: "/orders", label: "Mở Đơn hàng" },
      };
    },
  },
  {
    id: "orders_count",
    label: "Số đơn phát sinh",
    sample: "Hôm nay có bao nhiêu đơn?",
    phrases: [
      { p: "bao nhieu don", w: 3 },
      { p: "may don", w: 3 },
      { p: "so don", w: 2 },
      { p: "don hang", w: 1 },
      { p: "co don", w: 2 },
    ],
    async resolve({ scope, period }) {
      const [total, cancelled, grp] = await Promise.all([
        prisma.order.count({
          where: { channel: scope, createdAt: period.range },
        }),
        prisma.order.count({
          where: {
            channel: scope,
            createdAt: period.range,
            shippingStatus: ShippingStatus.CANCELLED,
          },
        }),
        prisma.order.groupBy({
          by: ["channelId"],
          where: { channel: scope, createdAt: period.range },
          _count: { _all: true },
        }),
      ]);
      const chans = await prisma.channel.findMany({
        where: { id: { in: grp.map((g) => g.channelId) } },
        select: { id: true, shopName: true, channelName: true },
      });
      const nameOf = new Map(chans.map((c) => [c.id, `${c.shopName} (${c.channelName})`]));
      return {
        outcome: "answered",
        text:
          total === 0
            ? `${period.label} chưa có đơn nào phát sinh.`
            : `${period.label} phát sinh ${total} đơn${cancelled > 0 ? `, trong đó ${cancelled} đơn hủy` : ""}.`,
        rows: grp
          .sort((a, b) => b._count._all - a._count._all)
          .slice(0, 4)
          .map((g) => ({
            label: nameOf.get(g.channelId) ?? "Gian hàng",
            value: `${g._count._all} đơn`,
          })),
        link: { href: "/orders", label: "Mở Đơn hàng" },
      };
    },
  },
  {
    id: "returns",
    label: "Đơn hoàn",
    sample: "Đơn hoàn đang thế nào?",
    phrases: [
      { p: "don hoan", w: 3 },
      { p: "hang hoan", w: 3 },
      { p: "hoan don", w: 3 },
      { p: "tra hang", w: 3 },
      { p: "hoan ve", w: 2 },
      { p: "hoan", w: 1 },
      { p: "boom hang", w: 3 },
    ],
    async resolve({ scope }) {
      const grp = await prisma.order.groupBy({
        by: ["returnStatus"],
        where: { channel: scope, returnStatus: { not: ReturnStatus.NONE } },
        _count: { _all: true },
      });
      const countOf = (s: ReturnStatus) =>
        grp.find((g) => g.returnStatus === s)?._count._all ?? 0;
      const awaiting = countOf(ReturnStatus.AWAITING);
      const received = countOf(ReturnStatus.RECEIVED);
      const damaged = countOf(ReturnStatus.DAMAGED);
      const open = awaiting + received + damaged;
      let text =
        open === 0
          ? "Không có đơn hoàn nào đang chờ xử lý. 👍"
          : `Đang có ${open} đơn hoàn cần theo dõi: ${awaiting} chờ hàng về, ${received} kiện đã nhận chưa nhập kho, ${damaged} hỏng/mất chờ khiếu nại.`;
      if (received > 0) {
        text += ` Bấm "Nhập kho tất cả" ở trang Đối soát đơn hoàn để cộng lại tồn một chạm.`;
      }
      return {
        outcome: "answered",
        text,
        rows:
          open === 0
            ? undefined
            : [
                { label: "Chờ hàng về kho", value: `${awaiting} đơn` },
                { label: "Đã nhận, chưa nhập kho", value: `${received} đơn`, tone: received > 0 ? "neg" : undefined },
                { label: "Hỏng/mất chờ khiếu nại", value: `${damaged} đơn`, tone: damaged > 0 ? "neg" : undefined },
              ],
        link: { href: "/warehouse/returns", label: "Mở Đối soát đơn hoàn" },
      };
    },
  },
  {
    id: "stock_low",
    label: "Tồn kho sắp hết",
    sample: "SKU nào sắp hết hàng?",
    phrases: [
      { p: "sap het", w: 3 },
      { p: "het hang", w: 3 },
      { p: "chay hang", w: 3 },
      { p: "chay kho", w: 3 },
      { p: "ton kho", w: 2 },
      { p: "ton thap", w: 3 },
      { p: "nhap them", w: 2 },
    ],
    async resolve({ ownerId, scope }) {
      const [setting, products, sold] = await Promise.all([
        prisma.shopSyncSetting.findUnique({ where: { userId: ownerId } }),
        prisma.product.findMany({
          where: { userId: ownerId },
          select: {
            skuCode: true,
            productName: true,
            quantityInStock: true,
            holdQuantity: true,
            safetyStock: true,
            id: true,
          },
        }),
        // Chỉ báo SKU CÓ BÁN trong 30 ngày — SKU ngừng kinh doanh tồn 0 không
        // phải sự cố (cùng triết lý detector cháy hàng của ops-alerts).
        prisma.orderItem.findMany({
          where: {
            productId: { not: null },
            order: {
              channel: scope,
              createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
            },
          },
          select: { productId: true },
          distinct: ["productId"],
        }),
      ]);
      const safetyDefault = setting?.safetyStockDefault ?? 0;
      const soldSet = new Set(sold.map((s) => s.productId));
      const low = products
        .filter((p) => soldSet.size === 0 || soldSet.has(p.id))
        .map((p) => ({
          ...p,
          available: p.quantityInStock - p.holdQuantity,
          safety: p.safetyStock ?? safetyDefault,
        }))
        .filter((p) => p.available <= p.safety)
        .sort((a, b) => a.available - b.available);
      const out = low.filter((p) => p.available <= 0).length;
      return {
        outcome: "answered",
        text:
          low.length === 0
            ? "Chưa có SKU đang bán nào chạm ngưỡng tồn an toàn. 👍"
            : `Có ${low.length} SKU đang bán chạm ngưỡng tồn an toàn${out > 0 ? `, trong đó ${out} SKU đã hết sạch hàng khả dụng` : ""}. Cân nhắc nhập thêm sớm.`,
        rows: low.slice(0, 5).map((p) => ({
          label: `${p.skuCode} — ${p.productName}`.slice(0, 60),
          value: `còn ${p.available} (an toàn ${p.safety})`,
          tone: p.available <= 0 ? "neg" : undefined,
        })),
        link: { href: "/products", label: "Mở Hàng hóa" },
      };
    },
  },
  {
    id: "ads",
    label: "Quảng cáo",
    sample: "Quảng cáo có campaign nào đốt tiền không?",
    phrases: [
      { p: "quang cao", w: 3 },
      { p: "ads", w: 3 },
      { p: "campaign", w: 3 },
      { p: "chien dich", w: 3 },
      { p: "dot tien", w: 3 },
      { p: "roas", w: 3 },
      { p: "chay ads", w: 3 },
    ],
    async resolve({ ownerId, scope }) {
      // Chỉ tính gian THỰC SỰ có chiến dịch (giới hạn 2 gian nặng nhất — mỗi
      // gian là một lượt tính P&L 30 ngày, đừng để câu chat thành báo cáo nặng).
      const grp = await prisma.adsCampaign.groupBy({
        by: ["channelId"],
        where: { channel: scope },
        _count: { _all: true },
      });
      const chans = await prisma.channel.findMany({
        where: { id: { in: grp.map((g) => g.channelId) } },
        select: { id: true, shopName: true, channelName: true },
      });
      if (chans.length === 0) {
        return {
          outcome: "answered",
          text: "Chưa có dữ liệu chiến dịch quảng cáo nào được đồng bộ về Hubsell.",
          link: { href: "/ads/shopee", label: "Mở Trợ lý quảng cáo" },
        };
      }
      const rows: AssistantRow[] = [];
      let needAction = 0;
      let spendToday = 0;
      let topChannel: { name: ChannelName; spend: number } | null = null;
      for (const c of chans.slice(0, 2)) {
        const insights = await computeChannelAdsInsights({
          id: c.id,
          userId: ownerId,
          channelName: c.channelName,
        });
        let chSpend = 0;
        let chAlerts = 0;
        for (const it of insights.items) {
          chSpend += it.windows.today.spend;
          const v = it.assessment.verdict;
          if (
            (v === "pause_now" || v === "review" || v === "grace" || v === "spike") &&
            !assistantDecisionActive(it)
          ) {
            chAlerts++;
          }
        }
        spendToday += chSpend;
        needAction += chAlerts;
        if (!topChannel || chSpend > topChannel.spend) {
          topChannel = { name: c.channelName, spend: chSpend };
        }
        rows.push({
          label: `${c.shopName} (${c.channelName})`,
          value: `hôm nay ${fmtMoney(chSpend)}${chAlerts > 0 ? ` — ${chAlerts} camp cần xử lý` : ""}`,
          tone: chAlerts > 0 ? "neg" : undefined,
        });
      }
      const adsHref =
        topChannel?.name === ChannelName.LAZADA ? "/ads/lazada" : "/ads/shopee";
      return {
        outcome: "answered",
        text:
          needAction > 0
            ? `Hôm nay đã chi ${fmtMoney(spendToday)} cho quảng cáo và có ${needAction} chiến dịch Trợ lý đánh giá cần xử lý (ROAS dưới hòa vốn / đột biến chi tiêu).`
            : `Hôm nay đã chi ${fmtMoney(spendToday)} cho quảng cáo, chưa có chiến dịch nào bị Trợ lý gắn cờ. 👍`,
        rows,
        link: { href: adsHref, label: "Mở Trợ lý quảng cáo" },
      };
    },
  },
  {
    id: "cash",
    label: "Dòng tiền / đối soát",
    sample: "Tiền của shop đang nằm ở đâu?",
    phrases: [
      { p: "dong tien", w: 3 },
      { p: "tien dang o dau", w: 3 },
      { p: "tien ve", w: 2 },
      { p: "vi san", w: 3 },
      { p: "so du", w: 3 },
      { p: "doi soat", w: 3 },
      { p: "chua doi soat", w: 3 },
      { p: "quyet toan", w: 3 },
      { p: "rut tien", w: 2 },
      { p: "tien", w: 1 },
    ],
    async resolve({ scope }) {
      const rows = activeRows(await loadPnlRows(scope));
      let inTransit = 0;
      let inTransitCount = 0;
      let pendingSettle = 0;
      let pendingCount = 0;
      for (const r of rows) {
        if (r.isSettled) continue; // tiền đã nằm trong ví sàn — cộng nữa là đếm đôi
        if (r.shippingStatus === ShippingStatus.SHIPPING) {
          inTransit += r.platformRevenue;
          inTransitCount++;
        } else if (r.shippingStatus === ShippingStatus.DELIVERED) {
          pendingSettle += r.platformRevenue;
          pendingCount++;
        }
      }
      const chans = await prisma.channel.findMany({
        where: scope,
        select: { walletBalance: true },
      });
      let wallet = 0;
      let hasWallet = false;
      for (const c of chans) {
        if (c.walletBalance != null) {
          wallet += Number(c.walletBalance);
          hasWallet = true;
        }
      }
      const total = inTransit + pendingSettle + wallet;
      return {
        outcome: "answered",
        text: `Tổng cộng khoảng ${fmtMoney(total)} đang trên đường về tay shop (chưa tính đơn chờ xử lý vì tỷ lệ hủy cao).`,
        rows: [
          { label: `Đơn đang giao (${inTransitCount} đơn)`, value: fmtMoney(inTransit) },
          { label: `Đã giao, chờ sàn đối soát (${pendingCount} đơn)`, value: fmtMoney(pendingSettle) },
          {
            label: "Số dư ví sàn đã đồng bộ",
            value: hasWallet ? fmtMoney(wallet) : "— (chưa đồng bộ)",
          },
          { label: "Tổng tiền dự kiến về", value: fmtMoney(total), tone: "pos" },
        ],
        link: { href: "/finance/analytics", label: "Mở Báo cáo dòng tiền" },
      };
    },
  },
  {
    id: "loss_orders",
    label: "Đơn đang lỗ",
    sample: "Tháng này có đơn nào lỗ không?",
    phrases: [
      { p: "don lo", w: 3 },
      { p: "dang lo", w: 3 },
      { p: "ban lo", w: 3 },
      { p: "bi lo", w: 3 },
      { p: "lo bao nhieu", w: 3 },
      { p: "sku lo", w: 3 },
    ],
    async resolve({ scope, period }) {
      const p = widenToMonth(period);
      const rows = activeRows(await loadPnlRows(scope, p.range));
      const losses = rows
        .filter((r) => !r.missingCostPrice && r.profitAfterTax < 0)
        .sort((a, b) => a.profitAfterTax - b.profitAfterTax);
      const totalLoss = losses.reduce((s, r) => s + r.profitAfterTax, 0);
      return {
        outcome: "answered",
        text:
          losses.length === 0
            ? `${p.label} không có đơn nào bán lỗ (trong số đơn đã đủ giá vốn). 👍`
            : `${p.label} có ${losses.length} đơn bán lỗ, tổng lỗ ${fmtMoney(Math.abs(totalLoss))}. Nặng nhất:`,
        rows: losses.slice(0, 3).map((r) => ({
          label: `${r.orderCode} — ${r.shopName}`,
          value: fmtMoney(r.profitAfterTax),
          tone: "neg" as const,
        })),
        link: { href: "/operations-assistant/loss-orders", label: "Mở Cảnh báo & P&L Sản phẩm" },
      };
    },
  },
  {
    id: "best_seller",
    label: "Sản phẩm bán chạy",
    sample: "Sản phẩm nào đang bán chạy nhất?",
    phrases: [
      { p: "ban chay", w: 3 },
      { p: "top san pham", w: 3 },
      { p: "ban tot", w: 3 },
      { p: "chay nhat", w: 2 },
      { p: "hot nhat", w: 3 },
    ],
    async resolve({ scope, period }) {
      // Không nêu mốc thời gian → mặc định 7 ngày (1 ngày quá thưa để xếp hạng).
      const p = period.explicit
        ? period
        : {
            label: "7 ngày gần nhất",
            range: {
              gte: new Date(businessDayStart(new Date()).getTime() - 6 * DAY_MS),
              lte: new Date(businessDayStart(new Date()).getTime() + DAY_MS - 1),
            },
            explicit: false,
          };
      const grp = await prisma.orderItem.groupBy({
        by: ["channelSku", "productName"],
        where: {
          order: {
            channel: scope,
            createdAt: p.range,
            shippingStatus: { not: ShippingStatus.CANCELLED },
          },
        },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      });
      return {
        outcome: "answered",
        text:
          grp.length === 0
            ? `${p.label} chưa có sản phẩm nào bán ra.`
            : `Top sản phẩm bán chạy ${p.label.toLowerCase()}:`,
        rows: grp.map((g) => ({
          label: `${g.channelSku} — ${g.productName}`.slice(0, 60),
          value: `${g._sum.quantity ?? 0} sp`,
        })),
        link: { href: "/products", label: "Mở Hàng hóa" },
      };
    },
  },
  {
    id: "help",
    label: "Trợ lý làm được gì",
    sample: "Trợ lý làm được những gì?",
    phrases: [
      { p: "lam duoc gi", w: 3 },
      { p: "giup gi", w: 3 },
      { p: "huong dan", w: 2 },
      { p: "xin chao", w: 2 },
      { p: "hello", w: 2 },
      { p: "chao", w: 1 },
      { p: "help", w: 2 },
    ],
    async resolve() {
      return {
        outcome: "answered",
        text:
          "Em là Trợ lý Hubsell — hỏi em số liệu vận hành của shop bằng tiếng Việt tự nhiên (gõ không dấu cũng hiểu), em trả số thật kèm đường dẫn tới đúng trang. Thử mấy câu này nhé:",
        suggestions: SUGGESTIONS,
      };
    },
  },
];

const INTENT_BY_ID = new Map(INTENTS.map((d) => [d.id, d]));

/** Câu mẫu chào màn hình + gợi ý khi miss — lấy từ chính bộ intent. */
const SUGGESTIONS = [
  "Hôm nay lãi bao nhiêu?",
  "Có bao nhiêu đơn chờ xử lý?",
  "SKU nào sắp hết hàng?",
  "Đơn hoàn đang thế nào?",
  "Quảng cáo có campaign nào đốt tiền không?",
  "Tiền của shop đang nằm ở đâu?",
];

// ─────────────────────────── Heuristic câu phân tích ───────────────────────────

/** "tại sao/so sánh/phân tích…" là việc của tầng LLM (gói cao, đang gác chờ
 *  thương mại hóa) — đi thẳng nhánh này, khỏi thử luật (thiết kế 16/08). */
const ANALYSIS_PHRASES = [
  "tai sao",
  "vi sao",
  "phan tich",
  "so sanh",
  "du doan",
  "du bao",
  "co nen",
  "nen khong",
  "danh gia giup",
  "giai thich",
  "xu huong",
];

function isAnalysisQuestion(norm: string): boolean {
  return ANALYSIS_PHRASES.some((p) => hasPhrase(norm, p));
}

// ─────────────────────────── Ghi log (không bao giờ làm vỡ trả lời) ───────────────────────────

async function logQuery(
  ownerId: string,
  question: string,
  normalized: string,
  intent: string | null,
  outcome: AssistantReply["outcome"]
): Promise<void> {
  try {
    await prisma.assistantQueryLog.create({
      data: { ownerId, question: question.slice(0, 500), normalized: normalized.slice(0, 500), intent, outcome },
    });
  } catch (err) {
    console.error("[assistant] ghi log lỗi:", (err as Error).message);
  }
}

// ─────────────────────────── Router ───────────────────────────

const router = Router();

/** Câu mẫu cho màn chào của bong bóng chat. */
router.get("/suggestions", (_req, res) => {
  res.json({ suggestions: SUGGESTIONS });
});

router.post("/ask", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const scope = channelScope(req);

    const rawQuestion = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    const directIntent = typeof req.body?.intent === "string" ? req.body.intent : "";

    if (!rawQuestion && !directIntent) {
      res.status(400).json({ error: "Thiếu câu hỏi" });
      return;
    }
    if (rawQuestion.length > 300) {
      res.status(400).json({ error: "Câu hỏi dài quá 300 ký tự" });
      return;
    }

    const norm = normalize(rawQuestion);
    const period = detectPeriod(norm);
    const ctx: ResolveCtx = { ownerId, scope, period };

    // Bấm CHIP hỏi lại → đi thẳng intent, khỏi chấm điểm lại.
    if (directIntent) {
      const def = INTENT_BY_ID.get(directIntent);
      if (def) {
        const reply = await def.resolve(ctx);
        await logQuery(ownerId, rawQuestion || def.label, norm || normalize(def.label), def.id, reply.outcome);
        res.json(reply);
        return;
      }
    }

    // Tầng heuristic: câu phân tích là đất của LLM — nhắc khéo lên gói
    // Trợ lý chuyên sâu (lời thoại anh Trung chốt 16/08), kiêm luôn upsell.
    if (isAnalysisQuestion(norm)) {
      const reply: AssistantReply = {
        outcome: "analysis",
        text:
          "🔒 Câu hỏi phân tích chuyên sâu như thế này nằm trong gói Trợ lý chuyên sâu — anh/chị vui lòng nâng cấp gói để mở khóa nhé. Còn các con số cụ thể thì em trả lời được ngay:",
        suggestions: SUGGESTIONS.slice(0, 3),
      };
      await logQuery(ownerId, rawQuestion, norm, null, "analysis");
      res.json(reply);
      return;
    }

    // TẦNG LUẬT: chấm điểm khớp từ khóa cho từng intent.
    const scored = INTENTS.map((def) => ({
      def,
      score: def.phrases.reduce((s, { p, w }) => (hasPhrase(norm, p) ? s + w : s), 0),
    }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    // Không khớp gì → lưới hứng gói thường: nhận là chưa hiểu + gợi ý gần nhất.
    if (scored.length === 0) {
      const reply: AssistantReply = {
        outcome: "miss",
        text:
          "Em chưa hiểu câu này — em đã ghi lại để đội Hubsell dạy thêm. Trong lúc đó anh/chị thử hỏi:",
        suggestions: SUGGESTIONS.slice(0, 3),
      };
      await logQuery(ownerId, rawQuestion, norm, null, "miss");
      res.json(reply);
      return;
    }

    // Hai intent SÁT ĐIỂM nhau → hỏi lại bằng chip, không đoán bừa.
    const tied = scored.filter((x) => x.score === scored[0].score);
    if (tied.length > 1) {
      const reply: AssistantReply = {
        outcome: "clarify",
        text: "Ý anh/chị là hỏi về điều nào dưới đây?",
        chips: tied.slice(0, 3).map((x) => ({ intent: x.def.id, label: x.def.label })),
      };
      await logQuery(ownerId, rawQuestion, norm, null, "clarify");
      res.json(reply);
      return;
    }

    const best = scored[0].def;
    const reply = await best.resolve(ctx);
    await logQuery(ownerId, rawQuestion, norm, best.id, reply.outcome);
    res.json(reply);
  } catch (err) {
    next(err);
  }
});

export default router;
