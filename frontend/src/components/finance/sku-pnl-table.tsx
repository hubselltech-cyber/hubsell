"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Crown,
  ImageIcon,
  Loader2,
  Megaphone,
  PackageSearch,
  PackageX,
  Pencil,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";

import { HintText } from "@/components/finance/hint-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Label } from "@/components/ui/label";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  fetchSkuPnl,
  updateCostPriceBySku,
  type ChannelFilterQuery,
  type SkuPnlResponse,
  type SkuPnlRow,
} from "@/lib/api";
import { Refreshing } from "@/components/refreshing";
import type { DateRange } from "@/lib/date-range";
import { formatVND, formatNumber } from "@/lib/format";
import {
  CELL_PADDING,
  MONEY_NEGATIVE,
  MONEY_POSITIVE,
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

// Khoảng đệm ô lấy từ quy chuẩn hệ thống (lib/typography.ts) để co giãn
// đồng bộ với cỡ chữ trên màn hình lớn
const CELL_PAD = CELL_PADDING;

// Cột "Sản phẩm" ghim cố định mép trái khi cuộn ngang xem các chỉ số tài chính
const STICKY_COL =
  "sticky left-0 z-10 bg-card shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]";

// Ô tiêu đề của cột ghim: nền phải trùng nền thanh tiêu đề (TABLE_HEAD_EMPHASIS)
// chứ không phải nền thẻ, kẻo cuộn ngang lộ một ô trắng lệch tông.
const STICKY_HEAD =
  "sticky left-0 z-10 bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]";

// Bảng dài thì cắt trang tại chỗ — dữ liệu đã về đủ trong một lần gọi API
const PAGE_SIZE = 10;

/** Ba tab lọc nhanh. Thứ tự đi từ rộng đến hẹp dần theo mức độ cần xử lý. */
type PnlTab = "all" | "urgent" | "missing-cost";

const TABS: { key: PnlTab; label: string }[] = [
  { key: "all", label: "Tất cả sản phẩm" },
  { key: "urgent", label: "🚨 Cần xử lý ngay" },
  { key: "missing-cost", label: "⚠️ Chưa nhập giá vốn" },
];

/** Một mã có thuộc tab đang chọn hay không. */
function matchTab(row: SkuPnlRow, tab: PnlTab): boolean {
  if (tab === "urgent") {
    return row.lossReason !== null || Boolean(row.breakEven?.isOverspending);
  }
  if (tab === "missing-cost") return row.missingCost;
  return true;
}

// ---------- Popup nhập nhanh giá vốn ----------

/**
 * Nhập giá vốn ngay trên dòng đang xem. Trước đây chủ shop phải rời trang sang
 * Cấu hình Giá vốn rồi tìm lại đúng mã — mất mạch khi đang soát một danh sách dài.
 */
function QuickCostDialog({
  row,
  open,
  onOpenChange,
  onSaved,
}: {
  row: SkuPnlRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cost = Number(value);
  const invalid = value.trim() === "" || Number.isNaN(cost) || cost < 0;

  // Giá vốn phải thấp hơn giá bán trung bình, nếu không thì bán ra là lỗ ngay.
  const avgPrice = row.quantitySold > 0 ? row.revenue / row.quantitySold : 0;
  const aboveSellingPrice = !invalid && avgPrice > 0 && cost >= avgPrice;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setSubmitting(true);
    try {
      const res = await updateCostPriceBySku(row.sku, cost);
      toast.success(
        `Đã đặt giá vốn ${formatVND(cost)} cho ${row.sku}` +
          (res.backfilledOrderLines > 0
            ? ` · tính lại lãi/lỗ cho ${formatNumber(res.backfilledOrderLines)} dòng hàng đã bán`
            : "")
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được giá vốn");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nhập nhanh giá vốn</DialogTitle>
          <DialogDescription>
            {row.productName} · <span className="font-mono">{row.sku}</span>
            {avgPrice > 0 && (
              <>
                <br />
                Giá bán trung bình đang là {formatVND(Math.round(avgPrice))}/sp.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="quick-cost">Giá vốn cho một sản phẩm (₫)</Label>
            <Input
              id="quick-cost"
              type="number"
              min="0"
              autoFocus
              placeholder="VD: 65000"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {aboveSellingPrice ? (
              <p className="text-sm text-amber-600">
                Giá vốn đang cao hơn hoặc bằng giá bán trung bình — mã này sẽ lỗ ở
                mọi đơn. Vẫn lưu được nếu anh chắc chắn.
              </p>
            ) : (
              <p className={TEXT_SUB}>
                Áp cho sản phẩm gốc trong kho, mọi gian hàng dùng chung một giá
                vốn. Các đơn đã bán mà lúc bán chưa có giá vốn cũng được tính lại
                theo mức này.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting || invalid}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Lưu giá vốn
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/// Bảng phân tích hiệu quả kinh doanh từng mã SKU:
/// SKU nào là "gà đẻ trứng vàng", SKU nào đang gánh lỗ.
export function SkuPnlTable({
  range,
  channel,
}: {
  range?: DateRange;
  channel?: ChannelFilterQuery;
}) {
  const [data, setData] = useState<SkuPnlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<PnlTab>("all");
  const [editingCost, setEditingCost] = useState<SkuPnlRow | null>(null);
  const [page, setPage] = useState(1);

  // Đổi tab hay bộ lọc là quay về trang đầu; riêng lưu giá vốn xong thì load()
  // lại nhưng GIỮ nguyên trang để không mất mạch đang soát dở danh sách.
  useEffect(() => {
    setPage(1);
  }, [tab, range, channel]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchSkuPnl(range, channel));
    } catch {
      // Trang cha đã xử lý 401/403/409
    } finally {
      setLoading(false);
    }
  }, [range, channel]);

  useEffect(() => {
    load();
  }, [load]);

  const allItems = useMemo(() => data?.items ?? [], [data]);
  const items = useMemo(
    () => allItems.filter((r) => matchTab(r, tab)),
    [allItems, tab]
  );

  // Kẹp lại số trang khi dữ liệu co hẹp (vd. nhập xong giá vốn ở tab "Chưa
  // nhập giá vốn" làm danh sách ngắn đi) — không bao giờ đứng ở trang rỗng.
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedItems = items.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  // Số đếm trên tab lấy từ máy chủ để phản ánh đúng toàn bộ tập dữ liệu
  const tabCount: Record<PnlTab, number> = {
    all: data?.summary.skuCount ?? 0,
    urgent: data?.summary.urgentCount ?? 0,
    "missing-cost": data?.summary.missingCostCount ?? 0,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hiệu quả kinh doanh theo sản phẩm (SKU P&amp;L)</CardTitle>
        <CardDescription>
          Lời/lỗ từng mã hàng trên đơn <b>Đã giao</b>. Phí sàn &amp; ship được phân
          bổ theo tỷ trọng doanh thu; chi phí biến đổi tính vào đúng SKU được gắn.
          Chi phí cố định không phân bổ — trừ vào lợi nhuận chung của shop.
        </CardDescription>

        {/* Tab lọc nhanh — đi thẳng vào nhóm cần xử lý thay vì đọc hết bảng */}
        <div className="flex flex-wrap gap-2 pt-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium transition-all",
                tab === t.key
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {t.label}
              <span
                className={cn(
                  "ml-2 rounded-full px-1.5 py-0.5 text-xs",
                  tab === t.key ? "bg-white/20" : "bg-muted"
                )}
              >
                {formatNumber(tabCount[t.key])}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Chỉ hiện chữ "đang tính" ở lần tải đầu; đổi bộ lọc thì giữ bảng cũ
            và làm mờ đi để mắt không bị giật khi bảng biến mất rồi hiện lại */}
        {loading && !data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tính toán hiệu quả từng SKU…
          </p>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <PackageSearch className="mx-auto mb-2 size-8" />
            {allItems.length === 0 ? (
              <>
                Chưa có dữ liệu. Cần ít nhất một đơn <b>Đã giao</b> có chi tiết sản
                phẩm.
              </>
            ) : tab === "urgent" ? (
              <>Không có mã nào đang lỗ hay vượt trần quảng cáo.</>
            ) : (
              <>Mọi mã đã bán đều đã có giá vốn.</>
            )}
          </div>
        ) : (
          <Refreshing active={loading}>
            {/* Cảnh báo tổng: có SKU đang đốt tiền quảng cáo vượt ngưỡng */}
            {(data?.summary.overspendingCount ?? 0) > 0 && (
              <div className="mx-4 mb-3 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                <span className="text-lg leading-none">🚨</span>
                <div className="text-sm">
                  <p className="font-medium text-rose-800">
                    {formatNumber(data!.summary.overspendingCount)} sản phẩm đang chi
                    quảng cáo vượt ngưỡng an toàn
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Chi phí marketing mỗi đơn đã vượt trần cho phép — nên tắt hoặc tối
                    ưu lại chiến dịch để không bị lỗ thêm.
                  </p>
                </div>
              </div>
            )}

            <Table>
                <TableHeader className={TABLE_HEAD_EMPHASIS}>
                  <TableRow>
                    {/* Cột sản phẩm ghim trái — luôn thấy được khi cuộn ngang */}
                    <TableHead className={cn(STICKY_HEAD, CELL_PADDING)}>
                      Sản phẩm
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>Đã bán</TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Doanh thu thuần
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>Giá vốn</TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Phí sàn &amp; ship
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Chi phí marketing
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Lợi nhuận
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>Biên LN</TableHead>
                    <TableHead className={cn(CELL_PAD, "text-center")}>
                      Thao tác
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedItems.map((row, index) => {
                    const profitable = row.profit > 0;
                    // Mã lãi cao nhất được gắn vương miện — tính theo vị trí
                    // trong TOÀN danh sách, không phải vị trí trên trang hiện tại
                    const isTop =
                      (safePage - 1) * PAGE_SIZE + index === 0 && profitable;
                    const be = row.breakEven;
                    // Giá bán thực tế đang thấp hơn giá hoà vốn ⇒ mỗi đơn bán ra là mỗi lần lỗ
                    const belowFloor = be ? be.avgSellingPrice < be.floorPrice : false;
                    return (
                      <TableRow key={row.sku}>
                        <TableCell className={cn(STICKY_COL, CELL_PADDING)}>
                          <div className="flex items-center gap-3">
                            {row.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={row.imageUrl}
                                alt={row.productName}
                                className="size-9 shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <ImageIcon className="size-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 font-medium">
                                {isTop && (
                                  <Crown className="size-4 shrink-0 text-amber-500" />
                                )}
                                <span className="truncate">{row.productName}</span>
                              </p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {row.sku}
                              </p>
                              {row.missingCost && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                  <AlertTriangle className="size-3" />
                                  Chưa nhập giá vốn
                                </span>
                              )}
                              {/* LÝ DO LỖ — hai loại cần hai cách chữa khác nhau */}
                              {row.lossReason === "ADS" && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">
                                  <Megaphone className="size-3" />
                                  Lỗ do Ads
                                </span>
                              )}
                              {row.lossReason === "COST" && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-red-500">
                                  <PackageX className="size-3" />
                                  Lỗ do Giá vốn / Phí sàn
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className={cn(CELL_PAD, "text-right font-medium")}>
                          {formatNumber(row.quantitySold)}
                        </TableCell>

                        {/* Doanh thu thuần + dòng phụ: giá hoà vốn mỗi sản phẩm */}
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          <Money value={row.revenue} className="block text-slate-900" />
                          {be && (
                            <HintText
                              className={cn(
                                "mt-0.5",
                                belowFloor
                                  ? "font-medium text-red-500"
                                  : "text-muted-foreground"
                              )}
                              hint={
                                <>
                                  <b>Giá bán hoà vốn</b> = giá vốn/sp + phí sàn &amp;
                                  ship trung bình/sp. Bán dưới mức này là chắc chắn âm
                                  tiền túi.
                                  <br />
                                  Giá bán trung bình hiện tại:{" "}
                                  {formatVND(be.avgSellingPrice)}/sp.
                                </>
                              }
                            >
                              {belowFloor && "⚠️ "}
                              Hoà vốn/sp: {formatVND(be.floorPrice)}
                            </HintText>
                          )}
                        </TableCell>
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          {row.cogs > 0 ? (
                            <Money
                              value={row.cogs}
                              negative
                              className={TEXT_NUMBER_MUTED}
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          {row.allocatedFee > 0 ? (
                            <Money
                              value={row.allocatedFee}
                              negative
                              className={TEXT_NUMBER_MUTED}
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        {/* Chi phí marketing + dòng phụ: trần Ads cho mỗi đơn */}
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          {row.marketingCost > 0 ? (
                            <Money
                              value={row.marketingCost}
                              negative
                              className={cn(
                                "block",
                                be?.isOverspending
                                  ? cn("font-semibold", MONEY_NEGATIVE)
                                  : TEXT_NUMBER_MUTED
                              )}
                            />
                          ) : (
                            <span className="block text-slate-400">—</span>
                          )}
                          {be && (
                            <HintText
                              className={cn(
                                "mt-0.5",
                                be.isOverspending
                                  ? "font-medium text-red-500"
                                  : "text-muted-foreground"
                              )}
                              hint={
                                <>
                                  <b>Trần Ads</b> = chi phí marketing tối đa trên mỗi
                                  đơn hàng để SKU này không bị lỗ tiền túi.
                                  <br />
                                  Đang tiêu thực tế:{" "}
                                  {formatVND(be.actualCpa)}/đơn.
                                  {be.isOverspending &&
                                    " → Vượt ngưỡng, nên tắt hoặc tối ưu lại chiến dịch."}
                                </>
                              }
                            >
                              {be.isOverspending && "🚨 "}
                              Trần Ads: {formatVND(be.targetCpa)}
                            </HintText>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            CELL_PAD,
                            "text-right font-semibold",
                            profitable ? MONEY_POSITIVE : MONEY_NEGATIVE
                          )}
                        >
                          <Money value={row.profit} />
                        </TableCell>
                        {/* Biên LN + dòng phụ: mức giảm giá tối đa còn hoà vốn */}
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          <span
                            className={cn(
                              "flex items-center justify-end gap-1 font-semibold",
                              profitable ? "text-emerald-500" : "text-red-500"
                            )}
                          >
                            {!profitable && <TrendingDown className="size-3.5" />}
                            {row.margin}%
                          </span>
                          {be && (
                            <HintText
                              className={cn(
                                "mt-0.5",
                                be.maxDiscountPercent > 0
                                  ? "text-muted-foreground"
                                  : "font-medium text-red-500"
                              )}
                              hint={
                                <>
                                  <b>Mức giảm tối đa</b> = lợi nhuận gộp (trước
                                  marketing) ÷ doanh thu. Cho biết được phép chạy Flash
                                  Sale giảm tối đa bao nhiêu % mà đơn vẫn hoà vốn trở
                                  lên.
                                </>
                              }
                            >
                              {be.maxDiscountPercent > 0
                                ? `Giảm tối đa: ${be.maxDiscountPercent}%`
                                : "Không thể giảm giá"}
                            </HintText>
                          )}
                        </TableCell>

                        <TableCell className={cn(CELL_PAD, "text-center")}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingCost(row)}
                          >
                            <Pencil className="size-3.5" />
                            {row.missingCost ? "Nhập giá vốn" : "Sửa giá vốn"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
            </Table>

            {/* Thanh phân trang — chỉ hiện khi danh sách vượt một trang */}
            {items.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  Hiển thị {formatNumber((safePage - 1) * PAGE_SIZE + 1)}–
                  {formatNumber(Math.min(safePage * PAGE_SIZE, items.length))} trên{" "}
                  {formatNumber(items.length)} sản phẩm · trang {safePage}/
                  {pageCount}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    <ChevronLeft className="size-4" />
                    Trang trước
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= pageCount}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Trang sau
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Đối chiếu về lợi nhuận cuối cùng của shop */}
            {data && (
              <div className="space-y-1 border-t p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Tổng lợi nhuận từ {formatNumber(data.summary.skuCount)} mã sản phẩm
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      data.summary.skuProfitTotal >= 0
                        ? "text-emerald-500"
                        : "text-red-500"
                    )}
                  >
                    {formatVND(data.summary.skuProfitTotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Chi phí cố định toàn shop (mặt bằng, lương…)
                  </span>
                  <span className="font-semibold text-red-500">
                    − {formatVND(data.summary.fixedExpense)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-medium">Lợi nhuận cuối cùng của shop</span>
                  <span
                    className={cn(
                      "text-base font-bold",
                      data.summary.shopProfit >= 0
                        ? "text-emerald-500"
                        : "text-red-500"
                    )}
                  >
                    {formatVND(data.summary.shopProfit)}
                  </span>
                </div>
              </div>
            )}
          </Refreshing>
        )}
      </CardContent>

      {editingCost && (
        <QuickCostDialog
          row={editingCost}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditingCost(null);
          }}
          onSaved={load}
        />
      )}
    </Card>
  );
}
