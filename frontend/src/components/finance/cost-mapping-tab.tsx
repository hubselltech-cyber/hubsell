"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronRight,
  ImageIcon,
  Layers,
  Loader2,
  Search,
  SearchX,
  Sparkles,
  X,
} from "lucide-react";

import { CostRulesSection } from "@/components/finance/cost-rules-section";
import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  dismissCostConflict,
  fetchCostSkuGroups,
  fillSuggestedCosts,
  setCostForSkuCodes,
  type CostMappingTarget,
  type CostSkuGroup,
  type CostSkuGroupList,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber, formatVND } from "@/lib/format";
import { normalizeText } from "@/lib/text";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { baseProductName, variantGroupKey, variantLabel } from "@/lib/variant-group";

/**
 * TAB "MAPPING GIÁ VỐN" — mỗi MÃ SKU chỉ còn MỘT dòng dù nằm trên bao nhiêu gian.
 *
 * Lý do tồn tại: tab Nhập giá vốn tách theo từng gian, một mẫu 10 phân loại bán
 * trên 10 gian là 100 ô phải gõ. Ở đây:
 *   1. Hubsell TỰ PHÁT HIỆN mã đã có giá ở gian này mà còn trống ở gian khác →
 *      đề xuất, một nút "Điền tất cả".
 *   2. Chủ shop tìm mã, nhập giá MỘT LẦN, bấm "Áp dụng" là mọi gian nhận giá.
 *      Dòng mẫu cha có ô "Giá vốn chung" cho cả loạt phân loại × mọi gian.
 * Khớp theo MÃ SKU, không bao giờ theo tên.
 */

type StatusFilter = "all" | CostSkuGroup["status"];

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "suggest", label: "Đề xuất điền" },
  { key: "conflict", label: "Lệch giá giữa các gian" },
  { key: "missing", label: "Chưa có giá" },
  { key: "complete", label: "Đã đủ" },
];

/** Số mẫu (dòng cha) vẽ mỗi lượt — shop nghìn mã không dựng cả nghìn ô nhập một lúc. */
const PAGE_SIZE = 100;

/**
 * Nút áp dụng dài ngắn khác nhau ("Lưu" / "Áp dụng 12 gian" / "Áp dụng cả mẫu") —
 * cho vào khe rộng cố định để ô nhập của mọi dòng thẳng một cột.
 */
const ACTION_SLOT = "w-[8.5rem] shrink-0";

