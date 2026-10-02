"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  Copy,
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
  type CostSiblings,
  type SkuProduct,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatVND, formatNumber } from "@/lib/format";
import { TABLE_HEAD_EMPHASIS, TEXT_SUB } from "@/lib/typography";
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

/**
 * Ô nhập của dòng cha ("Giá vốn chung") và dòng con ("Nhập giá vốn") phải THẲNG
 * MỘT CỘT. Muốn vậy thứ đứng sau ô nhập — nút "Áp dụng" ở dòng cha, dấu tick /
 * vòng xoay ở dòng con — phải chiếm cùng một bề rộng cố định, không thì nút dài
 * đẩy ô dòng cha lệch sang trái so với dòng con.
 */
const ACTION_SLOT = "flex w-[4.75rem] shrink-0 items-center";
/** Tiêu đề cột canh phải theo mép Ô NHẬP chứ không theo mép ô bảng (chừa chỗ ACTION_SLOT). */
const COST_HEAD = "w-64 pr-[6.125rem] text-right";

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
  /** Gọi sau khi áp giá hàng loạt để tải lại dữ liệu (+ gợi ý áp cho gian khác) */
  onBulkApplied: (siblings?: CostSiblings | null) => void;
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
    // table-fixed để tự quyết độ rộng cột — bảng auto bị tên phân loại dài kéo
    // tràn ngang, đẩy cột Giá vốn (cột thao tác chính) khuất sau mép cuộn.
    // Giá vốn đứng TRƯỚC Giá bán: người dùng vào trang này để nhập giá vốn,
    // cột đó phải luôn nhìn thấy; Giá bán chỉ để tham khảo nên ra rìa.
    // containerClassName overflow-visible: khung cuộn ngang mặc định sẽ chặn
    // tiêu đề bám dính; bảng table-fixed theo % nên không cần cuộn ngang.
    <Table className="table-fixed" containerClassName="overflow-visible">
      {/* Tiêu đề đậm, chữ 14px, BÁM DÍNH dưới thanh đầu app (h-16) khi khách cuộn
          (anh Trung 28/09) */}
      <TableHeader
        className={cn(TABLE_HEAD_EMPHASIS, "sticky top-16 z-20 [&_th]:text-sm")}
      >
        <TableRow>
          <TableHead className="w-[38%]">Sản phẩm</TableHead>
          {/* Mã phân loại trên sàn đứng dưới mã SKU — seller quen quản theo mã sàn */}
          <TableHead className="w-[16%]">Mã SKU · Mã sàn</TableHead>
          {/* Cửa hàng (tên gian) thay cho Kênh bán — kênh đã có bộ lọc phía trên (anh Trung 28/09) */}
          <TableHead className="w-[18%]">Cửa hàng</TableHead>
          <TableHead className={COST_HEAD}>Giá vốn (VNĐ)</TableHead>
          <TableHead className="text-right">Giá bán</TableHead>
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
                    showItemId={!singleItemId(group)}
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

/**
 * Vạch xanh 3px bên trái ô đầu của dòng cha ĐANG MỞ và mọi dòng con — ôm cả
 * cụm thành một khối. Vẽ bằng inset shadow trên td (border trên tr không ổn
 * định với border-collapse).
 */
const OPEN_GROUP_ACCENT =
  "[&>td:first-child]:shadow-[inset_3px_0_0_var(--color-sky-500)]";

