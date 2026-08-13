import { api } from "./client";
import type { ChannelListItem } from "../types/api";

/** DS gian hàng đã liên kết — màn lọc đơn dùng cho mục "Lọc theo shop". */
export function fetchChannels() {
  return api<ChannelListItem[]>("/api/channels");
}
