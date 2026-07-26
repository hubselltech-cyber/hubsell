"use client";

import { CircleAlert, FlaskConical } from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { InvoiceConfigSection } from "@/components/settings/invoice-config-section";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * KẾT NỐI & XUẤT HÓA ĐƠN — tích hợp Hóa đơn điện tử Multi-Vendor (MISA/BKAV).
 *
 * Chuyển từ Cấu hình → Hóa đơn & Thuế (đổi tên từ "Hóa đơn & Thuế" thành
 * "Kết nối & Xuất hóa đơn"); /settings/tax cũ redirect về đây. Nội dung 4 khối
 * giữ nguyên trong InvoiceConfigSection.
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
      description="Kết nối nhà cung cấp Hóa đơn điện tử (Multi-Vendor), chữ ký số, template và bật/tắt module."
    >
      {!enabled && (
        <div className="flex max-w-2xl items-start gap-3 rounded-lg border border-teal-200 bg-teal-50 p-3.5 text-sm text-teal-800">
          <FlaskConical className="mt-0.5 size-5 shrink-0 text-teal-600" />
          <div>
            <p className="font-semibold">Module đang ở chế độ Beta (Giữ chỗ)</p>
            <p className="mt-0.5 text-teal-700">
              Bạn có thể cấu hình trước nhà cung cấp và khóa kết nối, nhưng hệ
              thống <b>chưa phát hành hóa đơn thật</b> — mọi thao tác chạy ở
              Sandbox để an toàn cho dữ liệu. Tính năng sẽ mở khi bật cờ{" "}
              <code className="rounded bg-teal-100 px-1 py-0.5 text-[12px]">
                is_tax_module_enabled
              </code>
              .
            </p>
          </div>
        </div>
      )}

      <InvoiceConfigSection readOnlyPreview={!enabled} />
    </SettingsShell>
  );
}
