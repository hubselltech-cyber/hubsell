import * as XLSX from "xlsx";
import {
  fetchOrders,
  fetchProducts,
  fetchPurchaseStatsByProduct,
  fetchRealizedPnlRows,
  fetchShipDiffByProduct,
  fetchShippingDiscrepancies,
  type ChannelFilterQuery,
  type ChannelName,
  type Order,
  type PnlDetailRow,
  type PnlItemLine,
  type InvestorReportResponse,
  type InvoiceRegisterRowDTO,
  type TaxDeclarationResponse,
  type TaxDeclarationRowDTO,
  type PlatformLedgerEntry,
  type Product,
  type PurchaseStatProduct,
  type ReconciliationStatus,
  type SupplierRow,
  type ShipDiffProductRow,
  type ShippingDiscrepancy,
  type ShippingDisputeStatus,
  type SkuProduct,
} from "@/lib/api";
import { TIKTOK_COLUMNS, toShopeeRow, toTiktokRow } from "@/lib/pnl-mappers";
import { rangeToQuery, type DateRange } from "@/lib/date-range";
import {
  SHIP_DIFF_PART_COLUMNS,
  SHIP_GUARANTEE_GAP_META,
  SHIPPING_DIFF_REASON_META,
  SHIPPING_DIFF_REASON_ORDER,
  type ShippingDiffReasonFilter,
} from "@/lib/shipping-diff-reason";
import {
  HQ_EXPENSE_CATEGORY_LABEL,
  displayExpenseCategory,
} from "@/lib/hq-expense-categories";

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
interface SheetSpec {
  rows: Record<string, string | number>[];
  colWidths: number[];
  sheetName: string;
}

/** Một tệp nhiều trang tính (tên trang tính không dấu, tối đa 31 ký tự theo giới hạn Excel). */
function downloadSheets(sheets: SheetSpec[], fileName: string) {
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const ws = XLSX.utils.json_to_sheet(sh.rows);
    ws["!cols"] = sh.colWidths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, sh.sheetName);
  }
  XLSX.writeFile(wb, fileName);
}

function downloadSheet(
  rows: Record<string, string | number>[],
  colWidths: number[],
  sheetName: string,
  fileName: string
) {
  downloadSheets([{ rows, colWidths, sheetName }], fileName);
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
      "Mã SKU": "VD-AO-001-DEN-M",
      "Tên sản phẩm": "Áo thun ví dụ (xoá dòng này khi nhập thật)",
      "Phân loại": "Đen, M",
      "Giá vốn": 50000,
      "Giá bán": 120000,
      "Tồn kho": 100,
    },
    {
      "Mã SKU": "VD-QUAN-002",
      "Tên sản phẩm": "Quần jean ví dụ",
      "Phân loại": "",
      "Giá vốn": 150000,
      "Giá bán": 300000,
      "Tồn kho": 50,
    },
  ];
  downloadSheet(
    sample,
    [18, 42, 14, 12, 12, 10],
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
    // Phân loại tách cột (22/10/2026) — nhập lại file này thì cột được đọc đúng.
    "Phân loại": p.variantName ?? "",
    ...(includeCost ? { "Giá vốn": Number(p.costPrice ?? 0) } : {}),
    "Giá bán": Number(p.sellingPrice),
    "Tồn kho": p.quantityInStock,
    // Chờ giao (11/11/2026): đã trừ khỏi Tồn kho cho đơn đã chốt, chưa giao ship. Chỉ để đối chiếu —
    // nhập lại file thì cột này bị bỏ qua.
    "Chờ giao": p.awaitingShip ?? 0,
    "Trạng thái": p.isActive === false ? "Ngừng kinh doanh" : "Đang bán",
    "Ngày tạo": toDateTimeText(p.createdAt),
  }));
  downloadSheet(
    rows,
    includeCost ? [16, 42, 14, 14, 14, 10, 10, 16, 20] : [16, 42, 14, 14, 10, 10, 16, 20],
    "San pham",
    `hubsell_san_pham_${fileStamp()}.xlsx`
  );
}

