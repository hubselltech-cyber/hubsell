"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  PackagePlus,
  PackageSearch,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { Money } from "@/components/ui/money";
import { Refreshing } from "@/components/shared/refreshing";
import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import { SkuCombobox } from "@/components/finance/sku-combobox";
import { LinkOneDialog } from "@/components/mappings/link-one-dialog";
import { OneClickLinkDialog } from "@/components/products/one-click-link-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  createProductsFromMappings,
  fetchChannelProducts,
  fetchChannels,
  fetchProducts,
  linkChannelProductBySku,
  linkChannelProducts,
  unlinkChannelProducts,
  type Channel,
  type ChannelName,
  type ChannelProduct,
  type Product,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const LINK_TABS: { key: "" | "no" | "yes"; label: string; countKey: string }[] = [
  { key: "", label: "Tất cả", countKey: "all" },
  { key: "no", label: "Chưa liên kết", countKey: "unlinked" },
  { key: "yes", label: "Đã liên kết", countKey: "linked" },
];

// Thứ tự sàn hiển thị ở dropdown "Chọn sàn".
const PLATFORM_OPTIONS: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"];

/** id của <datalist> gợi ý mã SKU kho cho các ô gõ tại dòng. */
const SKU_LIST_ID = "hubsell-sku-kho-options";

interface LinkManagerProps {
  /** Từ khoá tìm kiếm khởi tạo — hub truyền vào khi bấm "Nối thêm gian" từ một SKU. */
  initialSearch?: string;
  /** Gọi sau MỖI thao tác đổi liên kết thành công — hub refresh tab Tồn kho + badge. */
  onChanged?: () => void;
}

/** Một SẢN PHẨM SÀN (gian × id sản phẩm) = các dòng phân loại backend đã xếp liền nhau. */
interface ChannelGroup {
  key: string;
  itemId: string | null;
  name: string;
  imageUrl: string | null;
  channel: ChannelProduct["channel"];
  rows: ChannelProduct[];
}

