"use client";

/**
 * useApiQuery — useQuery + quy ước lỗi chung của app.
 *
 * Mọi trang trước nay đều lặp đúng một khối catch: 401 → về /login, 403 → màn
 * AccessDenied, 409 NO_CHANNEL → im lặng (OnboardingOverlay của AppShell lo),
 * còn lại → thông báo "chưa kết nối được máy chủ". Hook này gói quy ước đó lại
 * để mỗi trang chỉ còn khai báo queryKey + queryFn.
 *
 * Trả về theo đúng ngữ nghĩa các trang đang dùng:
 * - `loading`    : tải LẦN ĐẦU, chưa có gì trong cache để hiện.
 * - `refreshing` : đang tính lại (đổi bộ lọc / refetch nền) — đưa thẳng vào
 *                  <Refreshing active>; số cũ vẫn trên màn nhờ keepPreviousData.
 * - `denied`     : 403 — trang render <AccessDenied />.
 * - `error`      : thông điệp lỗi còn lại (chuỗi tiếng Việt từ backend nếu có).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { ApiError } from "./api";

export const SERVER_DOWN_MESSAGE =
  "Chưa kết nối được máy chủ (backend). Hãy chắc chắn backend đang chạy ở cổng 4000.";

export function useApiQuery<T>(options: {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  /** false = chưa đủ điều kiện gọi (vd đang chờ biết quyền). Mặc định true. */
  enabled?: boolean;
  /** Poll định kỳ (ms) cho số cần nóng — vd trang đơn hoàn tự refresh 30s. */
  refetchInterval?: number;
  /** Ghi đè staleTime mặc định 30s khi trang cần số "tươi" hơn/lâu hơn. */
  staleTime?: number;
}) {
  const router = useRouter();
  // Chỉ truyền option khi CÓ giá trị — spread key undefined vào useQuery sẽ
  // đè mất default của QueryClient (staleTime 30s thành 0 → mount nào cũng
  // refetch, prefetch hover thành công cốc).
  const query = useQuery({
    queryKey: options.queryKey,
    queryFn: options.queryFn,
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
    ...(options.refetchInterval !== undefined
      ? { refetchInterval: options.refetchInterval }
      : {}),
    ...(options.staleTime !== undefined
      ? { staleTime: options.staleTime }
      : {}),
  });

  const err = query.error;
  const unauthorized = err instanceof ApiError && err.status === 401;
  const denied = err instanceof ApiError && err.status === 403;
  const noChannel = err instanceof ApiError && err.status === 409;

  React.useEffect(() => {
    if (unauthorized) router.replace("/login");
  }, [unauthorized, router]);

  return {
    data: query.data,
    loading: query.isPending && options.enabled !== false,
    refreshing: query.isFetching,
    /**
     * Đang hiện SỐ CŨ của bộ lọc trước trong lúc tải bộ lọc mới
     * (keepPreviousData). Trang có polling nền dùng `loading || placeholder`
     * thay cho `refreshing` để nhịp poll chạy IM LẶNG không làm mờ bảng.
     */
    placeholder: query.isPlaceholderData,
    denied,
    error:
      err && !unauthorized && !denied && !noChannel
        ? err instanceof ApiError
          ? err.message
          : SERVER_DOWN_MESSAGE
        : null,
    refetch: query.refetch,
  };
}

/**
 * Làm tươi mọi query của MỘT nhóm key sau khi ghi dữ liệu (tạo/sửa/xóa) —
 * gọi `invalidate(qk.products({...}))` là mọi biến thể bộ lọc của trang đó
 * cùng được đánh dấu cũ và refetch khi đang hiển thị.
 */
export function useInvalidate() {
  const qc = useQueryClient();
  return React.useCallback(
    (...keys: QueryKey[]) =>
      Promise.all(
        keys.map((key) =>
          // Chỉ so tiền tố (mặc định của invalidateQueries) — truyền key đầy đủ
          // hay chỉ phần tử đầu đều được.
          qc.invalidateQueries({ queryKey: key })
        )
      ),
    [qc]
  );
}
