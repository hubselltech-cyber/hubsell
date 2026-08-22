"use client";

// ============================================================
// DẢI CẢNH BÁO GIAN MẤT KẾT NỐI — dính dưới header trên MỌI trang.
//
// Vì sao cần thêm khi đã có chuông (anh Trung 22/08): thông báo chuông là
// DÒNG CHẢY — có nhiều sự kiện là tin quan trọng bị trôi. Dải này bám theo
// TRẠNG THÁI (còn gian DISCONNECTED là còn hiện, nối lại xong tự biến mất)
// nên không bao giờ trôi; đổi lại phải thật mỏng để không gây khó chịu.
//
// Chủ đích thiết kế:
// - Chỉ CHỦ SHOP thấy (nhân viên không vào được trang Kênh bán để nối lại).
// - Ẩn trên chính trang /channels — khách đã ở đúng nơi cần đến rồi.
// - Không có nút đóng: gian mất kết nối = đơn/tồn kho đang KHÔNG đồng bộ,
//   cho tắt là khách quên luôn; "đỡ khó chịu" giải bằng mỏng + không sticky.
// - Dùng chung query key qk.channels() với cache React Query toàn app.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PlugZap, TriangleAlert } from "lucide-react";

import { fetchChannels } from "@/lib/api";
import { qk } from "@/lib/query-keys";

// Nhãn sàn ngắn cho câu cảnh báo — không import từ operations/mock-data
// (module mock của Trợ lý vận hành, kéo vào shell toàn cục là sai tầng).
const CHANNEL_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
};

export function ChannelDisconnectedBanner() {
  const pathname = usePathname();

  // useQuery trần thay vì useApiQuery: banner là khối BỊ ĐỘNG — lỗi mạng hay
  // 403 thì lặng lẽ không hiện, không được kéo cả trang sang màn AccessDenied.
  const { data } = useQuery({
    queryKey: qk.channels(),
    queryFn: fetchChannels,
    // Cron token-refresh phía backend đánh dấu DISCONNECTED theo nhịp 30' —
    // poll 5' là đủ tươi; refetch-on-focus mặc định lo phần quay lại tab.
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  // Đang ở trang Kênh bán thì thôi — trạng thái từng gian đã bày ngay đó.
  if (pathname.startsWith("/channels")) return null;

  // Cùng bộ lọc với detector channel-disconnected (ops-alerts.ts): chỉ gian
  // nối API THẬT (apiConnected = có refreshToken) — gian giả lập/thủ công
  // DISCONNECTED là chuyện thường, không đáng chiếm một dải cảnh báo.
  const down = (data ?? []).filter(
    (c) =>
      c.status === "DISCONNECTED" &&
      c.apiConnected &&
      c.channelName !== "OFFLINE"
  );
  if (down.length === 0) return null;

  const first = down[0];
  const firstLabel = `"${first.shopName}" (${
    CHANNEL_LABEL[first.channelName] ?? first.channelName
  })`;
  const lead =
    down.length === 1
      ? `Gian ${firstLabel} đã mất kết nối`
      : `${down.length} gian hàng đã mất kết nối (${down
          .map((c) => c.shopName)
          .join(", ")})`;

  return (
    <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 md:px-6">
      <TriangleAlert className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{lead}</span>
        <span className="hidden sm:inline">
          {" "}
          — đơn mới và tồn kho đang không được đồng bộ.
        </span>
      </p>
      <Link
        href="/channels"
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-card px-2.5 py-1 font-medium transition-colors hover:bg-red-100"
      >
        <PlugZap className="size-3.5" />
        Kết nối lại
      </Link>
    </div>
  );
}
