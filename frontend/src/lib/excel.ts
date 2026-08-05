import * as XLSX from "xlsx";
import {
  fetchOrders,
  fetchProducts,
  fetchRealizedPnl,
  fetchShippingDiscrepancies,
  type ChannelFilterQuery,
  type ChannelName,
  type Order,
  type PnlDetailRow,
  type PnlItemLine,
  type Product,
  type ReconciliationStatus,
  type ShippingDiscrepancy,
  type SkuProduct,
} from "@/lib/api";
import { toShopeeRow, toTiktokRow } from "@/lib/pnl-mappers";
import type { DateRange } from "@/lib/date-range";

// Chuyển "yyyy-...T..." → "hh:mm dd/mm/yyyy" cho dễ đọc trong Excel
function toDateTimeText(value: string): string {
  const d = new Date(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(
    d.getMonth() + 1
  )}/${d.getFullYear()}`;
}

const CHANNEL_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  OFFLINE: "Offline",
};
const PAYMENT_LABEL: Record<string, string> = {
  PAID: "Đã thanh toán",
  UNPAID: "Chưa thanh toán",
  REFUNDED: "Đã hoàn tiền",
};
const SHIPPING_LABEL: Record<string, string> = {
  PENDING: "Chờ xử lý",
  SHIPPING: "Đang giao",
  DELIVERED: "Đã giao",
  CANCELLED: "Đã hủy",
};

// Ghi workbook 1 sheet ra file .xlsx và tự tải về
function downloadSheet(
  rows: Record<string, string | number>[],
  colWidths: number[],
  sheetName: string,
  fileName: string
) {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

// Ngày giờ dạng gọn cho tên file: 20260718_1530
function fileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(
    d.getHours()
  )}${p(d.getMinutes())}`;
}

// ---------- FILE MẪU (Template) ----------

// Tải file Excel mẫu để người dùng biết cấu trúc cột trước khi nhập thật
export function downloadProductTemplate() {
  const sample = [
    {
      "Mã SKU": "VD-AO-001",
      "Tên sản phẩm": "Áo thun ví dụ (xoá dòng này khi nhập thật)",
      "Giá vốn": 50000,
      "Giá bán": 120000,
      "Tồn kho": 100,
    },
    {
      "Mã SKU": "VD-QUAN-002",
      "Tên sản phẩm": "Quần jean ví dụ",
      "Giá vốn": 150000,
      "Giá bán": 300000,
      "Tồn kho": 50,
    },
  ];
  downloadSheet(
    sample,
    [16, 42, 12, 12, 10],
    "Mau nhap san pham",
    "hubsell_file_mau_san_pham.xlsx"
  );
}

// ---------- XUẤT SẢN PHẨM ----------

/**
 * Xuất danh sách sản phẩm ra Excel.
 * `includeCost = false` (nhân viên) thì bỏ hẳn cột Giá vốn — chặn ở giao diện mà
 * để file tải về vẫn có giá vốn thì coi như không chặn gì.
 */
export function exportProductsToExcel(
  products: Product[],
  includeCost: boolean
) {
  const rows = products.map((p) => ({
    "Mã SKU": p.skuCode,
    "Tên sản phẩm": p.productName,
    ...(includeCost ? { "Giá vốn": Number(p.costPrice ?? 0) } : {}),
    "Giá bán": Number(p.sellingPrice),
    "Tồn kho": p.quantityInStock,
    "Ngày tạo": toDateTimeText(p.createdAt),
  }));
  downloadSheet(
    rows,
    includeCost ? [16, 42, 14, 14, 10, 20] : [16, 42, 14, 10, 20],
    "San pham",
    `hubsell_san_pham_${fileStamp()}.xlsx`
  );
}

// Lấy TẤT CẢ sản phẩm (gom mọi trang) rồi xuất
export async function exportAllProducts(includeCost: boolean) {
  const all: Product[] = [];
  let page = 1;
  // trang tối đa 50/lần theo backend
  for (;;) {
    const res = await fetchProducts({ page, pageSize: 50 });
    all.push(...res.items);
    if (page >= res.pageCount || res.pageCount === 0) break;
    page++;
  }
  exportProductsToExcel(all, includeCost);
  return all.length;
}

// ---------- XUẤT ĐƠN HÀNG ----------

export function exportOrdersToExcel(orders: Order[]) {
  const rows = orders.map((o) => ({
    "Mã đơn": o.orderCode,
    "Khách hàng": o.customerName,
    Kênh: CHANNEL_LABEL[o.channel.channelName] ?? o.channel.channelName,
    "Thanh toán": PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus,
    "Vận chuyển": SHIPPING_LABEL[o.shippingStatus] ?? o.shippingStatus,
    "Tổng tiền": Number(o.totalAmount),
    "Thời gian": toDateTimeText(o.createdAt),
  }));
  downloadSheet(
    rows,
    [22, 22, 10, 16, 14, 14, 20],
    "Don hang",
    `hubsell_don_hang_${fileStamp()}.xlsx`
  );
}

// ---------- XUẤT FILE KHIẾU NẠI PHÍ SHIP ----------