interface ProductBucket {
  key: string;
  name: string;
  imageUrl: string | null;
  skus: CostSkuGroup[];
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function shopLabel(e: CostMappingTarget) {
  return `${CHANNEL_META[e.channelName].label} · ${e.shopName}`;
}

export function CostMappingTab({ onApplied }: { onApplied: () => void }) {
  const [data, setData] = React.useState<CostSkuGroupList | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filling, setFilling] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [visible, setVisible] = React.useState(PAGE_SIZE);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchCostSkuGroups());
    } catch (err) {
      toast.error(errorMessage(err, "Không tải được danh sách mã SKU"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  /** Sau mỗi lần ghi giá: nạp lại danh sách + báo tab Nhập giá vốn nạp lại. */
  const afterWrite = React.useCallback(async () => {
    onApplied();
    await load();
  }, [load, onApplied]);

  async function handleFillAll() {
    setFilling(true);
    try {
      const res = await fillSuggestedCosts();
      const parts = [
        `Đã điền giá vốn cho ${formatNumber(res.filledSkus)} ô trống của ${formatNumber(res.codes)} mã SKU`,
      ];
      if (res.backfilledOrderLines > 0) {
        parts.push(`tính lại ${formatNumber(res.backfilledOrderLines)} dòng hàng đã bán`);
      }
      toast.success(parts.join(" · "), { duration: 6000 });
      await afterWrite();
    } catch (err) {
      toast.error(errorMessage(err, "Không điền được giá vốn"));
    } finally {
      setFilling(false);
    }
  }

  const buckets = React.useMemo<ProductBucket[]>(() => {
    if (!data) return [];
    const keyword = normalizeText(search.trim());
    const map = new Map<string, ProductBucket>();
    for (const g of data.groups) {
      if (status !== "all" && g.status !== status) continue;
      if (
        keyword &&
        !normalizeText(g.code).includes(keyword) &&
        !normalizeText(g.productName).includes(keyword) &&
        !normalizeText(g.variantName ?? "").includes(keyword)
      ) {
        continue;
      }
      const key = variantGroupKey(g.productName);
      const bucket = map.get(key);
      if (bucket) {
        bucket.skus.push(g);
        if (!bucket.imageUrl) bucket.imageUrl = g.imageUrl;
      } else {
        map.set(key, {
          key,
          name: baseProductName(g.productName),
          imageUrl: g.imageUrl,
          skus: [g],
        });
      }
    }
    return [...map.values()];
  }, [data, search, status]);

  React.useEffect(() => setVisible(PAGE_SIZE), [search, status]);

  if (!data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {loading ? "Đang gộp mã SKU trên các gian…" : "Không tải được danh sách mã SKU."}
      </p>
    );
  }

  const { totals } = data;
  const countOf = (k: StatusFilter) => (k === "all" ? totals.codes : totals[k]);

  return (
    <div className="space-y-6">
      {/* ===== 1. ĐỀ XUẤT TỰ PHÁT HIỆN ===== */}
      {totals.suggest > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              <div className="min-w-0 text-sm">
                <p className="text-emerald-900">
                  Hubsell phát hiện <b className="tabular-nums">{formatNumber(totals.suggest)}</b>{" "}
                  mã SKU đã có giá vốn ở một gian nhưng còn trống ở gian khác (
                  <span className="tabular-nums">{formatNumber(totals.suggestEmptySlots)}</span> ô
                  trống).
                </p>
                <button
                  type="button"
                  onClick={() => setStatus("suggest")}
                  className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                >
                  Xem danh sách
                </button>
              </div>
            </div>
            <Button onClick={handleFillAll} disabled={filling}>
              {filling && <Loader2 className="size-4 animate-spin" />}
              Điền tất cả
            </Button>
          </CardContent>
        </Card>
      )}

      {totals.conflict > 0 && (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="flex min-w-0 items-center gap-3 text-amber-800">
              <AlertTriangle className="size-5 shrink-0 text-amber-600" />
              <p>
                <b className="tabular-nums">{formatNumber(totals.conflict)}</b> mã SKU đang có giá
                vốn khác nhau giữa các gian — bấm vào giá đúng rồi áp dụng, hoặc chọn giữ nguyên
                nếu bạn cố ý để giá riêng từng gian.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setStatus("conflict")}>
              Xem
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ===== 2. TÌM MÃ → NHẬP MỘT LẦN → ÁP CHO MỌI GIAN ===== */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 pr-9"
            placeholder="Tìm theo mã SKU hoặc tên sản phẩm…"
            aria-label="Tìm mã SKU"
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
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium tabular-nums transition-colors",
                status === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {f.label} · {formatNumber(countOf(f.key))}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {buckets.length === 0 ? (
            <div className="py-12 text-center">
              <SearchX className="mx-auto mb-3 size-9 text-muted-foreground" />
              <p>Không có mã SKU nào phù hợp</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Thử đổi từ khoá hoặc chọn nhóm khác.
              </p>
            </div>
          ) : (
            <Refreshing active={loading}>
              <Table className="min-w-[58rem] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30%]">Sản phẩm</TableHead>
                    <TableHead className="w-[15%]">Mã SKU</TableHead>
                    <TableHead>Gian hàng đang bán mã này</TableHead>
                    <TableHead className="w-80 pr-[9.875rem] text-right">
                      Giá vốn cho mọi gian
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buckets.slice(0, visible).map((b) =>
                    b.skus.length === 1 ? (
                      <SkuRow key={b.key} sku={b.skus[0]} onSaved={afterWrite} />
                    ) : (
                      <React.Fragment key={b.key}>
                        <BucketRow
                          bucket={b}
                          open={expanded.has(b.key)}
                          onToggle={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(b.key)) next.delete(b.key);
                              else next.add(b.key);
                              return next;
                            })
                          }
                          onSaved={async () => {
                            setExpanded((p) => new Set(p).add(b.key)); // xổ ra để thấy kết quả
                            await afterWrite();
                          }}
                        />
                        {expanded.has(b.key) &&
                          b.skus.map((s) => (
                            <SkuRow key={s.code} sku={s} child onSaved={afterWrite} />
                          ))}
                      </React.Fragment>
                    )
                  )}
                </TableBody>
              </Table>
              {buckets.length > visible && (
                <div className="border-t p-3 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                    Xem thêm {formatNumber(Math.min(PAGE_SIZE, buckets.length - visible))} sản phẩm
                  </Button>
                </div>
              )}
            </Refreshing>
          )}
        </CardContent>
      </Card>

      {/* ===== 3. NÂNG CAO: bảng giá theo mã mẫu + Excel (mặc định thu gọn) ===== */}
      <CostRulesSection onApplied={afterWrite} />
    </div>
  );
}

