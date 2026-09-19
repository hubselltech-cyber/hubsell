"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import { getStoredUser, getToken } from "@/lib/api";
import { canManageShop } from "@/lib/permissions";

/**
 * Vỏ chung cho các trang con của Cấu hình: chặn đăng nhập + chỉ Chủ shop, rồi
 * bọc AppShell. Gom về đây để 3 trang con (Chung / Hóa đơn & Thuế / Khác) không
 * lặp lại đoạn guard giống hệt nhau.
 */
export function SettingsShell({
  title,
  description,
  tabs,
  children,
}: {
  /** Cho phép ReactNode để trang con gắn thêm icon/tooltip cạnh tiêu đề. */
  title: React.ReactNode;
  description?: string;
  /**
   * Hàng <PageTabs className="border-b-0" /> của trang — nằm cuối dải trắng đầu
   * trang, dùng chung đường kẻ đáy của dải. Không có tab thì dải tự đệm đáy.
   */
  tabs?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!canManageShop(getStoredUser())) {
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
        <PageHeaderBand className={tabs ? undefined : "pb-4"}>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
          {tabs && <div className="mt-2">{tabs}</div>}
        </PageHeaderBand>
        {children}
      </div>
    </AppShell>
  );
}
