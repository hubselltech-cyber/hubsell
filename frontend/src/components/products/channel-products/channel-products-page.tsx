"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  History,
  Link2,
  Link2Off,
  Loader2,
  MoreHorizontal,
  PackagePlus,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ApiError,
  createProductsFromMappings,
  fetchChannelProducts,
  fetchChannels,
  ignoreChannelProducts,
  unlinkChannelProducts,
  type Channel,
  type ChannelName,
  type ChannelProductBucket,
  type Product,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { AutoMatchDialog } from "./auto-match-dialog";
import { BulkCreateDialog } from "./bulk-create-dialog";
import { LinkDrawer } from "./link-drawer";
import { MappingHistoryDialog } from "./mapping-history-dialog";
import { groupChannelProducts, variantLabel, type ChannelGroup } from "./shared";

/**
 * SẢN PHẨM TRÊN SÀN — thiết kế lại 05/11/2026 (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md).
 *
 * Nguyên tắc: kho là mỏ neo, sàn là HÀNG ĐỢI. Trang này là danh sách việc theo SẢN PHẨM sàn:
 *   · Dải 4 số = 4 nhóm (Cần nối · Đã nối · Sàn đã gỡ · Bỏ qua) — bấm số là lọc. Mặc định Cần nối:
 *     listing sàn đã gỡ và món khách bỏ qua KHÔNG nằm trong hàng đợi.
 *   · Mỗi sản phẩm MỘT dòng thu gọn, chip trạng thái (Chưa nối / Nối k/n / Đã nối) và MỘT nút chính
 *     theo ngữ cảnh: mã sàn chuẩn → "Đưa vào kho" (tạo hoặc nối theo mã, một bấm); mã máy / lệch →
 *     "Nối" mở ngăn kéo; nối dở → "Nối nốt". Bấm ▸ xem phân loại (chỉ đọc).
 *   · Việc hàng loạt có bước xem lại: "Tự khớp mã trùng" (3 nhóm) và "Đưa vào Tổng kho…" (bảng rà mã).
 *   · Chiều ngược (Tổng kho › Nối gian): `targetProduct` → dải đích + nút "Nối vào X".
 * Thay link-manager.tsx (bảng bung sẵn, ô gõ mã từng dòng kiểu Salework 22/10) — anh Trung 05/11: "quá rối".
 */

const BUCKETS: { key: ChannelProductBucket; label: string; hint: string }[] = [
  { key: "queue", label: "Cần nối", hint: "Đang bán trên sàn, còn phân loại chưa nối về Tổng kho" },
  { key: "linked", label: "Đã nối", hint: "Mọi phân loại đã nối SKU kho" },
  { key: "delisted", label: "Sàn đã gỡ", hint: "Listing không còn trên sàn — không cần nối" },
  { key: "ignored", label: "Bỏ qua", hint: "Bạn chọn không quản tồn (quà tặng, combo…) — vẫn nhận đơn" },
];
const PAGE_SIZES = [20, 50, 100];
const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50";

