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
  ArrowLeftRight,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCheck,
  ClipboardList,
  Download,
  Image as ImageIcon,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  MapPin,
  PackageOpen,
  Plus,
  Search,
  Sparkles,
  Warehouse,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/shell/app-shell";
import { Money } from "@/components/ui/money";
import { AdjustStockDialog } from "@/components/products/adjust-stock-dialog";
import { SkuSettingsDialog } from "@/components/products/sku-settings-dialog";
import { SetupGuide, type ChannelProductCounts } from "@/components/products/setup-guide";
import { OneClickLinkDialog } from "@/components/products/one-click-link-dialog";
import { InlineStockEditor } from "@/components/products/inline-stock-editor";
import { MarketplaceCodes } from "@/components/products/marketplace-codes";
import { ImportExcelDialog } from "@/components/products/import-excel-dialog";
import { InventoryLogTable } from "@/components/products/inventory-log-table";
import { ProductBulkBar } from "@/components/products/product-bulk-bar";
import { ProductHistoryDialog } from "@/components/products/product-history-dialog";
import { ProductRowMenu } from "@/components/products/product-row-menu";
import { StockLevelsCell } from "@/components/products/stock-levels-cell";
import { StockLocationsDialog } from "@/components/products/stock-locations-dialog";
import { StockTransferDialog } from "@/components/products/stock-transfer-dialog";
import { SyncAlertBanner } from "@/components/products/sync-alert-banner";
import { LinkManager } from "@/components/products/link-manager";
import { LocationSelect } from "@/components/products/location-select";
import {
  SyncSettingsDialog,
  type SyncHeaderState,
} from "@/components/products/sync-settings-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  ApiError,
  fetchChannelProducts,
  fetchChannels,
  fetchProductChannelLinks,
  fetchProducts,
  fetchStockLocations,
  fetchSyncSettings,
  getStoredUser,
  getToken,
  unlinkChannelProducts,
  type Channel,
  type Product,
  type ProductChannelLink,
  type ProductStatusFilter,
  type StockLocation,
} from "@/lib/api";
import { exportAllProducts } from "@/lib/excel";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { CHANNEL_META } from "@/lib/channel-meta";
import { locationLabel } from "@/lib/stock-locations";
import { formatNumber } from "@/lib/format";
import { canManageShop, canSeeFinancials } from "@/lib/permissions";
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
  skuCode: "w-[9%]",
  // Tiền: "1.294.000 ₫" cần ≥ 84px chữ → 10% của bảng tối thiểu 1.000px (soi 22/10 tối với
  // dữ liệu khoảng giá + giá 7 chữ số; trước đó 9% làm số tràn sang cột Tồn kho ở 1280).
  costPrice: "w-[10%]",
  sellingPrice: "w-[10%]",
  // Tồn kho: viên "9.998" ≈ 62px (bút chì chỉ hiện khi rê) → 8,5%; ở 7% viên (có bút chì) tràn
  // 28px sang Có thể bán tại 1280. TỔNG % giữ 88 — tăng tổng là hai cột tiền bị ép và tràn.
  quantityInStock: "w-[8.5%]",
  availableToSell: "w-[7.5%]",
  // Đang ở: "Kho chính  20" cần ≥ 80px chữ (tên 55 + khe 8 + số) → 12% của 1.000px; ở 9% (22/10
  // xem prod) ô "Kho chính" chỉ còn 29px chữ, tên cụt "K…" và số từng tràn sang cột Bán trên.
  locations: "w-[12%]",
  // Bán trên: chip "Shopee ×3" tự xuống dòng nên nhường 1% được.
  channels: "w-[11%]",
  actions: "w-[8.5rem]",
};

