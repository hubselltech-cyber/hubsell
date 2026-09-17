// ============================================================
// TIKTOK ADS — ĐỌC BÁO CÁO GMV MAX THÀNH DÒNG SẠCH (thuần, không đụng DB)
//
// Bài học probe 17/09/2026:
//   · Tiền là chuỗi VND nguyên ("2396438"), ngày dạng "2026-09-14 00:00:00".
//   · Metric THUỘC TÍNH (tên campaign, tên SP...) chỉ xin được khi dimensions có
//     MỘT chiều ID (campaign_id + stat_time_day thì được; campaign_id +
//     item_group_id thì lỗi 40002). Tầng video buộc 3 chiều ID → không có tên.
//   · Chiều stat_time_day: tối đa 30 ngày mỗi lượt gọi.
//   · Số tiêu của video trễ tới 11 giờ; ROI gộp cả đơn tự nhiên.
// ============================================================

import { getGmvMaxReport, type GmvMaxReportRow } from "./client";

const PAGE_SIZE = 1000;
/** Chặn vòng phân trang vô hạn nếu sàn trả total_page bất thường. */
const MAX_PAGES = 20;

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Scope {
  accessToken: string;
  advertiserId: string;
  storeId: string;
  /** YYYY-MM-DD, tối đa 30 ngày. */
  startDate: string;
  endDate: string;
}

async function fetchAllPages(
  s: Scope,
  q: { dimensions: string[]; metrics: string[]; filtering?: Record<string, unknown> }
): Promise<GmvMaxReportRow[]> {
  const rows: GmvMaxReportRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await getGmvMaxReport(s.accessToken, {
      advertiserId: s.advertiserId,
      storeId: s.storeId,
      startDate: s.startDate,
      endDate: s.endDate,
      ...q,
      page,
      pageSize: PAGE_SIZE,
    });
    rows.push(...r.list);
    if (!r.page_info || page >= r.page_info.total_page) break;
  }
  return rows;
}

export interface GmvMaxStoreDay {
  /** YYYY-MM-DD */
  date: string;
  cost: number;
  orders: number;
  gmv: number;
}

/** Tổng chi GMV Max (Product + LIVE) của shop theo ngày — nguồn cho AdSpend. */
export async function fetchGmvMaxStoreDaily(s: Scope): Promise<GmvMaxStoreDay[]> {
  const rows = await fetchAllPages(s, {
    dimensions: ["advertiser_id", "stat_time_day"],
    metrics: ["cost", "orders", "gross_revenue"],
  });
  return rows.map((r) => ({
    date: (r.dimensions.stat_time_day ?? "").slice(0, 10),
    cost: num(r.metrics.cost),
    orders: num(r.metrics.orders),
    gmv: num(r.metrics.gross_revenue),
  }));
}

export interface GmvMaxCampaignDay {
  campaignId: string;
  name: string;
  /** ENABLE | DISABLE */
  operationStatus: string;
  /** CUSTOM = ROI mục tiêu; NO_BID = phân phối tối đa */
  bidType: string;
  roasBid: number | null;
  budget: number;
  date: string;
  cost: number;
  orders: number;
  gmv: number;
}

/** Campaign Product GMV Max × ngày (gồm campaign tạo từ Seller Center lẫn Ads Manager). */
export async function fetchGmvMaxCampaignDaily(s: Scope): Promise<GmvMaxCampaignDay[]> {
  const rows = await fetchAllPages(s, {
    dimensions: ["campaign_id", "stat_time_day"],
    metrics: [
      "campaign_id", "campaign_name", "operation_status", "bid_type", "roas_bid",
      "target_roi_budget", "max_delivery_budget", "cost", "orders", "gross_revenue",
    ],
    filtering: { gmv_max_promotion_types: ["PRODUCT"] },
  });
  return rows.map((r) => {
    const m = r.metrics;
    const bidType = m.bid_type ?? "";
    return {
      campaignId: r.dimensions.campaign_id ?? m.campaign_id ?? "",
      name: m.campaign_name ?? "",
      operationStatus: m.operation_status ?? "",
      bidType,
      roasBid: bidType === "NO_BID" ? null : num(m.roas_bid) || null,
      budget: num(bidType === "NO_BID" ? m.max_delivery_budget : m.target_roi_budget),
      date: (r.dimensions.stat_time_day ?? "").slice(0, 10),
      cost: num(m.cost),
      orders: num(m.orders),
      gmv: num(m.gross_revenue),
    };
  });
}

