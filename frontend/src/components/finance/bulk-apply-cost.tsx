"use client";

import * as React from "react";
import { toast } from "sonner";
import { CopyPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ApiError, updateSkuCostPriceBulk, type SkuProduct } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Nút "áp dụng giá vốn này cho mọi phân loại của cùng mẫu hàng".
 *
 * LUÔN hỏi lại trước khi ghi. Ghi đè giá vốn là thao tác không hoàn tác được và
 * ảnh hưởng thẳng tới báo cáo lợi nhuận, nên người dùng phải nhìn thấy đúng
 * danh sách SKU sắp bị đổi — nhất là những mã ĐÃ CÓ giá vốn khác, vì đó mới là
 * chỗ dễ mất dữ liệu. Các mã đó được đánh dấu riêng trong danh sách.
 */
export function BulkApplyCost({
  targets,
  costDigits,
  onApplied,
}: {
  /**
   * TOÀN BỘ các dòng cùng mẫu hàng, KỂ CẢ dòng người dùng đang gõ.
   * Phải gồm cả dòng đang gõ: giá vừa nhập chưa được lưu (chưa rời ô), nếu chỉ
   * ghi cho các dòng khác rồi tải lại danh sách thì chính dòng vừa gõ lại hoá
   * trống — đúng cái dòng người dùng thao tác lại là dòng không có giá.
   */
  targets: SkuProduct[];
  /** Giá vốn đang gõ, dạng chuỗi chữ số thô */
  costDigits: string;
  onApplied: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const cost = Number(costDigits);
  const valid = costDigits !== "" && !Number.isNaN(cost) && cost > 0;

  // Những mã sắp bị GHI ĐÈ lên một giá vốn khác đang có — cần cảnh báo rõ
  const overwriting = targets.filter((s) => {
    const c = Number(s.costPrice);
    return c > 0 && c !== cost;
  });

  async function handleApply() {
    setSaving(true);
    try {
      const res = await updateSkuCostPriceBulk(
        targets.map((s) => s.skuId),
        cost
      );
      toast.success(
        `Đã áp giá vốn ${formatVND(cost)} cho ${res.updated} phân loại`
      );
      setOpen(false);
      onApplied();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không áp dụng được giá vốn"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={!valid}
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            title={
              valid
                ? `Áp dụng giá vốn này cho cả ${targets.length} phân loại`
                : "Nhập giá vốn trước khi áp dụng hàng loạt"
            }
            aria-label="Áp dụng giá vốn cho tất cả phân loại"
          >
            <CopyPlus className="size-4" />
          </Button>
        }
      />

      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              Áp {formatVND(cost)} cho {targets.length} phân loại?
            </p>
            <p className={TEXT_SUB}>
              Các mã cùng mẫu hàng sẽ được đặt cùng một giá vốn.
            </p>
          </div>

          <ul className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg bg-muted/50 p-2">
            {targets.map((s) => {
              const current = Number(s.costPrice);
              const willOverwrite = current > 0 && current !== cost;
              return (
                <li key={s.skuId} className="text-xs">
                  <span className="font-mono font-medium">{s.sku}</span>
                  {willOverwrite ? (
                    <span className="ml-1.5 text-amber-700">
                      ghi đè {formatVND(current)}
                    </span>
                  ) : (
                    <span className="ml-1.5 text-muted-foreground">
                      {current > 0 ? "giá đã trùng" : "chưa có giá vốn"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {overwriting.length > 0 && (
            <p className={cn(TEXT_SUB, "text-amber-700")}>
              ⚠ {overwriting.length} mã đang có giá vốn khác sẽ bị ghi đè, không
              hoàn tác được.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Huỷ
            </Button>
            <Button size="sm" onClick={handleApply} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Áp dụng
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
