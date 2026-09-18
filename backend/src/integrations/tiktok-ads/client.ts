// ============================================================
// TIKTOK ADS — CLIENT GỌI TIKTOK MARKETING API v1.3
//
// Quy ước của hệ này (khác TikTok Shop API — không ký chữ ký):
//   · Xác thực bằng header `Access-Token`.
//   · GET: tham số mảng/đối tượng truyền dạng CHUỖI JSON trên query
//     (store_ids=["..."], filtering={...}).
//   · HTTP luôn 200; lỗi nằm ở `code` ≠ 0 trong thân. Đã gặp thật: 40002 = tham số
//     / metric không hợp lệ (vd xin metric thuộc tính khi có ≥2 chiều ID, auth_code
//     sai); theo docs: 40105 = token sai hoặc đã bị thu hồi, 40100 = quá nhịp.
// Hạn mức Basic: 8 QPS / 240 QPM / 80k QPD mỗi app.
// ============================================================

import { acquireApiToken } from "../../services/api-budget";
import { TIKTOK_ADS_API_BASE, getTiktokAdsConfig, type TiktokAdsConfig } from "./config";

interface TiktokAdsEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data?: T;
}

export class TiktokAdsApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly code: number,
    message: string,
    public readonly requestId?: string
  ) {
    super(`TikTok Ads ${path} lỗi ${code}: ${message}${requestId ? ` (request_id ${requestId})` : ""}`);
    this.name = "TiktokAdsApiError";
  }
}

type QueryValue = string | number | string[] | Record<string, unknown> | undefined;

function toQuery(params: Record<string, QueryValue>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return qs.toString();
}

async function unwrap<T>(path: string, res: Response): Promise<T> {
  const text = await res.text();
  let body: TiktokAdsEnvelope<T>;
  try {
    body = JSON.parse(text) as TiktokAdsEnvelope<T>;
  } catch {
    throw new TiktokAdsApiError(path, res.status, `Phản hồi không phải JSON: ${text.slice(0, 200)}`);
  }
  if (body.code !== 0) {
    throw new TiktokAdsApiError(path, body.code, body.message, body.request_id);
  }
  return (body.data ?? {}) as T;
}

// ---------- VAN TỐC ĐỘ THEO APP + LÙI KHI QUÁ TẢI (hạ tầng TikTok Ads, 18/09/2026) ----------
// Hạn mức của app là CHUNG cho mọi seller (mức Basic: 8 call/giây · 240 call/phút · 80.000 call/ngày). Shopee/Lazada đã đi
// qua van `acquireApiToken`; TikTok Ads trước đây gọi thẳng → vài seller lớn chấm cùng lúc là chạm trần 240/phút.
// Mặc định 3 call/giây (= 180/phút, 75% trần phút — chừa chỗ cho tiến trình web khi tách web/worker); chỉnh bằng env
// ADS_TIKTOK_APP_QPS sau khi TikTok nâng mức. Van nằm trong RAM từng tiến trình như các sàn khác (Redis ở mốc M3).
// Mã quá tải theo docs "Return codes": 40016 / 40100 = trần cấp app, 40133 = trần cấp tài khoản quảng cáo.
const TIKTOK_ADS_BUCKET = "tiktok-ads";
const TIKTOK_ADS_QPS = Math.max(1, Number(process.env.ADS_TIKTOK_APP_QPS) || 3);
export const TIKTOK_ADS_RATE_LIMIT_CODES = [40016, 40100, 40133];
const RATE_LIMIT_RETRIES = 2;

export function isTiktokAdsRateLimited(err: unknown): boolean {
  return err instanceof TiktokAdsApiError && (TIKTOK_ADS_RATE_LIMIT_CODES.includes(err.code) || err.code === 429);
}

/** Chờ 2s rồi 6s (thuần — test): đủ để cửa sổ giây / phút của sàn trôi qua mà không treo lượt chấm quá lâu. */
export function rateLimitBackoffMs(attempt: number): number {
  return attempt <= 0 ? 2000 : 6000;
}

async function throttled<T>(path: string, doFetch: () => Promise<Response>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await acquireApiToken(TIKTOK_ADS_BUCKET, TIKTOK_ADS_QPS);
    try {
      return await unwrap<T>(path, await doFetch());
    } catch (err) {
      if (!isTiktokAdsRateLimited(err) || attempt >= RATE_LIMIT_RETRIES) throw err;
      console.warn(`[TikTok Ads] ${path} bị sàn báo quá tải (${(err as TiktokAdsApiError).code}) — chờ ${rateLimitBackoffMs(attempt)}ms rồi gọi lại`);
      await new Promise((r) => setTimeout(r, rateLimitBackoffMs(attempt)));
    }
  }
}

async function adsGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, QueryValue>
): Promise<T> {
  return throttled<T>(path, () =>
    fetch(`${TIKTOK_ADS_API_BASE}${path}?${toQuery(params)}`, {
      method: "GET",
      headers: { "Access-Token": accessToken },
    })
  );
}

// ---------- Ủy quyền ----------

export interface TiktokAdsTokenResult {
  access_token: string;
  /** Các tài khoản quảng cáo token này truy cập được. */
  advertiser_ids: string[];
  /** ID scope nhà quảng cáo THỰC SỰ cấp (có thể ít hơn scope app xin). */
  scope: number[];
}