export function ChannelProductsPage({
  initialSearch,
  targetProduct,
  onClearTarget,
}: {
  initialSearch?: string;
  targetProduct?: Product | null;
  onClearTarget?: () => void;
}) {
  const invalidate = useInvalidate();
  const [bucket, setBucket] = useState<ChannelProductBucket>("queue");
  const [platform, setPlatform] = useState<ChannelName | "">("");
  const [channelId, setChannelId] = useState("");
  const [search, setSearch] = useState(initialSearch ?? "");
  const [debounced, setDebounced] = useState(initialSearch ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drawerGroup, setDrawerGroup] = useState<ChannelGroup | null>(null);
  /** Các sản phẩm đang mở bảng rà mã "Đưa vào Tổng kho" (lô đã tick, hoặc một sản phẩm cần mã gốc). */
  const [bulkGroups, setBulkGroups] = useState<ChannelGroup[] | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    fetchChannels()
      .then((cs) => setChannels(cs.filter((c) => c.status === "ACTIVE" && c.channelName !== "OFFLINE")))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    view: "grouped" as const,
    bucket,
    channelName: platform || undefined,
    channelId: channelId || undefined,
    search: debounced || undefined,
    page,
    pageSize,
  };
  const q = useApiQuery({ queryKey: qk.channelProducts(params), queryFn: () => fetchChannelProducts(params) });
  const groups = useMemo(() => groupChannelProducts(q.data?.items ?? []), [q.data]);
  const buckets = q.data?.buckets ?? null;
  const pageCount = q.data?.pageCount ?? 0;
  const loading = q.refreshing;
  const platforms = useMemo(() => [...new Set(channels.map((c) => c.channelName))], [channels]);
  const channelChoices = channels.filter((c) => !platform || c.channelName === platform);
  const selectedGroups = groups.filter((g) => selected.has(g.key));
  const allOnPage = groups.length > 0 && groups.every((g) => selected.has(g.key));

  async function refresh() {
    setSelected(new Set());
    await invalidate(qk.channelProductsAll(), ["products"]);
  }
  function changeBucket(b: ChannelProductBucket) {
    setBucket(b);
    setPage(1);
    setSelected(new Set());
  }
  function toggleSet(set: Set<string>, key: string): Set<string> {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  }

  /** "Đưa vào kho" một bấm: mọi phân loại chưa nối đều có mã sàn chuẩn → tạo SKU theo mã, mã đã có thì nối. */
  async function createForGroup(g: ChannelGroup) {
    const ids = g.rows.filter((r) => !r.productId).map((r) => r.id);
    if (ids.length === 0) return;
    setBusyKey(g.key);
    try {
      const r = await createProductsFromMappings(ids);
      toast.success(
        `${g.title}: ${r.createdProducts > 0 ? `tạo ${formatNumber(r.createdProducts)} SKU kho` : ""}${r.createdProducts > 0 && r.reusedProducts > 0 ? ", " : ""}${
          r.reusedProducts > 0 ? `nối vào ${formatNumber(r.reusedProducts)} SKU có sẵn` : ""
        } — ${formatNumber(r.linked)} phân loại đã nối.`
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đưa vào kho được", { duration: 8000 });
    } finally {
      setBusyKey(null);
    }
  }
  async function setIgnored(list: ChannelGroup[], ignored: boolean) {
    const ids = list.flatMap((g) => g.rows.map((r) => r.id));
    if (ids.length === 0) return;
    try {
      await ignoreChannelProducts(ids, ignored);
      toast.success(ignored ? `Đã bỏ qua ${formatNumber(list.length)} sản phẩm — không còn trong Cần nối.` : `Đã đưa ${formatNumber(list.length)} sản phẩm về lại hàng đợi.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không cập nhật được");
    }
  }
  async function unlinkGroup(g: ChannelGroup) {
    const ids = g.rows.filter((r) => r.productId).map((r) => r.id);
    if (ids.length === 0) return;
    setBusyKey(g.key);
    try {
      const r = await unlinkChannelProducts(ids);
      toast.success(`Đã gỡ nối ${formatNumber(r.unlinked)} phân loại — ${g.title}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được");
    } finally {
      setBusyKey(null);
    }
  }

  /**
   * Nút chính theo ngữ cảnh. Chưa nối → "Đưa vào kho": mã sàn chuẩn thì một bấm; có mã máy / trống thì
   * mở bảng rà mã để điền mã gốc (05/11 soi local: sản phẩm 51 phân loại có 1 mã máy mà mở ngăn kéo thì
   * phải bấm 51 lần). Nối với hàng kho CÓ SẴN là nút phụ "Nối" cạnh đó. Nối dở → "Nối nốt" (ngăn kéo).
   */
  function primaryOf(g: ChannelGroup): { label: string; kind: "create" | "review" | "drawer" | "unignore" | "none" } {
    if (bucket === "ignored") return { label: "Bỏ cờ bỏ qua", kind: "unignore" };
    if (targetProduct) return { label: `Nối vào ${targetProduct.skuCode}`, kind: "drawer" };
    if (g.status === "linked") return { label: "", kind: "none" };
    if (g.status === "partial") return { label: "Nối nốt", kind: "drawer" };
    if (g.unlinkedAllStandard) return { label: "Đưa vào kho", kind: "create" };
    return { label: "Đưa vào kho…", kind: "review" };
  }

  return (
    <div className="space-y-4 pb-10">
      {targetProduct && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
          <Link2 className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Đang nối thêm gian cho SKU kho <b className="font-mono">{targetProduct.skuCode}</b>
            <span className="text-muted-foreground"> — {targetProduct.productName}</span>
            <span className={cn(TEXT_SUB, "block")}>Chọn gian, tìm đúng sản phẩm rồi bấm &ldquo;Nối vào {targetProduct.skuCode}&rdquo;.</span>
          </span>
          <Button size="sm" variant="outline" onClick={onClearTarget}>
            <Check className="size-3.5" /> Xong
          </Button>
        </div>
      )}

      {/* ===== DẢI 4 SỐ (bấm = lọc) + thao tác trang ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Nhóm sản phẩm trên sàn">
          {BUCKETS.map((b) => {
            const active = bucket === b.key;
            const n = buckets?.[b.key];
            return (
              <button
                key={b.key}
                type="button"
                role="tab"
                aria-selected={active}
                title={b.hint}
                onClick={() => changeBucket(b.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {b.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    b.key === "queue" && (n ?? 0) > 0 ? "bg-amber-100 text-amber-800" : "bg-muted-foreground/10"
                  )}
                >
                  {n == null ? "…" : formatNumber(n)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setAutoOpen(true)} title="Ghép các phân loại có mã sàn trùng đúng mã trong Tổng kho — xem lại trước khi áp">
            <Sparkles className="size-4" /> Tự khớp mã trùng
          </Button>
          <Button variant="ghost" onClick={() => setHistoryOpen(true)} title="Ai nối / gỡ gì, lúc nào">
            <History className="size-4" /> Lịch sử
          </Button>
          <SyncChannelProductsButton channelId={channelId || undefined} onSynced={() => void refresh()} label="Lấy sản phẩm mới từ sàn" />
        </div>
      </div>

      {/* ===== Lọc: sàn · gian · tìm ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          className="w-40"
          aria-label="Lọc theo sàn"
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value as ChannelName | "");
            setChannelId("");
            setPage(1);
          }}
        >
          <option value="">Mọi sàn</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {CHANNEL_META[p].label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-64"
          aria-label="Lọc theo gian"
          value={channelId}
          onChange={(e) => {
            setChannelId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Mọi gian</option>
          {channelChoices.map((c) => (
            <option key={c.id} value={c.id}>
              {platform ? "" : `${CHANNEL_META[c.channelName].label} · `}
              {c.shopName}
            </option>
          ))}
        </NativeSelect>
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 pr-8" placeholder="Tìm tên sản phẩm, phân loại, mã SKU sàn…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button type="button" aria-label="Xóa từ khóa" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}>
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* ===== Thanh hàng loạt — chỉ hiện khi tick ===== */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <span className="tabular-nums">
            Đã chọn <b>{formatNumber(selected.size)}</b> sản phẩm
          </span>
          {bucket !== "ignored" && bucket !== "linked" && (
            <Button size="sm" onClick={() => setBulkGroups(selectedGroups)}>
              <PackagePlus className="size-4" /> Đưa vào Tổng kho…
            </Button>
          )}
          {bucket === "ignored" ? (
            <Button size="sm" variant="outline" onClick={() => void setIgnored(selectedGroups, false)}>
              Bỏ cờ bỏ qua
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void setIgnored(selectedGroups, true)}>
              <EyeOff className="size-4" /> Bỏ qua
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}

      {/* ===== BẢNG THEO SẢN PHẨM ===== */}
      <div className="overflow-hidden rounded-lg border bg-card">
        {q.error ? (
          <p className="py-10 text-center text-sm text-amber-700">{q.error}</p>
        ) : q.loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Đang tải sản phẩm trên sàn…</p>
        ) : groups.length === 0 ? (
          <div className="space-y-1 py-10 text-center text-sm text-muted-foreground">
            <p>
              {debounced
                ? "Không có sản phẩm nào khớp từ khóa trong nhóm này."
                : bucket === "queue"
                  ? "Không còn sản phẩm nào cần nối. 🎉"
                  : bucket === "linked"
                    ? "Chưa có sản phẩm nào nối đủ."
                    : bucket === "delisted"
                      ? "Không có listing nào bị sàn gỡ."
                      : "Chưa bỏ qua sản phẩm nào."}
            </p>
            {bucket === "queue" && !debounced && (buckets?.linked ?? 0) === 0 && (
              <p className={TEXT_SUB}>Chưa thấy sản phẩm? Bấm &ldquo;Lấy sản phẩm mới từ sàn&rdquo; để kéo danh mục các gian đã nối.</p>
            )}
          </div>
        ) : (
          <Refreshing active={loading}>
            <table className="w-full table-fixed text-sm">
              <thead className="bg-muted/40">
                <tr className={cn(TEXT_SUB, "text-left")}>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label="Chọn mọi sản phẩm trên trang"
                      checked={allOnPage}
                      onChange={() => setSelected(allOnPage ? new Set() : new Set(groups.map((g) => g.key)))}
                    />
                  </th>
                  <th className="px-2 py-2.5 font-medium">Sản phẩm trên sàn</th>
                  <th className="w-[9%] px-2 py-2.5 text-right font-medium">Phân loại</th>
                  <th className="w-[15%] px-2 py-2.5 text-right font-medium">Giá · Tồn sàn</th>
                  <th className="w-[11%] px-2 py-2.5 font-medium">Trạng thái</th>
                  <th className="w-[23%] px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const open = expanded.has(g.key);
                  const p = primaryOf(g);
                  const busy = busyKey === g.key;
                  return (
                    <GroupRows
                      key={g.key}
                      g={g}
                      open={open}
                      checked={selected.has(g.key)}
                      onCheck={() => setSelected((s) => toggleSet(s, g.key))}
                      onToggle={() => setExpanded((s) => toggleSet(s, g.key))}
                      action={
                        <div className="flex items-center justify-end gap-1.5">
                          {p.kind !== "none" && (
                            <Button
                              size="sm"
                              variant={p.kind === "create" || p.kind === "review" || targetProduct ? "default" : "outline"}
                              disabled={busy}
                              title={
                                p.kind === "create"
                                  ? "Mã sàn đã chuẩn: tạo SKU kho theo đúng mã (mã đã có trong kho thì nối vào) — một bấm"
                                  : p.kind === "review"
                                    ? "Sàn chưa có mã SKU chuẩn cho sản phẩm này — điền mã gốc rồi tạo SKU kho"
                                    : p.kind === "drawer"
                                      ? "Chọn sản phẩm kho rồi ghép từng phân loại"
                                      : undefined
                              }
                              onClick={() => {
                                if (p.kind === "create") void createForGroup(g);
                                else if (p.kind === "review") setBulkGroups([g]);
                                else if (p.kind === "drawer") setDrawerGroup(g);
                                else if (p.kind === "unignore") void setIgnored([g], false);
                              }}
                            >
                              {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : p.kind === "create" || p.kind === "review" ? (
                                <PackagePlus className="size-4" />
                              ) : p.kind === "drawer" ? (
                                <Link2 className="size-4" />
                              ) : null}
                              <span className="truncate">{p.label}</span>
                            </Button>
                          )}
                          {(p.kind === "create" || p.kind === "review") && (
                            <Button size="sm" variant="outline" disabled={busy} title="Nối với sản phẩm đã có trong Tổng kho" onClick={() => setDrawerGroup(g)}>
                              <Link2 className="size-4" /> Nối
                            </Button>
                          )}
                          <Popover open={menuKey === g.key} onOpenChange={(o) => setMenuKey(o ? g.key : null)}>
                            <PopoverTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-muted-foreground" aria-label={`Thao tác khác với ${g.title}`} />}>
                              <MoreHorizontal className="size-4" />
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-60 p-1">
                              <button
                                type="button"
                                className={MENU_ITEM}
                                onClick={() => {
                                  setMenuKey(null);
                                  setDrawerGroup(g);
                                }}
                              >
                                <Link2 className="size-4 text-slate-500" /> {g.status === "linked" ? "Xem / đổi liên kết" : "Nối với sản phẩm kho…"}
                              </button>
                              {g.ignored ? (
                                <button
                                  type="button"
                                  className={MENU_ITEM}
                                  onClick={() => {
                                    setMenuKey(null);
                                    void setIgnored([g], false);
                                  }}
                                >
                                  <EyeOff className="size-4 text-slate-500" /> Bỏ cờ bỏ qua
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={MENU_ITEM}
                                  onClick={() => {
                                    setMenuKey(null);
                                    void setIgnored([g], true);
                                  }}
                                >
                                  <EyeOff className="size-4 text-slate-500" /> Bỏ qua (không quản tồn)
                                </button>
                              )}
                              {g.linkedCount > 0 && (
                                <>
                                  <div className="my-1 border-t" />
                                  <button
                                    type="button"
                                    className={cn(MENU_ITEM, "text-rose-700 hover:bg-rose-50")}
                                    onClick={() => {
                                      setMenuKey(null);
                                      void unlinkGroup(g);
                                    }}
                                  >
                                    <Link2Off className="size-4" /> Gỡ nối {formatNumber(g.linkedCount)} phân loại
                                  </button>
                                </>
                              )}
                            </PopoverContent>
                          </Popover>
                        </div>
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </Refreshing>
        )}
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <NativeSelect
              className="w-20"
              aria-label="Số sản phẩm mỗi trang"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
            <span className="text-sm text-muted-foreground">
              sản phẩm/trang · {formatNumber(q.data?.total ?? 0)} sản phẩm · trang {page}/{Math.max(1, pageCount)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((x) => x - 1)}>
              <ChevronLeft className="size-4" /> Trang trước
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage((x) => x + 1)}>
              Trang sau <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <LinkDrawer
        open={drawerGroup !== null}
        onOpenChange={(o) => {
          if (!o) setDrawerGroup(null);
        }}
        group={drawerGroup}
        target={targetProduct}
        onDone={() => void refresh()}
      />
      <BulkCreateDialog
        open={bulkGroups !== null}
        onOpenChange={(o) => {
          if (!o) setBulkGroups(null);
        }}
        groups={bulkGroups ?? []}
        onDone={() => void refresh()}
      />
      <AutoMatchDialog open={autoOpen} onOpenChange={setAutoOpen} channelId={channelId || undefined} onDone={() => void refresh()} />
      <MappingHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

function StatusChip({ g }: { g: ChannelGroup }) {
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";
  return (
    <span className="flex flex-wrap gap-1">
      {g.status === "linked" ? (
        <span className={cn(base, "border-emerald-200 bg-emerald-50 text-emerald-700")}>Đã nối</span>
      ) : g.status === "partial" ? (
        <span
          className={cn(base, "border-amber-300 bg-amber-50 text-amber-800")}
          title="Mới nối một phần: phân loại chưa nối không trừ kho, tồn không đẩy lên sàn"
        >
          Nối {g.linkedCount}/{g.total}
        </span>
      ) : (
        <span className={cn(base, "border-slate-200 bg-slate-50 text-slate-700")}>Chưa nối</span>
      )}
      {g.delisted && <span className={cn(base, "border-rose-200 bg-rose-50 text-rose-700")}>Sàn đã gỡ</span>}
      {g.ignored && <span className={cn(base, "border-slate-200 text-slate-500")}>Bỏ qua</span>}
    </span>
  );
}

function GroupRows({
  g,
  open,
  checked,
  onCheck,
  onToggle,
  action,
}: {
  g: ChannelGroup;
  open: boolean;
  checked: boolean;
  onCheck: () => void;
  onToggle: () => void;
  action: React.ReactNode;
}) {
  const meta = CHANNEL_META[g.channelName];
  return (
    <>
      <tr className={cn("border-t align-middle", checked && "bg-primary/5")}>
        <td className="px-3 py-2.5">
          <input type="checkbox" className="size-4 accent-primary" aria-label={`Chọn ${g.title}`} checked={checked} onChange={onCheck} />
        </td>
        <td className="px-2 py-2.5">
          <button type="button" className="flex w-full items-center gap-2.5 text-left" onClick={onToggle} aria-expanded={open}>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
            {g.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.imageUrl} alt="" className="size-10 shrink-0 rounded-md border object-cover" />
            ) : (
              <span className="size-10 shrink-0 rounded-md border border-dashed bg-muted/40" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={g.title}>
                {g.title}
              </span>
              <span className={cn(TEXT_SUB, "flex items-center gap-1.5 truncate")}>
                <span className={cn("rounded border px-1.5 py-px text-[11px] font-medium", meta.className)}>{meta.label}</span>
                <span className="truncate">{g.shopName}</span>
                {g.itemId && <span className="font-mono">· {g.itemId}</span>}
              </span>
            </span>
          </button>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums">{g.total}</td>
        <td className="px-2 py-2.5 text-right tabular-nums">
          {g.minPrice === g.maxPrice ? (
            <Money value={g.minPrice} />
          ) : (
            <span>
              <Money value={g.minPrice} /> – <Money value={g.maxPrice} />
            </span>
          )}
          <div className={TEXT_SUB}>tồn {g.totalStock == null ? "—" : formatNumber(g.totalStock)}</div>
        </td>
        <td className="px-2 py-2.5">
          <StatusChip g={g} />
        </td>
        <td className="px-3 py-2.5">{action}</td>
      </tr>
      {open &&
        g.rows.map((r) => (
          <tr key={r.id} className="border-t border-dashed bg-muted/20 text-sm">
            <td />
            <td className="py-1.5 pl-14 pr-2">
              <span className="block truncate" title={variantLabel(r)}>
                {variantLabel(r)}
              </span>
              <span className={cn(TEXT_SUB, "block truncate font-mono")}>{r.channelSku}</span>
            </td>
            <td />
            <td className="px-2 py-1.5 text-right tabular-nums">
              <Money value={Number(r.price) || 0} />
              <div className={TEXT_SUB}>tồn {r.channelStock ?? "—"}</div>
            </td>
            <td className="px-2 py-1.5" colSpan={2}>
              {r.product ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Link2 className="size-3.5 shrink-0 text-emerald-600" />
                  <span className="truncate font-mono text-emerald-700">{r.product.skuCode}</span>
                  <span className={cn(TEXT_SUB, "truncate")}>tồn kho {formatNumber(r.product.quantityInStock)}</span>
                </span>
              ) : (
                <span className={TEXT_SUB}>chưa nối{r.status === "DELISTED" ? " · sàn đã gỡ" : ""}</span>
              )}
            </td>
          </tr>
        ))}
    </>
  );
}