export function exportShippingDisputesToExcel(items: ShippingDiscrepancy[]) {
  const rows = items.map((o) => ({
    "Mã đơn hàng": o.orderCode,
    Sàn: CHANNEL_LABEL[o.channelName] ?? o.channelName,
    "Gian hàng": o.shopName,
    "Phí ship sàn báo": o.shippingFeeQuoted,
    "Phí ship thực tế bị trừ": o.shippingFeeActual,
    "Số tiền chênh lệch": o.discrepancy, // âm = số tiền cần đòi lại
  }));
  downloadSheet(
    rows,
    [24, 12, 22, 18, 22, 20],
    "Khieu nai phi ship",
    `hubsell_khieu_nai_phi_ship_${fileStamp()}.xlsx`
  );
}

/// Gom TẤT CẢ đơn "Chờ khiếu nại" theo bộ lọc hiện tại rồi xuất file gửi sàn
export async function exportShippingDisputes(filter: {
  channel?: ChannelFilterQuery;
}): Promise<number> {
  const all: ShippingDiscrepancy[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchShippingDiscrepancies({
      ...filter,
      status: "CHO_KHIEU_NAI", // chỉ xuất đơn chưa gửi khiếu nại
      page,
      pageSize: 100,
    });
    all.push(...res.items);
    if (page >= res.pageCount || res.pageCount === 0) break;
    page++;
  }
  if (all.length > 0) exportShippingDisputesToExcel(all);
  return all.length;
}

// Lấy TẤT CẢ đơn hàng theo bộ lọc hiện tại (gom mọi trang) rồi xuất
export async function exportAllOrders(filter: {
  shippingStatus?: string;
  channel?: ChannelFilterQuery;
}) {
  const all: Order[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchOrders({ ...filter, page, pageSize: 50 });
    all.push(...res.items);
    if (page >= res.pageCount || res.pageCount === 0) break;
    page++;
  }
  exportOrdersToExcel(all);
  return all.length;
}

// ---------- LÃI/LỖ THỰC HIỆN (đối soát theo sàn) ----------

/** Gộp các dòng sản phẩm thành một chuỗi cho ô Excel. */
function pnlItemsText(items: PnlItemLine[]): string {
  return items
    .map(
      (it) =>
        `${it.sku} ${it.name}${it.variation ? ` (${it.variation})` : ""} x${it.quantity}`
    )
    .join("; ");
}

/** Xuất Excel theo layout cột Shopee (đúng bảng đang xem). */
export function exportShopeePnlToExcel(rows: PnlDetailRow[]) {
  const data = rows.map(toShopeeRow).map((r) => ({
    "Mã đơn": r.base.orderCode,
    "Trạng thái": SHIPPING_LABEL[r.base.shippingStatus] ?? r.base.shippingStatus,
    Shop: r.base.shopName,
    "Ngày tạo": toDateTimeText(r.base.createdAt),
    "Chi tiết sản phẩm": pnlItemsText(r.base.items),
    "Tổng giá trị SP": r.revenueGross,
    "Trợ giá Shopee": r.shopeeSubsidy,
    "Phí VC Dự kiến": r.shipQuoted,
    "Phí VC Thực tế": r.shipActual,
    "Trợ giá VC Shopee": r.shipSubsidyShopee,
    "Trợ giá VC Shop": r.shipSubsidyShop,
    "Người mua trả": r.buyerPaidShip,
    "Chênh lệch phí VC": -r.shipDiff,
    "Phí sàn (CĐ+TT)": -r.feePlatform,
    "Phí TTLK": -r.feeAffiliate,
    "Phí DV (Xtra)": -r.feeServiceXtra,
    PiShip: -r.feePiship,
    "Nạp ví quảng cáo": -r.adWallet,
    "Trợ giá người bán": -r.sellerSubsidy,
    Thuế: -r.tax,
    "Doanh thu ước tính": r.estRevenue,
    "Doanh thu từ Shopee": r.revenueFromShopee,
    "Chi phí giá vốn": -r.costSnapshot,
    "LỢI NHUẬN THỰC TẾ": r.profit,
  }));
  downloadSheet(
    data,
    [
      22, 14, 22, 18, 40, 16, 14, 14, 14, 16, 14, 14, 16, 16, 12, 12, 12, 14, 16,
      12, 18, 18, 16, 18,
    ],
    "Loi nhuan Shopee",
    `hubsell_loinhuan_shopee_${fileStamp()}.xlsx`
  );
}

