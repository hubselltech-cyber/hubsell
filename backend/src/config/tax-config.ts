/**
 * CẤU HÌNH THUẾ CỦA SHOP — HELPER DÙNG CHUNG.
 *
 * Mọi nơi cần số thuế (Báo cáo dòng tiền, Lãi/Lỗ Thực Hiện, Báo cáo thuế) đều
 * đọc cấu hình và tính qua các hàm ở đây, KHÔNG tự cộng trừ % — để trang "Thuế
 * bổ sung" đổi cấu hình một phát là mọi báo cáo cùng đổi theo một công thức.
 *
 * Hai tầng thuế:
 *   1. THUẾ SÀN TMĐT (PLATFORM_TAX_RATE = 1.5% = 1% GTGT + 0.5% TNCN): sàn
 *      khấu trừ TẠI NGUỒN trên DOANH THU GỐC của đơn — khoản phí cứng giảm trừ
 *      doanh thu theo NĐ 252/2026/NĐ-CP Điều 43–44 (kế thừa NĐ 117/2025 đã bị
 *      bãi bỏ), KHÔNG cấu hình được (đổi luật thì sửa hằng số này, một chỗ).
 *      ⚠️ Chỉ áp cho HỘ / CÁ NHÂN kinh doanh — DOANH NGHIỆP tự kê khai, sàn
 *      KHÔNG khấu trừ (khảo sát 03/09/2026, tài liệu chính thức 3 sàn). Shop
 *      khai thuế suất GTGT doanh nghiệp (InvoiceConfig.defaultVatRate > 0)
 *      thì báo cáo KHÔNG được ước tính khoản này cho đơn chưa đối soát.
 *   2. THUẾ BỔ SUNG (customTaxRate): % dự phòng chủ shop tự ước tính, nhân vào
 *      cơ sở do chính họ chọn (calculationBase): LỢI NHUẬN trước thuế (mặc
 *      định, kiểu dự phòng TNDN) hoặc DOANH THU gốc (kiểu thuế khoán hộ KD).
 *      Cơ sở âm thì thuế bằng 0 — không có chuyện "thuế âm" cộng ngược vào lãi.
 *
 * Công thức chốt: Lợi nhuận ròng = Lợi nhuận trước thuế − Thuế sàn − Thuế bổ sung.
 */

import { TaxCalculationBase, TaxFilterPeriod } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** Thuế sàn TMĐT khấu trừ tại nguồn — NĐ 252/2026 ấn định 1% GTGT + 0.5% TNCN với hàng hóa. */
export const PLATFORM_TAX_RATE = 0.015;
/** Phần GTGT trong 1.5% sàn khấu trừ (hàng hóa); phần còn lại 0.5% là TNCN. */
export const PLATFORM_VAT_RATE = 0.01;

// ============================================================
// NGƯỠNG DOANH THU HỘ / CÁ NHÂN KINH DOANH — NĐ 68/2026/NĐ-CP, sửa bởi
// NĐ 141/2026/NĐ-CP (áp dụng từ kỳ tính thuế 2026, nâng 500 triệu → 1 TỶ).
// Nhiều bài trên mạng (kể cả thông báo Shopee 03/2026) còn ghi 500 triệu —
// đã lỗi thời, đừng chép lại. Hằng số này là NGUỒN DUY NHẤT cho mọi chỗ
// hiển thị/cảnh báo ngưỡng; đổi luật sửa một chỗ.
//   Nhóm 1: ≤ 1 tỷ    — miễn GTGT + TNCN, chỉ thông báo doanh thu năm (01/TKN-CNKD, hạn 31/01).
//   Nhóm 2: 1 – 3 tỷ  — khai QUÝ 01/CNKD: GTGT 1% + TNCN 0,5% doanh thu (hoặc 15% lợi nhuận).
//   Nhóm 3: 3 – 50 tỷ — khai quý, TNCN 17% thu nhập, BẮT BUỘC hóa đơn điện tử.
//   Nhóm 4: > 50 tỷ   — khai THÁNG, TNCN 20% thu nhập.
// Hóa đơn: NĐ 254/2026 Đ.6 — hộ > 1 tỷ bắt buộc HĐĐT (có mã hoặc máy tính tiền).
// ============================================================

