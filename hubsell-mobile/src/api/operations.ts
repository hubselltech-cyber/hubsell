import { api } from "./client";
import type { OpsConversationsResponse, OpsMessagesResponse } from "../types/api";

/**
 * Inbox hợp nhất mọi gian đã uỷ quyền. Backend gọi TRỰC TIẾP API sàn từng
 * lượt (không cache DB) — có thể mất vài giây, gian lỗi trả trong errors[].
 */
export function fetchConversations() {
  return api<OpsConversationsResponse>("/api/operations/conversations");
}

/** Lịch sử một hội thoại (backend đã đảo cũ → mới). buyerId chỉ Shopee cần. */
export function fetchMessages(params: {
  channelId: string;
  conversationId: string;
  buyerId?: string | null;
}) {
  const q = new URLSearchParams();
  q.set("channelId", params.channelId);
  q.set("conversationId", params.conversationId);
  if (params.buyerId) q.set("buyerId", params.buyerId);
  return api<OpsMessagesResponse>(
    `/api/operations/conversations/messages?${q.toString()}`
  );
}

/**
 * Gửi ẢNH — chỉ Shopee (backend upload lên file server sàn rồi send_message
 * kiểu image). uri là đường dẫn ảnh local từ expo-image-picker; RN FormData
 * nhận part dạng {uri, name, type} và tự stream file.
 */
export function sendImage(params: {
  channelId: string;
  buyerId: string;
  uri: string;
  mime: string;
  name: string;
}) {
  const form = new FormData();
  form.append("channelId", params.channelId);
  form.append("buyerId", params.buyerId);
  form.append("image", {
    uri: params.uri,
    type: params.mime,
    name: params.name,
  } as unknown as Blob);
  return api<{ ok: true; imageUrl: string }>(
    "/api/operations/conversations/send-image",
    { method: "POST", body: form }
  );
}

/** Gửi tin văn bản. Shopee bắt buộc buyerId (to_id); Lazada dùng sessionId. */
export function sendMessage(params: {
  channelId: string;
  conversationId: string;
  buyerId?: string | null;
  text: string;
}) {
  return api<{ ok: true }>("/api/operations/conversations/send", {
    method: "POST",
    body: {
      channelId: params.channelId,
      conversationId: params.conversationId,
      ...(params.buyerId ? { buyerId: params.buyerId } : {}),
      text: params.text,
    },
  });
}