export interface GmvMaxProductRow {
  spuId: string;
  name: string;
  cost: number;
  orders: number;
  gmv: number;
}

/** Sản phẩm (SPU) trong MỘT campaign, cộng dồn cả khoảng ngày. */
export async function fetchGmvMaxCampaignProducts(s: Scope, campaignId: string): Promise<GmvMaxProductRow[]> {
  const rows = await fetchAllPages(s, {
    dimensions: ["item_group_id"],
    metrics: ["product_name", "item_group_id", "cost", "orders", "gross_revenue"],
    filtering: { campaign_ids: [campaignId] },
  });
  return rows.map((r) => ({
    spuId: r.dimensions.item_group_id ?? "",
    name: r.metrics.product_name ?? "",
    cost: num(r.metrics.cost),
    orders: num(r.metrics.orders),
    gmv: num(r.metrics.gross_revenue),
  }));
}

export interface GmvMaxVideoRow {
  spuId: string;
  /** item_id = ID bài đăng TikTok; "-1" = thẻ sản phẩm (không phải video). */
  videoId: string;
  deliveryStatus: string;
  cost: number;
  orders: number;
  gmv: number;
  impressions: number;
  clicks: number;
  /** Tỷ lệ bấm quảng cáo (%) — ad_click_rate của sàn. */
  ctr: number;
  /** Tỷ lệ chuyển đổi sau bấm (%) — ad_conversion_rate của sàn. */
  cvr: number;
}

/** Trạng thái video còn được sàn phân phối / đang học — chỉ nhóm này mới đáng soi. */
export const GMV_MAX_LIVE_VIDEO_STATUSES = ["DELIVERING", "LEARNING", "IN_QUEUE"];

/**
 * Video của các SPU trong MỘT campaign, cộng dồn khoảng ngày. Một campaign thật
 * có gần 1.800 video mà chỉ vài chục cái tiêu tiền → mặc định lọc nhóm đang
 * phân phối cho nhẹ; truyền statuses=null để lấy hết.
 */
export async function fetchGmvMaxCampaignVideos(
  s: Scope,
  campaignId: string,
  spuIds: string[],
  statuses: string[] | null = GMV_MAX_LIVE_VIDEO_STATUSES
): Promise<GmvMaxVideoRow[]> {
  const out: GmvMaxVideoRow[] = [];
  // Docs: item_group_ids tối đa 100 mỗi lượt.
  for (let i = 0; i < spuIds.length; i += 100) {
    const rows = await fetchAllPages(s, {
      dimensions: ["campaign_id", "item_group_id", "item_id"],
      metrics: [
        "creative_delivery_status", "cost", "orders", "gross_revenue",
        "product_impressions", "product_clicks", "ad_click_rate", "ad_conversion_rate",
      ],
      filtering: {
        campaign_ids: [campaignId],
        item_group_ids: spuIds.slice(i, i + 100),
        ...(statuses ? { creative_delivery_statuses: statuses } : {}),
      },
    });
    for (const r of rows) {
      out.push({
        spuId: r.dimensions.item_group_id ?? "",
        videoId: r.dimensions.item_id ?? "",
        deliveryStatus: r.metrics.creative_delivery_status ?? "",
        cost: num(r.metrics.cost),
        orders: num(r.metrics.orders),
        gmv: num(r.metrics.gross_revenue),
        impressions: num(r.metrics.product_impressions),
        clicks: num(r.metrics.product_clicks),
        // Probe 17/09: sàn trả SẴN phần trăm dạng số trần ("1.92" = 1,92% — khớp 279 bấm / 14.518 lượt xem).
        ctr: num(r.metrics.ad_click_rate),
        cvr: num(r.metrics.ad_conversion_rate),
      });
    }
  }
  return out;
}
