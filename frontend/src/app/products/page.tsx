"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BellRing,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCheck,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  Download,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  PackageOpen,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/shell/app-shell";
import { Money } from "@/components/ui/money";
import { AdjustStockDialog } from "@/components/products/adjust-stock-dialog";
import { SkuSettingsDialog } from "@/components/products/sku-settings-dialog";
import { BulkStockSettingsDialog } from "@/components/products/bulk-stock-settings-dialog";
import {
  STOCK_VALUE_SHOW,
  StockValueAmount,
  StockValueSubline,
  groupStockValue,
  stockValueOf,
} from "@/components/products/stock-value";
import { SetupGuide, type ChannelProductCounts } from "@/components/products/setup-guide";
import { OneClickLinkDialog } from "@/components/products/one-click-link-dialog";
import { InlineStockEditor } from "@/components/products/inline-stock-editor";
import { ChannelLinksPopover } from "@/components/products/channel-links-popover";
import { PrintLabelsDialog } from "@/components/products/print-labels-dialog";
import {
  AWAITING_SHIP_GROUP_TITLE,
  AWAITING_SHIP_SHOW,
  AwaitingShip,
  awaitingShipTitle,
  groupAwaitingShip,
} from "@/components/products/awaiting-ship";
import { ImportExcelDialog } from "@/components/products/import-excel-dialog";
import { InventoryLogTable } from "@/components/products/inventory-log-table";
import { StockVoucherTable } from "@/components/products/stock-voucher-table";
import { SuppliersTab } from "@/components/products/suppliers/suppliers-tab";
import { ProductBulkBar } from "@/components/products/product-bulk-bar";
import { ProductHistoryDialog } from "@/components/products/product-history-dialog";
import { ProductRowMenu } from "@/components/products/product-row-menu";
import { StockLevelsCell } from "@/components/products/stock-levels-cell";
import { StockLocationsDialog } from "@/components/products/stock-locations-dialog";
import { StockTransferDialog } from "@/components/products/stock-transfer-dialog";
import { SyncAlertBanner } from "@/components/products/sync-alert-banner";
import { LocationSelect } from "@/components/products/location-select";
import { CopyFromChannelDialog } from "@/components/products/copy-from-channel-dialog";
import {
  SyncSettingsDialog,
  type SyncHeaderState,
} from "@/components/products/sync-settings-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeaderBand, PageTabs, type PageTabItem } from "@/components/ui/page-tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchChannelProducts,
  fetchChannels,
  fetchProducts,
  fetchStockLocations,
  fetchSyncSettings,
  getStoredUser,
  getToken,
  type Channel,
  type Product,
  type ProductStatusFilter,
  type StockLocation,
} from "@/lib/api";
import { exportAllProducts } from "@/lib/excel";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { CHANNEL_META } from "@/lib/channel-meta";
import { locationLabel } from "@/lib/stock-locations";
import { formatNumber } from "@/lib/format";
import { can, canManageShop, canSeeFinancials } from "@/lib/permissions";
import { TEXT_NUMBER_MUTED, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

// 20 / 50 / 100 dòng/trang — chuẩn bảng số liệu (anh Trung 24/09); nhớ lựa chọn theo trình duyệt.
const PAGE_SIZES = [20, 50, 100];
const PAGE_SIZE_KEY = "hubsell_products_page_size";
function readPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(n) ? n : 20;
  } catch {
    return 20;
  }
}

const columnHelper = createColumnHelper<Product>();

/**
 * Bề rộng cột bảng Tồn kho (table-fixed, % của bảng). Cột Nhập · Xuất cố định theo
 * rem để 3 nút icon không bao giờ bị cắt; phần % còn dư chia cho các cột không ghi.
 */
const COL_HEAD_CLASS: Record<string, string> = {
  select: "w-10",
  product: "w-[20%]",
  // Cột MÃ = mã SKU (dòng trên) + mã vạch quản lý 13 số kèm nút in (dòng dưới), phải đọc ĐỦ trên MỘT
  // dòng: mã vạch cỡ 11px (86px) + khe 2px + nút in 14px = 102px. 13% + đệm px-2 (xem CELL_PAD) cho
  // 114px chữ ở bảng 1.000px khi không có cột Vị trí. CÓ cột Vị trí thì tổng % vượt 100, mọi cột bị
  // ép: đo 05/11 bảng 1.060px cột này còn 125px (109px chữ) → cỡ 12px rớt dòng, cỡ 11px vừa; bảng
  // tối thiểu 1.040px (xem TABLE_MIN_W) giữ hai cột tiền ≥ 95px như trước. Mã SKU dài tự xuống
  // dòng sau dấu gạch chứ không cắt. Trước 05/11 cột 9% đệm 16px chỉ còn 58px chữ.
  skuCode: "w-[13%] px-2",
  // Tiền: "1.294.000 ₫" cần ≥ 84px chữ → 10% của bảng tối thiểu 1.000px (soi 22/10 tối với
  // dữ liệu khoảng giá + giá 7 chữ số; trước đó 9% làm số tràn sang cột Tồn kho ở 1280).
  costPrice: "w-[10%]",
  sellingPrice: "w-[10%]",
  // Tồn kho: viên "9.998" ≈ 62px (bút chì chỉ hiện khi rê) → 8,5%; ở 7% viên (có bút chì) tràn
  // 28px sang Có thể bán tại 1280. TỔNG % giữ 88 — tăng tổng là hai cột tiền bị ép và tràn.
  quantityInStock: "w-[8.5%]",
  // Đệm px-2 (11/11/2026): dòng nhỏ "xe tải + số chờ giao" dưới số Có thể bán cần 54px chữ, đệm mặc
  // định 16px chỉ còn 43px ở bảng 1.000px. Nội dung ô căn giữa nên số chính không xê dịch.
  availableToSell: "w-[7.5%] px-2",
  // Chờ giao (11/11/2026): cố định theo rem như Giá trị tồn để KHÔNG ăn vào % các cột đã đo. Tiêu đề
  // "Chờ giao" 12px ≈ 50px, số "9.998" ≈ 38px → 4.75rem (76px) với đệm px-2 còn 60px chữ. Khung bảng
  // hẹp thì cột ẩn, số thành dòng nhỏ dưới Có thể bán (xem AWAITING_SHIP_SHOW).
  awaitingShip: "w-[4.75rem] px-2",
  // Vị trí: "Kho chính  20" cần ≥ 80px chữ (tên 55 + khe 8 + số) → 12% của 1.000px; ở 9% (22/10
  // xem prod) ô "Kho chính" chỉ còn 29px chữ, tên cụt "K…" và số từng tràn sang cột Bán trên.
  locations: "w-[12%]",
  // Bán trên: chip "Shopee ×3" tự xuống dòng nên nhường 1% được. Đệm ngang px-2 (ô + tiêu đề, xem
  // CELL_PAD): ở 1280 cột 110px, đệm mặc định 16px chỉ còn 78px chữ — chip có biểu tượng
  // trạng thái "TikTok ×1 ⊗" cần 87px, "Shopee ×9 ⊗" cần 94px (đo 05/11).
  channels: "w-[11%] px-2",
  // Giá trị tồn = tồn × giá vốn (09/11/2026). Cố định theo rem như cột Nhập · Xuất để KHÔNG ăn vào
  // % của các cột đã đo: "298.400.000 ₫" (mẫu 2.984 chiếc × 100.000 ₫) cần ~93px chữ → 7rem (112px)
  // với đệm px-2 còn 96px chữ. Từ 1 tỷ trở lên ô tự hạ cỡ chữ (xem cột stockValue).
  stockValue: "w-[7rem] px-2",
  actions: "w-[8.5rem]",
};

/** Bề rộng tối thiểu của bảng: có cột Vị trí thì rộng hơn 40px bù cho cột mã (xem COL_HEAD_CLASS.skuCode). */
const TABLE_MIN_W = { plain: "min-w-[1000px]", withLocations: "min-w-[1040px]" } as const;

/** Đệm ngang riêng của Ô theo cột — phải khớp với tiêu đề cột ở COL_HEAD_CLASS. */
const CELL_PAD: Record<string, string> = {
  skuCode: "px-2",
  channels: "px-2",
  stockValue: "px-2",
  availableToSell: "px-2",
  awaitingShip: "px-2",
};

type HubTab = "inventory" | "logs" | "vouchers" | "suppliers";

/**
 * ⛔ TẠM ẨN 05/11/2026 (anh Trung, nâng cấp Quản lý kho): khối "Kho trung tâm Hubsell"
 * (dải kể chuyện Shop A/B/C + 3 bước kéo SP → nối SKU → bật đồng bộ, setup-guide.tsx)
 * KHÔNG hiện nữa — anh chưa quyết xóa hẳn hay làm lại nên giữ mã, chỉ tắt cờ.
 * Ba việc của khối vẫn có cửa khác: kéo SP về + Tự khớp = trang Sản phẩm trên sàn;
 * bật đồng bộ = nút "Đồng bộ tồn kho" trên thanh công cụ (thêm cùng ngày, trước đó
 * nút này chỉ nằm trong đầu khối). Nhắc anh quyết ~19/11/2026 — xem
 * docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 2. Xóa hẳn = bỏ cờ này, setup-guide.tsx,
 * hub-story-strip.tsx, state counts/channels/syncState chỉ còn nuôi dòng trống bảng.
 */
