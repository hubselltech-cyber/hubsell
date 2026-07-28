"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  ImageIcon,
  Layers,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  updateSkuCostPriceBulk,
  type ChannelName,
  type SkuProduct,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatVND, formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { variantLabel } from "@/lib/variant-group";

/**
 * BẢNG GIÁ VỐN PHÂN CẤP — theo đúng cấu trúc của các sàn TMĐT
 *
 *   Sản phẩm cha (mẫu hàng)
 *     └─ Biến thể / phân loại (size, màu…) — mỗi cái một SKU, một giá vốn riêng
 *
 * Vì sao phải gom? Shop vài trăm mã mà trải phẳng thì size M, L, XL của cùng
 * một mẫu áo nằm rời rạc như ba sản phẩm xa lạ, mắt không nhóm lại được và
 * bảng dài gấp mấy lần cần thiết.
 *
 * ĐÂY CHỈ LÀ CÁCH GOM Ở TẦNG HIỂN THỊ. Giá vốn vẫn lưu riêng cho từng SKU con,
 * nên P&L theo SKU và Cảnh báo đơn lỗ ở các trang khác vẫn lấy đúng số của
 * từng phân loại, không bị gộp hay tính trung bình.
 */

export interface ProductGroup {
  key: string;
  /** Tên mẫu hàng (đã cắt đuôi phân loại) */
  name: string;
  imageUrl: string | null;
  variants: SkuProduct[];
}

interface CostPriceTableProps {
  groups: ProductGroup[];
  drafts: Record<string, string>;
  onDraftChange: (skuId: string, digits: string) => void;
  onVariantBlur: (item: SkuProduct) => void;
  savingId: string | null;
  savedId: string | null;
  /** Gọi sau khi áp giá hàng loạt để tải lại dữ liệu */
  onBulkApplied: () => void;
}

export function CostPriceTable({
  groups,
  drafts,
  onDraftChange,
  onVariantBlur,
  savingId,
  savedId,
  onBulkApplied,
}: CostPriceTableProps) {
  // Mặc định thu gọn hết cho bảng ngắn gọn; mở nhóm nào thì nhớ nhóm đó
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[38%]">Sản phẩm</TableHead>
          <TableHead>Mã SKU</TableHead>
          <TableHead>Kênh bán</TableHead>
          <TableHead className="text-right">Giá bán</TableHead>
          <TableHead className="w-64 text-right">Giá vốn (VNĐ)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) =>
          group.variants.length === 1 ? (
            // Mẫu chỉ có đúng một mã thì không việc gì phải bọc thêm một tầng —
            // thêm mũi tên xổ ra chỉ để lộ đúng một dòng là thao tác thừa.
            <SingleRow
              key={group.key}
              item={group.variants[0]}
              drafts={drafts}
              onDraftChange={onDraftChange}
              onVariantBlur={onVariantBlur}
              savingId={savingId}
              savedId={savedId}
            />
          ) : (
            <React.Fragment key={group.key}>
              <ParentRow
                group={group}
                open={expanded.has(group.key)}
                onToggle={() => toggle(group.key)}
                onExpand={() =>
                  setExpanded((p) => new Set(p).add(group.key))
                }
                onBulkApplied={onBulkApplied}
              />
              {expanded.has(group.key) &&
                group.variants.map((v) => (
                  <ChildRow
                    key={v.skuId}
                    item={v}
                    drafts={drafts}
                    onDraftChange={onDraftChange}
                    onVariantBlur={onVariantBlur}
                    savingId={savingId}
                    savedId={savedId}
                  />
                ))}
            </React.Fragment>
          )
        )}
      </TableBody>
    </Table>
  );
}

/* ─────────────────────────── Dòng sản phẩm cha ─────────────────────────── */

