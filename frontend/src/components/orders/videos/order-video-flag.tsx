"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Video } from "lucide-react";

import { fetchPackVideoOrderFlags } from "@/lib/api";
import { packVideoOrderPath } from "@/lib/pack-video";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useFeature } from "@/lib/use-feature";
import { cn } from "@/lib/utils";

/**
 * DẤU "ĐƠN NÀY CÓ VIDEO" trên các bảng đơn có sẵn (Đơn hàng, Đối soát đơn hoàn).
 *
 * Cách chạy: trang bọc bảng bằng <OrderVideoFlagsProvider orderIds={id các đơn của trang}>;
 * provider gọi máy chủ MỘT lần cho cả trang rồi từng ô chỉ đọc kết quả qua <OrderVideoFlag>.
 *
 * - Cổng "Video đóng hàng" chưa mở với tài khoản này → KHÔNG gọi gì, không vẽ gì: hai trang
 *   đó chạy y như trước khi có tính năng.
 * - Khóa cache = đúng danh sách id của trang: lượt tự làm mới của bảng (id không đổi) không
 *   gọi lại; đổi trang / đổi bộ lọc mới gọi.
 * - Lỗi (mạng, 403) → im lặng coi như chưa đơn nào có video; dấu này là tiện ích, không được
 *   làm hỏng trang đơn.
 */
const FlagsContext = React.createContext<ReadonlySet<string>>(new Set());

export function OrderVideoFlagsProvider({
  orderIds,
  children,
}: {
  orderIds: string[];
  children: React.ReactNode;
}) {
  const open = useFeature("packVideo") === "open";
  // Xếp lại để cùng một tập đơn luôn ra cùng một khóa, bất kể thứ tự dòng.
  const key = React.useMemo(() => [...orderIds].sort(), [orderIds]);
  const { data } = useQuery({
    queryKey: qk.packVideoOrderFlags(key),
    queryFn: () => fetchPackVideoOrderFlags(key),
    enabled: open && key.length > 0,
    staleTime: 60_000,
    retry: false,
    // Không giữ kết quả của trang trước: cờ phải khớp đúng các đơn đang hiện.
    placeholderData: undefined,
  });
  const set = React.useMemo<ReadonlySet<string>>(
    () => new Set(open ? (data?.withVideo ?? []) : []),
    [open, data]
  );
  return <FlagsContext.Provider value={set}>{children}</FlagsContext.Provider>;
}

/** Biểu tượng nhỏ trỏ sang hồ sơ video của đơn; đơn không có video thì không vẽ gì. */
export function OrderVideoFlag({
  orderId,
  variant = "line",
}: {
  orderId: string;
  /** "line" = một dòng phụ có chữ (ô Trạng thái của bảng Đơn hàng); "icon" = chỉ biểu tượng. */
  variant?: "line" | "icon";
}) {
  const withVideo = React.useContext(FlagsContext);
  if (!withVideo.has(orderId)) return null;
  const title = "Đơn này có video đóng hàng — bấm để mở hồ sơ video";
  if (variant === "icon") {
    return (
      <Link
        href={packVideoOrderPath(orderId)}
        title={title}
        aria-label={title}
        className="flex size-5 shrink-0 items-center justify-center rounded text-sky-700 transition-colors hover:bg-muted"
      >
        <Video className="size-3.5" />
      </Link>
    );
  }
  return (
    <Link
      href={packVideoOrderPath(orderId)}
      title={title}
      className={cn(
        TEXT_SUB,
        "mt-1 flex items-center justify-center gap-1 text-sky-700 underline-offset-2 hover:underline"
      )}
    >
      <Video className="size-3 shrink-0" />
      Có video
    </Link>
  );
}
