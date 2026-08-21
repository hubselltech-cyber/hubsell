import { api } from "./client";
import type { AssistantReply } from "../types/api";

/**
 * Trợ lý Hubsell — cùng backend tầng luật với bong bóng chat trên web
 * (luật-trước-LLM-sau, 0 đồng token). Chỉ CHỦ SHOP: câu trả lời chạm số
 * tài chính, backend đã chặn theo role.
 */

/** Hỏi trợ lý: câu chữ tự nhiên, hoặc intent đích danh khi bấm chip hỏi lại. */
export function askAssistant(data: { question?: string; intent?: string }) {
  return api<AssistantReply>("/api/assistant/ask", { method: "POST", body: data });
}

/** Câu mẫu cho màn chào. */
export function fetchAssistantSuggestions() {
  return api<{ suggestions: string[] }>("/api/assistant/suggestions");
}
