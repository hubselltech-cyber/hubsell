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
  type InvestorReportResponse,
  type InvoiceRegisterRowDTO,
  type PlatformLedgerEntry,
  type Product,
  type ReconciliationStatus,
  type ShippingDiscrepancy,
  type SkuProduct,
} from "@/lib/api";
import { toShopeeRow, toTiktokRow } from "@/lib/pnl-mappers";
import type { DateRange } from "@/lib/date-range";
import {
  HQ_EXPENSE_CATEGORY_LABEL,
  displayExpenseCategory,
} from "@/app/admin/hq-expense-categories";

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

// ---------- SỔ QUỸ NỘI BỘ HUBSELL (khu điều hành) ----------

const LEDGER_SOURCE_LABEL: Record<string, string> = {
  SUBSCRIPTION: "Thu phí gói dịch vụ",
  REFERRAL_PAYOUT: "Chi hoa hồng giới thiệu",
  OTHER: "Khoản khác",
};
const LEDGER_INVOICE_LABEL: Record<string, string> = {
  NONE: "",
  PENDING: "CHƯA XUẤT",
  ISSUED: "Đã xuất",
};

/**
 * Xuất sổ quỹ một tháng ra Excel — layout sổ thu/chi quen thuộc của kế toán:
 * hai cột Tiền vào / Tiền ra tách riêng + dòng TỔNG CỘNG cuối sổ, kèm cột
 * nghĩa vụ hóa đơn (thu) và khoản mục + chứng từ đầu vào (chi: NCC, MST,
 * số HĐ, CK/TM). Sheet 2 "Chi theo khoan muc" tổng hợp tiền ra theo khoản
 * mục — kế toán dịch vụ lấy thẳng số lên tờ khai.
 */
export function exportLedgerToExcel(entries: PlatformLedgerEntry[], month: string) {
  const rows: Record<string, string | number>[] = entries.map((e) => ({
    "Ngày phát sinh": toDateTimeText(e.occurredAt),
    Loại: e.direction === "IN" ? "THU" : "CHI",
    "Khoản mục":
      e.direction === "OUT"
        ? HQ_EXPENSE_CATEGORY_LABEL[displayExpenseCategory(e)] ?? ""
        : LEDGER_SOURCE_LABEL[e.source] ?? e.source,
    "Diễn giải": e.note ?? "",
    "Khách hàng / NCC": e.customer
      ? `${e.customer.fullName}${e.customer.email ? ` (${e.customer.email})` : ""}`
      : e.vendorName ?? "",
    "MST NCC": e.vendorTaxCode ?? "",
    "Tiền vào": e.direction === "IN" ? e.amount : "",
    "Tiền ra": e.direction === "OUT" ? e.amount : "",
    "Hình thức TT":
      e.direction === "OUT"
        ? e.paymentMethod === "CASH"
          ? "Tiền mặt"
          : e.paymentMethod === "BANK"
            ? "Chuyển khoản"
            : ""
        : "",
    "Hóa đơn": LEDGER_INVOICE_LABEL[e.invoiceStatus] ?? e.invoiceStatus,
    "Số hóa đơn": e.direction === "IN" ? e.invoiceNo ?? "" : e.inputInvoiceNo ?? "",
    "Người ghi": e.createdByName,
  }));

  const totalIn = entries
    .filter((e) => e.direction === "IN")
    .reduce((s, e) => s + e.amount, 0);
  const totalOut = entries
    .filter((e) => e.direction === "OUT")
    .reduce((s, e) => s + e.amount, 0);
  rows.push({
    "Ngày phát sinh": "TỔNG CỘNG",
    Loại: "",
    "Khoản mục": "",
    "Diễn giải": `Chênh lệch: ${totalIn - totalOut}`,
    "Khách hàng / NCC": "",
    "MST NCC": "",
    "Tiền vào": totalIn,
    "Tiền ra": totalOut,
    "Hình thức TT": "",
    "Hóa đơn": "",
    "Số hóa đơn": "",
    "Người ghi": "",
  });

  // Sheet 2: tiền ra gom theo khoản mục — đúng nhóm chi phí khi kê khai.
  const byCategory = new Map<string, number>();
  for (const e of entries) {
    if (e.direction !== "OUT") continue;
    const key = displayExpenseCategory(e);
    byCategory.set(key, (byCategory.get(key) ?? 0) + e.amount);
  }
  const categoryRows = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, out]) => ({
      "Khoản mục": HQ_EXPENSE_CATEGORY_LABEL[key] ?? key,
      "Tiền ra": out,
      "Tỷ trọng (%)": totalOut > 0 ? Math.round((out / totalOut) * 1000) / 10 : 0,
    }));
  categoryRows.push({ "Khoản mục": "TỔNG CHI", "Tiền ra": totalOut, "Tỷ trọng (%)": 100 });

  const wb = XLSX.utils.book_new();
  const wsLedger = XLSX.utils.json_to_sheet(rows);
  wsLedger["!cols"] = [20, 8, 30, 44, 32, 14, 14, 14, 14, 12, 16, 20].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsLedger, `So quy ${month}`);
  const wsCategory = XLSX.utils.json_to_sheet(categoryRows);
  wsCategory["!cols"] = [36, 16, 14].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsCategory, "Chi theo khoan muc");
  XLSX.writeFile(wb, `hubsell_so_quy_${month}.xlsx`);
}

