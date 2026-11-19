"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiError, getStoredUser, updateSyncSettings, type RestockOnReturn } from "@/lib/api";
import { canManageShop } from "@/lib/permissions";
import { useStockSettings } from "@/lib/stock-model";
import { TEXT_SUB } from "@/lib/typography";
import { useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * CÁCH CỘNG TỒN CHO ĐƠN HỦY SAU KHI ĐÃ GIAO — kho chuẩn quốc tế lát 2 (20/11/2026, anh Trung chốt
 * 12/11 "chia theo shop"; docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 5.2.1 + 15).
 *
 * Mỗi shop tự chọn một trong hai:
 *   · Khi sàn báo hủy (mặc định, cách cũ) — cộng lại tồn ngay, kiện còn trên đường về vẫn nằm trên sổ;
 *   · Khi kho nhận kiện (chuẩn) — chỉ cộng khi bấm Nhập kho cho kiện nguyên vẹn; hỏng / mất không cộng.
 * Hộp nói rõ được gì, mất gì. Chỉ chủ shop đổi được; nhân viên không thấy nút. Đổi chỉ áp cho đơn hủy
 * TỪ lúc đổi — đơn đã cộng trước đó giữ nguyên.
 */
const OPTIONS: { key: RestockOnReturn; title: string; short: string; body: string }[] = [
  {
    key: "ON_CANCEL",
    title: "Khi sàn báo hủy",
    short: "khi sàn báo hủy",
    body: "Đơn hủy sau khi đã giao được cộng lại tồn ngay, kể cả khi kiện chưa về tới kho. Hợp với shop không quét nhận hàng hoàn. Kiện về hỏng hoặc thất lạc thì số đã cộng không tự rút lại.",
  },
  {
    key: "ON_RECEIVE",
    title: "Khi kho nhận kiện",
    short: "khi kho nhận kiện",
    body: "Chỉ cộng lại tồn khi kho bấm Nhập kho cho kiện nguyên vẹn; kiện hỏng, mất thì không cộng. Tồn kho luôn đúng với hàng thực có. Đổi lại phải nhận đủ mọi kiện ở trang này — kiện không nhận thì tồn không về.",
  },
];

export function RestockModeControl() {
  const { restockOnReturn, loaded } = useStockSettings();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<RestockOnReturn | null>(null);
  // Quyền đọc từ trình duyệt → chỉ biết sau khi gắn trang (tránh lệch với bản dựng sẵn).
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    setOwner(canManageShop(getStoredUser()));
  }, []);

  if (!owner || !loaded) return null;

  async function choose(next: RestockOnReturn) {
    if (next === restockOnReturn) {
      setOpen(false);
      return;
    }
    setSaving(next);
    try {
      await updateSyncSettings({ restockOnReturn: next });
      invalidate(["stock-model"]);
      invalidate(["products"]);
      toast.success(
        next === "ON_RECEIVE"
          ? "Từ giờ đơn hủy sau khi giao chỉ cộng lại tồn khi kho nhận kiện. Đơn đã cộng trước đó giữ nguyên."
          : "Từ giờ đơn hủy sau khi giao được cộng lại tồn ngay khi sàn báo hủy.",
        { duration: 8000 }
      );
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSaving(null);
    }
  }

  const current = OPTIONS.find((o) => o.key === restockOnReturn) ?? OPTIONS[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            title="Đơn hủy sau khi đã giao cho vận chuyển thì cộng lại tồn kho lúc nào"
          />
        }
      >
        <PackageOpen className="size-4" />
        {/* Chữ chỉ hiện từ màn 1400px: ở 1280 thanh công cụ không đủ chỗ, hiện chữ là rớt xuống dòng hai. */}
        <span className="hidden min-[1400px]:inline">Cộng tồn {current.short}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-2">
        <p className="px-2 pb-1 pt-1 text-sm font-medium">Đơn hủy sau khi đã giao: cộng lại tồn kho lúc nào?</p>
        <div className="space-y-1">
          {OPTIONS.map((o) => {
            const active = o.key === restockOnReturn;
            return (
              <button
                key={o.key}
                type="button"
                disabled={saving !== null}
                onClick={() => void choose(o.key)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-60",
                  active ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"
                )}
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  {saving === o.key ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : active ? (
                    <Check className="size-4 text-primary" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{o.title}</span>
                  <span className={cn(TEXT_SUB, "block")}>{o.body}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className={cn(TEXT_SUB, "px-2 pb-1 pt-2")}>Đổi chỉ áp cho đơn hủy từ lúc đổi. Đơn đã cộng tồn trước đó giữ nguyên.</p>
      </PopoverContent>
    </Popover>
  );
}
