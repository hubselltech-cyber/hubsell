"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { getStoredUser, getToken } from "@/lib/api";
import { canAccessOperations } from "@/lib/permissions";

/**
 * KHUNG CHUNG CỦA MODULE TRỢ LÝ VẬN HÀNH (/operations-assistant/*)
 *
 * Ba trang con (Chat / Phản hồi đánh giá / Kịch bản AI) dùng chung một khung:
 * chốt đăng nhập + phân quyền (ADMIN, SALES) và banner "đang phát triển".
 * Gom về đây để thêm trang con mới chỉ việc bọc <OperationsFrame> là xong,
 * không lặp lại đoạn gate ở từng trang.
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
      <div className="space-y-5 pb-10">
        {/* ===== BANNER TRẠNG THÁI: TÍNH NĂNG ĐANG PHÁT TRIỂN ===== */}
        {/* Cùng khuôn banner tím của Trợ lý quảng cáo — người dùng nhìn là
            hiểu ngay đây là bản preview, số liệu chưa thật. */}
        <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3.5 text-sm text-violet-800">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-violet-600" />
          <div>
            <p className="font-semibold">
              Tính năng Trợ lý vận hành đang được phát triển.
            </p>
            <p className="mt-0.5 text-violet-700">
              Dữ liệu dưới đây là bản xem trước (Preview) — khung giao diện
              chuẩn bị cho tích hợp API đánh giá &amp; tin nhắn của Shopee,
              TikTok Shop và Lazada, chưa phản ánh dữ liệu thật.
            </p>
          </div>
        </div>

        {children}
      </div>
    </AppShell>
  );
}
