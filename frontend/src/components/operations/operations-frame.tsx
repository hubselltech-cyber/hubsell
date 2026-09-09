"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { getStoredUser, getToken } from "@/lib/api";
import { canAccessOperations } from "@/lib/permissions";

/**
 * KHUNG CHUNG CỦA MODULE TRỢ LÝ VẬN HÀNH (/operations-assistant/*)
 *
 * Ba trang con (Chat / Phản hồi đánh giá / Cấu hình tự động hóa) dùng chung
 * một khung: chốt đăng nhập + phân quyền (ADMIN, SALES). Gom về đây để thêm
 * trang con mới chỉ việc bọc <OperationsFrame> là xong.
 *
 * 09/09/2026: bỏ banner "đang phát triển / Preview" — chat Shopee, đánh giá
 * Shopee/Lazada đều là dữ liệu thật; gian chưa có dữ liệu hiện empty state
 * chứ không đổ mock nữa (chuẩn bị nộp ISV, production không còn chữ "demo").
 */
export function OperationsFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!canAccessOperations(getStoredUser())) setDenied(true);
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
