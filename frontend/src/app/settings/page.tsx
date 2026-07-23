"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { InvoiceConfigSection } from "@/components/settings/invoice-config-section";
import { getStoredUser, getToken } from "@/lib/api";
import { canManageShop } from "@/lib/permissions";

/**
 * CẤU HÌNH HỆ THỐNG
 *
 * Hiện gồm module "Hóa đơn điện tử & Chữ ký số" (Multi-Vendor Adapter) — đóng gói
 * độc lập trong <InvoiceConfigSection />. Các module khác sẽ thêm vào trang này.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Cấu hình hệ thống chỉ dành cho Chủ shop
    if (!canManageShop(getStoredUser()?.role)) {
      setDenied(true);
    }
  }, [router]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <p className="text-muted-foreground">
          Thiết lập chung của hệ thống. Kết nối nhà cung cấp Hóa đơn điện tử, Đối
          soát Thuế và Chữ ký số (đang chuẩn bị tích hợp API thương mại).
        </p>

        <InvoiceConfigSection />

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Cấu hình hệ thống — Hóa đơn, Thuế &amp; Chữ ký số (Multi-Vendor)
        </p>
      </div>
    </AppShell>
  );
}
