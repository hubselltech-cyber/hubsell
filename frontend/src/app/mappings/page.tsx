"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Link2,
  Link2Off,
  Loader2,
  PackageSearch,
  Search,
  X,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Money } from "@/components/ui/money";
import { Refreshing } from "@/components/refreshing";
import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import { SkuCombobox } from "@/components/finance/sku-combobox";
import { LinkOneDialog } from "@/components/mappings/link-one-dialog";
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
  fetchChannelProducts,
  fetchChannels,
  fetchProducts,
  getStoredUser,
  getToken,
  linkChannelProducts,
  unlinkChannelProducts,
  type Channel,
  type ChannelName,
  type ChannelProduct,
  type Product,
} from "@/lib/api";
import { canManageShop } from "@/lib/permissions";
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

/**
 * TẦNG 2 — SẢN PHẨM SÀN & LIÊN KẾT VỀ KHO GỐC
 *
 * Đọc từ bảng đệm `ChannelProduct` chứ không phải kho vật lý. Mỗi dòng là một
 * sản phẩm thô kéo từ một gian hàng về; `productId = null` là chưa liên kết.
 *
 * Thao tác chính là TÍCH NHIỀU DÒNG rồi nối chung về một SKU gốc: ba gian hàng
 * đặt tên khác nhau cho cùng một mẫu áo vẫn phải trừ chung một kho.
 */
export default function MappingsPage() {
  const router = useRouter();

  const [rows, setRows] = useState<ChannelProduct[]>([]);
  const [counts, setCounts] = useState({ all: 0, linked: 0, unlinked: 0 });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Bộ lọc phân tầng: sàn (platform) và gian hàng cụ thể (channel).
  const [platformFilter, setPlatformFilter] = useState<ChannelName | "">("");
  const [channelFilter, setChannelFilter] = useState("");
  const [linkTab, setLinkTab] = useState<"" | "no" | "yes">("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pageCount, setPageCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetSku, setTargetSku] = useState("");
  const [linking, setLinking] = useState(false);

  // Sản phẩm sàn đang mở hộp thoại nối nhanh (bấm "Chưa liên kết" trên dòng)
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
      });
      setRows(res.items);
      setCounts(res.counts);
      setPageCount(res.pageCount);
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
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Liên kết sản phẩm là việc cấu hình của Chủ shop
    if (!canManageShop(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  // Danh sách gian hàng + toàn bộ SKU gốc để chọn nối về
  useEffect(() => {
    if (denied) return;
    fetchChannels()
      .then((cs) => setChannels(cs.filter((c) => c.status === "ACTIVE")))
      .catch(() => {});
    (async () => {
      const all: Product[] = [];
      let p = 1;
      try {
        for (;;) {
          const res = await fetchProducts({ page: p, pageSize: 50 });
          all.push(...res.items);
          if (p >= res.pageCount || res.pageCount === 0) break;
          p++;
        }
        setProducts(all);
      } catch {
        // không tải được thì combobox rỗng, người dùng vẫn xem được danh sách
      }
    })();
  }, [denied]);

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
        `Đã nối ${formatNumber(res.linked)} sản phẩm sàn về ${res.product.skuCode} — ${res.product.productName}`,
        { duration: 6000 }
      );
      setSelectedIds(new Set());
      setTargetSku("");
      load();
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
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được");
    } finally {
      setLinking(false);
    }
  }

  // Dropdown 2 chỉ hiện các gian thuộc sàn đang chọn ở Dropdown 1; chưa chọn sàn
  // thì hiện tất cả.
  const visibleChannels = platformFilter
    ? channels.filter((c) => c.channelName === platformFilter)
    : channels;

  // Đổi sàn ở Dropdown 1: reset luôn gian đang chọn nếu nó không thuộc sàn mới,
  // tránh trạng thái "đang lọc một gian không còn nằm trong danh sách hiển thị".
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

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Chừa đáy cho thanh liên kết nổi */}
      <div className="space-y-5 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Sản phẩm thô kéo từ các gian hàng về. Nối chúng về SKU gốc trong kho
            để đơn từ bất kỳ shop nào cũng trừ đúng tồn kho.
          </p>
          {/* Đang lọc theo một gian hàng thì chỉ đồng bộ gian đó */}
          <SyncChannelProductsButton
            channelId={channelFilter || undefined}
            onSynced={load}
          />
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
                placeholder="Tìm mã SKU sàn hoặc tên sản phẩm…"
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
                <Table>
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
                      <TableHead>Sản phẩm trên sàn</TableHead>
                      <TableHead>Gian hàng</TableHead>
                      <TableHead className="text-right">Giá sàn</TableHead>
                      <TableHead>Liên kết SP vào kho vật lý</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, index) => {
                      const checked = selectedIds.has(r.id);
                      const meta = CHANNEL_META[r.channel.channelName];
                      return (
                        <TableRow
                          key={r.id}
                          className={cn(
                            "transition-colors hover:bg-primary/10",
                            index % 2 === 1 && "bg-muted/40",
                            checked &&
                              "bg-primary/15 hover:bg-primary/20 shadow-[inset_3px_0_0_0_var(--color-primary)]"
                          )}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={`Chọn ${r.channelSku}`}
                              checked={checked}
                              onChange={() => toggleOne(r.id)}
                              className="size-4 cursor-pointer accent-primary"
                            />
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              {r.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={r.imageUrl}
                                  alt={r.productName}
                                  className="size-9 shrink-0 rounded-md object-cover"
                                />
                              ) : (
                                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                  <ImageIcon className="size-4" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {r.productName}
                                </p>
                                <p className={cn(TEXT_SUB, "font-mono")}>
                                  {r.channelSku}
                                </p>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                            <p className={cn(TEXT_SUB, "mt-1")}>
                              {r.channel.shopName}
                            </p>
                          </TableCell>

                          <TableCell className="text-right">
                            <Money value={r.price} className="text-slate-900" />
                          </TableCell>

                          <TableCell>
                            {r.product ? (
                              <>
                                <p className="flex items-center gap-1.5 font-medium text-emerald-700">
                                  <Link2 className="size-3.5 shrink-0" />
                                  {r.product.skuCode}
                                </p>
                                <p className={cn(TEXT_SUB, "truncate")}>
                                  {r.product.productName} · tồn{" "}
                                  {formatNumber(r.product.quantityInStock)}
                                </p>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setLinkTarget(r)}
                                title="Bấm để nối sản phẩm sàn này về SKU gốc"
                                className={cn(
                                  TEXT_SUB,
                                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-100 hover:text-amber-800"
                                )}
                              >
                                <Link2Off className="size-3.5 shrink-0" />
                                Chưa liên kết
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
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
                aria-label="Số dòng mỗi trang"
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
                dòng/trang · trang {page}/{Math.max(1, pageCount)}
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

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Sản phẩm sàn & Liên kết SP vào kho vật lý
        </p>
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

      {/* ===== HỘP THOẠI NỐI NHANH MỘT DÒNG ===== */}
      <LinkOneDialog
        item={linkTarget}
        products={products}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null);
        }}
        onDone={load}
      />
    </AppShell>
  );
}
