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
  /** Cập nhật mã vận đơn/kiện adapter khám phá được trong lúc lấy phiếu. */
  discovered: Map<string, { trackingCode?: string | null; packageId?: string | null }>;
  failed: { orderId: string; orderCode: string; reason: string }[];
}

export interface FulfillmentAdapter {
  channelName: ChannelName;
  /** false = mới giữ chỗ, route báo "sắp hỗ trợ" thay vì gọi. */
  supported: boolean;
  /** Hỏi sàn phương án vận chuyển — dùng một đơn mẫu của gian. */
  getShippingOptions(channel: Channel, sample: FulfillOrderRef): Promise<AdapterShippingOptions>;
  /** Sắp xếp vận chuyển THẬT cho một đơn. Không ném — trả ok=false kèm lý do. */
  arrangeShipment(channel: Channel, order: FulfillOrderRef, choice: FulfillChoice): Promise<ArrangeResult>;
  /** Tải vận đơn PDF chính chủ cho nhiều đơn của cùng gian. */
  fetchLabels(channel: Channel, orders: FulfillOrderRef[]): Promise<LabelFetchResult>;
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