/** Tên phân loại sàn in cho đẹp: Shopee "Đen,L" → "Đen, L" (cùng cách chuẩn hóa với SKU kho). */
function variantLabel(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Mã máy Hubsell tự sinh khi sàn không có SKU — dòng cha cho gõ MÃ GỐC thay vì giữ mã này. */
function isFallbackSku(sku: string): boolean {
  return /^(SPE|TTK|LZD)-\d/.test(sku);
}

/**
 * TRÌNH QUẢN LÝ LIÊN KẾT SÀN — tab "Sản phẩm trên sàn" của hub Hàng hóa.
 *
 * 22/10/2026 — khách: "nối thủ công kiểu Salework cũng được" → bảng CHA–CON theo
 * SẢN PHẨM SÀN (backend phân trang theo sản phẩm, view=grouped): dòng cha = ảnh +
 * tên + ID sàn + "N phân loại · n chưa nối" + nút "Tạo SKU kho cho cả sản phẩm"
 * (sàn không có mã thì gõ MÃ GỐC, Hubsell ghép phân loại); dòng con = phân loại +
 * mã sàn + Ô GÕ MÃ SKU KHO NGAY TẠI DÒNG (Enter = nối; mã chưa có thì tạo SKU kho
 * mới mang đúng mã) + nút gỡ. Giữ tick nhiều dòng nối chung một SKU, hộp "Tự khớp
 * + tạo SKU" (một cửa vào với bước 2 khối Thiết lập kho) cho khách đã đặt mã chuẩn.
 * CHỈ chủ shop (hub đã gác, API cũng chặn adminOnly độc lập).
 */
export function LinkManager({ initialSearch, onChanged }: LinkManagerProps) {
  const router = useRouter();

  const [rows, setRows] = useState<ChannelProduct[]>([]);
  const [counts, setCounts] = useState({ all: 0, linked: 0, unlinked: 0 });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Bộ lọc phân tầng: sàn (platform) và gian hàng cụ thể (channel).
  const [platformFilter, setPlatformFilter] = useState<ChannelName | "">("");
  const [channelFilter, setChannelFilter] = useState("");
  const [linkTab, setLinkTab] = useState<"" | "no" | "yes">("");
  const [search, setSearch] = useState(initialSearch ?? "");
  const [debounced, setDebounced] = useState(initialSearch ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pageCount, setPageCount] = useState(0);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetSku, setTargetSku] = useState("");
  const [linking, setLinking] = useState(false);
  // Sản phẩm sàn đang THU GỌN (mặc định bung hết — khách đang gõ mã từng phân loại).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Mã gốc đang gõ ở dòng cha, theo khóa nhóm.
  const [rootDrafts, setRootDrafts] = useState<Record<string, string>>({});
  // Nhóm đang tạo SKU kho hàng loạt / dòng đang gỡ.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Sản phẩm sàn đang mở hộp thoại nối nhanh (bấm "Chọn SKU có sẵn" trên dòng)
  const [linkTarget, setLinkTarget] = useState<ChannelProduct | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchChannelProducts({
        channelName: platformFilter || undefined,
        channelId: channelFilter || undefined,
        linked: linkTab || undefined,
        search: debounced || undefined,
        page,
        pageSize,
        view: "grouped",
      });
      setRows(res.items);
      setCounts(res.counts);
      setPageCount(res.pageCount);
      setTotal(res.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 409) return; // chưa có kênh
      toast.error("Không tải được danh sách sản phẩm sàn");
    } finally {
      setLoading(false);
    }
  }, [platformFilter, channelFilter, linkTab, debounced, page, pageSize, router]);

  useEffect(() => {
    load();
  }, [load]);

  // Toàn bộ SKU gốc cho combobox + gợi ý ô gõ tại dòng — gọi lại sau khi tạo SKU kho
  const loadAllProducts = useCallback(async () => {
    const all: Product[] = [];
    let p = 1;
    try {
      for (;;) {
        const res = await fetchProducts({ page: p, pageSize: 100 });
        all.push(...res.items);
        if (p >= res.pageCount || res.pageCount === 0) break;
        p++;
      }
      setProducts(all);
    } catch {
      // không tải được thì combobox rỗng, người dùng vẫn xem được danh sách
    }
  }, []);

  // Danh sách gian hàng + toàn bộ SKU gốc để chọn nối về
  useEffect(() => {
    fetchChannels()
      .then((cs) => setChannels(cs.filter((c) => c.status === "ACTIVE")))
      .catch(() => {});
    loadAllProducts();
  }, [loadAllProducts]);

  /** Thao tác đổi liên kết xong: tải lại bảng + báo hub refresh. */
  const afterChange = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  // Gom dòng theo sản phẩm sàn (backend đã xếp liền nhau theo gian × id sản phẩm).
  const groups = useMemo<ChannelGroup[]>(() => {
    const map = new Map<string, ChannelGroup>();
    const order: ChannelGroup[] = [];
    for (const r of rows) {
      const itemId = (r.externalId ?? "").split("-")[0] || null;
      const key = `${r.channel.id}:${itemId ?? r.id}`;
      let g = map.get(key);
      if (!g) {
        g = { key, itemId, name: r.productName, imageUrl: r.imageUrl, channel: r.channel, rows: [] };
        map.set(key, g);
        order.push(g);
      }
      if (!g.imageUrl && r.imageUrl) g.imageUrl = r.imageUrl;
      g.rows.push(r);
    }
    return order;
  }, [rows]);

  // Chỉ coi là đang chọn những dòng CÒN hiện trên bảng, nên đổi bộ lọc là lựa
  // chọn cũ tự rơi ra — không thể lỡ tay nối những dòng không còn nhìn thấy.
  const selected = rows.filter((r) => selectedIds.has(r.id));
  const allOnPageSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function toggleGroupSelected(g: ChannelGroup) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (g.rows.every((r) => next.has(r.id))) g.rows.forEach((r) => next.delete(r.id));
      else g.rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleLink() {
    const product = products.find((p) => p.skuCode === targetSku);
    if (!product) {
      toast.error("Chọn mã SKU gốc để nối về");
      return;
    }
    setLinking(true);
    try {
      const res = await linkChannelProducts(
        selected.map((s) => s.id),
        product.id
      );
      toast.success(
        `Đã nối ${formatNumber(res.linked)} sản phẩm sàn về ${res.product.skuCode} — ${res.product.productName}` +
          (res.seededStock != null
            ? `. Tồn ban đầu lấy theo sàn: ${formatNumber(res.seededStock)}.`
            : ""),
        { duration: 6000 }
      );
      setSelectedIds(new Set());
      setTargetSku("");
      afterChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không nối được");
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink() {
    setLinking(true);
    try {
      const res = await unlinkChannelProducts(selected.map((s) => s.id));
      toast.success(`Đã gỡ liên kết ${formatNumber(res.unlinked)} sản phẩm sàn`);
      setSelectedIds(new Set());
      afterChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được");
    } finally {
      setLinking(false);
    }
  }

  /** Gỡ MỘT dòng ngay tại chỗ (nút cạnh mã kho đã nối). */
  async function handleUnlinkOne(r: ChannelProduct) {
    setBusyKey(`unlink:${r.id}`);
    try {
      await unlinkChannelProducts([r.id]);
      toast.success(`Đã gỡ ${variantLabel(r.variantName) ?? r.channelSku} khỏi ${r.product?.skuCode ?? "SKU kho"}`);
      afterChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được");
    } finally {
      setBusyKey(null);
    }
  }

  // Tạo sản phẩm kho từ các dòng sàn đã chọn (chỉ dòng CHƯA liên kết) rồi nối luôn.
  const selectedUnlinked = selected.filter((s) => !s.productId);
  async function handleCreateProducts() {
    if (selectedUnlinked.length === 0) return;
    setLinking(true);
    try {
      const r = await createProductsFromMappings(selectedUnlinked.map((s) => s.id));
      toast.success(
        `Đã tạo ${formatNumber(r.createdProducts)} SKU kho mới` +
          (r.reusedProducts > 0
            ? `, dùng lại ${formatNumber(r.reusedProducts)} SKU sẵn có`
            : "") +
          ` và nối ${formatNumber(r.linked)} sản phẩm sàn.` +
          (r.seededProducts > 0
            ? ` Tồn ban đầu của ${formatNumber(r.seededProducts)} SKU lấy theo số trên sàn.`
            : ""),
        { duration: 6000 }
      );
      setSelectedIds(new Set());
      afterChange();
      loadAllProducts(); // combobox phải thấy ngay các SKU kho vừa sinh
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tạo được SKU kho");
    } finally {
      setLinking(false);
    }
  }

  /**
   * "Tạo SKU kho cho cả sản phẩm" ở dòng cha: mọi phân loại CHƯA nối của sản phẩm
   * sàn này thành SKU kho rồi nối. Sàn không có mã → cần MÃ GỐC khách gõ (mã kho =
   * MÃ GỐC-ĐUÔI-PHÂN-LOẠI); sàn có mã → lấy đúng mã sàn.
   */
  async function handleCreateForGroup(g: ChannelGroup) {
    const unlinked = g.rows.filter((r) => !r.productId);
    if (unlinked.length === 0) return;
    const needsRoot = unlinked.some((r) => isFallbackSku(r.channelSku));
    const root = (rootDrafts[g.key] ?? "").trim();
    if (needsRoot && !root) {
      toast.error("Sản phẩm này chưa có mã SKU trên sàn — gõ mã gốc rồi bấm Tạo");
      return;
    }
    setBusyKey(`create:${g.key}`);
    try {
      const r = await createProductsFromMappings(
        unlinked.map((u) => u.id),
        needsRoot && g.itemId ? { rootSkus: { [g.itemId]: root } } : {}
      );
      toast.success(
        `${g.name}: tạo ${formatNumber(r.createdProducts)} SKU kho` +
          (r.reusedProducts > 0 ? ` (dùng lại ${formatNumber(r.reusedProducts)})` : "") +
          `, nối ${formatNumber(r.linked)} phân loại.`,
        { duration: 6000 }
      );
      afterChange();
      loadAllProducts();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tạo được SKU kho");
    } finally {
      setBusyKey(null);
    }
  }

  // ===== MỘT CỬA VÀO: hộp "Tự khớp + tạo SKU" dùng chung với khối Thiết lập kho =====
  const [oneClickOpen, setOneClickOpen] = useState(false);

  // Dropdown 2 chỉ hiện các gian thuộc sàn đang chọn ở Dropdown 1; chưa chọn sàn
  // thì hiện tất cả.
  const visibleChannels = platformFilter
    ? channels.filter((c) => c.channelName === platformFilter)
    : channels;

  // Đổi sàn ở Dropdown 1: reset luôn gian đang chọn nếu nó không thuộc sàn mới.
  function handlePlatformChange(value: ChannelName | "") {
    setPlatformFilter(value);
    if (value && channelFilter) {
      const cur = channels.find((c) => c.id === channelFilter);
      if (!cur || cur.channelName !== value) setChannelFilter("");
    }
    setPage(1);
  }

  const isFiltering =
    Boolean(platformFilter) ||
    Boolean(channelFilter) ||
    Boolean(linkTab) ||
    Boolean(search.trim());

  /** Ô "Liên kết" của một dòng sàn: đã nối → mã kho + gỡ; chưa → ô gõ mã tại chỗ. */
  function renderLinkCell(r: ChannelProduct) {
    if (r.product) {
      return (
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-medium text-emerald-700">
              <Link2 className="size-3.5 shrink-0" />
              <span className="truncate font-mono text-sm">{r.product.skuCode}</span>
            </p>
            <p className={cn(TEXT_SUB, "truncate")} title={r.product.productName}>
              {r.product.productName} · tồn {formatNumber(r.product.quantityInStock)}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-8 shrink-0 px-2.5 text-red-700 hover:bg-red-50 hover:text-red-700"
            onClick={() => handleUnlinkOne(r)}
            disabled={busyKey === `unlink:${r.id}`}
            title="Gỡ nối dòng này khỏi SKU kho"
            aria-label={`Gỡ nối ${variantLabel(r.variantName) ?? r.channelSku}`}
          >
            {busyKey === `unlink:${r.id}` ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Link2Off className="size-3.5" />
            )}
            Gỡ nối
          </Button>
        </div>
      );
    }
    return (
      <InlineSkuLink
        row={r}
        onPick={() => setLinkTarget(r)}
        onLinked={(created) => {
          afterChange();
          if (created) loadAllProducts();
        }}
      />
    );
  }

  return (
    <>
      {/* Gợi ý mã SKU kho cho mọi ô gõ tại dòng (trình duyệt tự lọc theo chữ đang gõ) */}
      <datalist id={SKU_LIST_ID}>
        {products.map((p) => (
          <option key={p.id} value={p.skuCode}>
            {p.variantName ? `${p.productName} (${p.variantName})` : p.productName}
          </option>
        ))}
      </datalist>

      {/* Chừa đáy cho thanh liên kết nổi */}
      <div className="space-y-5 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Sản phẩm thô kéo từ các gian hàng về. Gõ mã SKU kho ngay tại từng phân loại
            (mã chưa có thì Hubsell tạo luôn), hoặc tạo SKU kho cho cả sản phẩm một lần.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Một cửa vào: hộp thoại cho chọn "chỉ tự khớp" hay "tự khớp + tạo SKU" */}
            {counts.unlinked > 0 && (
              <Button onClick={() => setOneClickOpen(true)} disabled={loading}>
                <Sparkles className="size-4" />
                Tự khớp + tạo SKU
              </Button>
            )}
            {/* Đang lọc theo một gian hàng thì chỉ đồng bộ gian đó */}
            <SyncChannelProductsButton
              channelId={channelFilter || undefined}
              onSynced={load}
            />
          </div>
        </div>

        {/* ===== BỘ LỌC ===== */}
        <Card className="shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-3 py-1">
            <div className="flex flex-wrap gap-2">
              {LINK_TABS.map((t) => {
                const active = linkTab === t.key;
                const count = counts[t.countKey as keyof typeof counts];
                return (
                  <button
                    key={t.key || "all"}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setLinkTab(t.key);
                      setPage(1);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {t.label}
                    <span className="tabular-nums opacity-70">
                      {formatNumber(count)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Dropdown 1 — chọn SÀN */}
            <NativeSelect
              className="w-40"
              aria-label="Lọc theo sàn"
              value={platformFilter}
              onChange={(e) =>
                handlePlatformChange(e.target.value as ChannelName | "")
              }
            >
              <option value="">Tất cả các sàn</option>
              {PLATFORM_OPTIONS.map((name) => (
                <option key={name} value={name}>
                  {CHANNEL_META[name].label}
                </option>
              ))}
            </NativeSelect>

            {/* Dropdown 2 — chọn GIAN HÀNG (lọc động theo sàn đã chọn) */}
            <NativeSelect
              className="w-52"
              aria-label="Lọc theo gian hàng"
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả gian hàng</option>
              {visibleChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {platformFilter
                    ? c.shopName
                    : `${CHANNEL_META[c.channelName].label} · ${c.shopName}`}
                </option>
              ))}
            </NativeSelect>

            <div className="relative ml-auto min-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 pr-9"
                placeholder="Tìm mã SKU sàn, tên sản phẩm hoặc phân loại…"
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
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-0">
            {loading && rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải danh mục sàn…
              </p>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <PackageSearch className="mx-auto mb-2 size-8" />
                {isFiltering
                  ? "Không có sản phẩm sàn nào khớp bộ lọc."
                  : "Chưa có sản phẩm sàn nào. Bấm “Đồng bộ từ sàn” để kéo danh mục về."}
              </div>
            ) : (
              <Refreshing active={loading}>
                {/* table-fixed theo % như bảng Giá vốn: KHÔNG cuộn ngang ở mọi cỡ màn (anh Trung
                    22/10: "phải kéo ngang thì rất mất việc"); tên dài tự cắt + tooltip; gian hàng
                    gộp vào ô tên, giá + tồn sàn chung một cột để nhường chỗ cho ô gõ mã kho. */}
                <Table className="table-fixed" containerClassName="overflow-visible">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả trên trang này"
                          checked={allOnPageSelected}
                          onChange={toggleAllOnPage}
                          className="size-4 cursor-pointer accent-primary"
                        />
                      </TableHead>
                      <TableHead className="w-[38%]">Sản phẩm trên sàn</TableHead>
                      <TableHead className="w-[14%] text-right">Giá · Tồn sàn</TableHead>
                      <TableHead>Mã SKU kho (liên kết)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.flatMap((g) => {
                      const multi = g.rows.length > 1;
                      const open = !multi || !collapsed.has(g.key);
                      const out: React.ReactNode[] = [];
                      if (multi) out.push(renderGroupRow(g, open));
                      if (!open) return out;
                      for (const r of g.rows) {
                        const checked = selectedIds.has(r.id);
                        const meta = CHANNEL_META[r.channel.channelName];
                        out.push(
                          <TableRow
                            key={r.id}
                            className={cn(
                              "transition-colors hover:bg-primary/10",
                              multi && "bg-slate-50/60 shadow-[inset_3px_0_0_0_var(--color-primary)]",
                              checked &&
                                "bg-primary/15 hover:bg-primary/20 shadow-[inset_3px_0_0_0_var(--color-primary)]"
                            )}
                          >
                            <TableCell>
                              <input
                                type="checkbox"
                                aria-label={`Chọn ${variantLabel(r.variantName) ?? r.channelSku}`}
                                checked={checked}
                                onChange={() => toggleOne(r.id)}
                                className="size-4 cursor-pointer accent-primary"
                              />
                            </TableCell>

                            <TableCell>
                              {multi ? (
                                // Dòng CON: chỉ phân loại + mã sàn (tên + ảnh đã ở dòng cha)
                                <div className="min-w-0 pl-9">
                                  {/* Sàn không trả tên phân loại (Lazada thiếu saleProp) → mã sàn làm nhãn chính */}
                                  <p
                                    className={cn(
                                      "truncate text-sm font-medium",
                                      r.variantName ? "text-sky-800" : "font-mono text-foreground"
                                    )}
                                    title={variantLabel(r.variantName) ?? r.channelSku}
                                  >
                                    {variantLabel(r.variantName) ?? r.channelSku}
                                  </p>
                                  {r.variantName && (
                                    <p className={cn(TEXT_SUB, "truncate font-mono")} title={r.channelSku}>
                                      {r.channelSku}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <ChannelThumb src={r.imageUrl} alt={r.productName} />
                                  <div className="min-w-0">
                                    <p className="truncate" title={r.productName}>
                                      {r.productName}
                                    </p>
                                    <p className={cn(TEXT_SUB, "truncate")}>
                                      <span className={`mr-1.5 inline-flex items-center rounded-full border px-1.5 py-0 text-[11px] font-medium ${meta.className}`}>
                                        {meta.label}
                                      </span>
                                      {r.channel.shopName}
                                    </p>
                                    {r.variantName && (
                                      <p className="truncate text-xs font-medium text-sky-700" title={variantLabel(r.variantName) ?? undefined}>
                                        {variantLabel(r.variantName)}
                                      </p>
                                    )}
                                    <p className={cn(TEXT_SUB, "truncate font-mono")} title={r.channelSku}>
                                      {r.channelSku}
                                      {r.externalId ? (
                                        <span className="ml-2 text-muted-foreground/70" title="ID sản phẩm trên sàn">
                                          ID {r.externalId}
                                        </span>
                                      ) : null}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </TableCell>

                            <TableCell className="text-right">
                              <Money value={r.price} className="text-slate-900" />
                              <p className={cn(TEXT_SUB, "tabular-nums")}>
                                {r.channelStock === null || r.channelStock === undefined ? (
                                  "tồn —"
                                ) : (
                                  <span className={cn(r.channelStock === 0 && "font-medium text-rose-700")}>
                                    tồn {formatNumber(r.channelStock)}
                                  </span>
                                )}
                              </p>
                            </TableCell>

                            <TableCell>{renderLinkCell(r)}</TableCell>
                          </TableRow>
                        );
                      }
                      return out;
                    })}
                  </TableBody>
                </Table>
              </Refreshing>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hiển thị</span>
              <NativeSelect
                className="w-20"
                aria-label="Số sản phẩm mỗi trang"
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm text-muted-foreground">
                sản phẩm/trang · {formatNumber(total)} sản phẩm sàn · trang {page}/
                {Math.max(1, pageCount)}
              </span>
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
      </div>

      {/* ===== THANH LIÊN KẾT HÀNG LOẠT ===== */}
      {selected.length > 0 && (
        <div
          role="region"
          aria-label="Liên kết hàng loạt"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5"
        >
          <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-lg ring-1 ring-black/10">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                Đã chọn {formatNumber(selected.length)} sản phẩm sàn
              </p>
              <p className={cn(TEXT_SUB, "text-background/70")}>
                Nối tất cả về cùng một SKU gốc
              </p>
            </div>

            <div className="min-w-56 flex-1">
              <SkuCombobox
                products={products}
                value={targetSku}
                onChange={setTargetSku}
                emptyHint="Bấm nút “Tạo SKU kho” bên cạnh — hệ thống tạo SKU từ chính sản phẩm sàn đã chọn rồi nối luôn."
              />
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={handleLink}
              disabled={linking || !targetSku}
              title={!targetSku ? "Chọn mã SKU gốc trước" : undefined}
            >
              {linking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Liên kết
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={handleUnlink}
              disabled={linking}
            >
              <Link2Off className="size-4" />
              Gỡ liên kết
            </Button>

            {selectedUnlinked.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCreateProducts}
                disabled={linking}
                title="Tạo sản phẩm kho mới từ dữ liệu sàn cho các dòng chưa liên kết"
              >
                <PackagePlus className="size-4" />
                Tạo SKU kho ({formatNumber(selectedUnlinked.length)})
              </Button>
            )}

            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              aria-label="Bỏ chọn tất cả"
              className="text-background hover:bg-background/15 hover:text-background"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ===== HỘP THOẠI NỐI NHANH MỘT DÒNG (chọn SKU có sẵn bằng tìm kiếm) ===== */}
      <LinkOneDialog
        item={linkTarget}
        products={products}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null);
        }}
        onDone={afterChange}
      />

      {/* ===== HỘP "TỰ KHỚP + TẠO SKU" (dùng chung với bước 2 khối Thiết lập kho) ===== */}
      <OneClickLinkDialog
        open={oneClickOpen}
        onOpenChange={setOneClickOpen}
        unlinkedCount={counts.unlinked}
        onDone={() => {
          setSelectedIds(new Set());
          afterChange();
          loadAllProducts(); // combobox phải thấy ngay các SKU kho vừa sinh
        }}
      />
    </>
  );

  /**
   * DÒNG CHA của một sản phẩm sàn có ≥ 2 phân loại: ảnh + tên + ID sàn + "N phân
   * loại · n chưa nối"; gian; khoảng giá; tổng tồn sàn; cột liên kết = "Tạo SKU kho
   * cho cả sản phẩm" (kèm ô MÃ GỐC khi sàn không có mã) hoặc "đã nối N/N".
   */
  function renderGroupRow(g: ChannelGroup, open: boolean) {
    const meta = CHANNEL_META[g.channel.channelName];
    const unlinked = g.rows.filter((r) => !r.productId);
    const selectedCount = g.rows.filter((r) => selectedIds.has(r.id)).length;
    const needsRoot = unlinked.some((r) => isFallbackSku(r.channelSku));
    const prices = g.rows.map((r) => Number(r.price)).filter((n) => n > 0);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    const stocks = g.rows.map((r) => r.channelStock).filter((n): n is number => typeof n === "number");
    const busy = busyKey === `create:${g.key}`;
    return (
      <TableRow
        key={`group-${g.key}`}
        className={cn(
          "cursor-pointer bg-muted/25 hover:bg-muted/50",
          open && "bg-slate-200/70! hover:bg-slate-200/90! shadow-[inset_3px_0_0_0_var(--color-primary)]"
        )}
        onClick={() => toggleCollapsed(g.key)}
      >
        <TableCell onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Chọn cả ${g.rows.length} phân loại của ${g.name}`}
            checked={selectedCount === g.rows.length}
            ref={(el) => {
              if (el) el.indeterminate = selectedCount > 0 && selectedCount < g.rows.length;
            }}
            onChange={() => toggleGroupSelected(g)}
            className="size-4 cursor-pointer accent-primary"
          />
        </TableCell>
        <TableCell>
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              aria-label={open ? "Thu gọn phân loại" : "Xem các phân loại"}
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapsed(g.key);
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight
                className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}
              />
            </button>
            <ChannelThumb src={g.imageUrl} alt={g.name} />
            <div className="min-w-0">
              <p className={cn("truncate", open ? "font-bold" : "font-medium")} title={g.name}>
                {g.name}
              </p>
              <p className={cn(TEXT_SUB, "truncate")}>
                <span className={`mr-1.5 inline-flex items-center rounded-full border px-1.5 py-0 text-[11px] font-medium ${meta.className}`}>
                  {meta.label}
                </span>
                {g.channel.shopName}
                {g.itemId && (
                  <span className="ml-1.5 font-mono" title="ID sản phẩm trên sàn">
                    · ID {g.itemId}
                  </span>
                )}
              </p>
              <p className="flex flex-wrap items-center gap-x-1 text-xs">
                <Layers className="size-3.5 shrink-0 text-sky-600" />
                <span className="font-semibold text-sky-700">{formatNumber(g.rows.length)} phân loại</span>
                {unlinked.length > 0 ? (
                  <span className="font-medium text-amber-700">· {formatNumber(unlinked.length)} chưa nối</span>
                ) : (
                  <span className="text-emerald-700">· đã nối hết</span>
                )}
              </p>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right">
          {prices.length === 0 ? (
            <span className={TEXT_SUB}>—</span>
          ) : min === max ? (
            <Money value={min} className="text-slate-900" />
          ) : (
            <span className="block truncate text-sm text-slate-900" title={`${formatNumber(min)} – ${formatNumber(max)} ₫`}>
              <Money value={min} className="text-slate-900" /> – <Money value={max} className="text-slate-900" />
            </span>
          )}
          <p className={cn(TEXT_SUB, "tabular-nums")}>
            {stocks.length === 0 ? (
              "tồn —"
            ) : (
              <>
                tồn <b className="font-semibold text-foreground">{formatNumber(stocks.reduce((s, n) => s + n, 0))}</b>
              </>
            )}
          </p>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {unlinked.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
              <Check className="size-3.5" />
              Đã nối {formatNumber(g.rows.length)}/{formatNumber(g.rows.length)}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {needsRoot && (
                <Input
                  className="h-8 w-24 font-mono text-sm uppercase"
                  placeholder="Mã gốc"
                  aria-label={`Mã gốc cho ${g.name}`}
                  maxLength={40}
                  value={rootDrafts[g.key] ?? ""}
                  onChange={(e) => setRootDrafts((d) => ({ ...d, [g.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateForGroup(g);
                    }
                  }}
                  title="Sàn chưa có mã SKU cho sản phẩm này — gõ mã gốc, Hubsell ghép phân loại: VAY01 → VAY01-DEN-M"
                />
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy}
                onClick={() => handleCreateForGroup(g)}
                title={
                  needsRoot
                    ? "Tạo SKU kho cho mọi phân loại chưa nối theo mã gốc + tên phân loại"
                    : "Tạo SKU kho cho mọi phân loại chưa nối theo đúng mã trên sàn"
                }
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PackagePlus className="size-3.5" />}
                Tạo SKU kho ({formatNumber(unlinked.length)})
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>
    );
  }
}

/** Ảnh sản phẩm sàn 36px; thiếu / hỏng → ô icon. */
function ChannelThumb({ src, alt }: { src: string | null; alt: string }) {
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

/**
 * Ô GÕ MÃ SKU KHO TẠI DÒNG (kiểu Salework): gõ mã → Enter / nút nối. Mã có trong
 * kho thì nối vào; chưa có thì tạo SKU kho mới mang đúng mã (tên, phân loại, ảnh,
 * giá từ sàn; tồn ban đầu theo sàn). Gợi ý mã qua <datalist> dùng chung.
 */
function InlineSkuLink({
  row,
  onPick,
  onLinked,
}: {
  row: ChannelProduct;
  /** Mở hộp tìm SKU có sẵn (khi khách không nhớ mã). */
  onPick: () => void;
  onLinked: (created: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const label = variantLabel(row.variantName) ?? row.channelSku;

  async function submit() {
    const sku = value.trim();
    if (!sku || busy) return;
    setBusy(true);
    try {
      const res = await linkChannelProductBySku(row.id, sku);
      toast.success(
        (res.created
          ? `Đã tạo SKU kho ${res.product.skuCode} và nối ${label}`
          : `Đã nối ${label} vào ${res.product.skuCode}`) +
          (res.seededStock != null ? ` · tồn ban đầu theo sàn: ${formatNumber(res.seededStock)}` : ""),
        { duration: 5000 }
      );
      setValue("");
      onLinked(res.created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không nối được");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Input
        list={SKU_LIST_ID}
        className="h-8 min-w-0 flex-1 font-mono text-sm uppercase placeholder:normal-case placeholder:font-sans"
        placeholder="Gõ mã SKU kho…"
        aria-label={`Mã SKU kho cho ${label}`}
        value={value}
        maxLength={50}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        title="Mã có sẵn trong kho → nối vào; mã mới → tạo SKU kho mới rồi nối. Enter để nối."
      />
      {/* Nút CÓ CHỮ ngay cạnh ô gõ (anh Trung 22/10: "để nút kết nối bên cạnh giống Salework") */}
      <Button
        size="sm"
        className="h-8 px-3"
        disabled={busy || !value.trim()}
        onClick={submit}
        title="Nối dòng sàn này vào mã vừa gõ (Enter)"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
        Nối
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 px-2.5"
        onClick={onPick}
        title="Không nhớ mã? Tìm SKU kho có sẵn theo tên"
      >
        <Search className="size-3.5" />
        Tìm
      </Button>
    </div>
  );
}