/* ─────────────────────────── Nút áp dụng có xác nhận ghi đè ─────────────────────────── */

/**
 * Bấm là ghi cho MỌI gian. Không có giá nào bị mất thì áp thẳng; có ô đang mang
 * giá KHÁC thì hỏi lại kèm danh sách — thao tác này không hoàn tác được.
 */
function ApplyButton({
  label,
  cost,
  disabled,
  primary,
  overwriting,
  onApply,
}: {
  label: string;
  cost: number;
  disabled: boolean;
  primary: boolean;
  overwriting: { key: string; text: string; from: number }[];
  onApply: () => Promise<void>;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function apply() {
    setSaving(true);
    try {
      await onApply();
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  function handleClick() {
    if (overwriting.length > 0) setConfirming(true);
    else apply();
  }

  // Popover CHỈ mở qua handleClick (khi thật sự có ô bị ghi đè) — trigger tự bật thì bỏ qua.
  return (
    <div className={ACTION_SLOT}>
      <Popover open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <PopoverTrigger
          disabled={disabled || saving}
          render={
            <Button
              type="submit" // Enter trong ô giá = bấm nút này
              size="sm"
              variant={primary ? "default" : "secondary"}
              className="w-full"
              onClick={handleClick}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : label}
            </Button>
          }
        />
        <PopoverContent align="end" className="w-80">
          <div className="space-y-3">
            <div>
              <p className="text-sm">Ghi đè giá vốn ở {overwriting.length} nơi?</p>
              <p className={TEXT_SUB}>Các nơi dưới đây đang có giá vốn khác {formatVND(cost)}.</p>
            </div>
            <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg bg-muted/50 p-2">
              {overwriting.map((o) => (
                <li key={o.key} className="text-xs">
                  <span className="font-medium">{o.text}</span>
                  <span className="ml-1.5 text-amber-700">
                    {formatVND(o.from)} → {formatVND(cost)}
                  </span>
                </li>
              ))}
            </ul>
            <p className={cn(TEXT_SUB, "text-amber-700")}>⚠ Thao tác này không hoàn tác được.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={saving}>
                Huỷ
              </Button>
              <Button size="sm" onClick={apply} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Ghi đè tất cả
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

async function saveCodes(codes: string[], cost: number, what: string, onSaved: () => Promise<void>) {
  try {
    const res = await setCostForSkuCodes(codes, cost);
    const parts = [`Đã áp ${formatVND(cost)} cho ${what} trên ${formatNumber(res.shops)} gian`];
    if (res.backfilledOrderLines > 0) {
      parts.push(`tính lại ${formatNumber(res.backfilledOrderLines)} dòng hàng đã bán`);
    }
    toast.success(parts.join(" · "));
    await onSaved();
  } catch (err) {
    toast.error(errorMessage(err, "Không lưu được giá vốn"));
  }
}

/* ───────────────────────────── Chip gian hàng ───────────────────────────── */

function ShopChips({
  entries,
  onPick,
}: {
  entries: CostMappingTarget[];
  /** Có = các gian đang lệch giá, bấm chip để lấy giá của gian đó. */
  onPick?: (cost: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((e) => {
        const has = e.currentCost > 0;
        const cls = cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
          has
            ? "border-slate-200 bg-slate-50 text-slate-900"
            : "border-dashed border-amber-300 bg-amber-50 text-amber-700"
        );
        const body = (
          <>
            <span className="truncate">{shopLabel(e)}</span>
            <span className="shrink-0 tabular-nums">
              {has ? formatVND(e.currentCost) : "trống"}
            </span>
          </>
        );
        return onPick && has ? (
          <button
            key={e.skuId}
            type="button"
            title="Lấy giá của gian này"
            onClick={() => onPick(e.currentCost)}
            className={cn(cls, "cursor-pointer font-medium transition-colors hover:border-primary")}
          >
            {body}
          </button>
        ) : (
          <span key={e.skuId} className={cls} title={shopLabel(e)}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Dòng một mã SKU ───────────────────────────── */

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="size-10 shrink-0 rounded-lg object-cover" />
  ) : (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <ImageIcon className="size-4" />
    </div>
  );
}

function SkuRow({
  sku,
  child,
  onSaved,
}: {
  sku: CostSkuGroup;
  child?: boolean;
  onSaved: () => Promise<void>;
}) {
  // Giá khởi điểm của ô: giá đề xuất / giá các gian đang thống nhất. Lệch giá
  // hoặc chưa có giá thì để TRỐNG — Hubsell không đoán hộ.
  const agreed =
    sku.status === "suggest"
      ? sku.suggestedCost
      : sku.status === "complete" && !sku.conflictDismissed
        ? sku.entries[0].currentCost
        : null;
  const initial = agreed ? String(agreed) : "";
  const [draft, setDraft] = React.useState(initial);
  React.useEffect(() => setDraft(initial), [initial]);

  const cost = Number(draft);
  const valid = draft !== "" && cost > 0;
  const changes = sku.entries.filter((e) => e.currentCost !== cost);
  const overwriting = changes
    .filter((e) => e.currentCost > 0)
    .map((e) => ({ key: e.skuId, text: shopLabel(e), from: e.currentCost }));
  // Mã hiển thị giữ nguyên cách viết của chủ shop; mã chuẩn hoá (IN HOA) chỉ để khớp.
  const displaySku = sku.entries[0].sku;
  const [deciding, setDeciding] = React.useState(false);
  async function decide(dismissed: boolean) {
    setDeciding(true);
    try {
      await dismissCostConflict(sku.code, dismissed);
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err, "Không lưu được lựa chọn"));
    } finally {
      setDeciding(false);
    }
  }

  const label = child
    ? variantLabel(sku.productName) || sku.variantName || displaySku
    : sku.productName;

  return (
    <TableRow className={cn(child && "bg-muted/40 hover:bg-muted/50")}>
      <TableCell>
        {child ? (
          <div className="flex min-w-0 items-center gap-2.5 pl-3">
            <span aria-hidden className="h-8 w-px shrink-0 bg-border" />
            <span className="shrink-0 text-muted-foreground">└</span>
            <span className="min-w-0 truncate" title={label}>
              {label}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-6 shrink-0" />
            <Thumb src={sku.imageUrl} alt={sku.productName} />
            <p className="min-w-0 truncate" title={sku.productName}>
              {sku.productName}
            </p>
          </div>
        )}
      </TableCell>
      <TableCell className="truncate font-mono" title={displaySku}>
        {displaySku}
      </TableCell>
      <TableCell>
        <ShopChips
          entries={sku.entries}
          onPick={sku.status === "conflict" ? (c) => setDraft(String(c)) : undefined}
        />
        {/* Lệch giá: ghi đè (bấm chip → Áp dụng) HOẶC giữ nguyên — chọn xong không nhắc lại */}
        {sku.status === "conflict" && (
          <button
            type="button"
            disabled={deciding}
            onClick={() => decide(true)}
            className="mt-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            Giữ giá riêng từng gian, không nhắc nữa
          </button>
        )}
        {sku.conflictDismissed && (
          <p className={cn(TEXT_SUB, "mt-1.5")}>
            Giá riêng từng gian (bạn đã chọn giữ nguyên) ·{" "}
            <button
              type="button"
              disabled={deciding}
              onClick={() => decide(false)}
              className="font-medium underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Nhắc lại
            </button>
          </p>
        )}
      </TableCell>
      <TableCell>
        <form
          className="flex items-center justify-end gap-1.5"
          onSubmit={(e) => e.preventDefault()}
        >
          <CurrencyInput
            className={cn(
              "w-32 text-right tabular-nums",
              sku.status === "missing" && "border-amber-400 bg-amber-50"
            )}
            placeholder={
              sku.status === "conflict"
                ? "Chọn giá đúng"
                : sku.conflictDismissed
                  ? "Giá chung mới"
                  : "Nhập giá vốn"
            }
            aria-label={`Giá vốn của mã ${sku.code} cho mọi gian`}
            value={draft}
            onValueChange={setDraft}
          />
          <ApplyButton
            label={
              sku.entries.length > 1 ? `Áp dụng ${formatNumber(sku.entries.length)} gian` : "Lưu"
            }
            cost={cost}
            primary={sku.status === "suggest" || sku.status === "conflict"}
            disabled={!valid || changes.length === 0}
            overwriting={overwriting}
            onApply={() => saveCodes([sku.code], cost, displaySku, onSaved)}
          />
        </form>
      </TableCell>
    </TableRow>
  );
}

/* ─────────────────── Dòng mẫu cha: "Giá vốn chung" cho cả loạt ─────────────────── */

function BucketRow({
  bucket,
  open,
  onToggle,
  onSaved,
}: {
  bucket: ProductBucket;
  open: boolean;
  onToggle: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = React.useState("");
  const cost = Number(draft);
  const valid = draft !== "" && cost > 0;

  const entries = bucket.skus.flatMap((s) => s.entries);
  const shops = new Set(entries.map((e) => e.channelId)).size;
  const emptySlots = entries.filter((e) => e.currentCost <= 0).length;
  const suggest = bucket.skus.filter((s) => s.status === "suggest").length;
  const conflict = bucket.skus.filter((s) => s.status === "conflict").length;
  const overwriting = entries
    .filter((e) => e.currentCost > 0 && e.currentCost !== cost)
    .map((e) => ({ key: e.skuId, text: `${e.sku} · ${shopLabel(e)}`, from: e.currentCost }));

  return (
    <TableRow
      className={cn(
        "cursor-pointer bg-muted/25 hover:bg-muted/50",
        // Dấu ! vì TableRow gốc có has-aria-expanded:bg-slate-50/80 nằm sau trong stylesheet
        open && "bg-muted/60! hover:bg-muted/70!"
      )}
      onClick={onToggle}
    >
      <TableCell>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label={open ? "Thu gọn phân loại" : "Xem các phân loại"}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-90"
              )}
            />
          </button>
          <Thumb src={bucket.imageUrl} alt={bucket.name} />
          <div className="min-w-0">
            <p className={cn("truncate", open ? "font-bold" : "font-medium")} title={bucket.name}>
              {bucket.name}
            </p>
            <p className={cn(TEXT_SUB, "flex items-center gap-1")}>
              <Layers className="size-3 shrink-0" />
              {formatNumber(bucket.skus.length)} phân loại · {formatNumber(shops)} gian
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className={TEXT_SUB}>—</TableCell>
      <TableCell className="text-xs">
        {emptySlots === 0 && conflict === 0 ? (
          <span className="text-muted-foreground">Đã đủ giá vốn</span>
        ) : (
          <span className="text-amber-700">
            {[
              emptySlots > 0 && `${formatNumber(emptySlots)} ô chưa có giá`,
              suggest > 0 && `${formatNumber(suggest)} mã có đề xuất`,
              conflict > 0 && `${formatNumber(conflict)} mã lệch giá`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <form
          className="flex items-center justify-end gap-1.5"
          onSubmit={(e) => e.preventDefault()}
        >
          <CurrencyInput
            className={cn(
              "w-32 text-right tabular-nums",
              emptySlots > 0 &&
                "border-amber-500 bg-amber-100/70 font-medium placeholder:text-amber-800"
            )}
            placeholder="Giá vốn chung"
            aria-label={`Giá vốn chung cho mọi phân loại của ${bucket.name} trên mọi gian`}
            value={draft}
            onValueChange={setDraft}
          />
          <ApplyButton
            label="Áp dụng cả mẫu"
            cost={cost}
            primary={false}
            disabled={!valid}
            overwriting={overwriting}
            onApply={async () => {
              await saveCodes(
                bucket.skus.map((s) => s.code),
                cost,
                bucket.name,
                onSaved
              );
              setDraft("");
            }}
          />
        </form>
      </TableCell>
    </TableRow>
  );
}