// ---------- BÁO CÁO NHÀ ĐẦU TƯ (khu điều hành, chỉ chủ nền tảng) ----------

/**
 * Xuất trọn bộ chỉ số nhà đầu tư ra MỘT file Excel nhiều sheet — mang đi pitch
 * là mở được ngay: Tổng quan / Đăng ký / GMV / Funnel / Retention / Sổ quỹ.
 * Số chưa có (MRR...) ghi rõ "chờ thương mại hóa", không vẽ.
 */
export function exportInvestorReportToExcel(report: InvestorReportResponse) {
  const wb = XLSX.utils.book_new();
  const addSheet = (
    rows: Record<string, string | number>[],
    colWidths: number[],
    name: string
  ) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = colWidths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addSheet(
    [
      { "Chỉ số": "Chủ shop đã đăng ký", "Giá trị": report.funnel.registered, "Ghi chú": "" },
      { "Chỉ số": "Đã kết nối sàn", "Giá trị": report.funnel.connectedChannel, "Ghi chú": `${report.funnel.connectedPct}% số đăng ký` },
      { "Chỉ số": "Đã có đơn qua hệ thống", "Giá trị": report.funnel.hasOrder, "Ghi chú": `${report.funnel.hasOrderPct}% số đăng ký` },
      { "Chỉ số": "Đăng ký qua giới thiệu", "Giá trị": report.viral.totalReferred, "Ghi chú": `${report.viral.pctOfSignups}% số đăng ký (tăng trưởng tự nhiên)` },
      { "Chỉ số": "MAU 30 ngày (đăng nhập)", "Giá trị": report.activity.mau30d, "Ghi chú": `Theo dõi từ ${report.activity.trackedSince}` },
      { "Chỉ số": "Chi trung bình/tháng (burn)", "Giá trị": report.burn.avgMonthlyBurn, "Ghi chú": "Bình quân các tháng có phát sinh sổ quỹ" },
      { "Chỉ số": "MRR", "Giá trị": report.revenue.mrr, "Ghi chú": report.revenue.note },
      { "Chỉ số": "ARPU", "Giá trị": report.revenue.arpu, "Ghi chú": report.revenue.note },
    ],
    [30, 16, 44],
    "Tong quan"
  );
  addSheet(
    report.signupsByMonth.map((r) => ({
      Tháng: r.label,
      "Đăng ký mới": r.count,
      "Tăng trưởng MoM (%)": r.momPct ?? "",
    })),
    [10, 14, 20],
    "Dang ky"
  );
  addSheet(
    report.gmvByMonth.map((r) => ({
      Tháng: r.label,
      "GMV qua nền tảng": r.gmv,
      "Tăng trưởng MoM (%)": r.momPct ?? "",
    })),
    [10, 20, 20],
    "GMV"
  );
  addSheet(
    report.retention.map((c) => {
      const row: Record<string, string | number> = {
        "Cohort (tháng đăng ký)": c.label,
        "Quy mô": c.size,
      };
      c.activePct.forEach((p, k) => {
        row[`M${k} (%)`] = p ?? "";
      });
      return row;
    }),
    [22, 10, 9, 9, 9, 9, 9, 9],
    "Retention"
  );
  addSheet(
    report.burn.byMonth.map((r) => ({
      Tháng: r.label,
      "Tiền vào": r.in,
      "Tiền ra": r.out,
      "Chênh lệch": r.in - r.out,
    })),
    [10, 14, 14, 14],
    "So quy"
  );

  XLSX.writeFile(wb, `hubsell_bao_cao_nha_dau_tu_${fileStamp()}.xlsx`);
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

// ---------- BẢNG KÊ HÓA ĐƠN BÁN RA (module Hóa đơn & Thuế, 03/09) ----------

const CQT_LABEL: Record<string, string> = {
  WAITING: "Chờ CQT",
  SEND_ERROR: "Gửi CQT lỗi",
  ACCEPTED: "CQT đã cấp mã / tiếp nhận",
  REJECTED: "CQT TỪ CHỐI",
};

/** "yyyy-...T..." → "dd/mm/yyyy" (ngày lập hóa đơn trên bảng kê). */
function toDateOnlyText(value: string): string {
  const d = new Date(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Xuất bảng kê hóa đơn bán ra của kỳ — cột theo thói quen kế toán đối chiếu
 * với cổng hoadondientu.gdt.gov.vn (ký hiệu, số, ngày, người mua, MST, tiền
 * chưa thuế / thuế / tổng). Tờ điều chỉnh mang số ÂM, ghi rõ điều chỉnh cho số nào.
 */
export function exportInvoiceRegisterToExcel(
  rows: InvoiceRegisterRowDTO[],
  rangeLabel: string
) {
  const data = rows.map((r, i) => ({
    STT: i + 1,
    "Ngày lập": toDateOnlyText(r.issuedAt),
    "Ký hiệu": r.invoiceSeries ?? "",
    "Số hóa đơn": r.invoiceNo ?? "",
    Loại:
      r.kind === "ADJUSTMENT"
        ? `Điều chỉnh cho ${[r.adjustsInvoiceSeries, r.adjustsInvoiceNo].filter(Boolean).join(" ")}`.trim()
        : "Bán hàng",
    "Mã đơn": r.orderCode,
    "Sàn / Gian hàng": [r.channelName ? CHANNEL_LABEL[r.channelName] ?? r.channelName : "", r.shopName ?? ""]
      .filter(Boolean)
      .join(" · "),
    "Người mua": r.buyerName ?? "",
    "MST / Số định danh người mua": r.buyerTaxCode ?? "",
    "Thuế suất": r.vatRates.map((x) => `${x}%`).join(" / "),
    "Tiền chưa thuế": r.amountWithoutVat,
    "Tiền thuế GTGT": r.vatAmount,
    "Tổng tiền": r.totalAmount,
    "Trạng thái NCC": r.status === "CANCELLED" ? "Đã hủy" : "Đã phát hành",
    "Cơ quan Thuế": r.cqtStatus ? CQT_LABEL[r.cqtStatus] ?? r.cqtStatus : "Chưa kiểm",
    "Mã tra cứu": r.transactionId ?? "",
  }));
  const safeLabel = rangeLabel.replace(/[^0-9a-zA-Z]+/g, "-").replace(/^-|-$/g, "");
  downloadSheet(
    data,
    [5, 12, 10, 12, 26, 20, 22, 30, 18, 12, 14, 14, 14, 14, 24, 16],
    "Bang ke ban ra",
    `bang-ke-hoa-don-ban-ra_${safeLabel || "ky"}_${fileStamp()}.xlsx`
  );
}
