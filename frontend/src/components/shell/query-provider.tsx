"use client";

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
} from "@tanstack/react-query";

import { ApiError } from "@/lib/api";

/**
 * TẦNG CACHE DỮ LIỆU TOÀN APP (React Query) — Tầng 1 kế hoạch UI đẳng cấp.
 *
 * Triết lý: quay lại trang cũ thì hiện NGAY số liệu trong cache rồi âm thầm
 * refetch phía sau — cùng tinh thần "mờ số cũ" của components/refreshing.tsx,
 * KHÔNG skeleton. Vì vậy:
 *
 * - `placeholderData: keepPreviousData` đặt MẶC ĐỊNH toàn cục: đổi bộ lọc
 *   (queryKey đổi) vẫn giữ số cũ trên màn hình trong lúc tải số mới — các trang
 *   chỉ cần đưa `refreshing` vào <Refreshing active> là có đúng hành vi cũ.
 * - `staleTime` 30s: đảo qua đảo lại giữa các trang trong nửa phút không bắn
 *   lại request; quá 30s thì hiện cache trước, refetch ngầm sau.
 * - `gcTime` 30 phút: cache sống đủ một phiên làm việc, không phình bộ nhớ.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * 60_000,
        placeholderData: keepPreviousData,
        // 4xx là lỗi "có chủ đích" của backend (401 hết phiên, 403 không quyền,
        // 409 chưa có kênh…) — retry chỉ tổ trễ thêm; lỗi mạng thì thử lại 1 lần.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 1;
        },
        // Các trang đều có nút "Làm mới" / polling riêng khi cần số nóng —
        // tự refetch lúc đổi cửa sổ dễ gây nhảy số bất ngờ giữa lúc đang đọc.
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState để client chỉ tạo MỘT lần cho cả vòng đời tab (React 19 có thể
  // re-render provider — tạo lại client là mất sạch cache).
  const [client] = React.useState(makeQueryClient);
  // Cửa soi cache khi dev (window.__hubsellQueryClient trong console) — không
  // đổi behavior production; đặt trong effect vì ghi lúc render vi phạm
  // react-hooks/immutability.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__hubsellQueryClient =
        client;
    }
  }, [client]);
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