function ParentRow({
  group,
  open,
  onToggle,
  onExpand,
  onBulkApplied,
}: {
  group: ProductGroup;
  open: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onBulkApplied: () => void;
}) {
  const missing = group.variants.filter((v) => Number(v.costPrice) <= 0).length;
  const costs = group.variants.map((v) => Number(v.costPrice)).filter((c) => c > 0);
  const min = costs.length ? Math.min(...costs) : 0;
  const max = costs.length ? Math.max(...costs) : 0;

  return (
    <TableRow
      className={cn(
        "cursor-pointer bg-muted/25 hover:bg-muted/50",
        // Đang mở: tô đậm nền hơn hẳn để cả cụm cha + con nổi thành một khối.
        // Cần dấu ! vì TableRow gốc có has-aria-expanded:bg-slate-50/80 (nhạt hơn)
        // nằm sau trong stylesheet nên sẽ đè mất màu này nếu không ép ưu tiên.
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

          {group.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={group.imageUrl}
              alt={group.name}
              className="size-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ImageIcon className="size-4" />
            </div>
          )}

          <div className="min-w-0">
            {/* Đang mở thì tên cha đậm hẳn lên làm điểm neo cho mắt */}
            <p className={cn("truncate", open ? "font-bold" : "font-medium")}>
              {group.name}
            </p>
            <p className={cn(TEXT_SUB, "flex items-center gap-1")}>
              <Layers className="size-3 shrink-0" />
              {formatNumber(group.variants.length)} phân loại
              {missing > 0 && (
                <span className="font-medium text-amber-700">
                  · {formatNumber(missing)} chưa có giá vốn
                </span>
              )}
            </p>
          </div>
        </div>
      </TableCell>

      {/* Mã SKU / kênh / giá bán để trống ở dòng cha — chi tiết nằm ở dòng con */}
      <TableCell className={TEXT_SUB}>—</TableCell>
      <TableCell className={TEXT_SUB}>—</TableCell>
      <TableCell className={cn(TEXT_SUB, "text-right")}>
        {costs.length === 0
          ? "—"
          : min === max
            ? formatVND(min)
            : `${formatVND(min)} – ${formatVND(max)}`}
      </TableCell>

      <TableCell onClick={(e) => e.stopPropagation()}>
        <QuickFill group={group} onExpand={onExpand} onApplied={onBulkApplied} />
      </TableCell>
    </TableRow>
  );
}

/* ────────────────── Ô "nhập nhanh cho tất cả phân loại" ────────────────── */

function QuickFill({
  group,
  onExpand,
  onApplied,
}: {
  group: ProductGroup;
  onExpand: () => void;
  onApplied: () => void;
}) {
  const [digits, setDigits] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const cost = Number(digits);
  const valid = digits !== "" && !Number.isNaN(cost) && cost > 0;

  // Những phân loại đang có giá vốn KHÁC sẽ bị ghi đè — đây là chỗ mất dữ liệu
  const overwriting = group.variants.filter((v) => {
    const c = Number(v.costPrice);
    return c > 0 && c !== cost;
  });

  async function apply() {
    setSaving(true);
    try {
      const res = await updateSkuCostPriceBulk(
        group.variants.map((v) => v.skuId),
        cost
      );
      toast.success(
        `${group.name}: đã đặt giá vốn ${formatVND(cost)} cho ${res.updated} phân loại`
      );
      setDigits("");
      setConfirming(false);
      onExpand(); // xổ nhóm ra để thấy ngay kết quả vừa áp
      onApplied();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không áp dụng được giá vốn"
      );
    } finally {
      setSaving(false);
    }
  }

  function handleClick() {
    if (!valid) return;
    // Không có gì bị mất thì áp thẳng, khỏi bắt xác nhận vô ích.
    // Có mã sắp bị ghi đè giá khác thì phải hỏi lại — thao tác này không hoàn tác được.
    if (overwriting.length > 0) setConfirming(true);
    else apply();
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <CurrencyInput
        className="w-32 text-right tabular-nums"
        placeholder="Nhập cho tất cả"
        aria-label={`Nhập nhanh giá vốn cho tất cả phân loại của ${group.name}`}
        value={digits}
        onValueChange={setDigits}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleClick();
        }}
      />

      <Popover open={confirming} onOpenChange={setConfirming}>
        <PopoverTrigger
          disabled={!valid || saving}
          render={
            <Button
              size="sm"
              variant="secondary"
              onClick={handleClick}
              title={
                valid
                  ? `Áp giá vốn này cho cả ${group.variants.length} phân loại`
                  : "Nhập giá vốn trước khi áp dụng"
              }
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Áp dụng"}
            </Button>
          }
        />

        <PopoverContent align="end" className="w-80">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">
                Ghi đè giá vốn của {overwriting.length} phân loại?
              </p>
              <p className={TEXT_SUB}>
                Các mã dưới đây đang có giá vốn khác {formatVND(cost)}.
              </p>
            </div>
            <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg bg-muted/50 p-2">
              {overwriting.map((v) => (
                <li key={v.skuId} className="text-xs">
                  <span className="font-mono font-medium">{v.sku}</span>
                  <span className="ml-1.5 text-amber-700">
                    {formatVND(Number(v.costPrice))} → {formatVND(cost)}
                  </span>
                </li>
              ))}
            </ul>
            <p className={cn(TEXT_SUB, "text-amber-700")}>
              ⚠ Thao tác này không hoàn tác được.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
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

