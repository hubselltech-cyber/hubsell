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
// - Nút "Không hiển thị lại" tắt theo TỪNG GIAN (anh Trung 22/08: có shop bỏ
//   sàn thật, không định nối lại — cảnh báo mãi thành rác). Lưu localStorage;
//   gian KHÁC mất kết nối sau đó vẫn hiện, và gian đã tắt mà nối lại rồi đứt
//   LẦN NỮA là sự kiện mới → tự hiện lại (danh sách tắt được tỉa khi gian
//   không còn DISCONNECTED).
// - Dùng chung query key qk.channels() với cache React Query toàn app.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PlugZap, TriangleAlert, X } from "lucide-react";

import { fetchChannels } from "@/lib/api";
import { qk } from "@/lib/query-keys";

// Nhãn sàn ngắn cho câu cảnh báo — không import từ operations/mock-data
// (module mock của Trợ lý vận hành, kéo vào shell toàn cục là sai tầng).
const CHANNEL_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
};

// Danh sách id gian đã bấm "Không hiển thị lại" — theo trình duyệt (đủ dùng:
// tắt là lựa chọn cá nhân của người đang ngồi máy, không phải cấu hình shop).
const DISMISS_KEY = "hubsell_channel_banner_dismissed";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function ChannelDisconnectedBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

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

  // Cùng bộ lọc với detector channel-disconnected (ops-alerts.ts): chỉ gian
  // nối API THẬT (apiConnected = có refreshToken) — gian giả lập/thủ công
  // DISCONNECTED là chuyện thường, không đáng chiếm một dải cảnh báo.
  const allDown = (data ?? []).filter(
    (c) =>
      c.status === "DISCONNECTED" &&
      c.apiConnected &&
      c.channelName !== "OFFLINE"
  );

  // TỈA danh sách tắt: gian không còn trong nhóm mất kết nối (đã nối lại /
  // đã xoá) thì gỡ khỏi dismissed — lần đứt SAU của chính gian đó là sự kiện
  // mới, phải hiện lại. Chỉ tỉa khi ĐÃ có data (đang loading mà tỉa là xoá
  // nhầm sạch danh sách vì allDown rỗng).
  useEffect(() => {
    if (!data) return;
    const downIds = new Set(allDown.map((c) => c.id));
    setDismissed((prev) => {
      const next = prev.filter((id) => downIds.has(id));
      if (next.length === prev.length) return prev;
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
      return next;
    });
    // allDown suy ra từ data — chỉ cần data làm dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Đang ở trang Kênh bán thì thôi — trạng thái từng gian đã bày ngay đó.
  if (pathname.startsWith("/channels")) return null;

  const down = allDown.filter((c) => !dismissed.includes(c.id));
  if (down.length === 0) return null;

  // "Không hiển thị lại": ghi nhớ đúng các gian ĐANG hiện trên dải — gian khác
  // đứt kết nối sau này không bị vạ lây.
  function dismissCurrent() {
    setDismissed((prev) => {
      const next = [...new Set([...prev, ...down.map((c) => c.id)])];
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
      return next;
    });
  }

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
      {/* Tắt hẳn cho các gian đang hiện — shop bỏ sàn thật thì đừng nhắc mãi.
          Icon X trần (không viền) để nút hành động chính bên cạnh vẫn nổi hơn. */}
      <button
        type="button"
        onClick={dismissCurrent}
        title="Không hiển thị lại cảnh báo cho gian này"
        aria-label="Không hiển thị lại cảnh báo cho gian này"
        className="shrink-0 rounded-md p-1 text-red-800/70 transition-colors hover:bg-red-100 hover:text-red-800"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
