"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Download,
  Link2,
  Link2Off,
  Loader2,
  Search,
  Settings2,
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
import { HubStoryStrip } from "@/components/products/hub-story-strip";
import { ImportExcelDialog } from "@/components/products/import-excel-dialog";
import { SyncAlertBanner } from "@/components/products/sync-alert-banner";
import { LinkManager } from "@/components/products/link-manager";
import {
  SyncSettingsDialog,
  type SyncHeaderState,
} from "@/components/products/sync-settings-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  fetchProductChannelLinks,
  fetchProducts,
  fetchSyncSettings,
  getStoredUser,
  getToken,
  unlinkChannelProducts,
  type Product,
  type ProductChannelLink,
} from "@/lib/api";
import { exportAllProducts } from "@/lib/excel";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { canManageShop, canSeeFinancials } from "@/lib/permissions";
import { TEXT_NUMBER_MUTED, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

const columnHelper = createColumnHelper<Product>();

type HubTab = "inventory" | "links";

/**
 * HUB "HÀNG HÓA" — một trang cho toàn bộ vòng đời hàng hóa của seller, thay ba
 * trang cũ (Kho vật lý / Liên kết sản phẩm / Đồng bộ tồn kho):
 *
 *   · Tab TỒN KHO: bảng SKU kho + cột "Bán trên" (các gian đã nối, badge lệch
 *     tồn) — bấm dòng bung ra từng SKU sàn với lượt đẩy tồn gần nhất, gỡ nối/
 *     nối thêm ngay tại chỗ.
 *   · Tab CHỜ LIÊN KẾT (chỉ chủ shop): trình quản lý liên kết + nút một cú bấm
 *     "Tự khớp + tạo SKU toàn bộ".
 *   · ĐỒNG BỘ là nút chứ không phải trang: chip BẬT/TẮT + dialog cài đặt.
 *
 * Route cũ /mappings và /warehouse/sync redirect về đây (?tab=links / ?sync=1).
 */
export default function ProductsHubPage() {
  const router = useRouter();
  const isAdmin = canManageShop(getStoredUser());

  const [tab, setTab] = useState<HubTab>("inventory");
  // Từ khoá mồi cho tab Chờ liên kết khi bấm "Nối thêm gian" từ một SKU.
  const [linkSeed, setLinkSeed] = useState<string | undefined>(undefined);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  // Số SP sàn chưa nối — nuôi badge tab + banner gợi ý (chỉ chủ shop).
  const [unlinkedCount, setUnlinkedCount] = useState(0);

  // Trạng thái đồng bộ cho chip header (chỉ chủ shop).
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
    queryKey: qk.products({ page, pageSize: PAGE_SIZE, search }),
    queryFn: () => fetchProducts({ page, pageSize: PAGE_SIZE, search }),
  });
  const invalidate = useInvalidate();
  const items = productsQ.data?.items ?? [];
  const total = productsQ.data?.total ?? 0;
  const pageCount = productsQ.data?.pageCount ?? 0;
  const loading = productsQ.refreshing;
  const error = productsQ.error;

  // Gọi sau mọi thao tác GHI (tạo SKU, nhập Excel, nối/gỡ liên kết, chỉnh
  // tồn): làm tươi mọi trang cache + xoá cache chi tiết liên kết đã đổi.
  const load = useCallback(() => {
    setLinkDetails({});
    invalidate(["products"]);
  }, [invalidate]);

  const loadUnlinkedCount = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetchChannelProducts({ page: 1, pageSize: 1 });
      setUnlinkedCount(res.counts.unlinked);
    } catch {
      // chưa có kênh / lỗi mạng — badge để 0, không chặn trang
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  useEffect(() => {
    loadUnlinkedCount();
    if (isAdmin) {
      fetchSyncSettings()
        .then((s) =>
          setSyncState({
            enabledCount: s.enabledCount,
            totalChannels: s.channels.length,
            pending: s.pendingJobs,
          })
        )
        .catch(() => {});
    }
    // Route cũ redirect về kèm query: ?tab=links mở tab liên kết, ?sync=1 mở
    // dialog cài đặt. Đọc một lần lúc mount — không cần useSearchParams.
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "links" && canManageShop(getStoredUser())) {
      setTab("links");
    }
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

  /** Bung/cụp một dòng; lần đầu bung thì tải chi tiết liên kết (lazy + cache). */
  const toggleExpand = useCallback(
    (product: Product) => {
      setExpandedId((cur) => (cur === product.id ? null : product.id));
      if (linkDetails[product.id]) return;
      setLinkDetails((prev) => ({ ...prev, [product.id]: "loading" }));
      fetchProductChannelLinks(product.id)
        .then((links) =>
          setLinkDetails((prev) => ({ ...prev, [product.id]: links }))
        )
        .catch(() =>
          setLinkDetails((prev) => {
            const next = { ...prev };
            delete next[product.id];
            return next;
          })
        );
    },
    [linkDetails]
  );

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
      loadUnlinkedCount();
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
      columnHelper.accessor("skuCode", {
        header: "Mã SKU",
        cell: (info) => (
          <span className="font-mono text-sm font-medium">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("productName", {
        header: "Tên sản phẩm",
        cell: (info) => <span>{info.getValue()}</span>,
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
        cell: (info) => {
          const qty = info.getValue();
          const held = info.row.original.holdQuantity ?? 0;
          // Màu theo NGƯỠNG CẢNH BÁO của SKU (riêng ?? shop) — không còn số cứng.
          const low = info.row.original.isLowStock ?? false;
          const threshold = info.row.original.lowStockThresholdEffective ?? 0;
          return (
            <div
              className="text-center"
              title={
                threshold > 0
                  ? `Ngưỡng cảnh báo sắp hết: ${formatNumber(threshold)}`
                  : "Chưa đặt ngưỡng cảnh báo sắp hết hàng"
              }
            >
              <span
                className={cn(
                  "inline-flex min-w-12 items-center justify-center rounded-full border px-2.5 py-0.5 text-sm font-semibold",
                  qty - held <= 0
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : low
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                )}
              >
                {formatNumber(qty)}
              </span>
              {held > 0 && (
                <p className="mt-1 text-xs text-amber-600">Giữ {formatNumber(held)}</p>
              )}
              {low && qty - held > 0 && (
                <p className="mt-0.5 text-xs font-medium text-amber-700">
                  ≤ ngưỡng {formatNumber(threshold)}
                </p>
              )}
            </div>
          );
        },
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
          // MỖI GIAN MỘT CHIP "tên shop + số đang hiện": nhìn một dòng là thấy
          // gian nào đang cùng số với kho (xanh), gian nào lệch/đẩy fail (đỏ),
          // gian nào chưa bật (xám). Câu chuyện "mọi gian cùng một số" nằm ngay đây.
          const available = row.original.availableToSell ?? 0;
          return (
            <button
              type="button"
              onClick={() => toggleExpand(row.original)}
              className="flex flex-wrap items-center gap-1.5 text-left"
              title="Bấm để xem sơ đồ kho ↔ từng gian"
            >
              {links.map((l) => {
                const meta = CHANNEL_META[l.channelName];
                const state = l.state ?? "unknown";
                const num =
                  state === "pending"
                    ? available
                    : l.channelStock === null || l.channelStock === undefined
                      ? null
                      : l.channelStock;
                const tone =
                  state === "match"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : state === "mismatch" || state === "alert"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : state === "pending"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-slate-200 bg-slate-50 text-slate-600";
                const hint =
                  state === "match"
                    ? "đang cùng số với kho"
                    : state === "mismatch"
                      ? `sàn đang ${formatNumber(num ?? 0)}, kho muốn ${formatNumber(available)}`
                      : state === "alert"
                        ? "đẩy tồn thất bại — xem cảnh báo"
                        : state === "pending"
                          ? "đang đẩy số mới lên sàn"
                          : state === "off"
                            ? "gian chưa bật đồng bộ — số này là của sàn"
                            : "sàn chưa trả số / chưa hỗ trợ";
                return (
                  <span
                    key={`${l.channelName}:${l.channelSku}`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                      tone
                    )}
                    title={`${meta?.label ?? l.channelName} · ${l.shopName} · SKU sàn ${l.channelSku} — ${hint}`}
                  >
                    <span className="max-w-24 truncate">{l.shopName}</span>
                    {state === "pending" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : state === "match" ? (
                      <CheckCircle2 className="size-3" />
                    ) : state === "mismatch" || state === "alert" ? (
                      <XCircle className="size-3" />
                    ) : null}
                    {num === null ? "?" : formatNumber(num)}
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
        header: () => <div className="text-center">Nhập / Xuất kho</div>,
        cell: ({ row }) => (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-emerald-700 hover:bg-emerald-50"
              onClick={() => setAdjusting({ product: row.original, type: "IMPORT" })}
            >
              <ArrowDownToLine className="size-4" />
              Nhập
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-rose-700 hover:bg-rose-50"
              disabled={row.original.quantityInStock === 0}
              onClick={() => setAdjusting({ product: row.original, type: "EXPORT" })}
            >
              <ArrowUpFromLine className="size-4" />
              Xuất
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "px-2",
                  row.original.isLowStock ? "text-amber-700" : "text-muted-foreground"
                )}
                title="Ngưỡng cảnh báo sắp hết hàng & tồn an toàn của SKU"
                aria-label={`Cài đặt SKU ${row.original.skuCode}`}
                onClick={() => setSkuSettings(row.original)}
              >
                <BellRing className="size-4" />
              </Button>
            )}
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seesCost, isAdmin, expandedId, linkDetails]
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

  const tabButton = (key: HubTab, label: string, badge?: number) => (
    <button
      type="button"
      aria-pressed={tab === key}
      onClick={() => {
        if (key === "links") setLinkSeed(undefined);
        setTab(key);
      }}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
        tab === key
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
            tab === key
              ? "bg-primary-foreground/20"
              : "bg-amber-100 text-amber-800"
          )}
        >
          {formatNumber(badge)}
        </span>
      )}
    </button>
  );

  return (
    <AppShell>
      <div className="space-y-5">
        {/* ===== THANH TAB + TRẠNG THÁI ĐỒNG BỘ ===== */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {tabButton("inventory", "Tồn kho")}
            {isAdmin && tabButton("links", "Chờ liên kết", unlinkedCount)}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {syncState && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                    syncState.enabledCount > 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  )}
                  title="Số gian đang bật đồng bộ tồn / tổng gian Shopee+Lazada đang nối"
                >
                  <CloudUpload className="size-3.5" />
                  Đồng bộ sàn:{" "}
                  {syncState.totalChannels === 0
                    ? "chưa có gian"
                    : syncState.enabledCount === 0
                      ? "TẮT"
                      : `${syncState.enabledCount}/${syncState.totalChannels} gian`}
                  {syncState.pending > 0 && (
                    <span className="flex items-center gap-1">
                      · <Loader2 className="size-3 animate-spin" />
                      {formatNumber(syncState.pending)}
                    </span>
                  )}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)}>
                <Settings2 className="size-4" />
                Cài đặt
              </Button>
            </div>
          )}
        </div>

        {tab === "links" && isAdmin ? (
          <LinkManager
            key={linkSeed ?? "all"}
            initialSearch={linkSeed}
            onChanged={() => {
              load();
              loadUnlinkedCount();
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-muted-foreground">
                SKU nội bộ, tồn kho{seesCost ? " và giá vốn" : ""} (
                {formatNumber(total)} sản phẩm) — cột “Bán trên” cho biết mỗi SKU
                đang nối những gian nào.
              </p>
              <div className="flex flex-wrap items-center gap-2">
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

            {/* Dải kể chuyện: 1 SKU kho ↔ nhiều gian, đặt CÙNG MÃ SKU (đóng được) */}
            <HubStoryStrip />

            {/* Cảnh báo lệch tồn với sàn — chỉ hiện khi có cảnh báo chưa xử lý */}
            <SyncAlertBanner />

            {/* Gợi ý xử lý SP sàn chưa nối — dẫn thẳng sang tab Chờ liên kết */}
            {isAdmin && unlinkedCount > 0 && (
              <button
                type="button"
                onClick={() => jumpToLinks()}
                className="flex w-full items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-primary/10"
              >
                <Sparkles className="size-4 shrink-0 text-primary" />
                <span>
                  Còn <b>{formatNumber(unlinkedCount)}</b> sản phẩm trên sàn chưa
                  nối về kho — sang tab <b>Chờ liên kết</b> để tự khớp hoặc tạo
                  SKU một cú bấm.
                </span>
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
              </button>
            )}

            {/* Thanh tìm kiếm */}
            <form onSubmit={handleSearch} className="flex max-w-md gap-2">
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
            </form>

            <Card>
              <CardContent className="p-0">
                {error ? (
                  <p className="py-10 text-center text-sm text-amber-700">{error}</p>
                ) : loading ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Đang tải dữ liệu…
                  </p>
                ) : items.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {search
                      ? `Không tìm thấy sản phẩm nào khớp với "${search}".`
                      : "Chưa có sản phẩm nào. Bấm “Thêm sản phẩm mới” để bắt đầu."}
                  </p>
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

      {/* Hộp thoại nhập/xuất kho */}
      {adjusting && (
        <AdjustStockDialog
          product={adjusting.product}
          type={adjusting.type}
          open={true}
          onOpenChange={(open) => {
            if (!open) setAdjusting(null);
          }}
          onDone={load}
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
    </AppShell>
  );
}
