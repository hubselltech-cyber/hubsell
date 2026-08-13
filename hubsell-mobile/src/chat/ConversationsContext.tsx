import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { fetchConversations } from "@/api/operations";
import { ApiError } from "@/api/client";
import type { OpsChannelErrorDto, OpsConversationDto } from "@/types/api";

/**
 * Inbox CSKH dùng chung: mount ở layout (admin) để badge "Tin nhắn" trên
 * thanh tab đếm được tin chưa đọc NGAY CẢ KHI chưa mở màn Tin nhắn — màn
 * messages.tsx tiêu thụ cùng dữ liệu, khỏi ai poll của người nấy.
 */

/** Backend fan-out gọi thẳng API từng sàn — đừng poll dày hơn mức này. */
const POLL_MS = 30_000;

interface ConversationsState {
  conversations: OpsConversationDto[];
  errors: OpsChannelErrorDto[];
  /** true cho tới khi lượt tải đầu tiên xong. */
  loading: boolean;
  /** Lỗi của lượt tải chủ động gần nhất — poll nền lỗi thì giữ im lặng. */
  error: string;
  totalUnread: number;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
}

const Ctx = createContext<ConversationsState | null>(null);

export function ConversationsProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<OpsConversationDto[]>([]);
  const [errors, setErrors] = useState<OpsChannelErrorDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      const res = await fetchConversations();
      setConversations(res.conversations);
      setErrors(res.errors);
      setError("");
    } catch (err) {
      if (!opts?.silent) {
        setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0);

  return (
    <Ctx.Provider
      value={{ conversations, errors, loading, error, totalUnread, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useConversations(): ConversationsState {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useConversations phải nằm trong ConversationsProvider");
  }
  return v;
}