/** Mã SẢN PHẨM trên sàn của cả mẫu — chỉ khi mọi phân loại chung một mã (một gian). */
function singleItemId(group: ProductGroup): string | null {
  const ids = new Set(group.variants.map((v) => v.itemId).filter(Boolean));
  return ids.size === 1 ? ([...ids][0] as string) : null;
}

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
  onBulkApplied: (siblings?: CostSiblings | null) => void;
}) {
  const missing = group.variants.filter((v) => Number(v.costPrice) <= 0).length;
  const itemId = singleItemId(group);
  const shops = new Set(group.variants.map((v) => v.shopName));
  const shopName = shops.size === 1 ? group.variants[0].shopName : null;
  // Khoảng GIÁ BÁN của các phân loại — hiển thị đúng dưới cột Giá bán
  // (trước đây lỡ tính khoảng giá vốn rồi đặt nhầm cột này)
  const sells = group.variants
    .map((v) => Number(v.sellingPrice))
    .filter((p) => p > 0);
  const min = sells.length ? Math.min(...sells) : 0;
  const max = sells.length ? Math.max(...sells) : 0;

  return (
    <TableRow
      className={cn(
        "cursor-pointer bg-muted/25 hover:bg-muted/50",
        // Đang mở: cả cụm cha + con thành MỘT KHỐI rõ để seller tập trung (anh
        // Trung 28/09 "phải đậm hơn"): nền slate đậm hơn hẳn + vạch xanh bên
        // trái chạy suốt cha lẫn con (OPEN_GROUP_ACCENT). Cần dấu ! vì TableRow
        // gốc có has-aria-expanded:bg-slate-50/80 nằm sau trong stylesheet.
        open && cn("bg-slate-200/70! hover:bg-slate-200/90!", OPEN_GROUP_ACCENT)
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
            {/* Tên cắt ngắn (tối đa ~26rem) + tooltip đủ tên; đang mở thì đậm hẳn làm điểm neo */}
            <p
              className={cn("max-w-[26rem] truncate", open ? "font-bold" : "font-medium")}
              title={group.name}
            >
              {group.name}
            </p>
            {/* Mã SẢN PHẨM trên sàn ngay dưới tên cha — chỉ khi mọi phân loại chung
                một mã; nhiều gian thì từng dòng con tự mang */}
            {itemId && (
              <p className="leading-tight">
                <MarketplaceCode label="Mã SP" code={itemId} />
              </p>
            )}
            {/* "x phân loại" dòng riêng dưới mã SP, màu xanh (anh Trung 28/09) */}
            <p className="flex flex-wrap items-center gap-x-1 text-xs">
              <Layers className="size-3.5 shrink-0 text-sky-600" />
              <span className="font-semibold text-sky-700">
                {formatNumber(group.variants.length)} phân loại
              </span>
              {missing > 0 && (
                <span className="font-medium text-amber-700">
                  · {formatNumber(missing)} chưa có giá vốn
                </span>
              )}
            </p>
          </div>
        </div>
      </TableCell>

      {/* Mã SKU để trống ở dòng cha — chi tiết nằm ở dòng con; cửa hàng hiện khi cả mẫu chung một gian */}
      <TableCell className={TEXT_SUB}>—</TableCell>
      <TableCell className={cn(TEXT_SUB, "truncate")} title={shopName ?? undefined}>
        {shopName ?? "—"}
      </TableCell>

      <TableCell onClick={(e) => e.stopPropagation()}>
        <QuickFill group={group} onExpand={onExpand} onApplied={onBulkApplied} />
      </TableCell>

      <TableCell className={cn(TEXT_SUB, "truncate text-right")}>
        {sells.length === 0
          ? "—"
          : min === max
            ? formatVND(min)
            : `${formatVND(min)} – ${formatVND(max)}`}
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
  onApplied: (siblings?: CostSiblings | null) => void;
}) {
  const [digits, setDigits] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const cost = Number(digits);
  const valid = digits !== "" && !Number.isNaN(cost) && cost > 0;

  // Vàng = "còn thiếu giá vốn" (cùng nghĩa với ô dòng con); dòng cha đậm hơn một
  // bậc vì là ô nhập cho CẢ MẪU. Mẫu đã đủ giá thì về trung tính.
  const missing = group.variants.some((v) => Number(v.costPrice) <= 0);

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
        `${group.name}: đã đặt giá vốn ${formatVND(cost)} cho ${res.updated} phân loại` +
          (res.backfilledOrderLines > 0
            ? ` · tính lại ${formatNumber(res.backfilledOrderLines)} dòng đơn cũ`
            : "")
      );
      setDigits("");
      setConfirming(false);
      onExpand(); // xổ nhóm ra để thấy ngay kết quả vừa áp
      onApplied(res.siblings);
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
      {/* Placeholder ngắn để không bị cắt chữ trong ô w-32; nghĩa đầy đủ ở aria-label */}
      <CurrencyInput
        className={cn(
          "w-32 text-right tabular-nums",
          missing && "border-amber-500 bg-amber-100/70 font-medium placeholder:text-amber-800"
        )}
        placeholder="Giá vốn chung"
        aria-label={`Nhập nhanh giá vốn cho tất cả phân loại của ${group.name}`}
        value={digits}
        onValueChange={setDigits}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleClick();
        }}
      />

      <div className={ACTION_SLOT}>
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
                <p className="text-sm">
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
    </div>
  );
}