/* ────────────────────────── Dòng biến thể con ────────────────────────── */

interface RowProps {
  item: SkuProduct;
  drafts: Record<string, string>;
  onDraftChange: (skuId: string, digits: string) => void;
  onVariantBlur: (item: SkuProduct) => void;
  savingId: string | null;
  savedId: string | null;
}

function CostCell({
  item,
  drafts,
  onDraftChange,
  onVariantBlur,
  savingId,
  savedId,
}: RowProps) {
  const missing = Number(item.costPrice) <= 0;
  return (
    <div className="flex items-center justify-end gap-1.5">
      <CurrencyInput
        className={cn(
          "w-32 text-right tabular-nums",
          missing && "border-amber-400 bg-amber-50"
        )}
        placeholder="Nhập giá vốn"
        aria-label={`Giá vốn của ${item.sku}`}
        value={drafts[item.skuId] ?? ""}
        onValueChange={(d) => onDraftChange(item.skuId, d)}
        onBlur={() => onVariantBlur(item)}
      />
      {savingId === item.skuId ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : savedId === item.skuId ? (
        <Check className="size-4 shrink-0 text-emerald-500" />
      ) : (
        <span className="size-4 shrink-0" />
      )}
    </div>
  );
}

function ChannelBadge({ name }: { name: string }) {
  const meta = CHANNEL_META[name as ChannelName];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * SKU sàn chưa nối kho gốc: giá vốn nhập ở đây lưu ngay trên SKU sàn — vẫn
 * tính lãi/lỗ đầy đủ, chỉ là không quản tồn kho tập trung. Nhãn để người dùng
 * hiểu vì sao dòng này không có tồn kho, KHÔNG phải lời nhắc bắt buộc phải nối.
 */
function UnlinkedHint({ linked }: { linked: boolean }) {
  if (linked) return null;
  return (
    <span
      title="Giá vốn lưu trên SKU sàn — muốn quản tồn kho tập trung thì liên kết ở trang Liên kết sản phẩm"
      className="ml-1.5 inline-flex items-center rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[11px] text-muted-foreground"
    >
      Chưa nối kho vật lý
    </span>
  );
}

function ChildRow(props: RowProps) {
  const { item } = props;
  const label = variantLabel(item.productName);
  return (
    // Nền xám nhạt cùng tông với dòng cha đang mở để cả cụm gom thành một khối,
    // không còn tuột về nền trắng lẫn vào các mẫu hàng khác
    <TableRow className="bg-muted/40 hover:bg-muted/50">
      <TableCell>
        {/* Thụt lề + vạch dọc để mắt thấy ngay đây là con của dòng phía trên */}
        <div className="flex items-center gap-2.5 pl-3">
          <span
            aria-hidden
            className="h-8 w-px shrink-0 bg-border"
          />
          <span className="text-muted-foreground">└</span>
          <span className="font-medium">
            {label ?? item.variantName ?? item.sku}
          </span>
        </div>
      </TableCell>
      <TableCell className="font-mono">{item.sku}</TableCell>
      <TableCell>
        <ChannelBadge name={item.channelName} />
        <UnlinkedHint linked={item.linked} />
      </TableCell>
      <TableCell className="text-right font-medium">
        {formatVND(item.sellingPrice)}
      </TableCell>
      <TableCell>
        <CostCell {...props} />
      </TableCell>
    </TableRow>
  );
}

/* ──────────────── Dòng đơn lẻ (mẫu chỉ có một phân loại) ──────────────── */

function SingleRow(props: RowProps) {
  const { item } = props;
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2.5">
          {/* Chừa đúng chỗ mũi tên để cột tên của mọi dòng thẳng hàng nhau */}
          <span aria-hidden className="size-6 shrink-0" />
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.productName}
              className="size-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ImageIcon className="size-4" />
            </div>
          )}
          <p className="truncate font-medium">{item.productName}</p>
        </div>
      </TableCell>
      <TableCell className="font-mono">{item.sku}</TableCell>
      <TableCell>
        <ChannelBadge name={item.channelName} />
        <UnlinkedHint linked={item.linked} />
      </TableCell>
      <TableCell className="text-right font-medium">
        {formatVND(item.sellingPrice)}
      </TableCell>
      <TableCell>
        <CostCell {...props} />
      </TableCell>
    </TableRow>
  );
}
