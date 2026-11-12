/**
 * Mức chi quảng cáo sàn mỗi tháng khách tự chọn lúc đăng ký (12/11/2026).
 *
 * Vì sao: khách trả tiền của Hubsell gần như đều là chủ shop tự chạy quảng cáo
 * ≥10 triệu đ/tháng (nhóm chi 0 đ: 0/159 trả tiền) — xem
 * hubsell-marketing/chien-luoc/nghien-cuu/reports/Tệp khách và kênh lấy khách.md.
 * Các công cụ tối ưu quảng cáo nước ngoài (Perpetua, Teikametrics) hỏi đúng câu
 * này ngay trên form để chia luồng. Hubsell dùng nó để anh Trung nhắn Zalo
 * trong ngày cho khách ≥10 triệu và để đo kênh nào mang đúng khách.
 *
 * Mốc 5 / 10 / 30 triệu là tự chọn, quanh trung vị khách trả (~22 triệu).
 * FE giữ cùng danh sách ở frontend/src/lib/ad-spend-band.ts.
 */
export const AD_SPEND_BANDS = ["NONE", "LT_5M", "M5_10", "M10_30", "GT_30M"] as const;
export type AdSpendBand = (typeof AD_SPEND_BANDS)[number];

export const AD_SPEND_BAND_LABEL: Record<AdSpendBand, string> = {
  NONE: "Chưa chạy quảng cáo",
  LT_5M: "Dưới 5 triệu",
  M5_10: "5–10 triệu",
  M10_30: "10–30 triệu",
  GT_30M: "Trên 30 triệu",
};

/** Nhóm đáng gọi ngay (chi ≥10 triệu/tháng). */
export function isHighAdSpend(band: string | null | undefined): boolean {
  return band === "M10_30" || band === "GT_30M";
}

/** Nhận giá trị từ body — sai/thiếu trả null (KHÔNG chặn đăng ký: app mobile, client cũ không gửi). */
export function parseAdSpendBand(raw: unknown): AdSpendBand | null {
  return typeof raw === "string" && (AD_SPEND_BANDS as readonly string[]).includes(raw)
    ? (raw as AdSpendBand)
    : null;
}
