"use client";

// ============================================================
// KẾ TOÁN NỘI BỘ (/admin/finance — lá hq.finance): khu làm việc của KẾ TOÁN
// công ty Hubsell, hai khối:
//  1. SỔ QUỸ (GĐ5)      — tiền vào/ra theo tháng + nghĩa vụ hóa đơn + xuất Excel
//  2. VÍ & LỆNH RÚT (GĐ3) — tổng quan Ví Hubsell + duyệt/từ chối lệnh rút
// Duyệt lệnh rút TỰ ghi bút toán CHI vào sổ quỹ — kế toán không nhập tay lại.
// ============================================================

import { useCallback, useState } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { AccessDenied } from "@/components/shared/access-denied";
import { Separator } from "@/components/ui/separator";
import {
  fetchPlatformFinance,
  fetchPlatformLedger,
  type PlatformFinanceResponse,
  type PlatformLedgerResponse,
} from "@/lib/api";
import { FinanceTab } from "../finance-tab";
import { LedgerSection } from "../ledger-section";
import { AdminError, AdminPageHeader, useAdminPage } from "../shared";

interface FinanceData {
  finance: PlatformFinanceResponse;
  ledger: PlatformLedgerResponse;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function PlatformFinancePage() {
  const [month, setMonth] = useState(currentMonth);

  const fetcher = useCallback(async (): Promise<FinanceData> => {
    const [finance, ledger] = await Promise.all([
      fetchPlatformFinance(),
      fetchPlatformLedger(month),
    ]);
    return { finance, ledger };
  }, [month]);
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
          description="Kế toán nội bộ Hubsell: sổ quỹ thu/chi của công ty, nghĩa vụ hóa đơn và duyệt chi trả hoa hồng giới thiệu."
          loading={loading}
          onReload={reload}
        />

        {error && <AdminError message={error} />}

        {/* ===== Khối 1: Sổ quỹ theo tháng ===== */}
        <LedgerSection
          data={data?.ledger ?? null}
          loading={loading}
          month={month}
          onMonthChange={(m) => {
            if (m) setMonth(m);
          }}
          onChanged={reload}
        />

        <Separator />

        {/* ===== Khối 2: Ví Hubsell & lệnh rút hoa hồng ===== */}
        <div>
          <p className="text-sm font-semibold">Ví Hubsell & lệnh rút hoa hồng</p>
          <p className="mb-4 text-xs text-muted-foreground">
            Duyệt = xác nhận ĐÃ chuyển khoản (bút toán CHI tự ghi vào sổ quỹ);
            từ chối = hoàn tiền vào ví người dùng.
          </p>
          <FinanceTab
            data={data?.finance ?? null}
            loading={loading}
            onChanged={reload}
          />
        </div>
      </div>
    </AppShell>
  );
}
