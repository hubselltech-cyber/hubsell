"use client";

/**
 * HỘP PHÁT HÀNH HÓA ĐƠN CHO ĐƠN HÀNG (thí điểm MISA).
 *
 * 23/08 (khuya) anh Trung chốt bố cục: hộp này nằm ở trang KẾT NỐI & XUẤT HÓA
 * ĐƠN (đúng tên trang — cấu hình xong là xuất được ngay tại chỗ); trang Lịch
 * sử & Báo cáo thuế chỉ còn vai trò tra cứu + tải PDF. Tách thành component
 * riêng để trang nào cần cũng cắm được.
 *
 * GĐ kế tiếp (đã chốt lộ trình theo khảo sát BigSeller/Salework): thay ô nhập
 * mã đơn bằng MÀN HÀNG CHỜ + tự động xuất khi đơn thành công & đã đối soát.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, issueInvoice } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

export function InvoiceIssueCard({
  /** Gọi sau khi phát hành (kể cả NCC từ chối — log FAILED cũng là dữ liệu mới). */
  onIssued,
}: {
  onIssued?: () => void;
}) {
  const [issueCode, setIssueCode] = useState("");
  const [issuing, setIssuing] = useState(false);

  const handleIssue = async () => {
    const orderCode = issueCode.trim();
    if (!orderCode || issuing) return;
    setIssuing(true);
    try {
      const res = await issueInvoice(orderCode);
      toast.success(
        `Đã phát hành hóa đơn số ${res.log.invoiceNo ?? "?"} cho đơn ${orderCode} — xem và tải PDF tại Lịch sử & Báo cáo thuế.`
      );
      setIssueCode("");
      onIssued?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : "Phát hành hóa đơn thất bại"
      );
      onIssued?.();
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-5">
        <div className="mb-1 flex items-center gap-2">
          <ReceiptText className="size-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">
            Phát hành hóa đơn cho đơn hàng
          </h3>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            Thí điểm
          </span>
        </div>
        <p className={cn(TEXT_SUB, "mb-3")}>
          Nhập mã đơn hàng để phát hành hóa đơn điện tử. Dòng hàng lấy theo
          đơn, thuế suất theo từng sản phẩm (mặc định 0% nếu chưa khai), đơn
          giá bán coi là chưa gồm GTGT.
        </p>
        <div className="flex max-w-md gap-2">
          <Input
            value={issueCode}
            onChange={(e) => setIssueCode(e.target.value)}
            placeholder="Mã đơn hàng, VD 2508230ABCDEF"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleIssue();
            }}
          />
          <Button
            onClick={() => void handleIssue()}
            disabled={issuing || issueCode.trim() === ""}
          >
            {issuing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Đang phát hành…
              </>
            ) : (
              "Phát hành hóa đơn"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