type HubTab = "inventory" | "links" | "logs";

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
 *      nối, badge lệch tồn) — bấm dòng bung sơ đồ kho ↔ từng gian, gỡ nối/nối
 *      thêm tại chỗ. Cảnh báo lệch tồn ngay trên bảng, chỉ hiện khi có lỗi.
 *   3. Tab SẢN PHẨM TRÊN SÀN (chỉ chủ shop): tầng đệm ChannelProduct để nối tay
 *      từng dòng / theo lô; cùng một hộp "Tự khớp + tạo SKU" với bước 2.
 *   4. Tab NHẬT KÝ KHO (24/09): sổ biến động toàn shop — vì sao tồn đổi, ai làm,
 *      đơn nào trừ. Chỉ gọi API khi mở tab. Từng SKU có "Lịch sử kho" trong menu ⋯.
 *
 * 24/09: SKU có thể NGỪNG KINH DOANH (ẩn khỏi bảng, giữ đơn cũ + liên kết) —
 * chip "Ngừng bán N" chỉ hiện khi N > 0; phiếu nhập/xuất NHIỀU MÃ là trang riêng
 * /products/receive. Thanh tab chuyển sang PageTabs + PageHeaderBand (chuẩn 19/09).
 *
 * Route cũ /mappings và /warehouse/sync redirect về đây (?tab=links / ?sync=1).
 */
