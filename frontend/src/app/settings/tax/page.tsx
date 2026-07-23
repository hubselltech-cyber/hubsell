"use client";

import { FlaskConical } from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { InvoiceConfigSection } from "@/components/settings/invoice-config-section";
import { isFeatureEnabled } from "@/lib/feature-flags";

/**
 * HÓA ĐƠN & THUẾ — cấu hình tích hợp Hóa đơn điện tử Multi-Vendor.
 *
 * Toàn module nằm dưới feature flag `is_tax_module_enabled`. Mặc định TẮT: hiện
 * banner Beta và toàn bộ thao tác chạy ở chế độ Sandbox (không phát hành hóa đơn
 * thật), an toàn cho dữ liệu thật của shop.
 */
export default function SettingsTaxPage() {
  const enabled = isFeatureEnabled("is_tax_module_enabled");

  return (
    <SettingsShell
      title="Hóa đơn & Thuế"
      description="Kết nối nhà cung cấp Hóa đơn điện tử (Multi-Vendor) và chữ ký số."
    >
      {!enabled && (
        <div className="flex max-w-2xl items-start gap-3 rounded-lg border border-teal-200 bg-teal-50 p-3.5 text-sm text-teal-800">
          <FlaskConical className="mt-0.5 size-5 shrink-0 text-teal-600" />
          <div>
            <p className="font-semibold">
              Module đang ở chế độ Beta (Giữ chỗ)
            </p>
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
