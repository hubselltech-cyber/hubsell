"use client";

// ============================================================
// MARKETING & GIỚI THIỆU (/admin/marketing — lá hq.marketing): hiệu quả
// chương trình "Kiếm Tiền Cùng Hubsell" toàn hệ thống — khu làm việc của
// nhân viên marketing/tiếp thị. Hai tab (07/11/2026):
//  1. TỔNG QUAN            — đăng ký qua giới thiệu + top người giới thiệu
//  2. CỘNG TÁC VIÊN ĐẶC BIỆT — chọn tài khoản đã đăng ký, đặt % hoa hồng riêng
//     và thời gian áp dụng (anh Trung: "mình chỉ thêm tab cho cộng tác viên
//     đặc biệt để nâng hoặc hạ mức hoa hồng và thời gian thôi").
// ============================================================

import { useCallback, useState } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeaderBand, PageTabs } from "@/components/ui/page-tabs";
import {
  fetchPlatformMarketing,
  fetchReferralPartners,
  type PlatformMarketingResponse,
  type ReferralPartnersResponse,
} from "@/lib/api";
import { MarketingTab } from "@/components/admin/marketing-tab";
import { ReferralPartnersTab } from "@/components/admin/referral-partners-tab";
import { AdminError, AdminPageHeader, useAdminPage } from "@/components/admin/shared";

type Tab = "overview" | "partners";

interface MarketingData {
  overview: PlatformMarketingResponse;
  partners: ReferralPartnersResponse;
}

export default function PlatformMarketingPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const fetcher = useCallback(async (): Promise<MarketingData> => {
    const [overview, partners] = await Promise.all([
      fetchPlatformMarketing(),
      fetchReferralPartners(),
    ]);
    return { overview, partners };
  }, []);
  const { data, loading, denied, error, reload } = useAdminPage(fetcher);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const activePartners =
    data?.partners.partners.filter((p) => p.status === "active").length ?? 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeaderBand>
          <AdminPageHeader
            description="Hiệu quả kênh tăng trưởng của Hubsell: đăng ký qua chương trình giới thiệu, người giới thiệu tích cực nhất và cộng tác viên có mức hoa hồng riêng."
            loading={loading}
            onReload={reload}
          />
          <PageTabs
            ariaLabel="Khu vực marketing"
            className="mt-2 border-b-0"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: "overview", label: "Tổng quan" },
              {
                key: "partners",
                label: "Cộng tác viên đặc biệt",
                count: activePartners,
                countTitle: "Đang áp dụng mức hoa hồng riêng",
              },
            ]}
          />
        </PageHeaderBand>

        {error && <AdminError message={error} />}

        {tab === "overview" && (
          <MarketingTab data={data?.overview ?? null} loading={loading} />
        )}
        {tab === "partners" && (
          <ReferralPartnersTab
            data={data?.partners ?? null}
            loading={loading}
            onChanged={reload}
          />
        )}
      </div>
    </AppShell>
  );
}
