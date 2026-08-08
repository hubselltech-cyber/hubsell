"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { getStoredUser, getToken } from "@/lib/api";
import { canAccessKocMarketing } from "@/lib/permissions";

/**
 * VỎ CHUNG CỦA 5 TRANG /koc-marketing/*
 *
 * Gom 3 việc lặp lại để từng trang chỉ còn lo nội dung:
 *   1. Guard đăng nhập + quyền (chỉ ADMIN — chi phí booking/ROI là dữ liệu
 *      tài chính, cùng luật với nhóm Quản lý Tài chính).
 *   2. Banner trạng thái PREVIEW — toàn module đang là mock, chờ nối
 *      Affiliate API từng sàn (cùng khuôn với Trợ lý quảng cáo /ads/*).
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
    if (!canAccessKocMarketing(getStoredUser()?.role)) setDenied(true);
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
              Mạng lưới KOC &amp; Affiliate đang được phát triển.
            </p>
            <p className="mt-0.5 text-violet-700">
              Dữ liệu dưới đây là bản xem trước (Preview) — khung giao diện
              chuẩn bị cho tích hợp Affiliate API của TikTok Shop, Shopee và
              Lazada, chưa phản ánh số liệu thật.
            </p>
          </div>
        </div>
        {children}
      </div>
    </AppShell>
  );
}
