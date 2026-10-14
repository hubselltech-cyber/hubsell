// ============================================================
// XỬ LÝ ĐƠN TẬP TRUNG — hợp đồng chung cho mọi sàn (04/09/2026)
//
// Ba việc kho làm trên mọi sàn: (1) hỏi sàn "có thể sắp xếp vận chuyển kiểu
// gì" (pickup/dropoff, địa chỉ, khung giờ), (2) sắp xếp vận chuyển THẬT cho
// từng đơn, (3) tải vận đơn PDF chính chủ của sàn. Mỗi sàn một adapter cùng
// hình dạng, route chỉ nói chuyện với hợp đồng này — thêm sàn mới (TikTok)
// là thêm một file, không đụng route.
//
// Nguyên tắc: Hubsell KHÔNG tự vẽ vận đơn. Mã vạch/QR phân loại kho là của
// sàn; phiếu Hubsell chỉ là PHIẾU NHẶT HÀNG nội bộ in kèm (xem pick-list-pdf).
// ============================================================

import type { Channel, ChannelName } from "@prisma/client";

/** Cách bàn giao kiện cho hãng vận chuyển. */
export type FulfillMethod = "PICKUP" | "DROPOFF";

/** Lựa chọn seller chốt trong hộp thoại "Chuẩn bị hàng" cho MỘT gian. */
export interface FulfillChoice {
  method: FulfillMethod;
  /** Shopee: address_id lấy hàng (pickup). */
  addressId?: string;
  /** Shopee: pickup_time_id khung giờ lấy hàng (pickup). */
  pickupTimeId?: string;
  /** Shopee: branch_id bưu cục gửi (dropoff) — chỉ khi sàn yêu cầu. */
  branchId?: string;
}

/** Phần lưu vào Channel.fulfillmentSettings (khung giờ đổi theo ngày, không lưu). */
export type FulfillDefaults = Pick<FulfillChoice, "method" | "addressId" | "branchId">;

export interface ShippingOptionSlot {
  id: string;
  label: string;
}

export interface ShippingOptionAddress {
  id: string;
  label: string;
  /** Địa chỉ sàn đánh dấu là địa chỉ lấy hàng mặc định. */
  isDefault: boolean;
  timeSlots: ShippingOptionSlot[];
}

/** Những gì adapter trả về cho hộp thoại — chưa gồm phần đóng gói theo gian. */
export interface AdapterShippingOptions {
  /** Phương thức sàn cho phép với gian này (rỗng = sàn tự quyết, không hỏi). */
  methods: FulfillMethod[];
  pickupAddresses: ShippingOptionAddress[];
  dropoffBranches: ShippingOptionSlot[];
  /** Ghi chú hiển thị cho seller (vd Lazada: "sàn tự sắp xếp theo cài đặt Seller Center"). */
  note?: string;
}

export interface ArrangeResult {
  ok: boolean;
  /** Mã vận đơn sàn cấp (có thể chưa có ngay — Shopee cấp sau vài giây). */
  trackingCode?: string | null;
  /** Mã kiện phía sàn (Lazada package_id / TikTok package id). */
  packageId?: string | null;
  /** Tên hãng vận chuyển sàn gán ngay khi sắp xếp (Lazada shipment_provider). */
  carrierName?: string | null;
  /** Lý do lỗi, đã dịch sang tiếng người — hiện thẳng cho seller. */
  error?: string;
  /** Adapter tự đổi phương thức so với lựa chọn (vd sàn chỉ cho pickup). */
  note?: string;
}

/** Dữ liệu tối thiểu của một đơn mà adapter cần. */
export interface FulfillOrderRef {
  id: string;
  orderCode: string;
  trackingCode: string | null;
  platformPackageId: string | null;
}

export interface LabelFetchResult {
  /** PDF vận đơn theo từng đơn (đơn lỗi không có mặt trong map). */
  pdfs: Map<string, Buffer>;
  /**
   * PDF GỘP nhiều đơn của sàn (chỉ khi xin `combined` — in vận đơn không kèm
   * phiếu xuất hàng, 14/10): trang xếp đúng thứ tự `orderIds`. Đơn nằm trong
   * một phần gộp KHÔNG có mặt trong `pdfs`. Route ghép các phần theo thứ tự
   * seller chọn (phần gộp đứng ở vị trí đơn đầu tiên của nó).
   */
  combined?: { orderIds: string[]; pdf: Buffer }[];
  /** Cập nhật mã vận đơn/kiện adapter khám phá được trong lúc lấy phiếu. */
  discovered: Map<string, { trackingCode?: string | null; packageId?: string | null }>;
  failed: { orderId: string; orderCode: string; reason: string }[];
}

export interface LabelFetchOptions {
  /**
   * Cho phép adapter tải MỘT file cho nhiều đơn (Shopee download_shipping_document
   * ≤50 đơn cùng hãng) thay vì từng đơn — nhanh hơn ~10 lần với mẻ 50. Chỉ bật
   * khi không in kèm phiếu xuất hàng (phiếu phải xen kẽ sau từng vận đơn).
   */
  combined?: boolean;
}

/**
 * Kết quả hỏi "sàn đã cấp vận đơn cho đơn này chưa?" (05/09).
 *
 * Sàn KHÔNG cấp mã vận đơn ngay lúc ship_order — Shopee mất vài giây tới vài
 * chục giây mới có tracking_number, còn tải PDF thì phải có mã đó. Trước 05/09
 * Hubsell xin PDF ngay sau khi sàn nhận → đơn nào sàn chưa kịp cấp mã bị rơi
 * khỏi file in (chuẩn bị 4 đơn, in ra 1). Giao diện dùng bước này để ĐỢI cho
 * đủ rồi mới xin PDF một lần.
 */
