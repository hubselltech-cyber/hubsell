"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileSignature, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, checkAwaitingSignature, fetchAwaitingSignature, type AwaitingSignatureDTO } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * DẢI NHẮC "TỜ NHÁP ĐANG CHỜ BẠN KÝ" (lát T1 tenant, 08/10/2026).
 *
 * Shop dùng chữ ký số từ xa (MISA eSign) hoặc USB token: Hubsell không ký nền được, chỉ
 * lập tờ nháp trên web nhà cung cấp; bước ký vẫn là việc của người. Dải này là MỘT nút
 * cho việc đó (quy tắc "khách cần đơn giản"): mở trang ký, và "Tôi đã ký, kiểm ngay" để
 * Hubsell nhận số ngay thay vì chờ nhịp 30 phút. Không có tờ nào chờ thì không hiện.
 *
 * Nghiệp vụ thuế: ngày ký số được khác ngày lập nhưng chậm nhất là ngày làm việc tiếp
 * theo (NĐ 254/2026) — tờ quá hạn ký được nêu riêng để shop ưu tiên.
 *
 * `refreshKey` đổi giá trị = tải lại (nơi dùng vừa xuất thêm hóa đơn).
 */
export function AwaitingSignatureBanner({
  className,
  refreshKey = 0,
  onChanged,
}: {
  className?: string;
  refreshKey?: number;
  /** Gọi sau khi "kiểm ngay" nối được số cho tờ nào đó — nơi dùng tải lại danh sách của nó. */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<AwaitingSignatureDTO | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchAwaitingSignature());
    } catch (err) {
      // Không có quyền / mất phiên: im lặng, dải chỉ là tiện ích.
      if (!(err instanceof ApiError && err.status === 401)) setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!data || data.count === 0) return null;

  async function handleCheck() {
    if (checking) return;
    setChecking(true);
    try {
      const r = await checkAwaitingSignature();
      if (r.busy) {
        toast.info("Hubsell đang kiểm với nhà cung cấp — vài giây nữa bấm lại.");
      } else if (r.signed > 0) {
        toast.success(
          `Đã nhận ${r.signed} hóa đơn bạn vừa ký${r.waiting > 0 ? ` — còn ${r.waiting} tờ chờ ký` : ""}. Xem và tải PDF tại Lịch sử & Báo cáo thuế.`
        );
        onChanged?.();
      } else if (r.gone > 0) {
        toast.warning(`${r.gone} tờ nháp đã bị xóa trên web nhà cung cấp trước khi ký — đơn quay lại Hàng chờ.`);
        onChanged?.();
      } else {
        toast.info("Chưa thấy tờ nào được ký. Ký & phát hành trên web nhà cung cấp xong rồi bấm lại.");
      }
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError && err.message ? err.message : "Không kiểm được với nhà cung cấp — thử lại sau.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900",
        className
      )}
    >
      <FileSignature className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {/* Chuỗi template để Turbopack không nuốt khoảng trắng sau {số}. */}
        <b>{`${data.count} hóa đơn`}</b>
        {" đang chờ bạn ký trên web nhà cung cấp hóa đơn"}
        {data.overdueCount > 0
          ? ` — trong đó ${data.overdueCount} tờ đã quá hạn ký (ngày ký chậm nhất là ngày làm việc tiếp theo kể từ ngày lập, NĐ 254/2026). `
          : ". Nên ký trong ngày (ngày ký chậm nhất là ngày làm việc tiếp theo kể từ ngày lập). "}
        Vào Hóa đơn → Chưa phát hành → chọn các tờ → Ký &amp; phát hành; ký xong Hubsell tự nhận số.
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {data.signUrl && (
          <a
            href={data.signUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-sm:h-10")}
          >
            <ExternalLink className="size-3.5" />
            Mở trang ký
          </a>
        )}
        <Button size="sm" className="max-sm:h-10" onClick={() => void handleCheck()} disabled={checking}>
          {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Tôi đã ký, kiểm ngay
        </Button>
      </span>
    </div>
  );
}
