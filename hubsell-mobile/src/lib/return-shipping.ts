import type {
  ReturnCarrierStatus,
  ReturnOrderDto,
  ReturnShippingFilter,
} from "../types/api";
import { formatDateTime } from "./format";

// ============================================================
// TRẠNG THÁI VẬN CHUYỂN CHIỀU HOÀN trên dòng đơn hoàn của app (26/11/2026, anh Trung:
// "Hiện tại trạng thái chỉ có 'Chờ hàng về' chứ chưa có 'Ship báo đã hoàn' — cần cập
// nhật vào trạng thái và cả bộ lọc").
//
// Cùng MỘT luật với cột "Trạng thái vận chuyển" của web Đối soát đơn hoàn
// (frontend/src/components/warehouse/return-shipping-cell.tsx) — hai nguồn:
//   1. `returnShipping` backend tính sẵn từ số của sàn (đơn khách trả hàng) — 0 lệnh gọi;
//   2. kiện GIAO THẤT BẠI quay đầu: API hoàn của sàn không nói gì về chặng về → hỏi hành
//      trình hãng cho các dòng đang hiện (useReturnCarrierStatus), 1 lệnh gọi sàn / đơn,
//      backend đệm 10 phút. Hãng báo đã trả thì backend LƯU mốc: từ lượt tải sau
//      `returnShipping` đã là RETURNED nguồn "carrier" — không hỏi nữa, bộ lọc thấy đơn.
// Hàm THUẦN, không đụng React Native — test: return-shipping.test.ts.
// ============================================================

/** Nhãn nhóm lọc — "Ship báo đã hoàn" là chữ anh Trung chọn cho app (web: "Hoàn thành công"). */
export const RETURN_SHIP_FILTERS: { key: ReturnShippingFilter; label: string }[] = [
  { key: "RETURNED", label: "Ship báo đã hoàn" },
  { key: "RETURNING", label: "Đang hoàn về" },
  { key: "WAITING_BUYER", label: "Chờ khách gửi hàng" },
  { key: "FAILED_DELIVERY", label: "Giao thất bại" },
  { key: "NO_SIGNAL", label: "Chưa có tin từ hãng" },
];

export const RETURN_SHIP_LABEL = Object.fromEntries(
  RETURN_SHIP_FILTERS.map((f) => [f.key, f.label])
) as Record<ReturnShippingFilter, string>;

type Row = Pick<ReturnOrderDto, "returnStatus" | "returnShipping" | "trackingCode"> & {
  channel: { channelName: string };
};

/** Đơn cần hỏi hành trình hãng: giao thất bại quay đầu, kho chưa nhận, sàn có API hành trình. */
export function needsCarrierLookup(o: Row): boolean {
  const s = o.returnShipping;
  return (
    !!s &&
    o.returnStatus === "AWAITING" &&
    s.state === "NO_SIGNAL" &&
    s.failedDelivery &&
    Boolean(o.trackingCode) &&
    (o.channel.channelName === "SHOPEE" || o.channel.channelName === "TIKTOK")
  );
}

export type ReturnShipTone = "red" | "blue" | "amber" | "muted";

export interface ReturnShipView {
  /** Sàn / hãng báo kiện ĐÃ VỀ shop mà kho chưa quét nhận → nhãn "Ship báo đã hoàn". */
  shipReturned: boolean;
  /** Đang chờ câu trả lời của hãng cho dòng này. */
  asking: boolean;
  /** Dòng phụ dưới mã vận đơn; null = không có gì để nói. */
  line: string | null;
  tone: ReturnShipTone;
}

/**
 * Cách một dòng đơn CHỜ HÀNG VỀ nói về chặng hoàn. Trả null khi đơn không còn chờ (kho đã
 * cầm kiện — nhãn tình trạng kho đã nói đủ) hoặc backend bản cũ không gửi `returnShipping`.
 */
export function returnShipView(
  o: Row,
  /** Kết quả hỏi hãng của đơn này; undefined = chưa có câu trả lời / không thuộc diện hỏi. */
  carrier?: ReturnCarrierStatus
): ReturnShipView | null {
  const s = o.returnShipping;
  if (!s || o.returnStatus !== "AWAITING") return null;

  const live = carrier?.status === "ok" ? carrier : null;
  const state = live ? live.state : s.state;

  if (state === "RETURNED") {
    const who = live || s.source === "carrier" ? "Hãng" : "Sàn";
    const at = live ? live.at : s.at;
    const when = at ? formatDateTime(at) : "";
    return {
      shipReturned: true,
      asking: false,
      line: `${who} báo ${when || "kiện đã về shop"} · kho chưa quét nhận`,
      tone: "red",
    };
  }

  if (needsCarrierLookup(o) && !carrier) {
    return { shipReturned: false, asking: true, line: "Đang hỏi hãng vận chuyển…", tone: "muted" };
  }

  if (live) {
    // Hãng đã trả lời nhưng kiện chưa về: đọc nguyên văn mốc mới nhất.
    const head = live.state === "RETURNING" ? "Đang hoàn về" : "Giao thất bại";
    return {
      shipReturned: false,
      asking: false,
      line: live.latest?.description ? `${head} · ${live.latest.description}` : head,
      tone: live.state === "RETURNING" ? "blue" : "muted",
    };
  }

  if (state === "RETURNING") {
    return { shipReturned: false, asking: false, line: "Đang hoàn về · sàn chưa báo kiện về tới", tone: "blue" };
  }
  if (state === "WAITING_BUYER") {
    return { shipReturned: false, asking: false, line: "Chờ khách gửi hàng", tone: "amber" };
  }
  return {
    shipReturned: false,
    asking: false,
    line: s.failedDelivery ? "Giao thất bại, kiện quay đầu" : "Chưa có tin từ hãng",
    tone: "muted",
  };
}