export interface LabelReadiness {
  /** id đơn đã có đủ dữ liệu để tải vận đơn. */
  ready: string[];
  /** Đơn sàn chưa cấp — hỏi lại sau vài giây. */
  waiting: { orderId: string; orderCode: string; reason?: string }[];
  /** Mã vận đơn/kiện khám phá được trong lúc hỏi → route lưu lại. */
  discovered: Map<string, { trackingCode?: string | null; packageId?: string | null }>;
}

export interface FulfillmentAdapter {
  channelName: ChannelName;
  /** false = mới giữ chỗ, route báo "sắp hỗ trợ" thay vì gọi. */
  supported: boolean;
  /** Hỏi sàn phương án vận chuyển — dùng một đơn mẫu của gian. */
  getShippingOptions(channel: Channel, sample: FulfillOrderRef): Promise<AdapterShippingOptions>;
  /** Sắp xếp vận chuyển THẬT cho một đơn. Không ném — trả ok=false kèm lý do. */
  arrangeShipment(channel: Channel, order: FulfillOrderRef, choice: FulfillChoice): Promise<ArrangeResult>;
  /**
   * Sắp xếp vận chuyển cho NHIỀU đơn cùng gian bằng API mẻ của sàn (14/10/2026:
   * Shopee mass_ship_order 50 kiện/lần, TikTok Batch Ship Packages). Trả kết
   * quả theo id đơn — đơn nào thiếu trong map coi như lỗi "sàn không trả lời".
   * `onProgress(done)` gọi sau mỗi nhóm để lượt chạy nền cập nhật tiến độ.
   * Không cài = route gọi arrangeShipment từng đơn như trước.
   */
  arrangeShipmentBatch?(
    channel: Channel,
    orders: FulfillOrderRef[],
    choice: FulfillChoice,
    onProgress?: (done: number) => void
  ): Promise<Map<string, ArrangeResult>>;
  /**
   * Hỏi sàn đơn nào đã sẵn vận đơn (rẻ, không dựng file). Không cài = coi như
   * sẵn ngay (kênh offline / sàn cấp mã ngay lúc sắp xếp).
   */
  probeLabelReadiness?(channel: Channel, orders: FulfillOrderRef[]): Promise<LabelReadiness>;
  /** Tải vận đơn PDF chính chủ cho nhiều đơn của cùng gian. */
  fetchLabels(channel: Channel, orders: FulfillOrderRef[], opts?: LabelFetchOptions): Promise<LabelFetchResult>;
}

/**
 * Lý do loại đơn KHÁCH CHƯA THANH TOÁN khỏi mẻ Chuẩn bị hàng (09/09/2026).
 * Sàn không cho sắp xếp vận chuyển đơn UNPAID (Seller Center xếp ở "Chờ xác
 * nhận"); Hubsell biết sẵn paymentStatus nên loại trước, không gọi sàn để rồi
 * nhận lỗi tiếng Anh khó hiểu. Anh Trung chốt: không tách tab, chỉ báo thẳng.
 */
export const UNPAID_REASON = "Khách chưa thanh toán — sàn chưa cho chuẩn bị";

/**
 * Dịch lỗi sàn hay gặp khi sắp xếp vận chuyển sang tiếng người. Lỗi lạ giữ
 * nguyên để còn tra được.
 */
export function humanizeArrangeError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("ready to be shipped") || m.includes("package is not ready")) {
    return "Sàn báo đơn chưa sẵn sàng giao — thường do khách chưa thanh toán hoặc đơn đã được sắp xếp vận chuyển trên Seller Center rồi";
  }
  if (m.includes("already") && (m.includes("ship") || m.includes("arrange"))) {
    return "Đơn đã được sắp xếp vận chuyển trên sàn rồi";
  }
  // Thiếu QUYỀN API (scope) xét TRƯỚC "token": TikTok trả "access token doesn't
  // have the required permission" — không phải mất kết nối, là app chưa xin scope.
  if (m.includes("permission") || m.includes("scope") || m.includes("not authorized")) {
    return `Sàn chưa cấp quyền API này cho Hubsell — cần xin thêm scope rồi ủy quyền lại gian (${message})`;
  }
  if (m.includes("invalid_access_token") || m.includes("error_auth") || m.includes("token")) {
    return "Gian mất kết nối với sàn — vào Kênh bán để kết nối lại";
  }
  return message;
}

/** Lỗi sàn kiểu "chưa sẵn" — đợi rồi hỏi lại được, không phải lỗi thật. */
export function isNotReadyError(text: string): boolean {
  return /not.?ready|not.?exist|not.?found|pending|processing|in.?progress|try.?again|later/i.test(text);
}

/** Rút thông báo lỗi tiếng người từ Error/unknown. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "lỗi không rõ");
}

/** Đọc FulfillDefaults từ cột JSON của Channel (phòng thủ với dữ liệu lạ). */
export function readFulfillDefaults(raw: unknown): FulfillDefaults | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.method !== "PICKUP" && o.method !== "DROPOFF") return null;
  return {
    method: o.method,
    addressId: typeof o.addressId === "string" ? o.addressId : undefined,
    branchId: typeof o.branchId === "string" ? o.branchId : undefined,
  };
}

/** Cắt mảng thành từng mẻ `size` phần tử (trần của API sàn). */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Chạy `fn` cho từng phần tử với tối đa `limit` việc song song — dùng cho API
 * chỉ có bản từng kiện (vận đơn TikTok) mà không dồn sàn bằng Promise.all.
 */
export async function mapWithLimit<T, R>(
  list: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
