"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
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
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
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
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </div>
    </AppShell>
  );
}
