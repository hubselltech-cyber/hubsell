"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  applyCostToSearch,
  fetchSkuSearchSummary,
  previewCostForSearch,
  type SkuSearchApplyPreview,
  type SkuSearchApplySummary,
  type SkuSearchScope,
} from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";

/**
 * DẢI ÁP GIÁ CHO TẤT CẢ MÃ VỪA TÌM (03/11/2026). Nằm giữa thanh tìm và bảng, chỉ hiện khi có từ khóa khớp mã.
 * Máy chủ tự tính danh sách theo từ khóa và bộ lọc; mặc định chỉ điền ô trống. Thao tác không hoàn tác được nên
 * luôn qua hộp xác nhận ghi đúng số mã, giá cũ, giá mới.
 */
export function CostSearchApply({
  scope,
  scopeLabels,
  onApplied,
  onShowAll,
}: {
  scope: SkuSearchScope;
  /** Tên các bộ lọc đang bật, để hộp xác nhận nói rõ phạm vi. */
  scopeLabels: string[];
  onApplied: () => void;
  onShowAll: () => void;
}) {
  const [summary, setSummary] = React.useState<SkuSearchApplySummary | null>(null);
  const [digits, setDigits] = React.useState("");
  const [overwrite, setOverwrite] = React.useState(false);
  const [preview, setPreview] = React.useState<SkuSearchApplyPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [reloadTick, setReloadTick] = React.useState(0);

  const { q, channel, shop, listing, status } = scope;
  const scopeKey = `${q}|${channel}|${shop}|${listing}|${status}`;

  // Đổi từ khóa hoặc bộ lọc: bỏ tick ghi đè, không để lựa chọn cũ áp sang danh sách mới.
  React.useEffect(() => {
    setOverwrite(false);
    setSummary(null);
  }, [scopeKey]);

  React.useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      fetchSkuSearchSummary({ q, channel, shop, listing, status })
        .then((r) => {
          if (!stale) setSummary(r);
        })
        .catch(() => {
          // Chỉ là phần phụ của trang: lỗi thì không hiện dải, ô tìm và bảng vẫn dùng được.
          if (!stale) setSummary(null);
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, channel, shop, listing, status, reloadTick]);

  if (!summary) return null;
  const hidden = summary.everywhere - summary.matched;
  if (summary.matched === 0 && hidden <= 0) return null;

  const cost = Number(digits);
  const validCost = digits !== "" && !Number.isNaN(cost) && cost > 0;
  const planned = overwrite ? summary.matched : summary.missing;
  const body = { q, channel, shop, listing, status, costPrice: cost, overwrite };

  async function openConfirm() {
    if (!validCost || planned === 0) return;
    setPreviewing(true);
    try {
      setPreview(await previewCostForSearch(body));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xem trước được danh sách mã");
    } finally {
      setPreviewing(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setApplying(true);
    try {
      const res = await applyCostToSearch({ ...body, expectedRows: preview.rows });
      toast.success(
        `Đã áp giá vốn ${formatVND(cost)} cho ${formatNumber(res.updated)} mã` +
          (res.backfilledOrderLines > 0
            ? ` · tính lại ${formatNumber(res.backfilledOrderLines)} dòng đơn cũ`
            : ""),
        { duration: 6000 }
      );
      setPreview(null);
      setDigits("");
      setOverwrite(false);
      setReloadTick((n) => n + 1);
      onApplied();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không áp được giá vốn");
      // Danh sách đổi giữa chừng: tính lại cho khách xem số mới.
      if (err instanceof ApiError && err.status === 409) {
        setPreview(await previewCostForSearch(body).catch(() => null));
        setReloadTick((n) => n + 1);
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card px-3 py-2.5 text-sm">
      {summary.matched > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 break-words">
            <b className="tabular-nums">{formatNumber(summary.matched)}</b> mã khớp “{q}”
            {" · "}
            <b className="tabular-nums">{formatNumber(summary.missing)}</b> mã chưa có giá
          </p>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {summary.filled > 0 && (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer accent-primary"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                />
                <span>
                  Ghi đè cả <span className="tabular-nums">{formatNumber(summary.filled)}</span> mã đang
                  có giá
                </span>
              </label>
            )}
            <CurrencyInput
              className="w-36 text-right tabular-nums"
              placeholder="Nhập giá vốn"
              aria-label={`Giá vốn áp cho các mã khớp ${q}`}
              value={digits}
              onValueChange={setDigits}
              onKeyDown={(e) => {
                if (e.key === "Enter") void openConfirm();
              }}
            />
            <Button
              size="sm"
              disabled={!validCost || planned === 0 || previewing}
              onClick={() => void openConfirm()}
            >
              {previewing && <Loader2 className="size-4 animate-spin" />}
              Áp cho {formatNumber(planned)} mã
            </Button>
          </div>
        </div>
      )}
      {hidden > 0 && (
        <p className={TEXT_SUB}>
          Còn <span className="tabular-nums">{formatNumber(hidden)}</span> mã khớp đang bị bộ lọc ẩn.{" "}
          <button
            type="button"
            onClick={onShowAll}
            className="font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            Xem cả các mã này
          </button>
        </p>
      )}

      <Dialog
        open={preview !== null}
        onOpenChange={(o) => {
          if (!o && !applying) setPreview(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Áp giá vốn {formatVND(cost)} cho {formatNumber(preview.rows)} mã?
                </DialogTitle>
                <DialogDescription>
                  Các mã khớp “{q}”
                  {scopeLabels.length > 0 ? ` trong ${scopeLabels.join(" · ")}` : " trong toàn bộ gian hàng"}.
                  Không tính dòng chỉ khớp ở tên sản phẩm.
                </DialogDescription>
              </DialogHeader>

              {preview.rows === 0 ? (
                <p className="text-sm">Không có mã nào cần đổi với giá này.</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <ul className="space-y-1">
                    {preview.fill > 0 && (
                      <li>
                        Điền <b className="tabular-nums">{formatNumber(preview.fill)}</b> mã chưa có giá
                      </li>
                    )}
                    {preview.levels.map((l) => (
                      <li key={l.cost} className="text-amber-700">
                        Đổi <b className="tabular-nums">{formatNumber(l.rows)}</b> mã:{" "}
                        <span className="tabular-nums">
                          {formatVND(l.cost)} → {formatVND(cost)}
                        </span>
                      </li>
                    ))}
                    {preview.levelCount > preview.levels.length && (
                      <li className="text-amber-700">
                        và {formatNumber(preview.levelCount - preview.levels.length)} mức giá khác
                      </li>
                    )}
                  </ul>

                  <div>
                    <p className={TEXT_SUB}>Ví dụ mã sẽ được áp:</p>
                    <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto rounded-lg bg-muted/50 p-2 text-xs">
                      {preview.samples.map((s) => (
                        <li key={s} className="truncate font-mono" title={s}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {preview.middleRows > 0 && (
                    <p className="break-words text-amber-700">
                      Có <b className="tabular-nums">{formatNumber(preview.middleRows)}</b> mã chỉ chứa “{q}” ở
                      giữa, ví dụ: <span className="font-mono">{preview.middleSamples.join(", ")}</span>. Nếu
                      không đúng ý, hãy gõ từ khóa dài hơn.
                    </p>
                  )}

                  <p className={TEXT_SUB}>
                    Đơn cũ chưa có giá vốn sẽ được tính lại, đơn đã có giá giữ nguyên. Thao tác này không
                    hoàn tác được.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" disabled={applying} onClick={() => setPreview(null)}>
                  Huỷ
                </Button>
                <Button disabled={applying || preview.rows === 0} onClick={() => void apply()}>
                  {applying && <Loader2 className="size-4 animate-spin" />}
                  {applying ? "Đang áp giá…" : `Áp cho ${formatNumber(preview.rows)} mã`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