/** Xuất Excel theo layout cột TikTok Shop (đúng bảng đang xem). */
export function exportTiktokPnlToExcel(rows: PnlDetailRow[]) {
  const data = rows.map(toTiktokRow).map((r) => ({
    "Mã đơn": r.base.orderCode,
    "Trạng thái": SHIPPING_LABEL[r.base.shippingStatus] ?? r.base.shippingStatus,
    Shop: r.base.shopName,
    "Ngày tạo": toDateTimeText(r.base.createdAt),
    "Ngày gửi ĐVVC": r.base.shippedAt ? toDateTimeText(r.base.shippedAt) : "",
    "Khách hàng": r.base.customerName,
    "Chi tiết sản phẩm": pnlItemsText(r.base.items),
    "Tổng giá trị SP": r.revenueGross,
    "Chiết khấu của sàn": r.platformDiscount,
    "Chiết khấu người bán": -r.sellerDiscount,
    "Tổng SP sau chiết khấu": r.revenueAfterDiscount,
    "PVC trước chiết khấu": r.shipBeforeDiscount,
    "CK PVC bởi sàn": -r.shipDiscountPlatform,
    "CK PVC bởi người bán": -r.shipDiscountSeller,
    "PVC sau chiết khấu": r.shipAfterDiscount,
    "PVC thực tế": r.shipActual,
    "Chênh lệch PVC": -r.shipDiff,
    "Phí cố định & GD": -r.feeFixedTransaction,
    "Phí dịch vụ SFP & Xtra": -r.feeServiceSfpXtra,
    "Phí Flash Sale": -r.feeFlashSale,
    "Phí Tiếp thị LK": -r.feeAffiliate,
    "Phí xử lý đơn & SFR": -r.feeOrderProcessingSfr,
    "Thuế & VAT": -r.taxVat,
    "Doanh thu ước tính": r.estRevenue,
    "Chi phí giá vốn": -r.costSnapshot,
    "LỢI NHUẬN THỰC TẾ": r.profit,
  }));
  downloadSheet(
    data,
    [
      22, 14, 22, 18, 18, 20, 40, 16, 16, 16, 18, 16, 14, 16, 16, 14, 14, 16, 18,
      14, 14, 16, 14, 18, 16, 18,
    ],
    "Loi nhuan TikTok",
    `hubsell_loinhuan_tiktok_${fileStamp()}.xlsx`
  );
}

/**
 * Xuất Lãi/Lỗ Thực Hiện theo BỘ LỌC ĐỘNG từ giao diện (sàn/khoảng ngày/trạng
 * thái). Gom hết các trang rồi chọn layout đúng theo sàn. Trả về số dòng đã xuất.
 */
export async function exportRealizedPnl(filter: {
  platform: ChannelName | "ALL";
  range?: DateRange;
  status?: ReconciliationStatus;
  lossOnly?: boolean;
}): Promise<number> {
  const channel: ChannelFilterQuery | undefined =
    filter.platform === "ALL" ? undefined : { channelName: filter.platform };

  const all: PnlDetailRow[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchRealizedPnl({
      range: filter.range,
      channel,
      status: filter.status,
      lossOnly: filter.lossOnly,
      page,
      pageSize: 100,
    });
    all.push(...res.rows);
    if (page >= res.pageCount || res.pageCount === 0) break;
    page++;
  }
  if (all.length === 0) return 0;
  if (filter.platform === "TIKTOK") exportTiktokPnlToExcel(all);
  else exportShopeePnlToExcel(all); // Shopee / Lazada / Tất cả dùng layout Shopee
  return all.length;
}

/**
 * Xuất TRỰC TIẾP các dòng đã chọn (không gọi API) theo layout của tab đang xem.
 * Dùng khi người dùng tích chọn thủ công một số đơn trong bảng.
 */
export function exportPnlRows(
  platform: ChannelName | "ALL",
  rows: PnlDetailRow[]
): number {
  if (rows.length === 0) return 0;
  if (platform === "TIKTOK") exportTiktokPnlToExcel(rows);
  else exportShopeePnlToExcel(rows);
  return rows.length;
}

// ---------- GIÁ VỐN THEO SKU ----------

/**
 * Xuất danh sách SKU kèm giá vốn hiện tại. File này chính là mẫu để sửa hàng
 * loạt rồi nhập ngược lại: chỉ cột "Mã SKU" và "Giá vốn" được đọc khi nhập,
 * các cột còn lại để người dùng biết mình đang sửa cái gì.
 */
export function exportCostPricesToExcel(items: SkuProduct[]) {
  const rows = items.map((i) => ({
    "Mã SKU": i.sku,
    "Tên sản phẩm": i.productName,
    "Phân loại": i.variantName ?? "",
    "Kênh bán": CHANNEL_LABEL[i.channelName] ?? i.channelName,
    "Giá bán": Number(i.sellingPrice),
    "Giá vốn": Number(i.costPrice),
  }));
  downloadSheet(
    rows,
    [18, 40, 26, 12, 14, 14],
    "Gia von",
    `hubsell_gia_von_${fileStamp()}.xlsx`
  );
}

/** File mẫu trống cho người chưa có dữ liệu, kèm 2 dòng ví dụ. */
export function downloadCostPriceTemplate() {
  const rows = [
    { "Mã SKU": "SH-AO-THUN-M", "Giá vốn": 74000 },
    { "Mã SKU": "SH-AO-THUN-L", "Giá vốn": 76000 },
  ];
  downloadSheet(
    rows,
    [22, 16],
    "Mau gia von",
    "hubsell_mau_nhap_gia_von.xlsx"
  );
}