const SHOW_SETUP_GUIDE: boolean = false;

/** Mục trong các menu thả của thanh công cụ (Tạo sản phẩm kho / Nhập – Xuất – Kiểm kê / Excel). */
const MENU_ITEM =
  "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50";

/** Một MẪU hàng trên bảng = các SKU kho cùng khóa cha–con (backend xếp liền nhau). */
interface ProductGroupRows {
  key: string;
  name: string;
  imageUrl: string | null;
  rows: Product[];
}

/** Ảnh sản phẩm 36px (lấy từ sàn khi tạo SKU); chưa có ảnh / ảnh hỏng thì ô xám có icon. */
function ProductThumb({ src, alt }: { src: string | null; alt: string }) {
  // Link ảnh sàn hết hạn (Shopee đổi CDN) → không hiện khung vỡ, về ô icon.
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="size-9 shrink-0 rounded-md object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  ) : (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <ImageIcon className="size-4" />
    </div>
  );
}

/** Ô tích của dòng cha: chọn cả mẫu; đang chọn một phần thì gạch ngang (indeterminate). */
function GroupCheckbox({
  label,
  checked,
  indeterminate,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      className="size-4 cursor-pointer align-middle accent-primary"
    />
  );
}

/**
 * HUB "HÀNG HÓA" — một trang cho toàn bộ vòng đời hàng hóa của seller, thay ba
 * trang cũ (Kho vật lý / Liên kết sản phẩm / Đồng bộ tồn kho). Sắp xếp BA TẦNG
 * từ trên xuống (anh Trung 06/09: seller mới phải biết bắt đầu từ đâu):
 *
 *   1. NGUYÊN LÝ + VIỆC PHẢI LÀM — khối "Kho trung tâm Hubsell" (setup-guide):
 *      dải kể chuyện Kho ↔ Shop A/B/C rồi 3 bước (kéo SP từ sàn → nối SKU →
 *      bật đồng bộ), mỗi bước một nút. Tự thu gọn khi đã xong.
 *   2. BẢNG LÀM VIỆC — tab TỒN KHO: bảng SKU kho + cột "Bán trên" (các gian đã
 *      nối, chip đổi màu khi lệch tồn) — bấm chip mở hộp nhỏ từng gian, CHỈ XEM
 *      (05/11/2026 anh Trung bỏ dòng bung sơ đồ kho ↔ gian: nối / gỡ nối là việc
 *      của trang Sản phẩm trên sàn). Cảnh báo lệch tồn ngay trên bảng, chỉ hiện khi có lỗi.
 *   3. Tab SẢN PHẨM TRÊN SÀN (chỉ chủ shop): tầng đệm ChannelProduct để nối tay
 *      từng dòng / theo lô; cùng một hộp "Tự khớp + tạo SKU" với bước 2.
 *   4. Tab NHẬT KÝ KHO (24/09): sổ biến động toàn shop — vì sao tồn đổi, ai làm,
 *      đơn nào trừ. Chỉ gọi API khi mở tab. Từng SKU có "Lịch sử kho" trong menu ⋯.
 *
 * 24/09: SKU có thể NGỪNG KINH DOANH (ẩn khỏi bảng, giữ đơn cũ + liên kết) —
 * chip "Ngừng bán N" chỉ hiện khi N > 0; phiếu nhập/xuất NHIỀU MÃ là trang riêng
 * /products/receive. Thanh tab chuyển sang PageTabs + PageHeaderBand (chuẩn 19/09).
 *
 * 05/11/2026 — TÁCH HUB (anh Trung, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md): trang này là
 * "TỔNG KHO" trên sidebar (tab Tồn kho + Nhật ký kho); tab Sản phẩm trên sàn thành
 * trang riêng /products/marketplace (mục sidebar cạnh dưới). Tầng 1 (khối 3 bước)
 * TẠM ẨN — xem SHOW_SETUP_GUIDE. NỐI MỘT CHIỀU (05/11 tối): Tổng kho không còn nút
 * nối gian nào — nối chỉ làm ở trang Sản phẩm trên sàn (sản phẩm sàn nối VÀO Tổng kho).
 *
 * Route cũ /warehouse/sync redirect về đây (?sync=1); /mappings và ?tab=links →
 * /products/marketplace.
 */