/* ────────────────────────── Dòng biến thể con ────────────────────────── */

interface RowProps {
  item: SkuProduct;
  /** Dòng con tự mang mã SẢN PHẨM khi dòng cha gộp nhiều gian / nhiều mã. */
  showItemId?: boolean;
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
        // Trang dùng để nhận ra ô đang gõ dở khi tự nạp lại danh sách.
        data-sku-id={item.skuId}
        value={drafts[item.skuId] ?? ""}
        onValueChange={(d) => onDraftChange(item.skuId, d)}
        onBlur={() => onVariantBlur(item)}
      />
      <span className={ACTION_SLOT}>
        {savingId === item.skuId ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : savedId === item.skuId ? (
          <Check className="size-4 text-emerald-500" />
        ) : null}
      </span>
    </div>
  );
}

/**
 * Mã sàn (mã sản phẩm / mã phân loại): chữ mono nhỏ + nút copy nhanh ngay cạnh.
 * Không in nhãn "Mã SP" / "PL" (anh Trung 28/09: thừa) — nghĩa nằm ở tooltip.
 * `label` giữ để tooltip nói đúng đây là mã gì.
 */
function MarketplaceCode({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = React.useState(false);
  const what = label === "PL" ? "Mã phân loại" : "Mã sản phẩm";

  async function copy(e: React.MouseEvent) {
    e.stopPropagation(); // dòng cha bấm là xổ/thu nhóm — copy không được kéo theo
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Trình duyệt/nhúng chặn Clipboard API → cách cũ: ô ẩn + execCommand
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand copy failed");
      } catch {
        toast.error("Trình duyệt không cho sao chép. Hãy bôi đen mã rồi Ctrl+C.");
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    // max-w-full + truncate để mã dài không tràn sang cột bên khi màn hẹp
    <span
      className="group/code inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-muted-foreground"
      title={`${what} trên sàn: ${code}`}
    >
      <span className="min-w-0 select-all truncate">{code}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Sao chép ${what.toLowerCase()} ${code}`}
        title={copied ? "Đã sao chép" : "Sao chép mã"}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground",
          copied ? "text-emerald-600" : "text-muted-foreground/60"
        )}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  );
}

/**
 * Ô Mã SKU: mã người bán đặt (dòng chính) + mã PHÂN LOẠI trên sàn ở dòng dưới.
 * Mã SẢN PHẨM luôn nằm dưới TÊN sản phẩm (dòng cha / dòng đơn lẻ), không ở đây
 * — anh Trung 28/09. Học Salework: nhiều seller quản theo mã sàn hơn tên.
 */
function SkuCell({ item }: { item: SkuProduct }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-mono" title={item.sku}>
        {item.sku}
      </p>
      {item.modelId && <MarketplaceCode label="PL" code={item.modelId} />}
    </div>
  );
}

/**
 * Tên gian hàng kèm chấm màu kênh (tooltip = tên kênh) — thay huy hiệu kênh vì
 * kênh đã có bộ lọc phía trên; tên gian mới phân biệt được 2 shop cùng sàn.
 */
const CHANNEL_DOT: Record<string, string> = {
  SHOPEE: "bg-orange-500",
  LAZADA: "bg-blue-600",
  TIKTOK: "bg-zinc-900",
  OFFLINE: "bg-zinc-400",
};

function ShopName({ item }: { item: SkuProduct }) {
  const meta = CHANNEL_META[item.channelName as ChannelName];
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm"
      title={`${item.shopName} · ${meta?.label ?? item.channelName}`}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", CHANNEL_DOT[item.channelName] ?? "bg-zinc-400")}
      />
      <span className="truncate">{item.shopName}</span>
    </span>
  );
}

// Nhãn "Chưa nối kho vật lý" đã bỏ 28/09 (anh Trung: rối; ai quản kho tự hiểu ở
// phần Kho). Giá vốn SKU chưa nối kho vẫn nhập được — không đổi hành vi.

/**
 * Sàn đã gỡ/ẩn/xóa SKU này (đồng bộ giữ dòng để đơn cũ còn tra được giá vốn).
 * Mặc định trang ẩn các dòng này; chỉ thấy khi khách chọn "Đã gỡ" / "Tất cả".
 */
function DelistedBadge({ status }: { status: SkuProduct["status"] }) {
  if (status !== "DELISTED") return null;
  return (
    <span
      title="Sàn đã gỡ / ẩn / xóa SKU này — giữ lại để đơn cũ vẫn tra được giá vốn"
      className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700"
    >
      Đã gỡ trên sàn
    </span>
  );
}

function ChildRow(props: RowProps) {
  const { item, showItemId } = props;
  const label = variantLabel(item.productName);
  return (
    // Nền xám nhạt cùng tông với dòng cha đang mở để cả cụm gom thành một khối,
    // không còn tuột về nền trắng lẫn vào các mẫu hàng khác
    <TableRow className={cn("bg-slate-100 hover:bg-slate-200/60", OPEN_GROUP_ACCENT)}>
      <TableCell>
        {/* Thụt lề + vạch dọc để mắt thấy ngay đây là con của dòng phía trên */}
        <div className="flex min-w-0 items-center gap-2.5 pl-3">
          <span
            aria-hidden
            className="h-8 w-px shrink-0 bg-border"
          />
          <span className="shrink-0 text-muted-foreground">└</span>
          {/* Truncate để tên phân loại dài không kéo tràn ngang cả bảng */}
          <div className="min-w-0">
            <p className="truncate" title={label ?? item.variantName ?? item.sku}>
              {label ?? item.variantName ?? item.sku}
            </p>
            {showItemId && item.itemId && <MarketplaceCode label="Mã SP" code={item.itemId} />}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <SkuCell item={item} />
      </TableCell>
      <TableCell>
        {/* Cho các nhãn XUỐNG DÒNG khi hẹp — ô bảng cắt chữ (…) làm "Đã gỡ trên sàn" cụt mất nghĩa. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <ShopName item={item} />
          <DelistedBadge status={item.status} />
        </div>
      </TableCell>
      <TableCell>
        <CostCell {...props} />
      </TableCell>
      <TableCell className="truncate text-right">
        {formatVND(item.sellingPrice)}
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
          <div className="min-w-0">
            <p className="max-w-[26rem] truncate" title={item.productName}>
              {item.productName}
            </p>
            {item.itemId && <MarketplaceCode label="Mã SP" code={item.itemId} />}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <SkuCell item={item} />
      </TableCell>
      <TableCell>
        {/* Cho các nhãn XUỐNG DÒNG khi hẹp — ô bảng cắt chữ (…) làm "Đã gỡ trên sàn" cụt mất nghĩa. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <ShopName item={item} />
          <DelistedBadge status={item.status} />
        </div>
      </TableCell>
      <TableCell>
        <CostCell {...props} />
      </TableCell>
      <TableCell className="truncate text-right">
        {formatVND(item.sellingPrice)}
      </TableCell>
    </TableRow>
  );
}
