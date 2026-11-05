"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  History,
  Link2,
  Link2Off,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { SyncSettingsDialog } from "@/components/products/sync-settings-dialog";
import {
  ApiError,
  fetchChannelProducts,
  fetchChannels,
  fetchStockSyncSummary,
  ignoreChannelProducts,
  setChannelProductsStockSync,
  unlinkChannelProducts,
  type Channel,
  type ChannelName,
  type ChannelProduct,
  type ChannelProductBucket,
  type StockSyncChannelSummary,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { AutoMatchDialog } from "./auto-match-dialog";
import { LinkDrawer } from "./link-drawer";
import { MappingHistoryDialog } from "./mapping-history-dialog";
import { channelModelId, groupChannelProducts, isStockSyncOn, stockSyncChanges, variantLabel, type ChannelGroup } from "./shared";
import { StockSyncConfirmDialog } from "./stock-sync-confirm-dialog";

/**
 * SẢN PHẨM TRÊN SÀN — thiết kế lại 05/11/2026 (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md).
 *
 * Nguyên tắc: kho là mỏ neo, sàn là HÀNG ĐỢI. Trang này là danh sách việc theo SẢN PHẨM sàn:
 *   · Dải 4 số = 4 nhóm (Cần nối · Đã nối · Sàn đã gỡ · Bỏ qua) — bấm số là lọc. Mặc định Cần nối:
 *     listing sàn đã gỡ và món khách bỏ qua KHÔNG nằm trong hàng đợi.
 *   · Mỗi sản phẩm MỘT dòng thu gọn, chip trạng thái (Chưa nối / Nối k/n / Đã nối) và MỘT nút chính:
 *     "Nối kho" mở ngăn kéo nối; nối dở → "Nối nốt". Bấm ▸ xem phân loại (chỉ đọc).
 *   · TRANG NÀY CHỈ NỐI, KHÔNG TẠO SẢN PHẨM KHO (anh Trung 05/11: "việc kiểm soát sản phẩm kho hoàn
 *     toàn nằm ở bên Tổng kho") — đã gỡ nút "Đưa vào kho", "Đưa vào Tổng kho…" theo lô và ô "Tạo SKU"
 *     trong ngăn kéo. Đừng thêm lại đường tạo SKU kho ở đây.
 *   · Việc hàng loạt có bước xem lại: "Tự khớp mã trùng" (chỉ nối mã trùng chính xác).
 *   · ĐỒNG BỘ TỒN BA CẤP (06/11, anh Trung: nút theo gian là nút tổng, cần bật / tắt từng sản phẩm và từng
 *     phân loại): cột Trạng thái (kết nối) đứng TRƯỚC cột Đồng bộ tồn — nối trước, đồng bộ sau; công tắc thật ở TỪNG PHÂN LOẠI đã nối (dòng xổ); công tắc ở dòng sản phẩm và nút "Đồng bộ tồn
 *     theo gian" là bật / tắt hàng loạt. Bật mà số sàn sẽ đổi → hộp xác nhận số cũ → số mới. Bật riêng là backend
 *     xếp việc đẩy tồn ngay; tắt riêng là rút việc đẩy tự động đang chờ (docs QUAN-LY-KHO mục 7).
 *   · MỘT CHIỀU (anh Trung 05/11 tối): chỉ nối từ sản phẩm sàn về Tổng kho. Luồng ngược "Tổng kho › Nối gian"
 *     (dải "Đang nối thêm gian cho SKU kho X" + nút "Nối vào X") đã gỡ — đừng thêm lại.
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
}: {
  initialSearch?: string;
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
  const [autoOpen, setAutoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  // Đồng bộ tồn: số tổng theo gian, hộp cài đặt theo gian (nút tổng), hộp xác nhận khi bật mà số sàn đổi.
  const [syncSummary, setSyncSummary] = useState<StockSyncChannelSummary[] | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [syncConfirm, setSyncConfirm] = useState<{ key: string; title: string; rows: ChannelProduct[] } | null>(null);

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

  const loadSyncSummary = useCallback(() => {
    fetchStockSyncSummary()
      .then((r) => setSyncSummary(r.channels))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadSyncSummary();
  }, [loadSyncSummary]);

  async function refresh() {
    setSelected(new Set());
    loadSyncSummary();
    await invalidate(qk.channelProductsAll(), ["products"]);
  }

  // Số "đang đồng bộ / đã nối" của gian đang lọc (không lọc gian = cộng mọi gian).
  const syncScope = (syncSummary ?? []).filter((c) => !channelId || c.channelId === channelId);
  const syncLinked = syncScope.reduce((n, c) => n + c.linked, 0);
  const syncEnabled = syncScope.reduce((n, c) => n + c.enabled, 0);

  /** Ghi công tắc cho một loạt phân loại rồi tải lại. */
  async function applyStockSync(key: string, rows: ChannelProduct[], enabled: boolean) {
    setSyncBusy(key);
    try {
      const r = await setChannelProductsStockSync(rows.map((x) => x.id), enabled);
      toast.success(
        enabled
          ? r.queued > 0
            ? `Đã bật đồng bộ tồn ${formatNumber(r.updated)} phân loại — đang đẩy tồn kho lên sàn.`
            : `Đã bật đồng bộ tồn ${formatNumber(r.updated)} phân loại. Chưa có gì để đẩy (gian chưa kết nối đẩy tồn, hoặc sàn đã gỡ sản phẩm).`
          : `Đã tắt đồng bộ tồn ${formatNumber(r.updated)} phân loại — tồn trên sàn giữ nguyên số đang có.`
      );
      setSyncConfirm(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đổi được công tắc đồng bộ tồn");
    } finally {
      setSyncBusy(null);
    }
  }

  /**
   * Bật / tắt đồng bộ tồn cho các phân loại ĐÃ NỐI trong `rows` (một phân loại, cả sản phẩm, hay nhiều sản
   * phẩm đã tick). Tắt thì làm ngay; bật mà có phân loại số sàn khác số kho → hỏi lại kèm số cũ → mới.
   */
  function requestStockSync(key: string, title: string, rows: ChannelProduct[], enabled: boolean) {
    const targets = rows.filter((r) => r.productId && isStockSyncOn(r) !== enabled);
    if (targets.length === 0) return;
    if (enabled && stockSyncChanges(targets).length > 0) {
      setSyncConfirm({ key, title, rows: targets });
      return;
    }
    void applyStockSync(key, targets, enabled);
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
   * Nút chính theo ngữ cảnh: chưa nối → "Nối kho", nối dở → "Nối nốt" — cả hai mở ngăn kéo nối.
   * Trang này KHÔNG tạo sản phẩm kho (anh Trung 05/11) — hàng chưa có trong kho thì tạo ở Tổng kho.
   */
  function primaryOf(g: ChannelGroup): { label: string; kind: "drawer" | "unignore" | "none" } {
    if (bucket === "ignored") return { label: "Bỏ cờ bỏ qua", kind: "unignore" };
    if (g.status === "linked") return { label: "", kind: "none" };
    if (g.status === "partial") return { label: "Nối nốt", kind: "drawer" };
    return { label: "Nối kho", kind: "drawer" };
  }

  return (
    <div className="space-y-4 pb-10">
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
        {/* NÚT TỔNG theo gian (06/11): bật / tắt cho mọi phân loại đã nối của một gian, qua màn so sánh sẵn có.
            Viên số = phân loại đang đồng bộ / đã nối của gian đang lọc (không lọc gian = mọi gian). */}
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => setSyncDialogOpen(true)}
          title="Bật / tắt đồng bộ tồn cho CẢ GIAN — mọi phân loại đã nối của gian đó. Bật / tắt riêng từng sản phẩm, từng phân loại thì dùng công tắc trong bảng."
        >
          <RefreshCw className="size-4" /> Đồng bộ tồn theo gian
          {syncSummary && (
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                syncLinked > 0 && syncEnabled === syncLinked ? "bg-emerald-100 text-emerald-800" : syncEnabled > 0 ? "bg-amber-100 text-amber-800" : "bg-muted-foreground/10"
              )}
            >
              {formatNumber(syncEnabled)}/{formatNumber(syncLinked)}
            </span>
          )}
        </Button>
      </div>

      {/* ===== Thanh hàng loạt — chỉ hiện khi tick ===== */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <span className="tabular-nums">
            Đã chọn <b>{formatNumber(selected.size)}</b> sản phẩm
          </span>
          {bucket === "ignored" ? (
            <Button size="sm" variant="outline" onClick={() => void setIgnored(selectedGroups, false)}>
              Bỏ cờ bỏ qua
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void setIgnored(selectedGroups, true)}>
              <EyeOff className="size-4" /> Bỏ qua
            </Button>
          )}
          {selectedGroups.some((g) => g.linkedCount > 0) && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={syncBusy !== null}
                onClick={() => requestStockSync("bulk", `${formatNumber(selectedGroups.length)} sản phẩm đã chọn`, selectedGroups.flatMap((g) => g.rows), true)}
              >
                <RefreshCw className="size-4" /> Bật đồng bộ tồn
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={syncBusy !== null}
                onClick={() => requestStockSync("bulk", `${formatNumber(selectedGroups.length)} sản phẩm đã chọn`, selectedGroups.flatMap((g) => g.rows), false)}
              >
                Tắt đồng bộ tồn
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </Button>
        </div>
      )}

      {/* ===== BẢNG THEO SẢN PHẨM ===== */}
      <div className="overflow-x-auto rounded-lg border bg-card">
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
            {/* min-w 940: vừa khung 943px của màn 1280 (đo 06/11) — 980 thì cuộn ngang 37px sau khi thêm cột Đồng bộ tồn. */}
            <table className="w-full min-w-[940px] table-fixed text-sm">
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
                  <th className="w-[72px] px-2 py-2.5 text-right font-medium">Phân loại</th>
                  <th className="w-36 px-2 py-2.5 text-right font-medium">Giá · Tồn sàn</th>
                  {/* THỨ TỰ: kết nối trước, đồng bộ sau (anh Trung 06/11) — đúng trình tự khách làm: nối xong mới bật.
                      Cột Trạng thái rộng 144px vì ở dòng phân loại nó chứa mã SKU kho đã nối + số có thể bán. */}
                  <th className="w-36 px-2 py-2.5 font-medium">Trạng thái</th>
                  <th
                    className="w-[104px] px-2 py-2.5 font-medium"
                    title="Bật: tồn trên sàn đi theo số có thể bán của Tổng kho. Công tắc ở dòng sản phẩm bật / tắt mọi phân loại đã nối của sản phẩm; xổ dòng để bật / tắt từng phân loại."
                  >
                    Đồng bộ tồn
                  </th>
                  <th className="w-40 px-3 py-2.5" />
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
                      syncBusy={syncBusy !== null}
                      onSyncGroup={(enabled) => requestStockSync(g.key, g.title, g.rows, enabled)}
                      onSyncVariant={(r, enabled) => requestStockSync(r.id, `${g.title} · ${variantLabel(r)}`, [r], enabled)}
                      action={
                        <div className="flex items-center justify-end gap-1.5">
                          {p.kind !== "none" && (
                            <Button
                              size="sm"
                              className="min-w-0"
                              variant={p.kind === "drawer" ? "default" : "outline"}
                              disabled={busy}
                              title={p.kind === "drawer" ? "Chọn sản phẩm trong Tổng kho rồi ghép từng phân loại" : undefined}
                              onClick={() => {
                                if (p.kind === "drawer") setDrawerGroup(g);
                                else if (p.kind === "unignore") void setIgnored([g], false);
                              }}
                            >
                              {busy ? <Loader2 className="size-4 animate-spin" /> : p.kind === "drawer" ? <Link2 className="size-4" /> : null}
                              <span className="truncate">{p.label}</span>
                            </Button>
                          )}
                          <Popover open={menuKey === g.key} onOpenChange={(o) => setMenuKey(o ? g.key : null)}>
                            <PopoverTrigger render={<Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-muted-foreground" aria-label={`Thao tác khác với ${g.title}`} />}>
                              <MoreHorizontal className="size-4" />
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-60 p-1">
                              {p.kind !== "drawer" && (
                                <button
                                  type="button"
                                  className={MENU_ITEM}
                                  onClick={() => {
                                    setMenuKey(null);
                                    setDrawerGroup(g);
                                  }}
                                >
                                  <Link2 className="size-4 text-slate-500" /> {g.status === "linked" ? "Xem / đổi liên kết" : "Nối kho…"}
                                </button>
                              )}
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
        onDone={() => void refresh()}
      />
      <SyncSettingsDialog
        open={syncDialogOpen}
        onOpenChange={(o) => {
          setSyncDialogOpen(o);
          // Đóng hộp = có thể vừa bật / tắt cả gian → tải lại công tắc trong bảng + số tổng.
          if (!o) void refresh();
        }}
      />
      <StockSyncConfirmDialog
        open={syncConfirm !== null}
        title={syncConfirm?.title ?? ""}
        total={syncConfirm?.rows.length ?? 0}
        changes={syncConfirm ? stockSyncChanges(syncConfirm.rows) : []}
        busy={syncBusy !== null}
        onCancel={() => setSyncConfirm(null)}
        onConfirm={() => {
          if (syncConfirm) void applyStockSync(syncConfirm.key, syncConfirm.rows, true);
        }}
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
  syncBusy,
  onSyncGroup,
  onSyncVariant,
  action,
}: {
  g: ChannelGroup;
  open: boolean;
  checked: boolean;
  onCheck: () => void;
  onToggle: () => void;
  syncBusy: boolean;
  onSyncGroup: (enabled: boolean) => void;
  onSyncVariant: (r: ChannelProduct, enabled: boolean) => void;
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
          {/* Vùng bấm xổ/thu = mũi tên + ảnh + tên. Dòng phụ nằm NGOÀI nút vì có nút sao chép (không lồng button trong button). */}
          <div className="flex items-center gap-2.5">
            <button type="button" className="flex shrink-0 items-center gap-2.5" onClick={onToggle} aria-expanded={open} aria-label={`${open ? "Thu" : "Xem"} phân loại của ${g.title}`}>
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
              {g.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.imageUrl} alt="" className="size-10 shrink-0 rounded-md border object-cover" />
              ) : (
                <span className="size-10 shrink-0 rounded-md border border-dashed bg-muted/40" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <button type="button" className="block w-full truncate text-left font-medium" title={g.title} onClick={onToggle}>
                {g.title}
              </button>
              {/* Mã sản phẩm trên sàn (item id) + nút sao chép — anh Trung 05/11. CÙNG DÒNG với gian khi đủ chỗ (bảng là
                  hàng đợi, giữ dòng thấp 61px; tách dòng riêng thì mọi dòng cao 76px, +25 %). Chật (màn < 1280, tên gian
                  dài + mã TikTok 19 số) thì khối mã TỰ XUỐNG DÒNG nhờ flex-wrap — không cắt tên gian, không cắt mã.
                  Đo 05/11: "ANO Official Store" + mã 19 số vừa một dòng từ 1280. */}
              <div className={cn(TEXT_SUB, "flex min-w-0 flex-wrap items-center gap-x-1.5")}>
                <span className={cn("shrink-0 rounded border px-1.5 py-px text-[11px] font-medium", meta.className)}>{meta.label}</span>
                <span className="min-w-0 max-w-full truncate" title={g.shopName}>
                  {g.shopName}
                </span>
                {g.itemId && (
                  <>
                    <span aria-hidden className="shrink-0">
                      ·
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-mono" title={`Mã sản phẩm trên sàn: ${g.itemId}`}>
                      <span className="select-all">{g.itemId}</span>
                      <CopyIconButton value={g.itemId} what="mã sản phẩm" className="size-4" />
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
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
        <td className="px-2 py-2.5">
          {/* Công tắc CẤP SẢN PHẨM = bật / tắt mọi phân loại ĐÃ NỐI của sản phẩm. Bật một phần → ghi "k/n",
              bấm là bật nốt. Chưa nối phân loại nào thì không có gì để điều khiển. */}
          {g.linkedCount === 0 ? (
            <span className={TEXT_SUB} title="Chưa nối phân loại nào về Tổng kho">
              —
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Switch
                checked={g.syncOnCount === g.linkedCount}
                disabled={syncBusy}
                onCheckedChange={(v) => onSyncGroup(v)}
                aria-label={`Đồng bộ tồn mọi phân loại đã nối của ${g.title}`}
              />
              {g.syncOnCount > 0 && g.syncOnCount < g.linkedCount && (
                <span
                  className="rounded-full bg-amber-100 px-1.5 text-xs tabular-nums text-amber-800"
                  title={`${g.syncOnCount}/${g.linkedCount} phân loại đã nối đang bật — bấm công tắc để bật nốt`}
                >
                  {g.syncOnCount}/{g.linkedCount}
                </span>
              )}
            </span>
          )}
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
              <span className={cn(TEXT_SUB, "flex min-w-0 items-center gap-1 font-mono")}>
                <span className="min-w-0 truncate" title={r.channelSku ? `Mã SKU người bán đặt trên sàn: ${r.channelSku}` : undefined}>
                  {r.channelSku}
                </span>
                {/* Mã phân loại sàn (model / SKU id) + sao chép — cùng quy ước với bảng Giá vốn và Tổng kho. */}
                {channelModelId(r.externalId) && (
                  <span className="flex shrink-0 items-center gap-1" title={`Mã phân loại trên sàn: ${channelModelId(r.externalId)}`}>
                    <span aria-hidden>·</span>
                    <span className="select-all">{channelModelId(r.externalId)}</span>
                    <CopyIconButton value={channelModelId(r.externalId)!} what="mã phân loại" className="size-4" />
                  </span>
                )}
              </span>
            </td>
            <td />
            <td className="px-2 py-1.5 text-right tabular-nums">
              <Money value={Number(r.price) || 0} />
              <div className={TEXT_SUB}>tồn {r.channelStock ?? "—"}</div>
            </td>
            {/* Cột TRẠNG THÁI của phân loại = đã nối về SKU kho nào (dòng trên) + số có thể bán của SKU đó (dòng
                dưới — con số sàn nhận khi bật đồng bộ). Hai dòng vì cột chỉ 144px. */}
            <td className="px-2 py-1.5">
              {r.product ? (
                <>
                  {/* Mã SKU kho phải đọc ĐỦ: không biểu tượng (màu xanh đã nói "đã nối"), mã dài tự xuống dòng sau dấu
                      gạch thay vì cắt (đo 06/11: mã 17 ký tự bị cắt ở cột 144px khi còn biểu tượng). */}
                  <span
                    className="block font-mono text-xs leading-tight whitespace-normal text-emerald-700 [overflow-wrap:anywhere]"
                    title={`Đã nối về SKU kho ${r.product.skuCode}`}
                  >
                    {r.product.skuCode}
                  </span>
                  <span className={cn(TEXT_SUB, "block truncate")} title="Số có thể bán của SKU kho (tồn − đang giữ − tồn an toàn) — con số sàn nhận khi bật đồng bộ">
                    có thể bán {formatNumber(r.product.availableToSell ?? r.product.quantityInStock)}
                  </span>
                </>
              ) : (
                <span className={TEXT_SUB}>chưa nối{r.status === "DELISTED" ? " · sàn đã gỡ" : ""}</span>
              )}
            </td>
            {/* Công tắc CỦA PHÂN LOẠI — đứng SAU cột kết nối: nối rồi mới có công tắc. */}
            <td className="px-2 py-1.5">
              {r.product && (
                <Switch
                  checked={isStockSyncOn(r)}
                  disabled={syncBusy}
                  onCheckedChange={(v) => onSyncVariant(r, v)}
                  aria-label={`Đồng bộ tồn phân loại ${variantLabel(r)}`}
                />
              )}
            </td>
            <td />
          </tr>
        ))}
    </>
  );
}