export default function ProductsHubPage() {
  const router = useRouter();
  const isAdmin = canManageShop(getStoredUser());

  const [tab, setTab] = useState<HubTab>("inventory");
  // Từ khoá mồi cho tab Sản phẩm trên sàn khi bấm "Nối thêm gian" từ một SKU.
  const [linkSeed, setLinkSeed] = useState<string | undefined>(undefined);

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
  // sự vắng mặt — không công tắc cài đặt). Cột "Đang ở" + ô chọn vị trí chỉ
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

  // Trạng thái đồng bộ tồn theo gian (chỉ chủ shop) — bước 3 + header khối.
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncHeaderState | null>(null);

  // Dòng đang bung + cache chi tiết liên kết theo productId.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkDetails, setLinkDetails] = useState<
    Record<string, ProductChannelLink[] | "loading">
  >({});

  const [adjusting, setAdjusting] = useState<{
    product: Product;
    type: "IMPORT" | "EXPORT";
  } | null>(null);
  // SKU đang mở hộp cài đặt riêng (ngưỡng cảnh báo + tồn an toàn).
  const [skuSettings, setSkuSettings] = useState<Product | null>(null);

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
  // tồn): làm tươi mọi trang cache + xoá cache chi tiết liên kết đã đổi.
  const load = useCallback(() => {
    setLinkDetails({});
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
    if (params.get("tab") === "links" && canManageShop(getStoredUser())) {
      setTab("links");
    }
    if (params.get("tab") === "logs") setTab("logs");
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

  /** Bung/cụp một dòng — chi tiết liên kết do effect bên dưới tải. */
  const toggleExpand = useCallback((product: Product) => {
    setExpandedId((cur) => (cur === product.id ? null : product.id));
  }, []);

  // Dòng đang bung mà chưa có chi tiết (lần đầu bung, HOẶC cache vừa bị load()
  // xoá sau khi nối/gỡ gian ở tab Sản phẩm trên sàn) → tải lại. Trước đây chỉ tải
  // lúc bấm bung nên sau khi nối thêm gian rồi quay về, dòng treo spinner
  // "Đang tải chi tiết liên kết…" vô hạn cho tới khi cụp/bung lại.
  useEffect(() => {
    if (!expandedId || linkDetails[expandedId]) return;
    const id = expandedId;
    setLinkDetails((prev) => ({ ...prev, [id]: "loading" }));
    fetchProductChannelLinks(id)
      .then((links) => setLinkDetails((prev) => ({ ...prev, [id]: links })))
      .catch(() => {
        toast.error("Không tải được chi tiết liên kết — thử bung lại dòng");
        setExpandedId((cur) => (cur === id ? null : cur));
        setLinkDetails((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      });
  }, [expandedId, linkDetails]);

  async function handleUnlinkOne(link: ProductChannelLink, productId: string) {
    try {
      await unlinkChannelProducts([link.id]);
      toast.success(`Đã gỡ ${link.channelSku} khỏi SKU kho`);
      setLinkDetails((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      load();
      loadCounts();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được");
    }
  }

  // SKU kho ĐÍCH khi bấm "Nối thêm gian cho SKU này" (anh Trung 22/10 tối: khách ở SKU gian A sang
  // tab sàn chọn gian B để nối thêm, dòng gian B đã nối hết nên không có nút nào) → tab sàn hiện
  // dải "Đang nối về SKU X" và mỗi dòng có nút "Nối vào X" một bấm, kể cả dòng đang nối gian khác.
  const [linkTargetProduct, setLinkTargetProduct] = useState<Product | null>(null);
  /** "Nối thêm gian" từ một SKU: nhảy sang tab liên kết, mồi sẵn từ khoá + SKU đích. */
  function jumpToLinks(seedSearch?: string, target?: Product) {
    setLinkSeed(seedSearch);
    setLinkTargetProduct(target ?? null);
    setTab("links");
  }
  /**
   * Từ khóa mồi khi bấm "Nối gian" ở một SKU kho: lấy 4 chữ đầu TÊN sản phẩm (anh Trung 22/10
   * tối: mồi bằng mã SKU kho thì hầu như không khớp dòng sàn nào — dòng sàn mang mã sàn khác —
   * khách nhảy sang thấy bảng trống, tưởng không có nút nối).
   */
  function linkSeedFor(p: Product): string {
    return p.productName.trim().split(/\s+/).slice(0, 4).join(" ");
  }

  // Nhân viên không được biết giá vốn — backend đã cắt trường, bỏ luôn cột.
  const seesCost = canSeeFinancials(getStoredUser());

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
                <MarketplaceCodes links={p.channelLinks} kind="item" />
              </div>
              {badge}
            </div>
          );
        },
      }),
      // Dưới mã SKU kho hiện MÃ PHÂN LOẠI trên sàn (anh Trung 28/09) — dãy số dài +
      // nút sao chép một chạm, giống bảng Giá vốn.
      columnHelper.accessor("skuCode", {
        header: "Mã SKU",
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate font-mono text-sm font-medium" title={row.original.skuCode}>
              {row.original.skuCode}
            </span>
            <MarketplaceCodes links={row.original.channelLinks} kind="model" />
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
          <InlineStockEditor
            product={row.original}
            low={row.original.isLowStock ?? false}
            threshold={row.original.lowStockThresholdEffective ?? 0}
            editable
            onSaved={load}
          />
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
            </div>
          );
        },
      }),
      // ===== CỘT MỚI: BÁN TRÊN — trái tim của hub. Gom chip theo sàn + badge
      // lệch tồn; bấm vào là bung chi tiết từng gian ngay dưới dòng. =====
      // "ĐANG Ở" (đợt B) — chỉ khi shop đã tạo vị trí; xem cột trống là hiểu
      // "chưa có ở đâu", bấm mở chi tiết sửa số / chuyển.
      ...(locationsEnabled
        ? [
            columnHelper.display({
              id: "locations",
              header: "Đang ở",
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
        header: "Bán trên",
        cell: ({ row }) => {
          const links = row.original.channelLinks ?? [];
          if (links.length === 0) {
            return isAdmin ? (
              <button
                type="button"
                onClick={() => jumpToLinks(linkSeedFor(row.original), row.original)}
                className={cn(
                  TEXT_SUB,
                  "inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 transition-colors hover:border-primary hover:text-foreground"
                )}
              >
                <Link2 className="size-3.5" />
                Nối gian
              </button>
            ) : (
              <span className={TEXT_SUB}>Chưa nối</span>
            );
          }
          // MỖI SÀN MỘT CHIP "Shopee ×3": seller lớn 10 gian vẫn tối đa 3 chip,
          // không bao giờ xuống dòng. Màu chip = trạng thái XẤU NHẤT trong nhóm
          // (đỏ có gian lệch/đẩy fail, vàng đang đẩy, xanh mọi gian khớp, xám
          // chưa bật). Tên từng shop + số từng gian đã có ở dòng bung bên dưới
          // (anh Trung chốt 05/09: cột chỉ cần vậy, không thêm gì).
          const available = row.original.availableToSell ?? 0;
          const RANK: Record<string, number> = {
            alert: 5, mismatch: 4, pending: 3, off: 2, unknown: 1, match: 0,
          };
          const groups = new Map<string, typeof links>();
          for (const l of links) {
            const g = groups.get(l.channelName) ?? [];
            g.push(l);
            groups.set(l.channelName, g);
          }
          const ORDER = ["SHOPEE", "LAZADA", "TIKTOK"];
          const ordered = [...groups.entries()].sort(
            (a, b) => (ORDER.indexOf(a[0]) + 99) % 100 - ((ORDER.indexOf(b[0]) + 99) % 100)
          );
          return (
            <button
              type="button"
              onClick={() => toggleExpand(row.original)}
              className="flex min-w-0 flex-wrap items-center gap-1.5 text-left"
              title="Bấm để xem sơ đồ kho ↔ từng gian"
            >
              {ordered.map(([channelName, group]) => {
                const meta = CHANNEL_META[channelName as keyof typeof CHANNEL_META];
                const worst = group.reduce(
                  (acc, l) => ((RANK[l.state ?? "unknown"] ?? 1) > (RANK[acc] ?? 1) ? (l.state ?? "unknown") : acc),
                  "match" as string
                );
                const tone =
                  worst === "match"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : worst === "mismatch" || worst === "alert"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : worst === "pending"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-slate-200 bg-slate-50 text-slate-600";
                const lines = group.map((l) => {
                  const st = l.state ?? "unknown";
                  const num =
                    st === "pending"
                      ? available
                      : l.channelStock === null || l.channelStock === undefined
                        ? null
                        : l.channelStock;
                  const hint =
                    st === "match"
                      ? "khớp"
                      : st === "mismatch"
                        ? `lệch, kho muốn ${formatNumber(available)}`
                        : st === "alert"
                          ? "đẩy thất bại"
                          : st === "pending"
                            ? "đang đẩy"
                            : st === "off"
                              ? "chưa bật đồng bộ"
                              : "sàn chưa trả số";
                  return `${l.shopName}: ${num === null ? "?" : formatNumber(num)} (${hint})`;
                });
                return (
                  <span
                    key={channelName}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                      tone
                    )}
                    title={`${meta?.label ?? channelName} — ${group.length} gian\n${lines.join("\n")}`}
                  >
                    {meta?.label ?? channelName}
                    <span className="opacity-70">×{group.length}</span>
                    {worst === "pending" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : worst === "match" ? (
                      <CheckCircle2 className="size-3" />
                    ) : worst === "mismatch" || worst === "alert" ? (
                      <XCircle className="size-3" />
                    ) : null}
                  </span>
                );
              })}
              <ChevronDown
                className={cn(
                  "size-4 text-muted-foreground transition-transform",
                  expandedId === row.original.id && "rotate-180"
                )}
              />
            </button>
          );
        },
      }),
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
    [seesCost, isAdmin, expandedId, linkDetails, locations, selected, allOnPage, toggleAllOnPage, toggleOne, childIds]
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount,
  });
  const colCount = table.getAllColumns().length;

  /** Chi tiết liên kết của dòng đang bung. */
  /**
   * SƠ ĐỒ KHO ↔ GIAN (dòng bung): thẻ Kho bên trái với "Có thể bán" to + công
   * thức, mũi tên hai chiều, bên phải mỗi gian một thẻ cùng cỡ số. Gian lệch tô
   * đỏ và có nút xử lý ngay tại chỗ. Câu chốt một dòng ở dưới — seller nhìn là
   * hiểu "mọi gian cùng một số", không phải ghép chữ.
   */
  function renderHubDiagram(product: Product, detail: ProductChannelLink[]) {
    const qty = product.quantityInStock;
    const held = product.holdQuantity ?? 0;
    const safety = product.safetyStockEffective ?? 0;
    const available = product.availableToSell ?? Math.max(0, qty - held - safety);
    const skuUpper = product.skuCode.trim().toUpperCase();

    return (
      <div className="space-y-2">
        <div className="grid items-center gap-2 md:grid-cols-[11rem_2.5rem_minmax(0,1fr)]">
          {/* Thẻ KHO */}
          <div className="rounded-lg border bg-background px-3 py-2.5 text-center">
            <div className={cn(TEXT_SUB, "flex items-center justify-center gap-1")}>
              <Warehouse className="size-3.5" />
              Tổng kho
            </div>
            <div className="text-2xl font-semibold tabular-nums leading-tight">
              {formatNumber(available)}
            </div>
            <div className={TEXT_SUB}>có thể bán</div>
            <div className={cn(TEXT_SUB, "mt-1 tabular-nums")}>
              {formatNumber(qty)} tồn − {formatNumber(held)} giữ − {formatNumber(safety)} an toàn
            </div>
          </div>
          <div className="hidden justify-center text-muted-foreground md:flex">
            <ArrowLeftRight className="size-5" />
          </div>

          {/* Thẻ TỪNG GIAN */}
          <div className="grid gap-1.5">
            {detail.map((l) => {
              const meta = CHANNEL_META[l.channelName];
              const bad = l.state === "mismatch" || l.state === "alert";
              const off = l.state === "off";
              const differentSku = l.channelSku.trim().toUpperCase() !== skuUpper;
              const num =
                l.state === "pending" ? l.expected : l.channelStock === null ? null : l.channelStock;
              return (
                <div
                  key={l.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
                    bad
                      ? "border-red-200 bg-red-50/60"
                      : off
                        ? "border-dashed bg-background"
                        : "bg-background"
                  )}
                >
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta?.className ?? ""}`}
                  >
                    {meta?.label ?? l.channelName}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {l.shopName}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{l.channelSku}</span>
                    {differentSku && (
                      <span
                        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                        title="SKU trên sàn khác mã SKU kho — vẫn chạy được vì đã nối tay, nhưng đặt CÙNG MÃ trên mọi shop thì Hubsell tự khớp, không lo nối nhầm."
                      >
                        khác mã kho
                      </span>
                    )}
                    {!l.channelActive && (
                      <span className={cn(TEXT_SUB, "ml-2")}>(gian đã ngắt)</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-base font-semibold tabular-nums",
                      bad ? "text-red-700" : off ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {num === null ? "?" : formatNumber(num)}
                  </span>
                  {l.state === "match" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                      <CheckCircle2 className="size-3.5" />
                      khớp
                    </span>
                  ) : l.state === "pending" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                      <Loader2 className="size-3.5 animate-spin" />
                      đang đẩy
                    </span>
                  ) : l.state === "mismatch" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                      <XCircle className="size-3.5" />
                      lệch, kho muốn {formatNumber(l.expected)}
                    </span>
                  ) : l.state === "alert" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                      <XCircle className="size-3.5" />
                      đẩy thất bại — xem cảnh báo
                    </span>
                  ) : off ? (
                    <span className={cn(TEXT_SUB, "text-xs")}>chưa bật đồng bộ</span>
                  ) : (
                    <span className={cn(TEXT_SUB, "text-xs")}>
                      {l.pushable ? "sàn chưa trả số" : "sàn chưa hỗ trợ đẩy tồn"}
                    </span>
                  )}
                  {isAdmin && off && l.pushable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setSyncOpen(true)}
                    >
                      Bật gian này
                    </Button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleUnlinkOne(l, product.id)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-red-600 hover:underline"
                    >
                      <Link2Off className="size-3" />
                      gỡ nối
                    </button>
                  )}
                </div>
              );
            })}
            {isAdmin && (
              <button
                type="button"
                onClick={() => jumpToLinks(linkSeedFor(product), product)}
                className="inline-flex items-center gap-1 self-start text-xs text-primary underline-offset-2 hover:underline"
              >
                <Link2 className="size-3" />
                Nối thêm gian cho SKU này
              </button>
            )}
          </div>
        </div>
        <p className={cn(TEXT_SUB, "flex items-center gap-1.5")}>
          <ArrowLeftRight className="size-3.5" />
          Gian nào bán 1 chiếc, kho và mọi gian còn lại cùng trừ 1. Nhập kho, mọi gian
          cùng lên. Cùng một sản phẩm trên nhiều shop thì đặt cùng mã SKU để Hubsell tự
          khớp.
        </p>
      </div>
    );
  }

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
              <MarketplaceCodes links={links} kind="item" />
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
        <TableCell className={TEXT_SUB}>—</TableCell>
        {seesCost && (
          <TableCell className="text-right">{range(rows.map((p) => Number(p.costPrice ?? 0)))}</TableCell>
        )}
        <TableCell className="text-right">{range(rows.map((p) => Number(p.sellingPrice)))}</TableCell>
        <TableCell className="text-center">
          <span className="text-sm font-semibold tabular-nums" title="Tổng tồn các phân loại">
            {formatNumber(qty)}
          </span>
        </TableCell>
        <TableCell className="text-center">
          <span
            className={cn("text-sm font-semibold tabular-nums", available === 0 ? "text-rose-700" : "text-foreground")}
            title="Tổng có thể bán các phân loại"
          >
            {formatNumber(available)}
          </span>
        </TableCell>
        {locationsEnabled && <TableCell className={TEXT_SUB}>—</TableCell>}
        <TableCell>
          {chips.length === 0 ? (
            <span className={TEXT_SUB}>Chưa nối</span>
          ) : (
            <span className="flex flex-nowrap items-center gap-1.5">
              {chips.map(([channelName, n]) => {
                const meta = CHANNEL_META[channelName as keyof typeof CHANNEL_META];
                return (
                  <span
                    key={channelName}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600"
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
        <TableCell className={cn(TEXT_SUB, "text-center")}>—</TableCell>
      </TableRow>
    );
  }

  function renderExpanded(product: Product) {
    const detail = linkDetails[product.id];
    return (
      <TableRow key={`${product.id}-links`} className="bg-muted/30 hover:bg-muted/30">
        <TableCell colSpan={colCount} className="py-2 pl-8">
          {!detail || detail === "loading" ? (
            <p className={cn(TEXT_SUB, "flex items-center gap-2 py-1")}>
              <Loader2 className="size-3.5 animate-spin" />
              Đang tải chi tiết liên kết…
            </p>
          ) : (
            renderHubDiagram(product, detail)
          )}
        </TableCell>
      </TableRow>
    );
  }

  const hubTabs: PageTabItem<HubTab>[] = [
    // "Tồn kho đã nối" (anh Trung 22/10 tối): khách kéo hàng về tưởng vào thẳng kho; tab này chỉ
    // có SKU kho — hàng sàn phải nối (bước 2) mới xuất hiện ở đây.
    // Lần 2 (anh Trung 22/10 tối): "Tổng kho" — gọn, bao cả SKU tự thêm / Excel lẫn SKU nối từ sàn.
    { key: "inventory", label: "Tổng kho" },
    ...(isAdmin
      ? [
          {
            key: "links" as const,
            label: "Sản phẩm trên sàn",
            count: unlinkedCount,
            countTone: "attention" as const,
            countTitle: "Sản phẩm trên sàn chưa nối về SKU kho",
          },
        ]
      : []),
    { key: "logs", label: "Nhật ký kho" },
  ];

  return (
    <AppShell>
      <div className="space-y-5">
        {/* ===== DẢI ĐẦU TRANG + THANH TAB (chuẩn PageTabs 19/09) ===== */}
        <PageHeaderBand>
          <PageTabs
            ariaLabel="Khu vực của hub Hàng hóa"
            className="border-b-0"
            tabs={hubTabs}
            value={tab}
            onChange={(key) => {
              if (key === "links") {
                setLinkSeed(undefined);
                setLinkTargetProduct(null);
              }
              setTab(key);
            }}
          />
        </PageHeaderBand>

        {tab === "logs" ? (
          <InventoryLogTable showLocation={locationsEnabled} />
        ) : tab === "links" && isAdmin ? (
          <LinkManager
            key={`${linkSeed ?? "all"}:${linkTargetProduct?.id ?? ""}`}
            initialSearch={linkSeed}
            targetProduct={linkTargetProduct}
            onClearTarget={() => setLinkTargetProduct(null)}
            onChanged={() => {
              load();
              loadCounts();
            }}
          />
        ) : (
          <>
            {/* ===== TẦNG 1: NGUYÊN LÝ + 3 BƯỚC THIẾT LẬP (tự thu gọn khi xong) =====
                CHỈ ở tab Tồn kho (anh Trung 06/09: tab Sản phẩm trên sàn là chỗ làm
                việc chi tiết, không kể chuyện hai lần). Cách bảng bên dưới một
                khoảng lớn hơn nhịp thường để hai khối tách tông. */}
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
                onOpenLinks={() => jumpToLinks()}
                onOpenSync={() => setSyncOpen(true)}
              />
            </div>

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
                    placeholder="Tìm theo mã SKU hoặc tên sản phẩm…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="secondary">
                  Tìm kiếm
                </Button>
              </form>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => setLocationsOpen(true)}
                    title={
                      locationsEnabled
                        ? `${locations.length} vị trí chứa hàng — bấm để quản lý`
                        : "Thuê thêm kho nhỏ / kệ? Thêm vị trí chứa hàng"
                    }
                  >
                    <MapPin className="size-4" />
                    {locationsEnabled ? `Vị trí (${locations.length})` : "Thêm vị trí chứa hàng"}
                  </Button>
                )}
                <Button variant="outline" nativeButton={false} render={<Link href="/products/receive" />}>
                  <ClipboardList className="size-4" />
                  Phiếu nhiều mã
                </Button>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/products/stocktake" />}
                  title="Đếm thực tế rồi chốt — mỗi mã lệch một dòng nhật ký"
                >
                  <ClipboardCheck className="size-4" />
                  Kiểm kê
                </Button>
                {locationsEnabled && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/products/putaway" />}
                    title="Quét tem kệ → quét SKU → chuyển hàng loạt từ Kho chính lên kệ"
                  >
                    <PackageOpen className="size-4" />
                    Cất lên kệ
                  </Button>
                )}
                <ImportExcelDialog onImported={load} />
                <Button variant="outline" onClick={handleExport} disabled={exporting}>
                  {exporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  Xuất Excel
                </Button>
                {/* 30/10/2026 anh chốt: bỏ hộp "Thêm sản phẩm mới" cũ (SKU + giá + tồn), thay bằng luồng
                    Tạo sản phẩm mới của Sao chép sản phẩm (soạn đủ chuẩn sàn → đăng lên gian + ghi Tổng kho). */}
                <Button nativeButton={false} render={<Link href="/products/new" />}>
                  <Plus className="size-4" />
                  Tạo sản phẩm mới
                </Button>
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
              </div>
            )}
            </div>

            {/* Cảnh báo lệch tồn với sàn — việc vận hành, chỉ hiện khi có lỗi chưa xử lý */}
            <SyncAlertBanner />

            <Card>
              <CardContent className="p-0">
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
                        Chưa có sản phẩm nào. Nối gian hàng để kéo sản phẩm từ sàn về (bước 1
                        phía trên), hoặc bấm “Tạo sản phẩm mới” / nhập Excel nếu bán ngoài sàn.
                      </p>
                    ) : isAdmin && (counts?.all ?? 0) === 0 ? (
                      <p>
                        Chưa có sản phẩm nào. Bấm “Kéo sản phẩm về” ở bước 1 phía trên để lấy
                        hàng từ gian đã nối, hoặc “Tạo sản phẩm mới” / nhập Excel nếu bán ngoài sàn.
                      </p>
                    ) : (
                      <p>Chưa có sản phẩm nào. Bấm “Tạo sản phẩm mới” hoặc nhập Excel để bắt đầu.</p>
                    )}
                  </div>
                ) : (
                  // table-fixed theo % (anh Trung 22/10: cột Nhập · Xuất bị cắt ở 1700px khi có cột
                  // Đang ở): từ 1.000px trở lên bảng vừa khung, tên / mã tự cắt + tooltip, chip Bán trên
                  // xuống dòng. Dưới 1.000px (laptop 1280 mở sidebar + có cột Đang ở) hộp cuộn ngang
                  // thay vì để số đè lên nhau — ô số không được phép tràn. Bề rộng cột ở COL_HEAD_CLASS.
                  <Table className="table-fixed min-w-[1000px]">
                    <TableHeader>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead
                              key={header.id}
                              // Tiêu đề được xuống dòng khi cột hẹp (1280: "Giá vốn mặc định" từng đè lên "Giá bán").
                              className={cn("whitespace-normal leading-tight", COL_HEAD_CLASS[header.column.id])}
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
                                  <TableCell key={cell.id}>
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </TableCell>
                                ))}
                              </TableRow>
                            );
                            if (expandedId === p.id) out.push(renderExpanded(p));
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

      {/* Cài đặt đồng bộ tồn kho (chỉ chủ shop) */}
      {isAdmin && (
        <SyncSettingsDialog
          open={syncOpen}
          onOpenChange={setSyncOpen}
          onStateChange={setSyncState}
        />
      )}

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
