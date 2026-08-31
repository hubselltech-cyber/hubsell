"use client";

// ============================================================
// KẾ TOÁN NỘI BỘ (/admin/finance — lá hq.finance): khu làm việc của KẾ TOÁN
// công ty Hubsell, ba tab:
//  1. SỔ QUỸ (GĐ5)      — tiền vào/ra theo tháng + nghĩa vụ hóa đơn + xuất Excel
//  2. VÍ & LỆNH RÚT (GĐ3) — tổng quan Ví Hubsell + duyệt/từ chối lệnh rút
//  3. LỊCH THUẾ          — lịch khai/nộp thuế + báo cáo 2026–2027 (dữ liệu tĩnh)
// Duyệt lệnh rút TỰ ghi bút toán CHI vào sổ quỹ — kế toán không nhập tay lại.
// ============================================================

import { useCallback, useState } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { AccessDenied } from "@/components/shared/access-denied";
import {
  fetchPlatformFinance,
  fetchPlatformLedger,
  type PlatformFinanceResponse,
  type PlatformLedgerResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { FinanceTab } from "../finance-tab";
import { LedgerSection } from "../ledger-section";
import { TaxCalendarSection } from "../tax-calendar-section";
import { AdminError, AdminPageHeader, useAdminPage } from "../shared";

interface FinanceData {
  finance: PlatformFinanceResponse;
  ledger: PlatformLedgerResponse;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type Tab = "ledger" | "wallet" | "taxcal";

export default function PlatformFinancePage() {
  const [tab, setTab] = useState<Tab>("ledger");
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
          description="Kế toán nội bộ Hubsell: sổ quỹ thu/chi của công ty, duyệt chi trả hoa hồng giới thiệu và lịch thủ tục thuế 2026–2027."
          loading={loading}
          onReload={reload}
        />

        {error && <AdminError message={error} />}

        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
          {(
            [
              ["ledger", "Sổ quỹ"],
              ["wallet", "Ví & lệnh rút"],
              ["taxcal", "Lịch thuế 2026–2027"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "ledger" && (
          <LedgerSection
            data={data?.ledger ?? null}
            loading={loading}
            month={month}
            onMonthChange={(m) => {
              if (m) setMonth(m);
            }}
            onChanged={reload}
          />
        )}

        {tab === "wallet" && (
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
        )}

        {tab === "taxcal" && <TaxCalendarSection />}
      </div>
    </AppShell>
  );
}
