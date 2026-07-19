"use client";

import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { CHANNEL_META } from "@/lib/channel-meta";
import { fetchChannels, type Channel, type ChannelName } from "@/lib/api";

const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK", "OFFLINE"];

/**
 * Giá trị của bộ lọc phân tầng. Hai ô rỗng dần theo mức độ cụ thể:
 *   { channelName: "", channelId: "" }          → tất cả sàn
 *   { channelName: "SHOPEE", channelId: "" }    → mọi gian trên Shopee
 *   { channelName: "SHOPEE", channelId: "abc" } → đúng gian "abc"
 */
export interface ChannelFilterValue {
  channelName: ChannelName | "";
  channelId: string;
}

export const ALL_CHANNELS: ChannelFilterValue = { channelName: "", channelId: "" };

/**
 * BỘ LỌC GIAN HÀNG PHÂN TẦNG — dùng chung cho mọi trang báo cáo.
 *
 * Ô thứ nhất chọn SÀN, ô thứ hai chọn GIAN trong sàn đó. Gộp cả hai cấp vào một
 * ô duy nhất thì danh sách dài và lẫn lộn hai loại lựa chọn khác cấp; tách ra
 * thì ô thứ hai chỉ hiện khi thật sự có việc để chọn.
 *
 * Ô thứ hai được ẨN khi đang xem tất cả sàn, và cũng ẩn khi sàn đang chọn chỉ có
 * đúng một gian — lúc đó ô chỉ có mỗi một lựa chọn nên chẳng để làm gì.
 *
 * Danh sách gian lấy từ /api/channels vốn đã lọc theo quyền, nên tài khoản SALES
 * chỉ nhìn thấy sàn và gian mình được phân công.
 */
export function ChannelFilter({
  value,
  onChange,
  className = "w-44",
}: {
  value: ChannelFilterValue;
  onChange: (value: ChannelFilterValue) => void;
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

  // Chỉ liệt kê sàn thật sự có gian hàng, giữ thứ tự cố định để vị trí các lựa
  // chọn không nhảy giữa các lần tải.
  const platforms = PLATFORM_ORDER.filter((p) =>
    channels.some((c) => c.channelName === p)
  );
  const shops = value.channelName
    ? channels.filter((c) => c.channelName === value.channelName)
    : [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        className={className}
        aria-label="Lọc theo sàn thương mại"
        value={value.channelName}
        onChange={(e) =>
          // Đổi sàn thì bỏ luôn gian đã chọn: gian cũ không thuộc sàn mới, giữ
          // lại sẽ ra bộ lọc mâu thuẫn và bảng trống trơn không rõ vì sao.
          onChange({
            channelName: e.target.value as ChannelName | "",
            channelId: "",
          })
        }
      >
        <option value="">Tất cả sàn</option>
        {platforms.map((p) => (
          <option key={p} value={p}>
            {CHANNEL_META[p].label}
          </option>
        ))}
      </NativeSelect>

      {shops.length > 1 && (
        <NativeSelect
          className={className}
          aria-label="Lọc theo gian hàng"
          value={value.channelId}
          onChange={(e) =>
            onChange({ ...value, channelId: e.target.value })
          }
        >
          <option value="">
            Tất cả gian {CHANNEL_META[value.channelName as ChannelName].label}
          </option>
          {shops.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shopName}
            </option>
          ))}
        </NativeSelect>
      )}
    </div>
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