// Lấy TẤT CẢ sản phẩm (gom mọi trang) rồi xuất
export async function exportAllProducts(includeCost: boolean) {
  const all: Product[] = [];
  let page = 1;
  // trang tối đa 100/lần theo backend
  for (;;) {
    // Xuất cả SKU đã ngừng bán (cột Trạng thái phân biệt) — file là để đối chiếu.
    const res = await fetchProducts({ page, pageSize: 100, status: "all", awaiting: true });
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
  const rows = items.map((o) => {
    const meta = o.reason ? SHIPPING_DIFF_REASON_META[o.reason] : undefined;
    return {
      "Mã đơn hàng": o.orderCode,
      "Mã vận đơn": o.trackingCode ?? "",
      Sàn: CHANNEL_LABEL[o.channelName] ?? o.channelName,
      "Gian hàng": o.shopName,
      "Nguyên nhân": meta?.label ?? "",
      "Khiếu nại được": meta ? (meta.claimable ? "Có" : "Không — chính sách sàn") : "",
      "Phí ship đã được phủ (khách trả + sàn trợ)": o.coveredFee,
      "Phí ship thực tế bị trừ": o.shippingFeeActual,
      "Số tiền chênh lệch": o.discrepancy, // âm = số tiền cần đòi lại
    };
  });
  downloadSheet(
    rows,
    [24, 20, 12, 22, 30, 24, 34, 22, 20],
    "Khieu nai phi ship",
    `hubsell_khieu_nai_phi_ship_${fileStamp()}.xlsx`
  );
}

/// Gom TẤT CẢ đơn "Chờ khiếu nại" theo bộ lọc hiện tại (gian + nguyên nhân)
/// rồi xuất file gửi sàn
export async function exportShippingDisputes(filter: {
  channel?: ChannelFilterQuery;
  reason?: ShippingDiffReasonFilter;
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

// ---------- TRUY THU PHÍ SHIP (Kiểm toán phí) — theo đơn + theo sản phẩm ----------

const SHIP_DISPUTE_LABEL: Record<ShippingDisputeStatus, string> = {
  CHO_KHIEU_NAI: "Chờ khiếu nại",
  DANG_KHIEU_NAI: "Đang khiếu nại",
  DA_DOI_SOAT: "Đã đối soát",
};

const SHIP_AUDIT_PAGE = 100;

/** Gọi lần lượt mọi trang của một danh sách phân trang (trang đầu luôn gọi). */
async function fetchEveryPage<T>(load: (page: number) => Promise<{ items: T[]; pageCount: number }>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await load(page);
    all.push(...res.items);
    if (page >= res.pageCount) break;
  }
  return all;
}

/**
 * Xuất rổ "Truy thu phí ship" của Kiểm toán phí theo GIAN + KHOẢNG NGÀY đang chọn (khách 10/11/2026: chọn
 * thời gian rồi xuất ra file, khỏi cho nhân viên chép tay). Một tệp hai trang tính, cùng nguồn với màn hình:
 *   · "Theo don": mọi đơn shop chịu thêm phí ship, kèm sản phẩm, nguyên nhân, trạng thái khiếu nại;
 *   · "Theo san pham": mỗi sản phẩm một dòng, tiền tách thành một cột cho từng nguyên nhân.
 * Không theo bộ lọc trạng thái / nguyên nhân trên màn: tệp là bản đầy đủ của kỳ, lọc tiếp trong Excel.
 * Số tiền là số DƯƠNG = phần shop chịu thêm. Trả số dòng mỗi trang tính; không có đơn nào thì không tạo tệp.
 */
export async function exportShipDiffAudit(filter: {
  channel?: ChannelFilterQuery;
  range?: DateRange;
}): Promise<{ orders: number; products: number }> {
  const orders = await fetchEveryPage<ShippingDiscrepancy>((page) =>
    fetchShippingDiscrepancies({ ...filter, page, pageSize: SHIP_AUDIT_PAGE })
  );
  if (orders.length === 0) return { orders: 0, products: 0 };
  const products = await fetchEveryPage<ShipDiffProductRow>((page) =>
    fetchShipDiffByProduct({ ...filter, page, pageSize: SHIP_AUDIT_PAGE, sort: "amount", dir: "desc" })
  );

  const orderRows = orders.map((o) => {
    const meta = SHIPPING_DIFF_REASON_META[o.reason];
    // Tách tiền từng đơn (mới có ở TikTok): các cột cộng lại bằng "Shop chịu thêm"; tiền sàn bù mang dấu trừ.
    const partCols: Record<string, number | string> = {};
    for (const c of SHIP_DIFF_PART_COLUMNS) {
      partCols[c.label] = o.parts ? (c.key === "reimbursed" ? -o.parts.reimbursed : o.parts[c.key]) : "";
    }
    return {
      "Mã đơn hàng": o.orderCode,
      "Mã vận đơn": o.trackingCode ?? "",
      Sàn: CHANNEL_LABEL[o.channelName] ?? o.channelName,
      "Gian hàng": o.shopName,
      "Ngày đặt": toDateTimeText(o.createdAt),
      "Ngày quyết toán": o.settledAt ? toDateTimeText(o.settledAt) : "",
      "Sản phẩm": (o.items ?? [])
        .map((it) => `${it.name || it.sku}${it.variation ? ` (${it.variation})` : ""} x${it.quantity}`)
        .join("; "),
      "Nguyên nhân": meta.label,
      "Khiếu nại được": meta.claimable ? "Có" : "Không — chính sách sàn",
      "Phí ship đã được phủ (khách trả + sàn trợ)": o.coveredFee,
      "Phí ship thực tế": o.shippingFeeActual,
      "Shop chịu thêm": -o.discrepancy,
      ...partCols,
      "Bảo đảm phí vận chuyển": o.guaranteeGap ? SHIP_GUARANTEE_GAP_META[o.guaranteeGap].label : "",
      "Trạng thái khiếu nại": SHIP_DISPUTE_LABEL[o.status] ?? o.status,
    };
  });

  // Mỗi nguyên nhân CÓ phát sinh trong kỳ một cột tiền, theo thứ tự chuẩn (ca khiếu nại được trước).
  const present = new Set(products.flatMap((p) => p.reasons.map((r) => r.reason)));
  const reasonCols = SHIPPING_DIFF_REASON_ORDER.filter((r) => present.has(r));
  const productRows = products.map((p) => {
    const row: Record<string, string | number> = {
      "Sản phẩm": p.unattributed ? "Đơn chưa rõ sản phẩm" : p.productName,
      "Mã sản phẩm trên sàn": p.itemId ?? p.sku ?? "",
      Sàn: CHANNEL_LABEL[p.channelName] ?? p.channelName,
      "Gian hàng": p.shopName,
      "Shop chịu thêm": p.amount,
      "Số đơn lệch": p.orders,
      "Trung bình mỗi đơn": p.avgPerOrder,
      "Tổng đơn trong kỳ": p.totalOrders ?? "",
      "Tỷ lệ đơn lệch (%)": p.rate ?? "",
      "Nguyên nhân chính": SHIPPING_DIFF_REASON_META[p.topReason].label,
    };
    for (const r of reasonCols) {
      row[SHIPPING_DIFF_REASON_META[r].label] = p.reasons.find((x) => x.reason === r)?.amount ?? 0;
    }
    return row;
  });

  const { from, to } = rangeToQuery(filter.range);
  const period = from && to ? `${from}_${to}` : "toan_bo";
  downloadSheets(
    [
      {
        rows: orderRows,
        colWidths: [22, 18, 10, 26, 18, 18, 60, 30, 24, 22, 18, 16, ...SHIP_DIFF_PART_COLUMNS.map(() => 18), 26, 18],
        sheetName: "Theo don",
      },
      {
        rows: productRows,
        colWidths: [60, 24, 10, 26, 16, 12, 18, 16, 16, 30, ...reasonCols.map(() => 22)],
        sheetName: "Theo san pham",
      },
    ],
    `hubsell_truy_thu_phi_ship_${period}_${fileStamp()}.xlsx`
  );
  return { orders: orderRows.length, products: productRows.length };
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

/** Xuất Excel theo layout cột TikTok Shop — đủ MỌI cột của TIKTOK_COLUMNS (bảng có thể ẩn cột trống). */
export function exportTiktokPnlToExcel(rows: PnlDetailRow[]) {
  const data = rows.map(toTiktokRow).map((r) => ({
    "Mã đơn": r.base.orderCode,
    "Trạng thái": SHIPPING_LABEL[r.base.shippingStatus] ?? r.base.shippingStatus,
    "Nguồn số": r.provisional ? "Tạm tính (API đơn)" : r.estimated ? "Sàn ước tính (chờ đối soát)" : "Bản kê đã quyết toán",
    Shop: r.base.shopName,
    "Ngày tạo": toDateTimeText(r.base.createdAt),
    "Ngày gửi ĐVVC": r.base.shippedAt ? toDateTimeText(r.base.shippedAt) : "",
    "Khách hàng": r.base.customerName,
    "Chi tiết sản phẩm": pnlItemsText(r.base.items),
    ...Object.fromEntries(
      TIKTOK_COLUMNS.map((c) => [
        c.label,
        c.key === "costSnapshot" ? -Number(r[c.key]) : Number(r[c.key]),
      ])
    ),
    "Loại điều chỉnh": r.adjustmentTypes ?? "",
  }));
  downloadSheet(
    data,
    [22, 14, 22, 22, 18, 18, 20, 40, ...TIKTOK_COLUMNS.map(() => 18), 24],
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

  // Đọc theo CON TRỎ (100 dòng/lượt, không kèm tóm tắt): lượt nào cũng nhẹ như
  // lượt đầu — trước 30/09/2026 mỗi trang backend đọc lại cả kỳ.
  const all: PnlDetailRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await fetchRealizedPnlRows({
      range: filter.range,
      channel,
      status: filter.status,
      lossOnly: filter.lossOnly,
      cursor,
    });
    all.push(...res.rows);
    if (!res.nextCursor || res.rows.length === 0) break;
    cursor = res.nextCursor;
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
 * loạt rồi nhập ngược lại: khi nhập chỉ đọc "Mã SKU", "Giá vốn" và "Gian hàng"
 * (+ "Kênh bán" khi hai gian trùng tên) — mỗi dòng ghi đúng giá của gian đó
 * (giá vốn theo gian, 11/10/2026). Các cột còn lại để người dùng biết mình
 * đang sửa cái gì.
 */
export function exportCostPricesToExcel(items: SkuProduct[]) {
  const rows = items.map((i) => ({
    "Mã SKU": i.sku,
    "Gian hàng": i.shopName,
    "Tên sản phẩm": i.productName,
    "Phân loại": i.variantName ?? "",
    "Kênh bán": CHANNEL_LABEL[i.channelName] ?? i.channelName,
    "Mã SP sàn": i.itemId ?? "",
    "Mã phân loại": i.modelId ?? "",
    "Trạng thái": i.status === "DELISTED" ? "Đã gỡ trên sàn" : "Đang bán",
    "Giá bán": Number(i.sellingPrice),
    "Giá vốn": Number(i.costPrice),
  }));
  downloadSheet(
    rows,
    [18, 24, 40, 26, 12, 16, 16, 16, 14, 14],
    "Gia von",
    `hubsell_gia_von_${fileStamp()}.xlsx`
  );
}

/**
 * File mẫu trống cho người chưa có dữ liệu, kèm ví dụ. "Gian hàng" để trống =
 * áp cho mọi gian có mã đó; ghi tên gian = chỉ gian đó.
 */
export function downloadCostPriceTemplate() {
  const rows = [
    { "Mã SKU": "SH-AO-THUN-M", "Giá vốn": 74000, "Gian hàng": "" },
    { "Mã SKU": "SH-AO-THUN-L", "Giá vốn": 76000, "Gian hàng": "" },
    { "Mã SKU": "SH-AO-THUN-L", "Giá vốn": 82000, "Gian hàng": "Tên gian Mall của bạn" },
  ];
  downloadSheet(
    rows,
    [22, 16, 28],
    "Mau gia von",
    "hubsell_mau_nhap_gia_von.xlsx"
  );
}

/** File mẫu cho BẢNG GIÁ TỰ NHẬP (tab Mapping giá vốn): mã mẫu lẫn mã đầy đủ. */
export function downloadCostRuleTemplate() {
  const rows = [
    { "Mã": "TBSA01", "Giá vốn": 52000, "Ghi chú": "Mã mẫu — áp cho mọi TBSA01-màu-size" },
    { "Mã": "TBSA01-Vàng-XXL", "Giá vốn": 55000, "Ghi chú": "Mã đầy đủ — thắng mã mẫu" },
  ];
  downloadSheet(rows, [24, 14, 44], "Bang gia von", "hubsell_mau_bang_gia_von.xlsx");
}

/**
 * Xuất các SKU KHÔNG KHỚP mã nào khi mapping. Cột "Mã" + "Giá vốn" đúng khuôn
 * file nhập bảng giá — điền giá rồi nhập ngược lại là khép vòng, không gõ lại mã.
 */
export function exportUnmatchedCostSkus(
  items: {
    sku: string;
    productName: string;
    variantName: string | null;
    channelName: string;
    shopName: string;
  }[]
) {
  const rows = items.map((i) => ({
    "Mã": i.sku,
    "Giá vốn": "",
    "Ghi chú": i.variantName ? `${i.productName} — ${i.variantName}` : i.productName,
    "Gian hàng": `${CHANNEL_LABEL[i.channelName] ?? i.channelName} · ${i.shopName}`,
  }));
  downloadSheet(
    rows,
    [26, 14, 50, 28],
    "Chua khop",
    `hubsell_sku_chua_khop_gia_von_${fileStamp()}.xlsx`
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

// ---------- SỐ LIỆU KÊ KHAI KỲ (07/09) ----------

/**
 * Xuất bảng số liệu kê khai của kỳ: mỗi sàn một dòng + dòng TỔNG, đúng các
 * cột seller cần khi điền 01/CNKD (hộ) / 01/GTGT (DN). Cố ý KHÔNG ghi "chỉ
 * tiêu số mấy" — seller/kế toán tự đối chiếu với mẫu tờ khai đang dùng.
 */
export function exportTaxDeclarationToExcel(d: TaxDeclarationResponse) {
  const toRow = (label: string, r: TaxDeclarationRowDTO): Record<string, string | number> => ({
    "Sàn": label,
    "Số đơn": r.orderCount,
    "Đã đối soát": r.settledCount,
    "Chưa đối soát": r.unsettledCount,
    "Tiền hàng": r.grossRevenue,
    "Giảm giá người bán": r.sellerVoucher,
    "Hoàn trả khách": r.refundedAmount,
    "Doanh thu tính thuế": r.taxableRevenue,
    "Trong đó chưa đối soát": r.unsettledTaxableRevenue,
    "Sàn đã khấu trừ (thật)": r.taxWithheldActual,
    "Sàn ước khấu trừ (chưa đối soát)": r.taxWithheldEstimated,
  });
  const rows = d.rows.map((r) => toRow(CHANNEL_LABEL[r.channelName] ?? r.channelName, r));
  rows.push(toRow("TỔNG", d.total));
  rows.push({
    "Sàn": `Ghi chú: kỳ ${d.period.label}, ${d.basis === "delivered" ? "cắt theo ngày sàn báo giao thành công giờ VN, chỉ gồm đơn đã giao" : "cắt theo ngày tạo đơn giờ VN"}; doanh thu tính thuế = tiền hàng − giảm giá người bán − hoàn (không trừ phí sàn/ship). Số khấu trừ thật chỉ có ở đơn đã đối soát; tách GTGT/TNCN theo tỷ lệ 1% : 0,5% (ước chia) — chứng từ khấu trừ sàn cấp là số chính thức. Hạn nộp: ${d.period.deadline.label}.`,
    "Số đơn": "",
    "Đã đối soát": "",
    "Chưa đối soát": "",
    "Tiền hàng": "",
    "Giảm giá người bán": "",
    "Hoàn trả khách": "",
    "Doanh thu tính thuế": "",
    "Trong đó chưa đối soát": "",
    "Sàn đã khấu trừ (thật)": "",
    "Sàn ước khấu trừ (chưa đối soát)": "",
  });
  downloadSheet(
    rows,
    [16, 8, 11, 12, 15, 17, 15, 18, 20, 20, 26],
    "So lieu ke khai",
    `so-lieu-ke-khai-thue_${d.period.key}_${fileStamp()}.xlsx`
  );
}

// ----- BÁO CÁO NHẬP HÀNG (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5) -----

/** Tab Nhà cung cấp › Theo nhà cung cấp — đúng các dòng đang lọc. Cột giá trị chỉ có khi thấy tài chính. */
export function exportSuppliersToExcel(items: SupplierRow[], includeValue: boolean) {
  const rows = items.map((s) => ({
    "Nhà cung cấp": s.name,
    "Số điện thoại": s.phone ?? "",
    "Mã số thuế": s.taxCode ?? "",
    "Địa chỉ": s.address ?? "",
    "Ghi chú": s.note ?? "",
    "Trạng thái": s.isActive ? "Đang dùng" : "Ngừng dùng",
    "Số phiếu nhập": s.voucherCount,
    "Số lượng nhập": s.totalQuantity,
    ...(includeValue ? { "Giá trị nhập": s.totalValue ?? "", "Còn nợ": s.debt ?? 0 } : {}),
    "Lần nhập gần nhất": s.lastImportAt ? toDateTimeText(s.lastImportAt) : "",
  }));
  downloadSheet(
    rows,
    includeValue ? [30, 14, 14, 36, 30, 12, 13, 13, 16, 14, 18] : [30, 14, 14, 36, 30, 12, 13, 13, 18],
    "Nha cung cap",
    `hubsell_nha_cung_cap_${fileStamp()}.xlsx`
  );
}

const PURCHASE_EXPORT_PAGE = 500;
const PURCHASE_EXPORT_MAX_PAGES = 20; // trần 10.000 SKU một tệp

/**
 * Tab Nhà cung cấp › Theo sản phẩm — gom mọi trang, mỗi SKU × nhà cung cấp MỘT dòng (tệp là dữ liệu
 * để lọc / pivot tiếp, nên không gom viên như trên màn hình). Trả về số dòng đã xuất.
 */
export async function exportPurchaseStatsToExcel(params: { search?: string; from?: string; to?: string }): Promise<number> {
  const all: PurchaseStatProduct[] = [];
  for (let page = 1; page <= PURCHASE_EXPORT_MAX_PAGES; page++) {
    const res = await fetchPurchaseStatsByProduct({ ...params, page, pageSize: PURCHASE_EXPORT_PAGE });
    all.push(...res.items);
    if (page >= res.pageCount) break;
  }
  const rows = all.flatMap((p) =>
    p.suppliers.map((s) => ({
      "Mã SKU": p.skuCode,
      "Tên sản phẩm": p.productName,
      "Phân loại": p.variantName ?? "",
      "Nhà cung cấp": s.supplierName ?? "(chưa ghi nhà cung cấp)",
      "Số lượng nhập": s.quantity,
      "Số phiếu": s.voucherCount,
      "Giá gần nhất": s.lastPrice ?? "",
      "Ngày nhập giá đó": s.lastPriceAt ? toDateTimeText(s.lastPriceAt) : "",
      "Giá TB của nhà này": s.avgPrice ?? "",
      "Giá nhập TB của SKU": p.avgPrice ?? "",
      "Giá vốn đang dùng": p.costPrice ?? "",
    }))
  );
  if (rows.length === 0) return 0;
  downloadSheet(rows, [18, 40, 16, 28, 13, 9, 13, 18, 16, 18, 16], "Gia nhap", `hubsell_gia_nhap_theo_san_pham_${fileStamp()}.xlsx`);
  return rows.length;
}
