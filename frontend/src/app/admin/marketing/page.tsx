"use client";

// ============================================================
// MARKETING & GIỚI THIỆU (/admin/marketing — lá hq.marketing): hiệu quả
// chương trình "Kiếm Tiền Cùng Hubsell" toàn hệ thống — khu làm việc của
// nhân viên marketing/tiếp thị.
// ============================================================

import { useCallback } from "react";

import { AppShell } from "@/components/app-shell";
import { AccessDenied } from "@/components/access-denied";
import { fetchPlatformMarketing } from "@/lib/api";
import { MarketingTab } from "../marketing-tab";
import { AdminError, AdminPageHeader, useAdminPage } from "../shared";

export default function PlatformMarketingPage() {
  const fetcher = useCallback(() => fetchPlatformMarketing(), []);
  const { data, loading, denied, error, reload } = useAdminPage(fetcher);

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
        <AdminPageHeader
          description="Hiệu quả kênh tăng trưởng của Hubsell: đăng ký qua chương trình giới thiệu và những người giới thiệu tích cực nhất."
          loading={loading}
          onReload={reload}
        />
        {error && <AdminError message={error} />}
        <MarketingTab data={data} loading={loading} />
      </div>
    </AppShell>
  );
}
