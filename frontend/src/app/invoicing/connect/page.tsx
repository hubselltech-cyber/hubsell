"use client";

import { useState } from "react";
import { CircleAlert, FlaskConical } from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { InvoiceConfigSection } from "@/components/settings/invoice-config-section";
import { InvoiceIssueCard } from "@/components/settings/invoice-issue-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";

/**
 * KẾT NỐI & XUẤT HÓA ĐƠN — tích hợp Hóa đơn điện tử Multi-Vendor (MISA/BKAV).
 *
 * BỐ CỤC 2 TAB (24/08, anh Trung yêu cầu khu thao tác phải gọn, không rối):
 *   · "Xuất hóa đơn" (mặc định) — hàng chờ + công tắc tự động, việc dùng
 *     HẰNG NGÀY nên đứng đầu.
 *   · "Cấu hình kết nối" — form 3 bước InvoiceConfigSection, việc làm MỘT LẦN.
 * Cả hai tab luôn mounted (ẩn bằng CSS) để form cấu hình không mất dữ liệu
 * đang gõ dở khi chuyển qua lại.
 *
 * Toàn module nằm dưới feature flag `is_tax_module_enabled`. Mặc định TẮT: hiện
 * banner Beta và toàn bộ thao tác chạy ở chế độ Sandbox (không phát hành hóa đơn
 * thật), an toàn cho dữ liệu thật của shop.
 *
 * Quy định pháp lý về HĐĐT được thu gọn vào icon tooltip cạnh tiêu đề —
 * hover/focus vào icon cam để xem.
 */
export default function InvoicingConnectPage() {
  const enabled = isFeatureEnabled("is_tax_module_enabled");
  const [tab, setTab] = useState<"issue" | "config">("issue");

  return (
    <SettingsShell
      title={
        <span className="inline-flex items-center gap-2">
          Kết nối &amp; Xuất hóa đơn
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Quy định về Hóa đơn điện tử cho Shop TMĐT"
                  className="text-amber-500 transition-colors hover:text-amber-600"
                />
              }
            >
              <CircleAlert className="size-4" />
            </TooltipTrigger>
            <TooltipContent className="block max-w-80 text-xs leading-relaxed">
              <p className="font-semibold">
                💡 Quy định về Hóa đơn điện tử (HĐĐT) cho Shop TMĐT:
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>
                  <b>Doanh thu trên 1 tỷ đồng/năm:</b> Bắt buộc phải áp dụng hóa
                  đơn điện tử có mã của cơ quan thuế hoặc khởi tạo từ máy tính
                  tiền.
                </li>
                <li>
                  <b>Doanh thu từ 1 tỷ đồng trở xuống:</b> Không bắt buộc xuất
                  theo doanh thu, trừ khi khách hàng yêu cầu hoặc shop tự nguyện
                  đăng ký sử dụng.
                </li>
              </ul>
            </TooltipContent>
          </Tooltip>
        </span>
      }
      description="Xuất hóa đơn cho đơn đã giao ngay tại đây — kết nối nhà cung cấp hóa đơn thiết lập một lần ở tab Cấu hình."
    >
      {enabled ? (
        <div className="flex max-w-2xl items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Hóa đơn phát hành là chứng từ thật</p>
            <p className="mt-0.5 text-amber-700">
              Hóa đơn phát hành từ <b>tài khoản Hóa đơn điện tử của chính
              shop</b> và được gửi <b>Cơ quan Thuế thật</b> — kiểm tra kỹ thông
              tin pháp nhân, ký hiệu và thuế suất GTGT mặc định trước khi xuất
              hóa đơn đầu tiên.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex max-w-2xl items-start gap-3 rounded-lg border border-teal-200 bg-teal-50 p-3.5 text-sm text-teal-800">
          <FlaskConical className="mt-0.5 size-5 shrink-0 text-teal-600" />
          <div>
            <p className="font-semibold">Module đang ở chế độ Beta (Giữ chỗ)</p>
            <p className="mt-0.5 text-teal-700">
              Bạn có thể cấu hình trước nhà cung cấp và khóa kết nối, nhưng hệ
              thống <b>chưa phát hành hóa đơn thật</b>.
            </p>
          </div>
        </div>
      )}

      {/* ---- Tab: Xuất hóa đơn (thao tác hằng ngày) / Cấu hình kết nối ---- */}
      <div
        role="tablist"
        aria-label="Khu vực Hóa đơn điện tử"
        className="flex flex-wrap gap-1 border-b"
      >
        {(
          [
            { key: "issue", label: "Xuất hóa đơn" },
            { key: "config", label: "Cấu hình kết nối" },
          ] as const
        ).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Hộp XUẤT hóa đơn nằm ngay trang này (anh Trung chốt 23/08) — cấu hình
          xong là phát hành được tại chỗ; Lịch sử chỉ để tra + tải PDF. */}
      <div className={cn(tab !== "issue" && "hidden")}>
        <InvoiceIssueCard onOpenConfig={() => setTab("config")} />
      </div>
      <div className={cn(tab !== "config" && "hidden")}>
        <InvoiceConfigSection readOnlyPreview={!enabled} />
      </div>
    </SettingsShell>
  );
}
