"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { FeatureLockedCard } from "@/components/shared/feature-locked-card";
import { AppShell } from "@/components/shell/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { PageHeaderBand, PageTabs, type PageTabItem } from "@/components/ui/page-tabs";
import { getToken } from "@/lib/api";
import { useFeature } from "@/lib/use-feature";

import { HoursBalanceBar } from "./hours-balance";
import { OrderVideoDossier } from "./order-video-dossier";
import { ReturnsTab } from "./returns-tab";
import { StatsTab } from "./stats-tab";
import { VideosTab } from "./videos-tab";

type TabKey = "videos" | "returns" | "stats";

const TABS: readonly PageTabItem<TabKey>[] = [
  { key: "videos", label: "Video đóng hàng" },
  { key: "returns", label: "Đơn hoàn" },
  { key: "stats", label: "Thống kê" },
];

/**
 * KHUNG CHUNG của hai trang video: kiểm đăng nhập + CỔNG TÍNH NĂNG (tầng 2).
 *
 * Tài khoản chưa được mở (lib/use-feature.ts — máy chủ quyết) chỉ thấy thẻ "chưa mở";
 * phần ruột KHÔNG được dựng nên không lượt gọi API video nào xảy ra. Lớp chặn thật vẫn
 * là 403 FEATURE_LOCKED ở backend.
 */
function PackVideoGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const open = useFeature("packVideo") === "open";

  React.useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  return (
    <AppShell>
      {open ? (
        children
      ) : (
        <FeatureLockedCard
          title="Video đóng hàng chưa mở"
          description="Tính năng đang được hoàn thiện và chưa mở cho tài khoản này. Đơn hàng vẫn xử lý bình thường ở trang Xử lý đơn hàng."
          action={
            <Link href="/orders" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Về Xử lý đơn hàng
            </Link>
          }
        />
      )}
    </AppShell>
  );
}

/**
 * TRANG VIDEO ĐÓNG HÀNG (/orders/videos) — docs/VIDEO-DONG-HANG-THIET-KE.md.
 *
 * Ba tab cấp trang: Video đóng hàng (một dòng = một video) · Đơn hoàn (một dòng = một đơn,
 * gồm cả video khui hàng) · Thống kê. Mỗi tab tự giữ bộ lọc của mình và chỉ được dựng khi
 * đang chọn — tab Đơn hoàn và Thống kê không gọi máy chủ cho tới lúc mở.
 */
export function PackVideosPage() {
  const [tab, setTab] = React.useState<TabKey>("videos");
  return (
    <PackVideoGate>
      <div className="space-y-5">
        <PageHeaderBand>
          <p className="text-sm text-muted-foreground">
            Video quay lúc đóng hàng trên app, tìm lại bằng mã vận đơn khi cần bằng chứng khiếu nại.
          </p>
          <PageTabs
            ariaLabel="Các phần của trang Video đóng hàng"
            className="mt-2 border-b-0"
            tabs={TABS}
            value={tab}
            onChange={setTab}
            // Giờ còn lại + nút mua hiện ở MỌI tab (anh Trung 16/11).
            trailing={<HoursBalanceBar />}
          />
        </PageHeaderBand>

        {tab === "videos" && <VideosTab />}
        {tab === "returns" && <ReturnsTab />}
        {tab === "stats" && <StatsTab />}
      </div>
    </PackVideoGate>
  );
}

/** TRANG HỒ SƠ VIDEO CỦA MỘT ĐƠN (/orders/videos/order/[orderId]). */
export function PackVideoOrderPage({ orderId }: { orderId: string }) {
  return (
    <PackVideoGate>
      <OrderVideoDossier orderId={orderId} />
    </PackVideoGate>
  );
}
