// ============================================================
// THUẾ GTGT SÀN THU THÊM TRÊN TIỀN QUẢNG CÁO — bảng thuế suất theo NGÀY (26/11/2026).
// Khảo sát + nguồn từng dòng: docs/TAI-CHINH-VAT-QUANG-CAO.md mục 2. Đây là chuyện thuế:
// số dưới lấy từ trang chính chủ của sàn + văn bản luật, CHƯA phải ý kiến cơ quan thuế.
//
// Sàn cộng thuế THÊM lúc chủ shop nạp tiền quảng cáo (nạp 100.000 trả 108.000 / 110.000),
// tài khoản quảng cáo nhận đủ số chưa thuế → con số "chi phí quảng cáo" sàn báo (bảng
// AdSpend) là số CHƯA gồm thuế. Báo cáo cộng thêm thuế = chi phí × thuế suất của NGÀY
// TIÊU. Thuế thật thu theo ngày NẠP — Hubsell không có dữ liệu ngày nạp nên đây là phép
// ước: lệch chỉ xảy ra với tiền nạp trước rồi tiêu vắt qua ngày đổi thuế suất.
//
//   TikTok  (TikTok Pte. Ltd., nhà cung cấp nước ngoài): 10 % từ 01/07/2025 (Luật Thuế
//           GTGT 48/2024/QH15; ads.tiktok.com/help/article/vietnam-vat-cit). Trước đó 5 %
//           (theo đại lý — khá chắc).
//   Shopee  (pháp nhân Việt Nam, hóa đơn GTGT): 8 % từ 01/07/2025 tới HẾT 31/12/2026
//           (Nghị quyết 204/2025/QH15; banhang.shopee.vn/edu/article/25329). Ngoài khoảng
//           đó 10 %. ⚠️ Có văn bản kéo dài giảm 2 % sang 2027 thì sửa mốc ở đây.
//   Lazada  (Công ty TNHH Recess): điều khoản nói phí chưa gồm thuế nhưng KHÔNG có nguồn
//           chính chủ nêu % và thời điểm thu → 0 cho tới khi có hóa đơn thật (docs mục 5, K3).
//
// Thêm / sửa mức: chỉ sửa bảng này — báo cáo tính lúc ĐỌC nên số quá khứ tự đúng theo
// ngày, không phải chạy lại dữ liệu.
// ============================================================

interface AdsVatBand {
  /** "yyyy-mm-dd" — áp từ ngày này (kể cả). Thiếu = từ trước tới nay. */
  from?: string;
  /** Phân số: 0.1 = 10 %. */
  rate: number;
}

/** Mỗi sàn một danh sách mốc xếp MỚI NHẤT TRƯỚC; lấy mốc đầu tiên có from ≤ ngày. */
const ADS_VAT_BANDS: Record<string, AdsVatBand[]> = {
  TIKTOK: [{ from: "2025-07-01", rate: 0.1 }, { rate: 0.05 }],
  SHOPEE: [{ from: "2027-01-01", rate: 0.1 }, { from: "2025-07-01", rate: 0.08 }, { rate: 0.1 }],
};

/** Thuế suất GTGT quảng cáo của một sàn vào một ngày ("yyyy-mm-dd" giờ VN). Sàn lạ → 0. */
export function adsVatRate(channelName: string, dayKey: string): number {
  const bands = ADS_VAT_BANDS[channelName];
  if (!bands) return 0;
  for (const b of bands) {
    if (!b.from || dayKey >= b.from) return b.rate;
  }
  return 0;
}

/**
 * Khoản quảng cáo sàn TRỪ THẲNG TRONG ĐƠN đã gồm thuế GTGT hay chưa — quyết định khi lấy
 * "chi phí sàn báo" (chưa thuế) trừ đi phần đã thu trong đơn thì phải bóc thuế ra trước
 * hay không.
 *   SHOPEE: CÓ — tiền trích từ đơn nạp ví quảng cáo = % × 1,08 (soi đơn thật 10/11/2026,
 *           docs/SHOPEE-NAP-VI-QUANG-CAO-TRU-TRUNG.md).
 *   TIKTOK: CHƯA BIẾT (gmv_max_ad_fee_amount trên bản kê) → coi là CHƯA gồm, giữ phép trừ
 *           như trước 26/11/2026 (docs TAI-CHINH-VAT-QUANG-CAO mục 5, K1). Chỉ ảnh hưởng
 *           gian trả GMV Max bằng tiền đơn (≈ 3 % tiền quảng cáo TikTok trên prod 11/2026).
 */
export function adsChargedInOrderIncludesVat(channelName: string): boolean {
  return channelName === "SHOPEE";
}

/** Đường lui toàn hệ thống: ADS_VAT_OFF=1 → mọi báo cáo quay về số trước 26/11/2026. */
export function adsVatGloballyOff(): boolean {
  return process.env.ADS_VAT_OFF === "1";
}
