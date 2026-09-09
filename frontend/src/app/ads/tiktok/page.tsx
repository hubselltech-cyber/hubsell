"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { getStoredUser, getToken } from "@/lib/api";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { TEXT_SUB } from "@/lib/typography";

/**
 * Trợ lý quảng cáo — TikTok Shop.
 *
 * 09/09/2026: thay khung preview vẽ số giả (ads-assistant-page cũ, đã xóa)
 * bằng trang "sắp ra mắt" nói thật — nhất quán với landing (TikTok "Sắp ra
 * mắt"). Khi TikTok Marketing API được duyệt thì dựng trang thật theo khuôn
 * Shopee/Lazada (shopee-ads-page.tsx dùng chung lõi).
 */
export default function TiktokAdsPage() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!can(getStoredUser(), "ads.tiktok")) setDenied(true);
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
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Megaphone className="size-6" />
          </div>
          <p className="text-base font-semibold text-slate-900">
            Trợ lý quảng cáo TikTok Shop sắp ra mắt
          </p>
          <p className={cn(TEXT_SUB, "max-w-md")}>
            Hubsell đang chờ TikTok duyệt quyền truy cập dữ liệu quảng cáo. Khi
            mở, trang này sẽ có cùng bộ công cụ như Shopee và Lazada: chi phí và
            GMV theo ngày, ROAS hòa vốn từng sản phẩm, cảnh báo chiến dịch đang
            lỗ.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
