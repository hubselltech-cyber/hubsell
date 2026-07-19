"use client";

import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { CHANNEL_META } from "@/lib/channel-meta";
import { fetchChannels, type Channel, type ChannelName } from "@/lib/api";

const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK", "OFFLINE"];

/**
 * Bộ chọn GIAN HÀNG dùng chung cho mọi trang báo cáo.
 *
 * Danh sách gom theo sàn (optgroup) rồi mới tới từng gian, vì một sàn có thể có
 * nhiều gian: nếu chỉ hiện tên sàn thì hai gian Shopee sẽ là hai dòng "Shopee"
 * y hệt nhau, chủ shop không biết đang chọn gian nào.
 *
 * Giá trị trả về là channelId (chuỗi rỗng = tất cả gian hàng).
 */
export function ShopFilter({
  value,
  onChange,
  className = "w-56",
}: {
  value: string;
  onChange: (channelId: string) => void;
  className?: string;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    // Bộ lọc hỏng thì trang vẫn phải xem được toàn bộ số liệu, nên nuốt lỗi ở
    // đây thay vì bắn toast — người dùng chỉ mất khả năng lọc, không mất báo cáo.
    fetchChannels()
      .then(setChannels)
      .catch(() => setChannels([]));
  }, []);

  const groups = PLATFORM_ORDER.map((platform) => ({
    platform,
    shops: channels.filter((c) => c.channelName === platform),
  })).filter((g) => g.shops.length > 0);

  return (
    <NativeSelect
      className={className}
      aria-label="Lọc theo gian hàng"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Tất cả gian hàng</option>
      {groups.map((g) => (
        <optgroup key={g.platform} label={CHANNEL_META[g.platform].label}>
          {g.shops.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shopName}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

/**
 * Gian hàng có mang tên riêng hay chỉ đang lấy tên sàn làm tên mặc định?
 * So sánh bỏ qua hoa thường vì tên mặc định sinh ra ở nhiều thời điểm khác nhau
 * ("Tiktok" và "TikTok" là một) — nếu so khớp cứng sẽ hiện thành "TikTok · Tiktok".
 */
function hasOwnName(channelName: ChannelName, shopName: string): boolean {
  return (
    shopName.trim().toLowerCase() !==
    CHANNEL_META[channelName].label.toLowerCase()
  );
}

/** Nhãn đầy đủ của một gian hàng: "Shopee · Shop Phụ Kiện B" */
export function shopLabel(channelName: ChannelName, shopName: string): string {
  const platform = CHANNEL_META[channelName].label;
  return hasOwnName(channelName, shopName)
    ? `${platform} · ${shopName}`
    : platform;
}

/**
 * Tên gian hàng để hiện KÈM huy hiệu sàn (huy hiệu đã nói lên sàn rồi).
 * Trả về null khi gian chưa có tên riêng — lúc đó huy hiệu là đủ, thêm chữ chỉ thừa.
 */
export function shopOnlyName(
  channelName: ChannelName,
  shopName: string
): string | null {
  return hasOwnName(channelName, shopName) ? shopName : null;
}
