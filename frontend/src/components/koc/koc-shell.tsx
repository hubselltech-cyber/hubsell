"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { getStoredUser, getToken } from "@/lib/api";
import { canAccessKocMarketing } from "@/lib/permissions";

/**
 * VỎ CHUNG CỦA 5 TRANG /koc-marketing/*
 *
 * Gom 3 việc lặp lại để từng trang chỉ còn lo nội dung:
 *   1. Guard đăng nhập + quyền "koc" (ADMIN mặc định qua; nhân viên cần được
 *      tick lá "Mạng lưới KOC & Marketing" — lớp chặn thật ở backend).
 *   2. Banner trạng thái module (Sổ KOC đã lên số thật 30/08 — hoa hồng từ
 *      đối soát, danh tính KOC theo đơn từ file Báo cáo chuyển đổi TTLK).
 *   3. AppShell (sidebar + header).
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
      <div className="space-y-5 pb-10">
        <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3.5 text-sm text-violet-800">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-violet-600" />
          <div>
            <p className="font-semibold">
              Mạng lưới KOC &amp; Affiliate — số liệu cấp sàn là THẬT, hồ sơ
              từng KOC đang là Preview.
            </p>
            <p className="mt-0.5 text-violet-700">
              GMV/hoa hồng affiliate đọc từ đối soát thật của gian hàng đã
              liên kết (Shopee AMS, Lazada tiếp thị liên kết — không cần uỷ
              quyền thêm). Danh tính từng KOC chờ TikTok Affiliate API có shop
              thật uỷ quyền mới bật được.
            </p>
          </div>
        </div>
        {children}
      </div>
    </AppShell>
  );
}
