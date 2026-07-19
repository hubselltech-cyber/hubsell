import * as XLSX from "xlsx";
import {
  fetchOrders,
  fetchProducts,
  fetchShippingDiscrepancies,
  type Order,
  type Product,
  type ShippingDiscrepancy,
  type SkuProduct,
} from "@/lib/api";

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

export function exportProductsToExcel(products: Product[]) {
  const rows = products.map((p) => ({
    "Mã SKU": p.skuCode,
    "Tên sản phẩm": p.productName,
    "Giá vốn": Number(p.costPrice),
    "Giá bán": Number(p.sellingPrice),
    "Tồn kho": p.quantityInStock,
    "Ngày tạo": toDateTimeText(p.createdAt),
  }));
  downloadSheet(
    rows,
    [16, 42, 14, 14, 10, 20],
    "San pham",
    `hubsell_san_pham_${fileStamp()}.xlsx`
  );
}

// Lấy TẤT CẢ sản phẩm (gom mọi trang) rồi xuất
export async function exportAllProducts() {
  const all: Product[] = [];
  let page = 1;
  // trang tối đa 50/lần theo backend
  for (;;) {
    const res = await fetchProducts({ page, pageSize: 50 });
    all.push(...res.items);
    if (page >= res.pageCount || res.pageCount === 0) break;
    page++;
  }
  exportProductsToExcel(all);
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
    "Phí ship sàn báo": o.shippingFeeQuoted,
    "Phí ship thực tế bị trừ": o.shippingFeeActual,
    "Số tiền chênh lệch": o.discrepancy, // âm = số tiền cần đòi lại
  }));
  downloadSheet(
    rows,
    [24, 12, 18, 22, 20],
    "Khieu nai phi ship",
    `hubsell_khieu_nai_phi_ship_${fileStamp()}.xlsx`
  );
}

/// Gom TẤT CẢ đơn "Chờ khiếu nại" theo bộ lọc hiện tại rồi xuất file gửi sàn
export async function exportShippingDisputes(filter: {
  channel?: string;
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
  channelId?: string;
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