/** Trần doanh thu năm nhóm 1 (miễn thuế + không bắt buộc HĐĐT). */
export const HOUSEHOLD_TAX_FREE_THRESHOLD = 1_000_000_000;
/** Trần doanh thu năm nhóm 2. */
export const HOUSEHOLD_TIER2_MAX = 3_000_000_000;
/** Trần doanh thu năm nhóm 3. */
export const HOUSEHOLD_TIER3_MAX = 50_000_000_000;

export type HouseholdTier = 1 | 2 | 3 | 4;

export interface HouseholdTierInfo {
  tier: HouseholdTier;
  /** Nhãn ngắn để UI/chuông in thẳng. */
  label: string;
  /** Nghĩa vụ kê khai tóm tắt của nhóm. */
  obligation: string;
}

/**
 * Xếp nhóm hộ/cá nhân KD theo doanh thu NĂM. Nguồn số là doanh thu qua
 * Hubsell — seller có thêm doanh thu ngoài sàn thì tự cộng (UI nói rõ).
 */
export function householdTier(annualRevenue: number): HouseholdTierInfo {
  const r = Math.max(0, annualRevenue);
  if (r <= HOUSEHOLD_TAX_FREE_THRESHOLD) {
    return {
      tier: 1,
      label: "Nhóm 1 (≤ 1 tỷ/năm)",
      obligation:
        "Miễn GTGT + TNCN. Chỉ gửi thông báo doanh thu năm (mẫu 01/TKN-CNKD) trước 31/01 năm sau; không bắt buộc hóa đơn điện tử.",
    };
  }
  if (r <= HOUSEHOLD_TIER2_MAX) {
    return {
      tier: 2,
      label: "Nhóm 2 (1 – 3 tỷ/năm)",
      obligation:
        "Kê khai theo QUÝ (mẫu 01/CNKD): GTGT 1% + TNCN 0,5% trên doanh thu (hoặc chọn 15% lợi nhuận). Bắt buộc hóa đơn điện tử.",
    };
  }
  if (r <= HOUSEHOLD_TIER3_MAX) {
    return {
      tier: 3,
      label: "Nhóm 3 (3 – 50 tỷ/năm)",
      obligation:
        "Kê khai theo QUÝ, TNCN 17% trên thu nhập; bắt buộc hóa đơn điện tử và sổ sách kế toán.",
    };
  }
  return {
    tier: 4,
    label: "Nhóm 4 (> 50 tỷ/năm)",
    obligation: "Kê khai theo THÁNG, TNCN 20% trên thu nhập; chế độ kế toán như doanh nghiệp.",
  };
}

export interface ShopTaxConfig {
  /** Phân số: 0.2 = 20%. 0 = chủ shop không trích thêm. */
  customTaxRate: number;
  calculationBase: TaxCalculationBase;
  filterPeriod: TaxFilterPeriod;
}

/** Mặc định khi shop CHƯA lưu cấu hình lần nào — khớp default của schema. */
export const DEFAULT_TAX_CONFIG: ShopTaxConfig = {
  customTaxRate: 0,
  calculationBase: TaxCalculationBase.PROFIT,
  filterPeriod: TaxFilterPeriod.MONTH,
};

/** Đọc cấu hình thuế của một shop; chưa có bản ghi thì trả mặc định. */
export async function getShopTaxConfig(
  ownerId: string
): Promise<ShopTaxConfig> {
  const s = await prisma.shopTaxSetting.findUnique({ where: { ownerId } });
  if (!s) return DEFAULT_TAX_CONFIG;
  return {
    customTaxRate: Number(s.customTaxRate),
    calculationBase: s.calculationBase,
    filterPeriod: s.filterPeriod,
  };
}

/** Thuế sàn TMĐT khấu trừ tại nguồn trên doanh thu gốc (1.5% cứng theo luật). */
export function platformTaxOn(grossRevenue: number): number {
  return Math.max(0, grossRevenue) * PLATFORM_TAX_RATE;
}

/**
 * Thuế bổ sung ước tính cho một kỳ.
 * @param base doanh thu gốc VÀ lợi nhuận trước thuế của cùng kỳ — hàm tự chọn
 *             cơ sở theo calculationBase trong cấu hình.
 */
export function additionalTaxOn(
  base: { grossRevenue: number; profit: number },
  cfg: ShopTaxConfig
): number {
  if (cfg.customTaxRate <= 0) return 0;
  const taxBase =
    cfg.calculationBase === TaxCalculationBase.REVENUE
      ? base.grossRevenue
      : base.profit;
  return Math.max(0, taxBase) * cfg.customTaxRate;
}
