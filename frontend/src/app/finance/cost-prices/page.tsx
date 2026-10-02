"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Loader2,
  PackageSearch,
  Search,
  SearchX,
  X,
} from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { can } from "@/lib/permissions";
import { AppShell } from "@/components/shell/app-shell";
import { CostMappingTab } from "@/components/finance/cost-mapping-tab";
import {
  CostPriceTable,
  type ProductGroup,
} from "@/components/finance/cost-price-table";
import { ImportCostDialog } from "@/components/finance/import-cost-dialog";
import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeaderBand, PageTabs } from "@/components/ui/page-tabs";
import {
  ApiError,
  backfillCostPricesToOrders,
  fetchCatalogPending,
  fetchSkuProducts,
  fillSuggestedCosts,
  getStoredUser,
  getToken,
  updateSkuCostPrice,
  type CatalogPendingChannel,
  type CostSiblings,
  type SkuChannelFilter,
  type SkuProduct,
} from "@/lib/api";
import { exportCostPricesToExcel } from "@/lib/excel";
import { formatVND, formatNumber } from "@/lib/format";
import { normalizeText } from "@/lib/text";
import { cn } from "@/lib/utils";
import { baseProductName, variantGroupKey } from "@/lib/variant-group";

// Trạng thái giá vốn để lọc
type CostStatusFilter = "all" | "missing" | "filled";

const STATUS_OPTIONS: { value: CostStatusFilter; label: string }[] = [
  { value: "all", label: "Tất cả sản phẩm" },
  { value: "missing", label: "Chưa nhập giá vốn" },
  { value: "filled", label: "Đã nhập giá vốn" },
];

// Trạng thái TRÊN SÀN: mặc định chỉ hiện hàng đang bán — SKU sàn đã gỡ/ẩn/xóa
// vẫn được giữ (để đơn cũ tra giá vốn) nhưng không cần khách nhập giá vốn nữa.
// Khách 28/09: "không có filter theo các mặt hàng đang hoạt động".
type ListingFilter = "active" | "delisted" | "all";

const LISTING_OPTIONS: { value: ListingFilter; label: string }[] = [
  { value: "active", label: "Đang bán trên sàn" },
  { value: "delisted", label: "Đã gỡ trên sàn" },
  { value: "all", label: "Tất cả, kể cả đã gỡ" },
];

// Hai tab của trang: nhập từng SKU, hoặc mapping một lần cho mọi gian
const PAGE_TABS = [
  { key: "entry", label: "Nhập giá vốn" },
  { key: "mapping", label: "Mapping giá vốn" },
] as const;
type PageTab = (typeof PAGE_TABS)[number]["key"];

/** Khoá localStorage nhớ đã tắt dải cảnh báo thiếu giá vốn (nối thêm userId). */
const BANNER_HIDE_KEY = "hubsell_cost_missing_banner_hidden";

// Phân trang theo SẢN PHẨM (nhóm cha), KHÔNG theo dòng — anh Trung 28/09: một
// mẫu 25 phân loại không bị ngắt giữa hai trang. 20 mặc định, tối đa 50.
const PAGE_SIZES = [20, 50] as const;
const PAGE_SIZE_KEY = "hubsell_cost_prices_page_size";

// Nhịp hỏi "danh mục gian mới về chưa" — chỉ là nhịp làm tươi màn hình (câu hỏi
// nhẹ, một truy vấn theo chủ shop), không phải giới hạn của sàn hay của worker.
const CATALOG_POLL_MS = 15_000;

// Các tab lọc theo sàn
const TABS: { key: SkuChannelFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "shopee", label: "Shopee" },
  { key: "tiktok", label: "TikTok Shop" },
  { key: "lazada", label: "Lazada" },
  { key: "offline", label: "Offline" },
];