export default function ProductsHubPage() {
  const router = useRouter();
  const isAdmin = canManageShop(getStoredUser());

  const [tab, setTab] = useState<HubTab>("inventory");
  // Bấm một nhà cung cấp ở tab Nhà cung cấp → sang Phiếu kho lọc sẵn theo nhà đó (05/11, mục 5).
  const [voucherSupplier, setVoucherSupplier] = useState<{ id: string; name: string } | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => {
    setPageSize(readPageSize());
  }, []);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  // Đang bán (mặc định) / Ngừng bán — chip chỉ hiện khi có SKU ngừng bán.
  const [status, setStatus] = useState<ProductStatusFilter>("active");
  // Lọc HẾT HÀNG (tồn ≤ 0) — khách shop váy 22/10 xin; chip bật/tắt, kết hợp với Đang bán / Ngừng bán.
  const [stockFilter, setStockFilter] = useState<"all" | "out">("all");
  // Lọc theo vị trí chứa hàng (anh Trung 24/09) — "" = mọi vị trí.
  const [locationFilter, setLocationFilter] = useState("");
  // SKU đang mở hộp Lịch sử kho.
  const [history, setHistory] = useState<Product | null>(null);

  // Ô TÍCH đầu dòng (anh Trung 24/09): chọn nhiều để ngừng / bán lại / xóa hàng
  // loạt. Giữ cả object để thanh xử lý biết SKU nào đang bán / ngừng; đổi
  // trang, bộ lọc, tìm kiếm thì xóa lựa chọn (tránh xóa nhầm dòng không còn thấy).
  const [selected, setSelected] = useState<Map<string, Product>>(new Map());
  const selectAllRef = useRef<HTMLInputElement>(null);

  // VỊ TRÍ CHỨA HÀNG (đợt B): rỗng = shop chưa dùng, giao diện y hệt cũ (ẩn bằng
  // sự vắng mặt — không công tắc cài đặt). Cột "Vị trí" + ô chọn vị trí chỉ
  // xuất hiện khi có ≥ 1 vị trí.
  const locationsQ = useApiQuery({
    queryKey: qk.stockLocations(),
    queryFn: fetchStockLocations,
  });
  const locations: StockLocation[] = locationsQ.data?.items ?? [];
  const locationsEnabled = locations.length > 0;
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [transfer, setTransfer] = useState<{ product: Product; fromId?: string } | null>(null);

  // Số liệu nuôi khối Thiết lập kho + badge tab (chỉ chủ shop): đếm SP sàn,
  // gian hàng đang hoạt động. `guideReady` = đã tải xong lượt đầu để khối quyết
  // định bung/thu, tránh nháy.
  const [counts, setCounts] = useState<ChannelProductCounts | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [guideReady, setGuideReady] = useState(!isAdmin);
  const unlinkedCount = counts?.unlinked ?? 0;

  // Hộp "Tự khớp + tạo SKU" — mở từ bước 2 hoặc từ dòng trống của bảng.
  const [oneClickOpen, setOneClickOpen] = useState(false);
  // Menu "Tạo sản phẩm kho" (05/11): Tạo mới / Sao chép từ sàn — mục sau theo lá quyền của trang đó.
  const [createOpen, setCreateOpen] = useState(false);
  const canCopyListing = can(getStoredUser(), "operations.copy-listing");
  // Hộp chọn MỘT sản phẩm trên gian → /products/new?fromChannel=&item= (docs SAO-CHEP-SAN-PHAM mục 34).
  const [copyOpen, setCopyOpen] = useState(false);
  // 05/11/2026 (anh Trung: "một hàng 9 món khó nhìn, màn nhỏ khó thao tác"): thanh công cụ còn 4 nút —
  // việc tuần (Phiếu nhiều mã / Kiểm kê / Cất lên kệ / Vị trí) gom vào menu "Nhập – Xuất – Kiểm kê",
  // Nhập / Xuất Excel gom vào menu "Excel". Tên menu trùng mục sidebar dự kiến (docs QUAN-LY-KHO mục 3)
  // để khi tách trang riêng chỉ việc dời đi.
  const [opsOpen, setOpsOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Trạng thái đồng bộ tồn theo gian (chỉ chủ shop) — bước 3 + header khối.
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncHeaderState | null>(null);

  // Hộp "In mã vạch": mở từ nút máy in cạnh mã vạch (một mã) hoặc thanh hàng loạt (nhiều mã).
  const [printing, setPrinting] = useState<Product[] | null>(null);

  const [adjusting, setAdjusting] = useState<{
    product: Product;
    type: "IMPORT" | "EXPORT";
  } | null>(null);
  // SKU đang mở hộp cài đặt riêng (ngưỡng cảnh báo + tồn an toàn).
  const [skuSettings, setSkuSettings] = useState<Product | null>(null);
  // Cài nhanh cảnh báo + tồn an toàn cho các SKU đang tích (09/11/2026).
  const [bulkSettingsOpen, setBulkSettingsOpen] = useState(false);

  // Danh sách SKU kho nằm trong cache React Query — quay lại hub Hàng hóa là
  // thấy ngay bảng cũ, refetch chạy ngầm (401/403/409 hook tự xử).
  // Bảng CHA–CON (22/10/2026, khách muốn giống bảng Giá vốn): backend phân trang
  // theo MẪU hàng (view=grouped), các phân loại của một mẫu luôn về cùng trang.
  const productsQ = useApiQuery({
    queryKey: qk.products({ page, pageSize, search, status, stockFilter, locationFilter, view: "grouped" }),
    queryFn: () =>
      fetchProducts({
        page,
        pageSize,
        search,
        status,
        stock: stockFilter === "out" ? "out" : undefined,
        locationId: locationFilter || undefined,
        view: "grouped",
        awaiting: true,
      }),
  });
  const inactiveCount = productsQ.data?.inactiveCount ?? 0;
  const outOfStockCount = productsQ.data?.outOfStockCount ?? 0;
  const invalidate = useInvalidate();
  const items = useMemo(() => productsQ.data?.items ?? [], [productsQ.data]);
  // Gom dòng theo khóa cha–con backend đã xếp liền nhau: mẫu có ≥ 2 phân loại
  // thành một dòng cha (ảnh + tên + tổng tồn) bung ra các dòng con (từng phân loại).
  const groups = useMemo<ProductGroupRows[]>(() => {
    const map = new Map<string, ProductGroupRows>();
    const order: ProductGroupRows[] = [];
    for (const p of items) {
      const key = p.groupKey ?? p.id;
      let g = map.get(key);
      if (!g) {
        g = { key, name: p.productName, imageUrl: p.imageUrl ?? null, rows: [] };
        map.set(key, g);
        order.push(g);
      }
      if (!g.imageUrl && p.imageUrl) g.imageUrl = p.imageUrl;
      g.rows.push(p);
    }
    return order;
  }, [items]);
  // Tổng phân loại THẬT của mẫu (backend trả khi đang lọc hết hàng / tìm kiếm): mẫu 6
  // phân loại mà chỉ 1 khớp vẫn là dòng cha "1/6 phân loại", không thành sản phẩm đơn.
  const groupTotals = useMemo(() => productsQ.data?.groupTotals ?? {}, [productsQ.data]);
  const groupTotalOf = useCallback(
    (g: ProductGroupRows) => Math.max(groupTotals[g.key] ?? 0, g.rows.length),
    [groupTotals]
  );
  // Id các dòng CON (thuộc mẫu ≥ 2 phân loại) — ô "Sản phẩm" của chúng chỉ in phân loại.
  const childIds = useMemo(
    () => new Set(groups.filter((g) => groupTotalOf(g) > 1).flatMap((g) => g.rows.map((p) => p.id))),
    [groups, groupTotalOf]
  );
  const multiGroupKeys = useMemo(
    () => groups.filter((g) => groupTotalOf(g) > 1).map((g) => g.key),
    [groups, groupTotalOf]
  );
  // Mẫu đang bung. Mặc định thu gọn (bảng ngắn, dòng cha đã có tổng tồn); đang
  // TÌM KIẾM thì bung hết — khách tìm là để xem đúng phân loại đó.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (search) setOpenGroups(new Set(multiGroupKeys));
  }, [search, multiGroupKeys]);
  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const allGroupsOpen = multiGroupKeys.length > 0 && multiGroupKeys.every((k) => openGroups.has(k));
  const total = productsQ.data?.total ?? 0;
  const skuTotal = productsQ.data?.skuTotal ?? total;
  const pageCount = productsQ.data?.pageCount ?? 0;
  // Khối Kho trung tâm đếm SKU ĐANG BÁN toàn shop — không đổi theo chip lọc /
  // ô tìm (backend cũ chưa trả activeCount thì rơi về total như trước).
  const activeTotal = productsQ.data?.activeCount ?? total;

  useEffect(() => {
    setSelected(new Map());
  }, [page, search, status, stockFilter, tab, locationFilter]);
  const pageIds = items.map((p) => p.id);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allOnPage = items.length > 0 && selectedOnPage === items.length;
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedOnPage > 0 && !allOnPage;
    }
  }, [selectedOnPage, allOnPage]);
  const toggleOne = useCallback((p: Product) => {
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
  }, []);
  const toggleAllOnPage = useCallback(() => {
    setSelected((cur) => {
      const next = new Map(cur);
      if (items.every((p) => next.has(p.id))) items.forEach((p) => next.delete(p.id));
      else items.forEach((p) => next.set(p.id, p));
      return next;
    });
  }, [items]);
  const loading = productsQ.refreshing;
  const error = productsQ.error;

  // Gọi sau mọi thao tác GHI (tạo SKU, nhập Excel, nối/gỡ liên kết, chỉnh
  // tồn): làm tươi mọi trang cache.
  const load = useCallback(() => {
    invalidate(["products"]);
    invalidate(["inventory-logs"]);
    invalidate(["stock-locations"]);
  }, [invalidate]);

  /** Đếm SP sàn (all/linked/unlinked) — badge tab + bước 1, 2 của khối thiết lập. */
  const loadCounts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetchChannelProducts({ page: 1, pageSize: 1 });
      setCounts(res.counts);
    } catch {
      // chưa có kênh / lỗi mạng — badge để 0, không chặn trang
    }
  }, [isAdmin]);

  /** Trạng thái đồng bộ tồn theo gian — bước 3 + header khối thiết lập. */
  const loadSyncState = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const s = await fetchSyncSettings();
      setSyncState({
        enabledCount: s.enabledCount,
        totalChannels: s.channels.length,
        pending: s.pendingJobs,
      });
    } catch {
      // không có thì bước 3 hiện "Đang kiểm tra…", không chặn trang
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (isAdmin) {
      // Tải song song ba nguồn của khối thiết lập rồi mới cho khối quyết định
      // bung/thu — tránh nháy "bung rồi thu" khi seller đã xong.
      Promise.allSettled([
        loadCounts(),
        loadSyncState(),
        fetchChannels()
          .then((cs) => setChannels(cs.filter((c) => c.status === "ACTIVE")))
          .catch(() => {}),
      ]).then(() => setGuideReady(true));
    }
    // Route cũ redirect về kèm query: ?tab=links mở tab liên kết, ?sync=1 mở
    // dialog cài đặt. Đọc một lần lúc mount — không cần useSearchParams.
    const params = new URLSearchParams(window.location.search);
    // ?tab=links = link cũ tới tab Sản phẩm trên sàn (05/11/2026 đã thành trang riêng).
    if (params.get("tab") === "links") {
      router.replace("/products/marketplace");
      return;
    }
    if (params.get("tab") === "logs") setTab("logs");
    if (params.get("tab") === "vouchers") setTab("vouchers");
    if (params.get("tab") === "suppliers") setTab("suppliers");
    if (params.get("sync") === "1" && canManageShop(getStoredUser())) {
      setSyncOpen(true);
    }
    // Deep-link từ thẻ cảnh báo sắp hết hàng / chuông: ?search=SKU mở đúng dòng.
    const q = params.get("search")?.trim();
    if (q) {
      setSearchInput(q);
      setSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đang xem "Ngừng bán" mà bán lại hết → tự về "Đang bán", không để lại
  // bảng trống với chip 0 (chip cũng tự biến mất vì inactiveCount = 0).
  useEffect(() => {
    if (status === "inactive" && productsQ.data && inactiveCount === 0) {
      setStatus("active");
      setPage(1);
    }
  }, [status, inactiveCount, productsQ.data]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportAllProducts(seesCost);
      if (count === 0) {
        toast.info("Chưa có sản phẩm nào để xuất");
      } else {
        toast.success(`Đã xuất ${count} sản phẩm ra file Excel`);
      }
    } catch {
      toast.error("Không xuất được file Excel");
    } finally {
      setExporting(false);
    }
  }

  // Nhân viên không được biết giá vốn — backend đã cắt trường, bỏ luôn cột.
  const seesCost = canSeeFinancials(getStoredUser());
  // Cột Giá trị tồn hiện / ẩn theo bề rộng khung bảng — xem components/products/stock-value.tsx.
  const { column: valueColShow, subline: valueSublineShow } =
    STOCK_VALUE_SHOW[locationsEnabled ? "withLocations" : "plain"];
  // Cột Chờ giao cũng co theo khung bảng; người không thấy giá vốn không có cột Giá trị tồn nên đủ chỗ sớm hơn.
  const { column: awaitColShow, subline: awaitSublineShow } =
    AWAITING_SHIP_SHOW[
      locationsEnabled
        ? seesCost
          ? "withLocationsAndValue"
          : "withLocations"
        : seesCost
          ? "plainWithValue"
          : "plain"
    ];
  // Cột nào ẩn / hiện theo bề rộng khung bảng (tiêu đề + ô dùng chung).
  const colShow: Record<string, string> = { stockValue: valueColShow, awaitingShip: awaitColShow };

  const columns = useMemo(
    () => [
      ...(isAdmin
        ? [
            columnHelper.display({
              id: "select",
              header: () => (
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Chọn tất cả SKU trên trang"
                  checked={allOnPage}
                  onChange={toggleAllOnPage}
                  className="size-4 cursor-pointer align-middle accent-primary"
                />
              ),
              cell: ({ row }) => (
                <input
                  type="checkbox"
                  aria-label={`Chọn ${row.original.skuCode}`}
                  checked={selected.has(row.original.id)}
                  onChange={() => toggleOne(row.original)}
                  className="size-4 cursor-pointer align-middle accent-primary"
                />
              ),
            }),
          ]
        : []),
      // 22/10/2026 (khách phàn nàn 6 phân loại váy cùng tên): cột SẢN PHẨM lên
      // ĐẦU — ảnh + tên cắt ngắn (rê chuột đủ tên) + phân loại màu/size + mã sản
      // phẩm sàn; mã SKU kho lùi sang cột 2. Dòng CON của một mẫu chỉ in phân loại
      // (tên + ảnh đã ở dòng cha, như bảng Giá vốn).
      columnHelper.accessor("productName", {
        id: "product",
        header: "Sản phẩm",
        cell: ({ row }) => {
          const p = row.original;
          const inactive = p.isActive === false;
          const badge = inactive ? (
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              Ngừng bán
            </span>
          ) : null;
          if (childIds.has(p.id)) {
            return (
              <div className="flex min-w-0 items-center gap-2 pl-9">
                <span
                  className={cn(
                    "min-w-0 truncate text-sm font-medium text-sky-800",
                    inactive && "text-muted-foreground line-through decoration-slate-300"
                  )}
                  title={p.variantName ?? p.productName}
                >
                  {p.variantName ?? "—"}
                </span>
                {badge}
              </div>
            );
          }
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Chừa chỗ bằng nút bung của dòng cha để ảnh + tên sản phẩm đơn THẲNG HÀNG với
                  sản phẩm nhiều phân loại (anh Trung 22/10 tối). */}
              <span className="size-6 shrink-0" aria-hidden />
              <ProductThumb src={p.imageUrl ?? null} alt={p.productName} />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate font-medium",
                    inactive && "text-muted-foreground line-through decoration-slate-300"
                  )}
                  title={p.productName}
                >
                  {p.productName}
                </span>
                {p.variantName && (
                  <span className="block truncate text-xs font-medium text-sky-700" title={p.variantName}>
                    {p.variantName}
                  </span>
                )}
              </div>
              {badge}
            </div>
          );
        },
      }),
      // HAI MÃ CỦA SẢN PHẨM KHO (anh Trung 05/11/2026: sản phẩm Tổng kho là sản phẩm RIÊNG):
      //   · mã SKU — mã để KHỚP VỚI SÀN (khách đặt cùng mã trên mọi gian);
      //   · mã vạch quản lý — mã để KHO QUÉT / in tem, 13 số hệ thống tự sinh (sửa ở ⋯ › Cài đặt SKU).
      // KHÔNG bày mã sản phẩm / mã phân loại của sàn ở đây nữa (bản 28/09) — mã sàn nằm trong hộp nhỏ
      // "Bán trên", cạnh từng gian.
      columnHelper.accessor("skuCode", {
        header: () => (
          <span className="block leading-tight">
            Mã SKU
            <span className="block font-normal text-muted-foreground">Mã vạch</span>
          </span>
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <span
              className="block font-mono text-sm leading-tight font-medium whitespace-normal [overflow-wrap:anywhere]"
              title={`Mã SKU: ${row.original.skuCode}`}
            >
              {row.original.skuCode}
            </span>
            {row.original.barcode && (
              <span className="mt-0.5 flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground">
                <span
                  className="min-w-0 whitespace-normal select-all [overflow-wrap:anywhere]"
                  title={`Mã vạch quản lý: ${row.original.barcode} — kho quét mã này`}
                >
                  {row.original.barcode}
                </span>
                {/* Nút in NGAY CẠNH mã vạch (anh Trung 05/11) — mở hộp chọn khổ tem + số tem. */}
                <button
                  type="button"
                  onClick={() => setPrinting([row.original])}
                  aria-label={`In mã vạch ${row.original.skuCode}`}
                  title="In mã vạch"
                  className="flex size-3.5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <Printer className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        ),
      }),
      ...(seesCost
        ? [
            columnHelper.accessor("costPrice", {
              // Giá vốn theo gian (11/10/2026): giá ở kho là MẶC ĐỊNH cho các gian
              // chưa đặt giá riêng ở trang Cấu hình Giá vốn.
              header: () => (
                <div
                  className="text-right"
                  title="Gian nào chưa đặt giá vốn riêng (trang Cấu hình Giá vốn) thì dùng giá này"
                >
                  Giá vốn
                </div>
              ),
              cell: (info) => (
                <div className="text-right">
                  <Money value={info.getValue() ?? 0} className={TEXT_NUMBER_MUTED} />
                </div>
              ),
            }),
          ]
        : []),
      columnHelper.accessor("sellingPrice", {
        header: () => <div className="text-right">Giá bán</div>,
        cell: (info) => (
          <div className="text-right">
            <Money value={info.getValue()} className="text-slate-900" />
          </div>
        ),
      }),
      columnHelper.accessor("quantityInStock", {
        header: () => <div className="text-center">Tồn kho</div>,
        // Bấm vào số là sửa trực tiếp (Enter lưu) — màu theo ngưỡng cảnh báo của SKU.
        cell: ({ row }) => (
          <>
            <InlineStockEditor
              product={row.original}
              low={row.original.isLowStock ?? false}
              threshold={row.original.lowStockThresholdEffective ?? 0}
              editable
              onSaved={load}
            />
            {seesCost && <StockValueSubline value={stockValueOf(row.original)} className={valueSublineShow} />}
          </>
        ),
      }),
      // ===== CÓ THỂ BÁN — số Hubsell đẩy lên MỌI gian đã nối (trung tâm điều
      // tiết): tồn − đang giữ − tồn an toàn. Đây là con số khách phải tin. =====
      columnHelper.display({
        id: "availableToSell",
        header: () => <div className="text-center">Có thể bán</div>,
        cell: ({ row }) => {
          const p = row.original;
          const qty = p.quantityInStock;
          const held = p.holdQuantity ?? 0;
          const safety = p.safetyStockEffective ?? 0;
          const available = p.availableToSell ?? Math.max(0, qty - held - safety);
          const linked = (p.channelLinks ?? []).length > 0;
          return (
            <div
              className="text-center"
              title={`Tồn ${formatNumber(qty)} − giữ ${formatNumber(held)} − an toàn ${formatNumber(safety)} = ${formatNumber(available)}${linked ? " — số này được đẩy lên mọi gian đã nối" : ""}`}
            >
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  available === 0 ? "text-rose-700" : "text-foreground"
                )}
              >
                {formatNumber(available)}
              </span>
              {safety > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">an toàn {formatNumber(safety)}</p>
              )}
              <AwaitingShip
                quantity={p.awaitingShip ?? 0}
                title={awaitingShipTitle(p)}
                variant="subline"
                className={awaitSublineShow}
              />
            </div>
          );
        },
      }),
      // ===== CHỜ GIAO (11/11/2026, khách xin "đơn đang ra 10 con thì hiện 10 con bị giữ lại") — đã trừ
      // khỏi Tồn kho cho đơn đã chốt, chưa giao ship. Đứng SAU Có thể bán: nó không nằm trong phép
      // "Tồn − giữ − an toàn = Có thể bán". Chỉ là con số + chú thích; đơn xem ở trang Đơn hàng. =====
      columnHelper.display({
        id: "awaitingShip",
        header: () => (
          <div
            className="text-center"
            title="Hàng của đơn đã chốt nhưng chưa giao cho đơn vị vận chuyển. Đã trừ khỏi Tồn kho, hàng vẫn còn trong kho."
          >
            Chờ giao
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-center">
            <AwaitingShip quantity={row.original.awaitingShip ?? 0} title={awaitingShipTitle(row.original)} />
          </div>
        ),
      }),
      // ===== CỘT MỚI: BÁN TRÊN — trái tim của hub. Gom chip theo sàn + badge
      // lệch tồn; bấm vào là bung chi tiết từng gian ngay dưới dòng. =====
      // "ĐANG Ở" (đợt B) — chỉ khi shop đã tạo vị trí; xem cột trống là hiểu
      // "chưa có ở đâu", bấm mở chi tiết sửa số / chuyển.
      ...(locationsEnabled
        ? [
            columnHelper.display({
              id: "locations",
              // Trước 09/11/2026 cột này tên "Đang ở" — anh Trung đổi thành "Vị trí".
              header: "Vị trí",
              cell: ({ row }) => (
                <StockLevelsCell
                  product={row.original}
                  locations={locations}
                  editable={true}
                  onTransfer={(fromId) => setTransfer({ product: row.original, fromId })}
                  onSaved={load}
                />
              ),
            }),
          ]
        : []),
      columnHelper.display({
        id: "channels",
        // Câu nguyên lý trước nằm cuối mỗi dòng bung — nay là chú thích của tiêu đề cột.
        header: () => (
          <span title="Gian nào bán 1 chiếc, kho và mọi gian còn lại cùng trừ 1. Nhập kho, mọi gian cùng lên. Cùng một sản phẩm trên nhiều shop thì đặt cùng mã SKU để Hubsell tự khớp.">
            Bán trên
          </span>
        ),
        cell: ({ row }) => {
          const links = row.original.channelLinks ?? [];
          // NỐI MỘT CHIỀU (anh Trung 05/11 tối): việc nối chỉ làm từ sản phẩm sàn (trang Sản phẩm trên sàn)
          // nối VÀO Tổng kho — ở đây không còn nút "Nối gian" hay đường dẫn nối / gỡ nối; cột chỉ để xem.
          if (links.length === 0) return <span className={TEXT_SUB}>Chưa nối</span>;
          // Chip theo sàn, bấm mở hộp nhỏ từng gian (05/11/2026, anh Trung: nối / gỡ nối là việc của
          // trang Sản phẩm trên sàn → bỏ dòng bung sơ đồ kho ↔ gian; ở Tổng kho chỉ còn xem).
          return (
            <ChannelLinksPopover
              links={links}
              available={row.original.availableToSell ?? 0}
              skuCode={row.original.skuCode}
            />
          );
        },
      }),
      // GIÁ TRỊ TỒN (09/11/2026, khách xin) — đứng giữa Bán trên và Nhập · Xuất theo ảnh anh Trung
      // khoanh. Chỉ người thấy giá vốn mới có cột.
      ...(seesCost
        ? [
            columnHelper.display({
              id: "stockValue",
              header: () => (
                <div className="text-right" title="Tồn kho × giá vốn. Tồn âm tính 0.">
                  Giá trị tồn
                </div>
              ),
              cell: ({ row }) => (
                <div className="text-right">
                  <StockValueAmount
                    value={stockValueOf(row.original)}
                    title={`${formatNumber(Math.max(0, row.original.quantityInStock))} × ${formatNumber(Number(row.original.costPrice))} ₫`}
                    emptyTitle="Chưa nhập giá vốn"
                  />
                </div>
              ),
            }),
          ]
        : []),
      columnHelper.display({
        id: "actions",
        header: () => <div className="text-center">Nhập · Xuất</div>,
        // Nút icon (rê chuột có chú thích) để bảng vừa một màn hình 1366 không cuộn ngang.
        cell: ({ row }) => (
          <div className="flex justify-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 text-emerald-700 hover:bg-emerald-50"
              title={`Nhập kho ${row.original.skuCode}`}
              aria-label={`Nhập kho ${row.original.skuCode}`}
              onClick={() => setAdjusting({ product: row.original, type: "IMPORT" })}
            >
              <ArrowDownToLine className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 text-rose-700 hover:bg-rose-50"
              title={`Xuất kho ${row.original.skuCode}`}
              aria-label={`Xuất kho ${row.original.skuCode}`}
              disabled={row.original.quantityInStock === 0}
              onClick={() => setAdjusting({ product: row.original, type: "EXPORT" })}
            >
              <ArrowUpFromLine className="size-4" />
            </Button>
            {/* Việc thỉnh thoảng (lịch sử, cảnh báo, ngừng bán, xóa) gom vào ⋯ (24/09).
                Nút chuông riêng đã bỏ: cột Tồn kho vốn đã ghi "≤ ngưỡng N" khi
                sắp hết, thêm nút thứ tư làm bảng tràn ngang ở 1366/1440. */}
            <ProductRowMenu
              product={row.original}
              isAdmin={isAdmin}
              onHistory={() => setHistory(row.original)}
              onSettings={() => setSkuSettings(row.original)}
              onChanged={load}
            />
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seesCost, isAdmin, locations, selected, allOnPage, toggleAllOnPage, toggleOne, childIds, valueSublineShow, awaitSublineShow]
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount,
  });
  /**
   * DÒNG CHA của một mẫu có ≥ 2 phân loại (22/10/2026, giống bảng Giá vốn): ảnh +
   * tên + mã sản phẩm sàn + "N phân loại"; cột số = TỔNG tồn / có thể bán của các
   * phân loại, giá = khoảng; "Bán trên" = chip theo sàn đếm phân loại đã nối. Bấm
   * dòng để bung/thu các phân loại; ô tích chọn cả mẫu cho thanh xử lý hàng loạt.
   */
  function renderGroupRow(g: ProductGroupRows, open: boolean) {
    const rows = g.rows;
    const selectedCount = rows.filter((p) => selected.has(p.id)).length;
    const qty = rows.reduce((s, p) => s + p.quantityInStock, 0);
    const available = rows.reduce(
      (s, p) =>
        s +
        (p.availableToSell ??
          Math.max(0, p.quantityInStock - (p.holdQuantity ?? 0) - (p.safetyStockEffective ?? 0))),
      0
    );
    const inactiveCount = rows.filter((p) => p.isActive === false).length;
    const lowCount = rows.filter((p) => p.isLowStock).length;
    const { value: groupValue, noCostCount } = groupStockValue(rows);
    const awaitingTotal = groupAwaitingShip(rows);
    const links = rows.flatMap((p) => p.channelLinks ?? []);
    const byChannel = new Map<string, number>();
    for (const l of links) byChannel.set(l.channelName, (byChannel.get(l.channelName) ?? 0) + 1);
    const ORDER = ["SHOPEE", "LAZADA", "TIKTOK"];
    const chips = [...byChannel.entries()].sort(
      (a, b) => ((ORDER.indexOf(a[0]) + 99) % 100) - ((ORDER.indexOf(b[0]) + 99) % 100)
    );
    const range = (nums: number[]) => {
      const v = nums.filter((n) => n > 0);
      if (v.length === 0) return <span className={TEXT_SUB}>—</span>;
      const min = Math.min(...v);
      const max = Math.max(...v);
      // KHOẢNG GIÁ xếp HAI DÒNG (anh Trung 22/10 tối, ảnh prod khách: "214.000 ₫ – 294.000 ₫" một
      // dòng tràn sang cột Tồn kho ở table-fixed). Dòng dưới "– max" nhỏ hơn, tooltip đủ khoảng.
      return min === max ? (
        <Money value={min} className={TEXT_NUMBER_MUTED} />
      ) : (
        <span
          className={cn(TEXT_NUMBER_MUTED, "block leading-tight")}
          title={`${formatNumber(min)} – ${formatNumber(max)} ₫`}
        >
          <Money value={min} className={TEXT_NUMBER_MUTED} />
          <span className="block text-xs text-muted-foreground">
            – <Money value={max} className="text-xs text-muted-foreground" />
          </span>
        </span>
      );
    };
    const toggleAllInGroup = () => {
      setSelected((cur) => {
        const next = new Map(cur);
        if (rows.every((p) => next.has(p.id))) rows.forEach((p) => next.delete(p.id));
        else rows.forEach((p) => next.set(p.id, p));
        return next;
      });
    };
    return (
      <TableRow
        key={`group-${g.key}`}
        className={cn(
          "cursor-pointer bg-muted/25 hover:bg-muted/50",
          // Đang mở: cả cụm cha + con thành MỘT KHỐI (anh Trung 28/09 ở bảng Giá vốn).
          open && "bg-slate-200/70! hover:bg-slate-200/90! shadow-[inset_3px_0_0_0_var(--color-primary)]"
        )}
        onClick={() => toggleGroup(g.key)}
      >
        {isAdmin && (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <GroupCheckbox
              label={`Chọn cả ${rows.length} phân loại của ${g.name}`}
              checked={selectedCount === rows.length}
              indeterminate={selectedCount > 0 && selectedCount < rows.length}
              onChange={toggleAllInGroup}
            />
          </TableCell>
        )}
        <TableCell>
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              aria-label={open ? "Thu gọn phân loại" : "Xem các phân loại"}
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation();
                toggleGroup(g.key);
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight
                className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}
              />
            </button>
            <ProductThumb src={g.imageUrl} alt={g.name} />
            <div className="min-w-0 flex-1">
              <span className={cn("block truncate", open ? "font-bold" : "font-medium")} title={g.name}>
                {g.name}
              </span>
              <span className="flex flex-wrap items-center gap-x-1 text-xs">
                <Layers className="size-3.5 shrink-0 text-sky-600" />
                <span className="font-semibold text-sky-700">
                  {groupTotalOf(g) > rows.length
                    ? `${formatNumber(rows.length)}/${formatNumber(groupTotalOf(g))} phân loại${stockFilter === "out" ? " hết hàng" : " khớp"}`
                    : `${formatNumber(rows.length)} phân loại`}
                </span>
                {inactiveCount > 0 && (
                  <span className="text-muted-foreground">· {formatNumber(inactiveCount)} ngừng bán</span>
                )}
                {lowCount > 0 && (
                  <span className="font-medium text-amber-700">· {formatNumber(lowCount)} sắp hết</span>
                )}
              </span>
            </div>
          </div>
        </TableCell>
        <TableCell className={cn(TEXT_SUB, CELL_PAD.skuCode)}>—</TableCell>
        {seesCost && (
          <TableCell className="text-right">{range(rows.map((p) => Number(p.costPrice ?? 0)))}</TableCell>
        )}
        <TableCell className="text-right">{range(rows.map((p) => Number(p.sellingPrice)))}</TableCell>
        <TableCell className="text-center">
          <span className="text-sm font-semibold tabular-nums" title="Tổng tồn các phân loại">
            {formatNumber(qty)}
          </span>
          {seesCost && <StockValueSubline value={groupValue} className={valueSublineShow} />}
        </TableCell>
        <TableCell className={cn("text-center", CELL_PAD.availableToSell)}>
          <span
            className={cn("text-sm font-semibold tabular-nums", available === 0 ? "text-rose-700" : "text-foreground")}
            title="Tổng có thể bán các phân loại"
          >
            {formatNumber(available)}
          </span>
          <AwaitingShip
            quantity={awaitingTotal}
            title={AWAITING_SHIP_GROUP_TITLE}
            variant="subline"
            className={awaitSublineShow}
          />
        </TableCell>
        <TableCell className={cn("text-center", CELL_PAD.awaitingShip, awaitColShow)}>
          <AwaitingShip quantity={awaitingTotal} title={AWAITING_SHIP_GROUP_TITLE} />
        </TableCell>
        {locationsEnabled && <TableCell className={TEXT_SUB}>—</TableCell>}
        <TableCell className={CELL_PAD.channels}>
          {chips.length === 0 ? (
            <span className={TEXT_SUB}>Chưa nối</span>
          ) : (
            // Chip tự xuống dòng + đệm px-1.5 như dòng con (đo prod 05/11 đêm, màn 1920: hai chip
            // "TikTok ×1 Shopee ×3" một hàng với đệm px-2 tràn 3px khỏi ô 168px).
            <span className="flex flex-wrap items-center gap-1.5">
              {chips.map(([channelName, n]) => {
                const meta = CHANNEL_META[channelName as keyof typeof CHANNEL_META];
                return (
                  <span
                    key={channelName}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-600"
                    title={`${meta?.label ?? channelName}: ${formatNumber(n)} phân loại đã nối — bung mẫu để xem từng dòng`}
                  >
                    {meta?.label ?? channelName}
                    <span className="opacity-70">×{n}</span>
                  </span>
                );
              })}
            </span>
          )}
        </TableCell>
        {seesCost && (
          <TableCell className={cn("text-right", CELL_PAD.stockValue, valueColShow)}>
            <StockValueAmount
              value={groupValue}
              title={
                `Tổng giá trị tồn của ${formatNumber(rows.length)} phân loại` +
                (noCostCount > 0 ? ` — ${formatNumber(noCostCount)} phân loại chưa nhập giá vốn nên chưa tính` : "")
              }
              emptyTitle="Chưa phân loại nào có giá vốn"
            />
          </TableCell>
        )}
        <TableCell className={cn(TEXT_SUB, "text-center")}>—</TableCell>
      </TableRow>
    );
  }

  const hubTabs: PageTabItem<HubTab>[] = [
    // "Tồn kho đã nối" (anh Trung 22/10 tối): khách kéo hàng về tưởng vào thẳng kho; tab này chỉ
    // có SKU kho — hàng sàn phải nối (bước 2) mới xuất hiện ở đây.
    // Lần 2 (anh Trung 22/10 tối): "Tổng kho" — gọn, bao cả SKU tự thêm / Excel lẫn SKU nối từ sàn.
    // Lần 3 (05/11, trang đã mang tên "Tổng kho" trên sidebar + tiêu đề): tab về "Tồn kho"
    // cho khỏi lặp chữ; tab "Sản phẩm trên sàn" chuyển thành trang riêng /products/marketplace.
    { key: "inventory", label: "Tồn kho" },
    { key: "logs", label: "Nhật ký kho" },
    // 05/11/2026 (anh Trung: doanh nghiệp cần in phiếu nhập / xuất): cấp PHIẾU, khác Nhật ký (cấp bút toán).
    { key: "vouchers", label: "Phiếu kho" },
    // 05/11/2026 (anh Trung: doanh nghiệp quản cả nhà cung cấp; "đây là phần thống kê thôi"): báo cáo nhập
    // hàng đọc từ phiếu nhập — Theo nhà cung cấp / Theo sản phẩm. docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5.
    { key: "suppliers", label: "Nhà cung cấp" },
  ];

  return (
    <AppShell>
      <div className="space-y-5">
        {/* ===== DẢI ĐẦU TRANG + THANH TAB (chuẩn PageTabs 19/09) ===== */}
        <PageHeaderBand>
          <PageTabs
            ariaLabel="Khu vực của Tổng kho"
            className="border-b-0"
            tabs={hubTabs}
            value={tab}
            onChange={setTab}
          />
        </PageHeaderBand>

        {tab === "logs" ? (
          <InventoryLogTable showLocation={locationsEnabled} />
        ) : tab === "vouchers" ? (
          <StockVoucherTable
            key={voucherSupplier?.id ?? "all"}
            showLocation={locationsEnabled}
            supplierFilter={voucherSupplier}
            onClearSupplierFilter={() => setVoucherSupplier(null)}
          />
        ) : tab === "suppliers" ? (
          <SuppliersTab
            onOpenVouchers={(s) => {
              setVoucherSupplier(s);
              setTab("vouchers");
            }}
          />
        ) : (
          <>
            {/* ===== TẦNG 1: NGUYÊN LÝ + 3 BƯỚC THIẾT LẬP (tự thu gọn khi xong) =====
                CHỈ ở tab Tồn kho (anh Trung 06/09: tab Sản phẩm trên sàn là chỗ làm
                việc chi tiết, không kể chuyện hai lần). Cách bảng bên dưới một
                khoảng lớn hơn nhịp thường để hai khối tách tông.
                ⛔ TẠM ẨN 05/11/2026 — xem SHOW_SETUP_GUIDE đầu tệp. */}
            {SHOW_SETUP_GUIDE && (
            <div className="pb-2">
              <SetupGuide
                isAdmin={isAdmin}
                productTotal={activeTotal}
                ready={guideReady && !productsQ.loading}
                channels={channels}
                counts={counts}
                syncState={syncState}
                onSynced={loadCounts}
                onOpenOneClick={() => setOneClickOpen(true)}
                onOpenLinks={() => router.push("/products/marketplace")}
                onOpenSync={() => setSyncOpen(true)}
              />
            </div>
            )}

            {/* ===== TẦNG 2: BẢNG LÀM VIỆC — thanh công cụ + cảnh báo + bảng ===== */}
            {/* Hai hàng CÓ CHỦ Ý (anh Trung 03/10: lệch hàng xấu): hàng 1 = tìm kiếm (trái) + thao tác (phải);
                hàng 2 = bộ lọc. Trước đây chip lọc chen cùng hàng, tự rớt dòng làm cụm nút phải lệch. */}
            <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <form onSubmit={handleSearch} className="flex min-w-64 max-w-md flex-1 gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Tìm theo mã SKU, mã vạch hoặc tên sản phẩm…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="secondary">
                  Tìm kiếm
                </Button>
              </form>
              <div className="flex flex-wrap items-center gap-2">
                {/* 05/11/2026: cửa vào hộp Đồng bộ tồn kho lên sàn — trước chỉ nằm ở đầu khối
                    3 bước (đã tạm ẩn); chủ shop phải luôn có chỗ bật/tắt gian + đối soát. */}
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => setSyncOpen(true)}
                    title={
                      syncState && syncState.totalChannels > 0
                        ? `Đang đẩy tồn lên ${syncState.enabledCount}/${syncState.totalChannels} gian — bấm để bật / tắt từng gian, đối soát`
                        : "Bật đồng bộ tồn kho lên từng gian sau khi so số"
                    }
                  >
                    <RefreshCw className="size-4" />
                    Đồng bộ tồn kho
                    {syncState && syncState.totalChannels > 0 && (
                      <span
                        className={cn(
                          "ml-0.5 rounded-full px-1.5 text-xs tabular-nums",
                          syncState.enabledCount === syncState.totalChannels
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-800"
                        )}
                      >
                        {syncState.enabledCount}/{syncState.totalChannels}
                      </span>
                    )}
                  </Button>
                )}
                {/* ===== Nhập – Xuất – Kiểm kê ▾ : việc kho làm theo tuần ===== */}
                <Popover open={opsOpen} onOpenChange={setOpsOpen}>
                  <PopoverTrigger render={<Button variant="outline" />}>
                    <ClipboardList className="size-4" />
                    <span className="hidden sm:inline">Nhập – Xuất – Kiểm kê</span>
                    <span className="sm:hidden">Kho</span>
                    <ChevronDown className={cn("size-4 transition-transform", opsOpen && "rotate-180")} />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-1">
                    <Link href="/products/receive" className={MENU_ITEM} onClick={() => setOpsOpen(false)}>
                      <ClipboardList className="mt-0.5 size-4 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span className="block font-medium">Phiếu nhiều mã</span>
                        <span className={cn(TEXT_SUB, "block")}>Nhập hoặc xuất nhiều mã trong một phiếu, có lý do.</span>
                      </span>
                    </Link>
                    <Link href="/products/stocktake" className={MENU_ITEM} onClick={() => setOpsOpen(false)}>
                      <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span className="block font-medium">Kiểm kê</span>
                        <span className={cn(TEXT_SUB, "block")}>Đếm thực tế rồi chốt — mỗi mã lệch một dòng nhật ký.</span>
                      </span>
                    </Link>
                    {locationsEnabled && (
                      <Link href="/products/putaway" className={MENU_ITEM} onClick={() => setOpsOpen(false)}>
                        <PackageOpen className="mt-0.5 size-4 shrink-0 text-slate-500" />
                        <span className="min-w-0">
                          <span className="block font-medium">Cất lên kệ</span>
                          <span className={cn(TEXT_SUB, "block")}>Quét tem kệ → quét SKU → chuyển hàng loạt từ Kho chính lên kệ.</span>
                        </span>
                      </Link>
                    )}
                    {isAdmin && (
                      <>
                        <div className="my-1 border-t" />
                        <button
                          type="button"
                          className={MENU_ITEM}
                          onClick={() => {
                            setOpsOpen(false);
                            setLocationsOpen(true);
                          }}
                        >
                          <MapPin className="mt-0.5 size-4 shrink-0 text-slate-500" />
                          <span className="min-w-0">
                            <span className="block font-medium">{locationsEnabled ? `Vị trí chứa hàng (${locations.length})` : "Thêm vị trí chứa hàng"}</span>
                            <span className={cn(TEXT_SUB, "block")}>
                              {locationsEnabled ? "Kho, kệ, tầng — quản lý cây vị trí." : "Thuê thêm kho nhỏ / kệ? Tạo cây Kho › Kệ › Tầng."}
                            </span>
                          </span>
                        </button>
                      </>
                    )}
                  </PopoverContent>
                </Popover>

                {/* ===== Excel ▾ : nhập / xuất tệp ===== */}
                <Popover open={excelOpen} onOpenChange={setExcelOpen}>
                  <PopoverTrigger render={<Button variant="outline" />}>
                    <FileSpreadsheet className="size-4" />
                    Excel
                    <ChevronDown className={cn("size-4 transition-transform", excelOpen && "rotate-180")} />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-1">
                    <button
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => {
                        setExcelOpen(false);
                        setImportOpen(true);
                      }}
                    >
                      <Upload className="mt-0.5 size-4 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span className="block font-medium">Nhập Excel</span>
                        <span className={cn(TEXT_SUB, "block")}>Theo mẫu: mã đã có thì cập nhật giá, tồn; mã mới thì tạo.</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={MENU_ITEM}
                      disabled={exporting}
                      onClick={() => {
                        setExcelOpen(false);
                        void handleExport();
                      }}
                    >
                      {exporting ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <Download className="mt-0.5 size-4 shrink-0 text-slate-500" />}
                      <span className="min-w-0">
                        <span className="block font-medium">Xuất Excel</span>
                        <span className={cn(TEXT_SUB, "block")}>Toàn bộ SKU trong Tổng kho ra tệp .xlsx.</span>
                      </span>
                    </button>
                  </PopoverContent>
                </Popover>
                <ImportExcelDialog open={importOpen} onOpenChange={setImportOpen} trigger={false} onImported={load} />
                {/* 30/10/2026 anh chốt: bỏ hộp "Thêm sản phẩm mới" cũ (SKU + giá + tồn), thay bằng luồng
                    Tạo sản phẩm mới của Sao chép sản phẩm (soạn đủ chuẩn sàn → đăng lên gian + ghi Tổng kho).
                    05/11/2026 anh Trung: nút thành MENU "Tạo sản phẩm kho" — hai đường đưa hàng vào kho:
                    soạn từ đầu (/products/new) hoặc SAO CHÉP một sản phẩm trên gian đã nối thành SKU kho
                    ĐỘC LẬP (anh chốt cùng ngày: "sản phẩm ở Tổng kho độc lập trước, nối sau; thiếu SKU thì
                    bắt đặt") — hộp chọn sản phẩm → cùng form Tạo mới đổ sẵn → Lưu vào Tổng kho (docs
                    SAO-CHEP-SAN-PHAM mục 34). Mục này theo lá quyền operations.copy-listing. */}
                <Popover open={createOpen} onOpenChange={setCreateOpen}>
                  <PopoverTrigger render={<Button />}>
                    <Plus className="size-4" />
                    Tạo sản phẩm kho
                    <ChevronDown className={cn("size-4 transition-transform", createOpen && "rotate-180")} />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-1">
                    <Link
                      href="/products/new"
                      className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-muted"
                      onClick={() => setCreateOpen(false)}
                    >
                      <Plus className="mt-0.5 size-4 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span className="block font-medium">Tạo sản phẩm mới</span>
                        <span className={cn(TEXT_SUB, "block")}>Soạn từ đầu, đăng lên gian hoặc chỉ lưu vào Tổng kho.</span>
                      </span>
                    </Link>
                    {canCopyListing && (
                      <button
                        type="button"
                        className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                        onClick={() => {
                          setCreateOpen(false);
                          setCopyOpen(true);
                        }}
                      >
                        <Copy className="mt-0.5 size-4 shrink-0 text-slate-500" />
                        <span className="min-w-0">
                          <span className="block font-medium">Sao chép sản phẩm từ sàn</span>
                          <span className={cn(TEXT_SUB, "block")}>Sao chép một sản phẩm từ gian hàng trên sàn làm một sản phẩm độc lập trong Tổng kho.</span>
                        </span>
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            {/* Hàng chip lọc LUÔN hiện khi kho có SKU (anh Trung 22/10 tối: khách shop váy không thấy
                "Đang bán / Ngừng bán" vì shop họ 0 SKU ngừng bán → chip bị ẩn, tưởng không có bộ lọc). */}
            {(items.length > 0 || search || status !== "active" || stockFilter !== "all" || locationFilter) && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Chip "Tại vị trí" — chỉ khi shop dùng vị trí; chọn kho là gom cả kệ / tầng bên trong. */}
                {locationsEnabled && (
                  <LocationSelect
                    ariaLabel="Lọc theo vị trí chứa hàng"
                    className={cn("w-56 [&>select]:rounded-full [&>select]:text-xs", locationFilter && "[&>select]:border-primary [&>select]:font-medium")}
                    locations={locations}
                    value={locationFilter}
                    onChange={(v) => {
                      setLocationFilter(v);
                      setPage(1);
                    }}
                    placeholder="Tại vị trí: tất cả"
                    suffix={(l) => (l.skuCount ? ` · ${l.skuCount} SKU` : "")}
                  />
                )}
                {/* Đang bán / Ngừng bán luôn hiện (Ngừng bán 0 vẫn hiện để khách biết có bộ lọc). */}
                {(
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { key: "active", label: `Đang bán ${formatNumber(productsQ.data?.activeCount ?? 0)}` },
                        { key: "inactive", label: `Ngừng bán ${formatNumber(inactiveCount)}` },
                      ] as { key: ProductStatusFilter; label: string }[]
                    ).map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        aria-pressed={status === c.key}
                        onClick={() => {
                          setStatus(c.key);
                          setPage(1);
                        }}
                        className={cn(
                          "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          status === c.key
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {/* Chip HẾT HÀNG (22/10, khách xin) — đứng CẠNH Ngừng bán (anh Trung): bật/tắt,
                    đếm SKU đang bán có tồn ≤ 0; kết hợp với trạng thái / vị trí / tìm kiếm. */}
                {(outOfStockCount > 0 || stockFilter !== "all") && (
                  <button
                    type="button"
                    aria-pressed={stockFilter === "out"}
                    onClick={() => {
                      setStockFilter((s) => (s === "out" ? "all" : "out"));
                      setPage(1);
                    }}
                    className={cn(
                      "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      stockFilter === "out"
                        ? "border-rose-600 bg-rose-600 text-white"
                        : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    )}
                    title="Chỉ hiện SKU đang hết hàng (tồn kho ≤ 0)"
                  >
                    Hết hàng {formatNumber(outOfStockCount)}
                  </button>
                )}
                {/* CÀI NHANH cho các SKU đang tích (09/11/2026, khách xin; vị trí theo ảnh anh Trung
                    khoanh — góc phải hàng lọc). Luôn hiện để khách biết có tính năng; chưa tích gì
                    thì bấm vào được nhắc tích trước. */}
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      if (selected.size === 0) {
                        toast.info("Tích ô đầu dòng của các sản phẩm cần cài, rồi bấm lại nút này.");
                        return;
                      }
                      setBulkSettingsOpen(true);
                    }}
                  >
                    <BellRing className="size-3.5" />
                    Cài cảnh báo &amp; tồn an toàn
                    {selected.size > 0 && <span className="tabular-nums">({formatNumber(selected.size)})</span>}
                  </Button>
                )}
              </div>
            )}
            </div>

            {/* Cảnh báo lệch tồn với sàn — việc vận hành, chỉ hiện khi có lỗi chưa xử lý */}
            <SyncAlertBanner />

            <Card>
              {/* @container: cột Giá trị tồn hiện / ẩn theo bề rộng KHUNG BẢNG này (xem STOCK_VALUE_SHOW). */}
              <CardContent className="@container p-0">
                {error ? (
                  <p className="py-10 text-center text-sm text-amber-700">{error}</p>
                ) : loading ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Đang tải dữ liệu…
                  </p>
                ) : items.length === 0 ? (
                  // Dòng trống nói đúng việc kế tiếp theo ngữ cảnh: có hàng sàn
                  // chưa nối thì chỉ lên bước 2, không bảo "thêm tay" cho seller
                  // đã có vài trăm sản phẩm trên Shopee.
                  <div className="space-y-3 py-10 text-center text-sm text-muted-foreground">
                    {search ? (
                      <p>Không tìm thấy sản phẩm nào khớp với &quot;{search}&quot;.</p>
                    ) : locationFilter ? (
                      <p>
                        Chưa có mã nào có hàng tại{" "}
                        <b className="text-foreground">
                          {locationLabel(locations.find((l) => l.id === locationFilter) ?? locations[0])}
                        </b>
                        . Dùng &ldquo;Cất lên kệ&rdquo; để đưa hàng vào đây.
                      </p>
                    ) : stockFilter === "out" ? (
                      <p>Không có SKU nào đang hết hàng. Bấm lại chip &ldquo;Hết hàng&rdquo; để xem tất cả.</p>
                    ) : status === "inactive" ? (
                      <p>Chưa có SKU nào ngừng kinh doanh.</p>
                    ) : isAdmin && unlinkedCount > 0 ? (
                      <>
                        <p>
                          Kho chưa có SKU nào, nhưng đang có{" "}
                          <b className="text-foreground">{formatNumber(unlinkedCount)}</b> sản
                          phẩm trên sàn chưa nối về. Nối là có kho ngay, tồn lấy theo sàn.
                        </p>
                        <Button size="sm" onClick={() => setOneClickOpen(true)}>
                          <Sparkles className="size-3.5" />
                          Tự khớp + tạo SKU
                        </Button>
                      </>
                    ) : isAdmin && channels.length === 0 ? (
                      <p>
                        Chưa có sản phẩm nào. Vào <Link href="/channels" className="font-medium text-primary hover:underline">Kênh bán</Link> nối
                        gian hàng để kéo sản phẩm từ sàn về, hoặc bấm “Tạo sản phẩm kho” / nhập Excel nếu bán ngoài sàn.
                      </p>
                    ) : isAdmin && (counts?.all ?? 0) === 0 ? (
                      <p>
                        Chưa có sản phẩm nào. Vào <Link href="/products/marketplace" className="font-medium text-primary hover:underline">Sản phẩm trên sàn</Link> bấm
                        “Đồng bộ từ sàn” để lấy hàng từ gian đã nối, hoặc “Tạo sản phẩm kho” / nhập Excel nếu bán ngoài sàn.
                      </p>
                    ) : (
                      <p>Chưa có sản phẩm nào. Bấm “Tạo sản phẩm kho” hoặc nhập Excel để bắt đầu.</p>
                    )}
                  </div>
                ) : (
                  // table-fixed theo % (anh Trung 22/10: cột Nhập · Xuất bị cắt ở 1700px khi có cột
                  // Vị trí): từ 1.000px trở lên bảng vừa khung, tên / mã tự cắt + tooltip, chip Bán trên
                  // xuống dòng. Dưới 1.000px (laptop 1280 mở sidebar + có cột Vị trí) hộp cuộn ngang
                  // thay vì để số đè lên nhau — ô số không được phép tràn. Bề rộng cột ở COL_HEAD_CLASS.
                  <Table className={cn("table-fixed", locationsEnabled ? TABLE_MIN_W.withLocations : TABLE_MIN_W.plain)}>
                    <TableHeader>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead
                              key={header.id}
                              // Tiêu đề được xuống dòng khi cột hẹp (1280: "Giá vốn mặc định" từng đè lên "Giá bán").
                              className={cn(
                                "whitespace-normal leading-tight",
                                COL_HEAD_CLASS[header.column.id],
                                colShow[header.column.id]
                              )}
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const rowById = new Map(table.getRowModel().rows.map((r) => [r.original.id, r]));
                        return groups.flatMap((g) => {
                          const multi = groupTotalOf(g) > 1;
                          const open = !multi || openGroups.has(g.key);
                          const out: ReactNode[] = [];
                          if (multi) out.push(renderGroupRow(g, open));
                          if (!open) return out;
                          for (const p of g.rows) {
                            const row = rowById.get(p.id);
                            if (!row) continue;
                            out.push(
                              <TableRow
                                key={row.id}
                                className={cn(multi && "bg-slate-50/60 shadow-[inset_3px_0_0_0_var(--color-primary)]")}
                              >
                                {row.getVisibleCells().map((cell) => (
                                  <TableCell
                                    key={cell.id}
                                    className={cn(CELL_PAD[cell.column.id], colShow[cell.column.id])}
                                  >
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </TableCell>
                                ))}
                              </TableRow>
                            );
                          }
                          return out;
                        });
                      })()}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Phân trang — chọn 20/50/100 dòng/trang như các bảng khác */}
            {items.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Hiển thị</span>
                  <NativeSelect
                    className="w-20"
                    aria-label="Số dòng mỗi trang"
                    value={String(pageSize)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setPageSize(n);
                      setPage(1);
                      try {
                        localStorage.setItem(PAGE_SIZE_KEY, String(n));
                      } catch {
                        // bị chặn — bỏ qua
                      }
                    }}
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                  <span className="text-sm text-muted-foreground">
                    sản phẩm/trang · {formatNumber(total)} sản phẩm · {formatNumber(skuTotal)} SKU · trang{" "}
                    {page}/{Math.max(1, pageCount)}
                  </span>
                  {multiGroupKeys.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setOpenGroups(allGroupsOpen ? new Set() : new Set(multiGroupKeys))
                      }
                    >
                      {allGroupsOpen ? (
                        <ChevronsDownUp className="size-3.5" />
                      ) : (
                        <ChevronsUpDown className="size-3.5" />
                      )}
                      {allGroupsOpen ? "Thu gọn phân loại" : "Bung hết phân loại"}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="size-4" />
                    Trang trước
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pageCount || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Trang sau
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Thanh xử lý hàng loạt — nổi đáy màn hình khi có SKU được tích */}
      {isAdmin && (
        <ProductBulkBar
          selected={[...selected.values()]}
          onClear={() => setSelected(new Map())}
          onDone={load}
          onPrintLabels={(rows) => setPrinting(rows)}
        />
      )}

      {/* Hộp In mã vạch */}
      {printing && (
        <PrintLabelsDialog
          products={printing}
          open
          onOpenChange={(o) => {
            if (!o) setPrinting(null);
          }}
        />
      )}

      {/* Hộp thoại nhập/xuất kho */}
      {adjusting && (
        <AdjustStockDialog
          product={adjusting.product}
          type={adjusting.type}
          locations={locations}
          open={true}
          onOpenChange={(open) => {
            if (!open) setAdjusting(null);
          }}
          onDone={load}
        />
      )}

      {/* Vị trí chứa hàng (chỉ chủ shop) */}
      {isAdmin && (
        <StockLocationsDialog
          open={locationsOpen}
          onOpenChange={setLocationsOpen}
          locations={locations}
          onChanged={() => load()}
        />
      )}

      {/* Chuyển vị trí một SKU */}
      {transfer && (
        <StockTransferDialog
          product={transfer.product}
          locations={locations}
          defaultFromId={transfer.fromId}
          open={true}
          onOpenChange={(open) => {
            if (!open) setTransfer(null);
          }}
          onDone={load}
        />
      )}

      {/* Lịch sử kho của một SKU */}
      {history && (
        <ProductHistoryDialog
          product={history}
          showLocation={locationsEnabled}
          open={true}
          onOpenChange={(open) => {
            if (!open) setHistory(null);
          }}
        />
      )}

      {/* Cài đặt riêng một SKU: ngưỡng cảnh báo sắp hết hàng + tồn an toàn */}
      {skuSettings && (
        <SkuSettingsDialog
          product={skuSettings}
          shopDefaults={{
            safetyStock: productsQ.data?.safetyStockDefault ?? 0,
            lowStock: productsQ.data?.lowStockDefault ?? 0,
          }}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSkuSettings(null);
          }}
          onSaved={load}
        />
      )}

      {/* Cài nhanh ngưỡng cảnh báo + tồn an toàn cho các SKU đang tích */}
      {isAdmin && (
        <BulkStockSettingsDialog
          selected={[...selected.values()]}
          shopDefaults={{
            safetyStock: productsQ.data?.safetyStockDefault ?? 0,
            lowStock: productsQ.data?.lowStockDefault ?? 0,
          }}
          open={bulkSettingsOpen}
          onOpenChange={setBulkSettingsOpen}
          onSaved={() => {
            setSelected(new Map());
            load();
          }}
        />
      )}

      {/* Cài đặt đồng bộ tồn kho (chỉ chủ shop) */}
      {isAdmin && (
        <SyncSettingsDialog
          open={syncOpen}
          onOpenChange={setSyncOpen}
          onStateChange={setSyncState}
        />
      )}

      {/* Sao chép sản phẩm từ sàn → SKU kho độc lập (docs SAO-CHEP-SAN-PHAM mục 34) */}
      {canCopyListing && <CopyFromChannelDialog open={copyOpen} onOpenChange={setCopyOpen} />}

      {/* Bước 2 "Tự khớp + tạo SKU" — cùng hộp với tab Sản phẩm trên sàn */}
      {isAdmin && (
        <OneClickLinkDialog
          open={oneClickOpen}
          onOpenChange={setOneClickOpen}
          unlinkedCount={unlinkedCount}
          onDone={() => {
            load();
            loadCounts();
            loadSyncState();
          }}
        />
      )}
    </AppShell>
  );
}
