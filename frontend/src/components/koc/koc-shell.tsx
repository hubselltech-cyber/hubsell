"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { getStoredUser, getToken } from "@/lib/api";
import { canAccessKocMarketing } from "@/lib/permissions";

/**
 * VỎ CHUNG CỦA 5 TRANG /koc-marketing/*
 *
 * Gom 2 việc lặp lại để từng trang chỉ còn lo nội dung:
 *   1. Guard đăng nhập + quyền "koc" (ADMIN mặc định qua; nhân viên cần được
 *      tick lá "Mạng lưới KOC & Marketing" — lớp chặn thật ở backend).
 *   2. AppShell (sidebar + header).
 * Banner tím "Preview" cũ đã GỠ theo yêu cầu chủ shop 30/08 — Sổ KOC chạy số
 * thật rồi, banner vừa sai vừa chiếm chỗ.
 */
export function KocShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!canAccessKocMarketing(getStoredUser())) setDenied(true);
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
      <div className="space-y-5 pb-10">{children}</div>
    </AppShell>
  );
}