export default function CostPricesPage() {
  const router = useRouter();
  const [pageTab, setPageTab] = useState<PageTab>("entry");
  const [channel, setChannel] = useState<SkuChannelFilter>("all");
  const [items, setItems] = useState<SkuProduct[]>([]);
  const [missingCount, setMissingCount] = useState(0);
  // Gian vừa nối, danh mục chưa kéo xong lần đầu (worker đang kéo nền).
  const [catalogPending, setCatalogPending] = useState<CatalogPendingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // Giá trị đang gõ trong từng ô input (theo skuId)
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // skuId đang lưu / vừa lưu xong (để hiện spinner & dấu tick)
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // ----- Bộ lọc nâng cao -----
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CostStatusFilter>("all");
  const [listing, setListing] = useState<ListingFilter>("active");
  // Đang chạy "Áp giá vốn cho đơn cũ"
  const [backfilling, setBackfilling] = useState(false);
  // Dải "còn X SKU chưa nhập giá vốn": người đã biết bấm X là không hiện lại
  // (nhớ theo tài khoản trong localStorage — anh Trung 28/09 "đỡ ngứa mắt").
  const [bannerHidden, setBannerHidden] = useState(true);
  useEffect(() => {
    try {
      const uid = getStoredUser()?.id ?? "";
      setBannerHidden(localStorage.getItem(`${BANNER_HIDE_KEY}:${uid}`) === "1");
    } catch {
      setBannerHidden(false);
    }
  }, []);
  function hideBanner() {
    setBannerHidden(true);
    try {
      const uid = getStoredUser()?.id ?? "";
      localStorage.setItem(`${BANNER_HIDE_KEY}:${uid}`, "1");
    } catch {
      // không lưu được thì chỉ ẩn trong phiên này
    }
  }

  // Tập nền theo trạng thái trên sàn — các bộ lọc khác và "Hiển thị X/Y" tính trên tập này.
  const listedItems = useMemo(
    () =>
      listing === "all"
        ? items
        : items.filter((i) => (listing === "active") === (i.status === "ACTIVE")),
    [items, listing]
  );
  const delistedCount = useMemo(
    () => items.filter((i) => i.status === "DELISTED").length,
    [items]
  );

  // Lọc ngay tại màn hình → kết quả cập nhật tức thì khi gõ, không cần chờ API
  const filteredItems = useMemo(() => {
    const keyword = normalizeText(search.trim());
    return listedItems.filter((item) => {
      // Lọc theo trạng thái giá vốn
      const cost = Number(item.costPrice);
      if (statusFilter === "missing" && cost > 0) return false;
      if (statusFilter === "filled" && cost <= 0) return false;

      // Lọc theo từ khoá: tên sản phẩm, mã SKU, hoặc tên phân loại trên sàn
      if (!keyword) return true;
      return (
        normalizeText(item.productName).includes(keyword) ||
        normalizeText(item.sku).includes(keyword) ||
        normalizeText(item.variantName ?? "").includes(keyword) ||
        // Mã sản phẩm / mã phân loại trên sàn — seller quen tra theo mã sàn
        (item.itemId ?? "").includes(keyword) ||
        (item.modelId ?? "").includes(keyword)
      );
    });
  }, [listedItems, search, statusFilter]);

  const isFiltering = search.trim() !== "" || statusFilter !== "all";

  /**
   * Gom dòng đã lọc thành cây Sản phẩm cha → Biến thể con để đưa vào bảng.
   * Giữ nguyên thứ tự xuất hiện đầu tiên của mỗi mẫu, không sắp xếp lại, để
   * người dùng đổi bộ lọc mà các dòng không nhảy lung tung.
   */
  const groups = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, ProductGroup>();
    for (const item of filteredItems) {
      const key = variantGroupKey(item.productName);
      const existing = map.get(key);
      if (existing) {
        existing.variants.push(item);
        // Mẫu lấy ảnh của phân loại đầu tiên có ảnh
        if (!existing.imageUrl) existing.imageUrl = item.imageUrl;
      } else {
        map.set(key, {
          key,
          name: baseProductName(item.productName),
          imageUrl: item.imageUrl,
          variants: [item],
        });
      }
    }
    return [...map.values()];
  }, [filteredItems]);

  // ----- Phân trang theo sản phẩm -----
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
      if ((PAGE_SIZES as readonly number[]).includes(saved)) setPageSize(saved);
    } catch {
      // không đọc được thì giữ mặc định
    }
  }, []);
  // Đổi kênh / tìm kiếm / bộ lọc → về trang 1 để không đứng ở trang trống.
  useEffect(() => {
    setPage(1);
  }, [channel, search, statusFilter, listing]);
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
  // Đổi bộ lọc / tìm kiếm / kênh làm số trang co lại → kéo về trang cuối còn dữ liệu.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const pagedGroups = useMemo(
    () => groups.slice((page - 1) * pageSize, page * pageSize),
    [groups, page, pageSize]
  );
  const pageSkuCount = useMemo(
    () => pagedGroups.reduce((n, g) => n + g.variants.length, 0),
    [pagedGroups]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSkuProducts(channel);
      setItems(res.items);
      setMissingCount(res.missingCostCount);
      setCatalogPending(res.catalogPending ?? []);
      // Nạp giá vốn hiện tại vào ô nhập. Chưa có giá thì để TRỐNG chứ không
      // điền số 0 — để placeholder "Nhập giá vốn" hiện ra, nhìn là biết còn
      // thiếu, thay vì tưởng đã nhập giá vốn bằng 0.
      const next: Record<string, string> = {};
      for (const i of res.items) {
        const cost = Number(i.costPrice);
        next[i.skuId] = cost > 0 ? String(cost) : "";
      }
      // Giữ ô đang gõ dở: lượt nạp lại tự động khi danh mục gian mới về có thể
      // rơi đúng lúc khách đang nhập giá cho gian khác.
      const focused =
        document.activeElement instanceof HTMLInputElement
          ? document.activeElement.dataset.skuId
          : undefined;
      setDrafts((prev) =>
        focused && focused in prev ? { ...next, [focused]: prev[focused] } : next
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      // 409 (chưa có kênh) — AppShell overlay xử lý
    } finally {
      setLoading(false);
    }
  }, [channel, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Giá vốn là số liệu nhạy cảm: chỉ Chủ shop
    if (!can(getStoredUser(), "finance.cost-prices")) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  // Khách bấm "Nhập giá vốn ngay" ở hộp chào sau khi nối gian thường tới đây
  // TRƯỚC khi worker kéo xong danh mục (nhịp quét 5'). Trong lúc chờ: hỏi bản
  // nhẹ theo nhịp, gian nào kéo xong (hoặc lỗi / quá hạn chờ) thì nạp lại bảng.
  useEffect(() => {
    if (catalogPending.length === 0) return;
    const waiting = catalogPending.map((p) => p.id).join(",");
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetchCatalogPending();
        if (r.pending.map((p) => p.id).join(",") !== waiting) load();
      } catch {
        // lỗi mạng thoáng qua — lượt sau hỏi lại
      }
    }, CATALOG_POLL_MS);
    return () => clearInterval(timer);
  }, [catalogPending, load]);

  // Gian đang chờ danh mục thuộc tab sàn đang xem.
  const pendingShops = useMemo(
    () =>
      catalogPending.filter(
        (p) => channel === "all" || p.channelName.toLowerCase() === channel
      ),
    [catalogPending, channel]
  );
  const pendingNote =
    pendingShops.length > 0
      ? `Đang kéo danh mục sản phẩm của gian ${pendingShops
          .map((p) => p.shopName)
          .join(", ")} từ sàn, thường xong trong vài phút. Trang tự cập nhật khi xong.`
      : null;

  /**
   * Vừa lưu giá cho một mã mà mã đó còn nằm ở gian khác → gợi ý áp luôn TẠI CHỖ,
   * khách không phải nhớ sang tab Mapping. Chỉ điền ô TRỐNG; gian đang mang giá
   * khác thì dẫn sang tab Mapping để khách tự quyết (ghi đè hoặc giữ nguyên).
   */
  function offerSiblings(siblings: CostSiblings | null | undefined, what: string) {
    if (!siblings) return;
    if (siblings.fillable > 0) {
      toast(`${what} còn ở ${formatNumber(siblings.fillShops)} gian khác chưa có giá vốn`, {
        duration: 12000,
        action: {
          label: `Áp dụng ${formatNumber(siblings.fillable)} ô trống`,
          onClick: async () => {
            try {
              const r = await fillSuggestedCosts(siblings.fillCodes);
              toast.success(`Đã điền giá vốn cho ${formatNumber(r.filledSkus)} ô ở các gian khác`);
              load();
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Không áp dụng được");
            }
          },
        },
      });
    } else if (siblings.conflicting > 0) {
      toast.warning(`${what} đang có giá vốn khác ở gian khác`, {
        duration: 12000,
        action: { label: "Xem ở Mapping", onClick: () => setPageTab("mapping") },
      });
    }
  }

  // Tự động lưu khi người dùng nhập xong và click ra ngoài ô input
  async function handleBlur(item: SkuProduct) {
    const raw = (drafts[item.skuId] ?? "").trim();
    const value = Number(raw);
    const current = Number(item.costPrice);
    const restore = () =>
      setDrafts((d) => ({
        ...d,
        [item.skuId]: current > 0 ? String(current) : "",
      }));

    if (raw === "") {
      // Ô trống là trạng thái hợp lệ của SKU chưa nhập giá — chỉ báo lỗi khi
      // người dùng xoá mất một giá vốn ĐÃ CÓ (nhiều khả năng là lỡ tay).
      if (current > 0) {
        toast.error("Giá vốn không được để trống");
        restore();
      }
      return;
    }
    if (Number.isNaN(value) || value < 0) {
      toast.error("Giá vốn phải là số không âm");
      restore();
      return;
    }
    if (value === current) return; // không đổi thì không gọi API

    setSavingId(item.skuId);
    try {
      const res = await updateSkuCostPrice(item.skuId, value);
      toast.success(
        `Đã cập nhật giá vốn — ${item.sku}: ${formatVND(value)}` +
          (res.backfilledOrderLines > 0
            ? ` · tính lại ${formatNumber(res.backfilledOrderLines)} dòng đơn cũ`
            : "")
      );
      offerSiblings(res.siblings, `Mã ${item.sku}`);
      setSavedId(item.skuId);
      setTimeout(() => setSavedId(null), 2000);
      // Cập nhật lại danh sách (một sản phẩm gốc có thể gắn nhiều SKU sàn)
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được giá vốn");
      restore();
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Đơn về khi SKU chưa có giá vốn lưu ảnh chụp = 0. Nhập giá vốn ở trang này
   * vốn tự vá đơn cũ; nút này dành cho giá vốn đã nhập từ trước / nhập ở nơi
   * khác — quét lại cả shop một lượt để báo cáo lãi/lỗ, dòng tiền và ROAS hòa
   * vốn của Trợ lý quảng cáo tính lại theo giá vốn hiện tại.
   */
  async function handleBackfill() {
    setBackfilling(true);
    try {
      const r = await backfillCostPricesToOrders();
      // Nói rõ phần còn lại để khách không tưởng nút không chạy (anh Trung 28/09):
      // còn X dòng vì SKU chưa nhập giá; Y dòng vì mã trên đơn đã khác mọi mã sàn.
      const leftover: string[] = [];
      const noCost = r.remainingZeroLines - r.unmatchedZeroLines;
      if (noCost > 0) leftover.push(`${formatNumber(noCost)} dòng thuộc SKU chưa nhập giá vốn`);
      if (r.unmatchedZeroLines > 0)
        leftover.push(`${formatNumber(r.unmatchedZeroLines)} dòng có mã không khớp SKU nào trên sàn`);
      const tail = leftover.length ? ` Còn lại: ${leftover.join("; ")}.` : "";
      if (r.backfilledOrderLines > 0) {
        toast.success(
          `Đã áp giá vốn cho ${formatNumber(r.backfilledOrderLines)} dòng hàng của đơn cũ (mọi đơn, không giới hạn ngày).${tail}`,
          { duration: 12000 }
        );
      } else if (r.remainingZeroLines === 0) {
        toast("Mọi đơn cũ đã có giá vốn — không có dòng nào cần tính lại.");
      } else {
        toast.warning(`Không có dòng nào áp được.${tail}`, { duration: 12000 });
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không áp được giá vốn cho đơn cũ");
    } finally {
      setBackfilling(false);
    }
  }

  // Xuất đúng những dòng đang hiển thị theo bộ lọc — lọc "chưa nhập giá vốn"
  // rồi xuất ra là có ngay file chỉ chứa các mã còn thiếu để điền hàng loạt.
  function handleExport() {
    if (filteredItems.length === 0) {
      toast.error("Không có SKU nào để xuất");
      return;
    }
    exportCostPricesToExcel(filteredItems);
    toast.success(`Đã xuất ${formatNumber(filteredItems.length)} SKU ra Excel`);
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeaderBand>
          <p className="text-sm text-muted-foreground">
            Nhập giá vốn gốc cho từng SKU đã đồng bộ từ sàn. Giá vốn này dùng để
            tính lợi nhuận và cảnh báo đơn lỗ.
          </p>
          <PageTabs
            ariaLabel="Khu vực giá vốn"
            className="mt-2 border-b-0"
            tabs={PAGE_TABS}
            value={pageTab}
            onChange={setPageTab}
          />
        </PageHeaderBand>

        {pageTab === "mapping" && <CostMappingTab onApplied={load} />}

        {/* Tab nhập chỉ ẨN chứ không tháo ra — sang Mapping rồi quay lại thì nhóm
            đang xổ, bộ lọc, ô đang gõ dở vẫn còn nguyên. */}
        <div className={cn("space-y-6", pageTab !== "entry" && "hidden")}>
          {/* Tabs lọc theo sàn + nút Đồng bộ từ sàn */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setChannel(t.key)}
                  className={cn(
                    "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                    channel === t.key
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={loading || filteredItems.length === 0}
              >
                <Download className="size-4" />
                Xuất file Excel
              </Button>

              <ImportCostDialog onImported={load} />

              <Button
                variant="outline"
                onClick={handleBackfill}
                disabled={loading || backfilling}
                title="Đơn về trước khi nhập giá vốn được tính lại theo giá vốn hiện tại — báo cáo lãi/lỗ, dòng tiền 30 ngày và ROAS hòa vốn cập nhật theo"
              >
                {backfilling ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <History className="size-4" />
                )}
                Áp giá vốn cho đơn cũ
              </Button>

              {/* Giữ nút ở đây để đang duyệt tài chính mà thiếu SKU thì đồng
                  bộ tại chỗ. Dùng chung component với trang Sản phẩm. */}
              <SyncChannelProductsButton onSynced={load} />
            </div>
          </div>

          {/* Dải nhắc còn SKU chưa nhập giá vốn — gọn một dòng, X = không hiện lại */}
          {!loading && missingCount > 0 && !bannerHidden && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-800">
              <AlertTriangle className="size-3.5 shrink-0 text-amber-600" />
              <p className="min-w-0 flex-1">
                Còn <b>{formatNumber(missingCount)}</b> SKU đang bán chưa nhập giá vốn — lợi
                nhuận của đơn chứa các SKU này chưa chính xác.
              </p>
              <button
                type="button"
                onClick={hideBanner}
                aria-label="Không hiện lại dải nhắc này"
                title="Không hiện lại"
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* Gian vừa nối đang kéo danh mục — bảng đã có SKU của gian khác nên báo
              bằng một dải gọn; bảng còn trống thì báo ngay trong thân bảng. */}
          {pendingNote && items.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-1.5 text-xs text-sky-800">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600 motion-reduce:animate-none" />
              <p className="min-w-0 flex-1">{pendingNote}</p>
            </div>
          )}

          {/* ===== THANH BỘ LỌC NÂNG CAO ===== */}
          {!loading && items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Ô tìm kiếm real-time */}
              <div className="relative min-w-64 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 pr-9"
                  placeholder="Tìm theo tên sản phẩm hoặc mã SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Xoá từ khoá"
                    className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {/* Lọc theo trạng thái TRÊN SÀN (đang bán / đã gỡ) */}
              <NativeSelect
                className="w-52"
                aria-label="Lọc theo trạng thái trên sàn"
                value={listing}
                onChange={(e) => setListing(e.target.value as ListingFilter)}
              >
                {LISTING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                    {o.value === "delisted" && delistedCount > 0
                      ? ` (${formatNumber(delistedCount)})`
                      : ""}
                  </option>
                ))}
              </NativeSelect>

              {/* Lọc theo trạng thái giá vốn */}
              <NativeSelect
                className="w-52"
                aria-label="Lọc theo trạng thái giá vốn"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as CostStatusFilter)
                }
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>

              {/* Số kết quả đang hiển thị */}
              {isFiltering && (
                <p className="text-sm text-muted-foreground">
                  Hiển thị <b>{formatNumber(filteredItems.length)}</b>/
                  {formatNumber(listedItems.length)} SKU
                </p>
              )}
            </div>
          )}

          {/* overflow-visible để tiêu đề bảng bám dính khi cuộn (Card mặc định
              overflow-hidden sẽ chặn position: sticky) */}
          <Card className="overflow-visible">
            <CardContent className="p-0">
              {/* Chỉ thay bảng bằng chữ "đang tải" ở LẦN ĐẦU. Mỗi lần lưu giá vốn
                  đều gọi load() lại; nếu tháo bảng ra thì component mất trạng thái
                  và mọi nhóm đang xổ sẽ tự thu lại — xổ nhóm, gõ giá, vừa rời ô là
                  nhóm sập xuống, không thao tác tiếp được. */}
              {loading && items.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Đang tải danh sách SKU…
                </p>
              ) : items.length === 0 && pendingNote ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 size-8 animate-spin motion-reduce:animate-none" />
                  {pendingNote}
                </div>
              ) : items.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  <PackageSearch className="mx-auto mb-2 size-8" />
                  Không có SKU nào ở kênh này. Hãy liên kết sản phẩm ở trang “Liên kết
                  SP” trước, hoặc bấm “Đồng bộ từ sàn”.
                </div>
              ) : listedItems.length === 0 && listing === "delisted" ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  <PackageSearch className="mx-auto mb-2 size-8" />
                  Không có SKU nào bị sàn gỡ ở kênh này.
                </div>
              ) : filteredItems.length === 0 && statusFilter === "missing" && !search.trim() ? (
                // Empty state đặc biệt: đã nhập đủ giá vốn cho tất cả sản phẩm
                <div className="py-16 text-center">
                  <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-teal-100">
                    <CheckCircle2 className="size-9 text-teal-600" />
                  </div>
                  <p className="text-lg font-semibold text-teal-700">
                    Tuyệt vời! Toàn bộ sản phẩm của bạn đã được cấu hình giá vốn.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Báo cáo lợi nhuận và cảnh báo đơn lỗ giờ đã chính xác.
                  </p>
                </div>
              ) : filteredItems.length === 0 ? (
                // Không tìm thấy kết quả khớp bộ lọc
                <div className="py-12 text-center">
                  <SearchX className="mx-auto mb-3 size-9 text-muted-foreground" />
                  <p>Không tìm thấy SKU nào phù hợp</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Thử đổi từ khoá, trạng thái giá vốn hoặc chọn “Tất cả, kể cả đã gỡ”.
                  </p>
                </div>
              ) : (
                <Refreshing active={loading}>
                  <CostPriceTable
                    groups={pagedGroups}
                    drafts={drafts}
                    onDraftChange={(skuId, digits) =>
                      setDrafts((d) => ({ ...d, [skuId]: digits }))
                    }
                    onVariantBlur={handleBlur}
                    savingId={savingId}
                    savedId={savedId}
                    onBulkApplied={(siblings) => {
                    load();
                    offerSiblings(siblings, "Các mã vừa nhập");
                  }}
                  />
                </Refreshing>
              )}
            </CardContent>
          </Card>

          {/* Phân trang theo SẢN PHẨM — mỗi trang trọn vẹn 20/50 mẫu kèm mọi phân loại */}
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Hiển thị</span>
                <NativeSelect
                  className="w-20"
                  aria-label="Số sản phẩm mỗi trang"
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
                  sản phẩm/trang · trang này {formatNumber(pageSkuCount)} SKU ·{" "}
                  {formatNumber(groups.length)} sản phẩm · trang {page}/{pageCount}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                  Trang trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Trang sau
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Hubsell Finance · Cấu hình Giá vốn — nhập xong bấm ra ngoài ô là tự động lưu
          </p>
        </div>
      </div>
    </AppShell>
  );
}
