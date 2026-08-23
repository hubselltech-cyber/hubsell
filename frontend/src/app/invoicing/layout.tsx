"use client";

/**
 * LỚP CHẶN THÍ ĐIỂM cho toàn bộ /invoicing/* (23/08/2026): module Hóa đơn &
 * Thuế mới thông sandbox MISA, chỉ mở cho tài khoản trong TAX_PILOT_EMAILS
 * (feature-flags.ts) để anh Trung theo dõi và test. Sidebar đã ẩn mục này với
 * người ngoài thí điểm — layout chặn thêm đường vào bằng URL trực tiếp; lớp
 * chặn thật (403 TAX_PILOT_ONLY) nằm ở backend/src/tax-pilot.ts.
 */

import { useEffect, useState } from "react";

import { getStoredUser } from "@/lib/api";
import { isTaxPilotUser } from "@/lib/feature-flags";

export default function InvoicingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Đọc user từ localStorage SAU khi mount — tránh lệch SSR/client.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    setAllowed(isTaxPilotUser(getStoredUser()));
  }, []);

  if (allowed === null) return null;
  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <span
            className="material-symbols-rounded mb-3 inline-block text-4xl text-muted-foreground"
            aria-hidden
          >
            lock
          </span>
          <h1 className="mb-2 text-lg font-semibold">
            Tính năng đang thí điểm
          </h1>
          <p className="text-sm text-muted-foreground">
            Module Hóa đơn &amp; Thuế đang trong giai đoạn thử nghiệm nội bộ và
            chưa mở cho tài khoản của bạn. Hubsell sẽ thông báo khi tính năng
            sẵn sàng.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
