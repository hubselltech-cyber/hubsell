"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ClipboardCheck,
  ClipboardList,
  Download,
  Link2,
  Link2Off,
  Loader2,
  MapPin,
  PackageOpen,
  Search,
  Sparkles,
  Warehouse,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/shell/app-shell";
import { Money } from "@/components/ui/money";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { AdjustStockDialog } from "@/components/products/adjust-stock-dialog";
import { SkuSettingsDialog } from "@/components/products/sku-settings-dialog";
import { SetupGuide, type ChannelProductCounts } from "@/components/products/setup-guide";
import { OneClickLinkDialog } from "@/components/products/one-click-link-dialog";
import { InlineStockEditor } from "@/components/products/inline-stock-editor";
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
import { locationLabel, locationTree } from "@/lib/stock-locations";
import { formatNumber } from "@/lib/format";
import { canManageShop, canSeeFinancials } from "@/lib/permissions";
import { TEXT_NUMBER_MUTED, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

const columnHelper = createColumnHelper<Product>();

type HubTab = "inventory" | "links" | "logs";

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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  // Đang bán (mặc định) / Ngừng bán — chip chỉ hiện khi có SKU ngừng bán.
  const [status, setStatus] = useState<ProductStatusFilter>("active");
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
  const productsQ = useApiQuery({
    queryKey: qk.products({ page, pageSize: PAGE_SIZE, search, status, locationFilter }),
    queryFn: () =>
      fetchProducts({ page, pageSize: PAGE_SIZE, search, status, locationId: locationFilter || undefined }),
  });
  const inactiveCount = productsQ.data?.inactiveCount ?? 0;
  const invalidate = useInvalidate();
  const items = useMemo(() => productsQ.data?.items ?? [], [productsQ.data]);
  const total = productsQ.data?.total ?? 0;
  const pageCount = productsQ.data?.pageCount ?? 0;
  // Khối Kho trung tâm đếm SKU ĐANG BÁN toàn shop — không đổi theo chip lọc /
  // ô tìm (backend cũ chưa trả activeCount thì rơi về total như trước).
  const activeTotal = productsQ.data?.activeCount ?? total;

  useEffect(() => {
    setSelected(new Map());
  }, [page, search, status, tab, locationFilter]);
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

  /** "Nối thêm gian" từ một SKU: nhảy sang tab liên kết, mồi sẵn từ khoá. */
  function jumpToLinks(seedSearch?: string) {
    setLinkSeed(seedSearch);
    setTab("links");
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
      // Cả khối làm việc phải nằm gọn một màn hình (anh Trung 05/09): SKU và
      // tên CẮT NGẮN, rê chuột hiện đầy đủ — không kéo thanh trượt đi kéo lại.
      columnHelper.accessor("skuCode", {
        header: "Mã SKU",
        cell: (info) => (
          <span
            className="block max-w-[8rem] truncate font-mono text-sm font-medium 2xl:max-w-[14rem]"
            title={info.getValue()}
          >
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("productName", {
        header: "Tên sản phẩm",
        cell: (info) => (
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "block max-w-[13rem] truncate 2xl:max-w-[26rem]",
                info.row.original.isActive === false && "text-muted-foreground line-through decoration-slate-300"
              )}
              title={info.getValue()}
            >
              {info.getValue()}
            </span>
            {info.row.original.isActive === false && (
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                Ngừng bán
              </span>
            )}
          </span>
        ),
      }),
      ...(seesCost
        ? [
            columnHelper.accessor("costPrice", {
              header: () => <div className="text-right">Giá vốn</div>,
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
                onClick={() => jumpToLinks(row.original.skuCode)}
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
              className="flex flex-nowrap items-center gap-1.5 text-left"
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
    [seesCost, isAdmin, expandedId, linkDetails, locations, selected, allOnPage, toggleAllOnPage, toggleOne]
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
              Kho Hubsell
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
                onClick={() => jumpToLinks(product.skuCode)}
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
    { key: "inventory", label: "Tồn kho" },
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
              if (key === "links") setLinkSeed(undefined);
              setTab(key);
            }}
          />
        </PageHeaderBand>

        {tab === "logs" ? (
          <InventoryLogTable showLocation={locationsEnabled} />
        ) : tab === "links" && isAdmin ? (
          <LinkManager
            key={linkSeed ?? "all"}
            initialSearch={linkSeed}
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <form onSubmit={handleSearch} className="flex w-full max-w-md gap-2">
                <div className="relative flex-1">
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
                {/* Chip "Tại vị trí" — chỉ khi shop dùng vị trí; chọn kho là gom cả kệ / tầng bên trong. */}
                {locationsEnabled && (
                  <NativeSelect
                    aria-label="Lọc theo vị trí chứa hàng"
                    className={cn("w-56 [&>select]:rounded-full [&>select]:text-xs", locationFilter && "[&>select]:border-primary [&>select]:font-medium")}
                    value={locationFilter}
                    onChange={(e) => {
                      setLocationFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Tại vị trí: tất cả</option>
                    {locationTree(locations).map(({ loc, depth }) => (
                      <option key={loc.id} value={loc.id}>
                        {"\u00a0\u00a0".repeat(depth)}
                        {depth > 0 ? "› " : ""}
                        {loc.name}
                        {loc.skuCount ? ` · ${loc.skuCount} SKU` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                {/* Chip Ngừng bán chỉ hiện khi có SKU ngừng bán (ẩn bằng vắng mặt). */}
                {(inactiveCount > 0 || status !== "active") && (
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { key: "active", label: "Đang bán" },
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
                <ProductFormDialog onCreated={load} />
              </div>
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
                        phía trên), hoặc bấm “Thêm sản phẩm mới” / nhập Excel nếu bán ngoài sàn.
                      </p>
                    ) : isAdmin && (counts?.all ?? 0) === 0 ? (
                      <p>
                        Chưa có sản phẩm nào. Bấm “Kéo sản phẩm về” ở bước 1 phía trên để lấy
                        hàng từ gian đã nối, hoặc “Thêm sản phẩm mới” / nhập Excel nếu bán ngoài sàn.
                      </p>
                    ) : (
                      <p>Chưa có sản phẩm nào. Bấm “Thêm sản phẩm mới” hoặc nhập Excel để bắt đầu.</p>
                    )}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
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
                      {table.getRowModel().rows.flatMap((row) => {
                        const rendered = [
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext()
                                )}
                              </TableCell>
                            ))}
                          </TableRow>,
                        ];
                        if (expandedId === row.original.id) {
                          rendered.push(renderExpanded(row.original));
                        }
                        return rendered;
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Phân trang */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Trang {page} / {pageCount}
                </p>
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