/** Đổi auth_code (sống 1 giờ, dùng một lần) → access_token dài hạn. */
export async function exchangeTiktokAdsAuthCode(
  authCode: string,
  cfg: TiktokAdsConfig = getTiktokAdsConfig()
): Promise<TiktokAdsTokenResult> {
  const path = "/oauth2/access_token/";
  const res = await fetch(`${TIKTOK_ADS_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: cfg.appId, secret: cfg.secret, auth_code: authCode }),
  });
  return unwrap<TiktokAdsTokenResult>(path, res);
}

export interface TiktokAdsAdvertiser {
  advertiser_id: string;
  advertiser_name: string;
}

/** Danh sách tài khoản quảng cáo (kèm tên) mà token truy cập được. */
export async function getTiktokAdsAdvertisers(
  accessToken: string,
  cfg: TiktokAdsConfig = getTiktokAdsConfig()
): Promise<TiktokAdsAdvertiser[]> {
  const data = await adsGet<{ list?: TiktokAdsAdvertiser[] }>(
    "/oauth2/advertiser/get/",
    accessToken,
    { app_id: cfg.appId, secret: cfg.secret }
  );
  return data.list ?? [];
}

// ---------- GMV Max ----------

/** Một shop trong /gmv_max/store/list/ (khuôn đã xác minh bằng probe 17/09/2026). */
export interface GmvMaxStore {
  /** = shop id của TikTok Shop API (Channel.externalShopId) — đã kiểm khớp trên prod. */
  store_id: string;
  store_name?: string;
  /** Mã shop dạng "VNLCTWWLT3". */
  store_code?: string;
  /** true CHỈ với tài khoản quảng cáo đang giữ quyền độc quyền GMV Max của shop. */
  is_gmv_max_available?: boolean;
  store_authorized_bc_id?: string;
  /** Tài khoản quảng cáo DUY NHẤT được chạy GMV Max cho shop (vắng = shop chưa cấp cho ai). */
  exclusive_authorized_advertiser_info?: { advertiser_id?: string; advertiser_name?: string };
}

/** Các shop TikTok mà một tài khoản quảng cáo nhìn thấy — gồm cả shop nó KHÔNG được chạy GMV Max. */
export async function getGmvMaxStores(accessToken: string, advertiserId: string): Promise<GmvMaxStore[]> {
  const data = await adsGet<{ store_list?: GmvMaxStore[] }>("/gmv_max/store/list/", accessToken, {
    advertiser_id: advertiserId,
  });
  return data.store_list ?? [];
}

export interface GmvMaxReportQuery {
  advertiserId: string;
  /** Docs: tối đa 1 shop mỗi lượt gọi. */
  storeId: string;
  /** YYYY-MM-DD; chiều stat_time_day tối đa 30 ngày, stat_time_hour 1 ngày. */
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  filtering?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
}

export interface GmvMaxReportRow {
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
}

export interface GmvMaxReportPage {
  list: GmvMaxReportRow[];
  page_info?: { page: number; page_size: number; total_number: number; total_page: number };
}

/**
 * Báo cáo GMV Max — gồm cả campaign tạo từ Seller Center lẫn Ads Manager.
 * Hàm mỏng — ba tầng campaign → sản phẩm → video và các bẫy của từng tầng nằm ở report.ts.
 */
export async function getGmvMaxReport(
  accessToken: string,
  q: GmvMaxReportQuery
): Promise<GmvMaxReportPage> {
  const data = await adsGet<Partial<GmvMaxReportPage>>("/gmv_max/report/get/", accessToken, {
    advertiser_id: q.advertiserId,
    store_ids: [q.storeId],
    start_date: q.startDate,
    end_date: q.endDate,
    dimensions: q.dimensions,
    metrics: q.metrics,
    filtering: q.filtering,
    page: q.page ?? 1,
    page_size: q.pageSize ?? 1000,
  });
  return { list: data.list ?? [], page_info: data.page_info };
}

// ---------- GHI: loại / khôi phục video trong campaign GMV Max ----------

export type GmvMaxCreativeAction = "REMOVE" | "ADD";

/** Docs: tối đa 400 video mỗi lượt gọi (tổng 10.000 video loại / campaign). */
export const GMV_MAX_CREATIVE_BATCH = 400;

/**
 * Loại (REMOVE) hoặc đưa lại (ADD) video trong một campaign GMV Max. Điều kiện
 * của sàn: campaign đang BẬT; Product GMV Max phải để chế độ sàn tự chọn video
 * (product_video_specific_type = AUTO_SELECTION — Hubsell không đọc được cờ này
 * vì chưa xin nhóm quyền Campaign, sai thì sàn trả lỗi). Sàn KHÔNG trả kết quả
 * từng video; trạng thái mới (EXCLUDED) chỉ thấy trong report sau ~20 phút.
 */
export async function updateGmvMaxCreatives(
  accessToken: string,
  input: {
    advertiserId: string;
    campaignId: string;
    action: GmvMaxCreativeAction;
    items: { itemId: string; spuIds: string[] }[];
  }
): Promise<void> {
  const path = "/campaign/gmv_max/creative/update/";
  // Lệnh GHI cũng qua van; sàn báo quá tải = lệnh CHƯA được nhận nên gọi lại là an toàn (lỗi khác thì không gọi lại).
  await throttled<Record<string, never>>(path, () =>
    fetch(`${TIKTOK_ADS_API_BASE}${path}`, {
      method: "POST",
      headers: { "Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        advertiser_id: input.advertiserId,
        campaign_id: input.campaignId,
        action: input.action,
        item_list: input.items.map((x) => ({ item_id: x.itemId, spu_id_list: x.spuIds })),
      }),
    })
  );
}
