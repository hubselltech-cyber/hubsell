/**
 * Mức chi quảng cáo sàn mỗi tháng — câu hỏi một chạm ở form đăng ký (12/11/2026).
 * Cùng danh sách với backend/src/lib/ad-spend-band.ts (mốc 5/10/30 triệu tự chọn).
 * Vì sao hỏi: xem hubsell-marketing/chien-luoc/nghien-cuu/reports/Tệp khách và kênh lấy khách.md.
 */
export const AD_SPEND_BAND_OPTIONS = [
  { value: "NONE", label: "Chưa chạy" },
  { value: "LT_5M", label: "Dưới 5 triệu" },
  { value: "M5_10", label: "5–10 triệu" },
  { value: "M10_30", label: "10–30 triệu" },
  { value: "GT_30M", label: "Trên 30 triệu" },
] as const;

export type AdSpendBand = (typeof AD_SPEND_BAND_OPTIONS)[number]["value"];

export const AD_SPEND_BAND_VALUES = AD_SPEND_BAND_OPTIONS.map((o) => o.value) as [
  AdSpendBand,
  ...AdSpendBand[],
];

export function adSpendBandLabel(band: string | null | undefined): string | null {
  return AD_SPEND_BAND_OPTIONS.find((o) => o.value === band)?.label ?? null;
}

/** Nhóm đúng chân dung khách trả tiền (chi ≥10 triệu/tháng). */
export function isHighAdSpend(band: string | null | undefined): boolean {
  return band === "M10_30" || band === "GT_30M";
}
