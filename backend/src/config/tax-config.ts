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
 *      doanh thu theo luật TMĐT, KHÔNG cấu hình được (đổi luật thì sửa hằng số
 *      này, một chỗ duy nhất).
 *   2. THUẾ BỔ SUNG (customTaxRate): % dự phòng chủ shop tự ước tính, nhân vào
 *      cơ sở do chính họ chọn (calculationBase): LỢI NHUẬN trước thuế (mặc
 *      định, kiểu dự phòng TNDN) hoặc DOANH THU gốc (kiểu thuế khoán hộ KD).
 *      Cơ sở âm thì thuế bằng 0 — không có chuyện "thuế âm" cộng ngược vào lãi.
 *
 * Công thức chốt: Lợi nhuận ròng = Lợi nhuận trước thuế − Thuế sàn − Thuế bổ sung.
 */

import { TaxCalculationBase, TaxFilterPeriod } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** Thuế sàn TMĐT khấu trừ tại nguồn — luật hiện hành ấn định 1.5%. */
export const PLATFORM_TAX_RATE = 0.015;

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
