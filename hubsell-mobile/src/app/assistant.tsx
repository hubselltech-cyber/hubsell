import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { askAssistant, fetchAssistantSuggestions } from "@/api/assistant";
import { ApiError } from "@/api/client";
import type { AssistantReply } from "@/types/api";
import { AssistantOrb } from "@/components/AssistantOrb";
import { useVoiceInput } from "@/lib/use-voice-input";
import { hapticTap } from "@/lib/haptics";

/**
 * TRỢ LÝ HUBSELL trên mobile — cùng backend tầng luật với bong bóng chat web
 * (hỏi số liệu vận hành tiếng Việt tự nhiên, trả SỐ THẬT + chip hỏi lại).
 * Mở dạng modal từ orb nổi ở Trang chủ; CHỈ CHỦ SHOP như web.
 *
 * Điểm mobile hơn web: nút MIC — bấm là nói, không cần gõ tay (native dùng
 * bộ nhận dạng của máy, web-sim dùng Web Speech API — xem use-voice-input).
 * Deep-link trong câu trả lời trỏ trang web quản trị nên mobile ẩn đi.
 */

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  reply?: AssistantReply;
  error?: boolean;
}

/** Dự phòng khi API gợi ý chưa kịp về — khớp bộ intent backend. */
const FALLBACK_SUGGESTIONS = [
  "Hôm nay lãi bao nhiêu?",
  "Có bao nhiêu đơn chờ xử lý?",
  "SKU nào sắp hết hàng?",
];

// Hội thoại sống XUYÊN các lần đóng/mở modal (hết phiên app là thôi) — vai
// trò như sessionStorage của bản web.
let cachedMsgs: Msg[] = [];
let msgSeq = 0;

/** Biểu đồ cột thuần View — đủ cho khung chat, không kéo thư viện chart. */
function MiniBarChart({ points }: { points: { label: string; value: number }[] }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const labelStep = points.length > 10 ? Math.ceil(points.length / 6) : 1;
  return (
    <View className="flex-row items-end gap-1">
      {points.map((p, i) => (
        <View key={i} className="flex-1 items-center gap-0.5">
          <View
            className="w-full rounded-t bg-emerald-500/80"
            style={{ height: Math.max(3, Math.round((p.value / max) * 64)) }}
          />
          <Text className="h-3 text-[9px] text-slate-400" numberOfLines={1}>
            {i % labelStep === 0 || i === points.length - 1 ? p.label : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 active:bg-emerald-50 dark:border-emerald-700 dark:bg-slate-900 dark:active:bg-emerald-950"
    >
      <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
        {label}
      </Text>
    </Pressable>
  );
}

export default function AssistantScreen() {
  const { status, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<Msg[]>(() => cachedMsgs);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS);
  const scrollRef = useRef<ScrollView>(null);
  const loadingRef = useRef(false);
  loadingRef.current = loading;

  useEffect(() => {
    cachedMsgs = msgs;
  }, [msgs]);

  useEffect(() => {
    fetchAssistantSuggestions()
      .then((r) => {
        if (r.suggestions.length > 0) setSuggestions(r.suggestions);
      })
      .catch(() => {
        // giữ fallback — màn chào vẫn có chip
      });
  }, []);

  const push = useCallback((msg: Omit<Msg, "id">) => {
    setMsgs((prev) => [...prev, { ...msg, id: ++msgSeq }]);
  }, []);

  const ask = useCallback(
    async (payload: { question?: string; intent?: string }, shown: string) => {
      if (loadingRef.current) return;
      push({ role: "user", text: shown });
      setLoading(true);
      try {
        const reply = await askAssistant(payload);
        push({ role: "assistant", text: reply.text, reply });
      } catch (err) {
        push({
          role: "assistant",
          text:
            err instanceof ApiError
              ? err.message
              : "Có lỗi khi hỏi trợ lý — anh/chị thử lại giúp em nhé.",
          error: true,
        });
      } finally {
        setLoading(false);
      }
    },
    [push]
  );

  // ── Giọng nói: transcript tạm hiện live trong ô input, câu chốt tự gửi.
  // Đang chờ trả lời câu trước thì chỉ điền chữ vào ô, khách tự bấm gửi.
  const askRef = useRef(ask);
  askRef.current = ask;
  const voice = useVoiceInput({
    onTranscript: setInput,
    onFinal: (q) => {
      if (loadingRef.current) {
        setInput(q);
        return;
      }
      setInput("");
      void askRef.current({ question: q }, q);
    },
  });

  useEffect(() => {
    // Tin mới / đang trả lời → cuộn xuống đáy
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [msgs, loading]);

  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;

  function submit() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    void ask({ question: q }, q);
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* ── Header — band navy LUÔN TỐI (nhận diện trợ lý, như web) ── */}
      <View
        className="flex-row items-center gap-3 px-4 pb-3"
        style={{
          backgroundColor: "#0a1424",
          paddingTop: (Platform.OS === "ios" ? 12 : insets.top) + 12,
        }}
      >
        <AssistantOrb size={38} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-sm font-semibold text-white">Trợ lý Hubsell</Text>
            <View className="rounded-full bg-emerald-500 px-1.5 py-px">
              <Text className="text-[9px] font-bold uppercase tracking-wide text-emerald-950">
                AI
              </Text>
            </View>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="size-1.5 rounded-full bg-emerald-400" />
            <Text className="text-xs text-slate-400" numberOfLines={1}>
              Hỏi số liệu vận hành — nói hoặc gõ đều được
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="rounded-md p-1.5 active:bg-white/10"
        >
          <Ionicons name="close" size={20} color="#8fa3bf" />
        </Pressable>
      </View>

      {/* ── Khung hội thoại ── */}
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-3 py-3"
        contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {msgs.length === 0 && (
          <View className="mr-auto max-w-[95%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2.5 dark:bg-slate-800">
            <Text className="text-sm leading-5 text-slate-900 dark:text-slate-100">
              Chào anh/chị 👋 Em là Trợ lý Hubsell. Hỏi em về lãi lỗ, đơn hàng,
              tồn kho, quảng cáo… bằng tiếng Việt tự nhiên — bấm nút mic là nói
              được luôn, không cần gõ. Thử ngay:
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <Chip key={s} label={s} onPress={() => void ask({ question: s }, s)} />
              ))}
            </View>
          </View>
        )}

        {msgs.map((m) =>
          m.role === "user" ? (
            <View
              key={m.id}
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-500 px-3 py-2"
            >
              <Text className="text-sm leading-5 text-white">{m.text}</Text>
            </View>
          ) : (
            <View
              key={m.id}
              className={`mr-auto max-w-[95%] rounded-2xl rounded-bl-sm px-3 py-2.5 ${
                m.error
                  ? "border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950"
                  : "bg-slate-100 dark:bg-slate-800"
              }`}
            >
              <Text
                className={`text-sm leading-5 ${
                  m.error
                    ? "text-red-500 dark:text-red-400"
                    : "text-slate-900 dark:text-slate-100"
                }`}
              >
                {m.text}
              </Text>

              {/* Bảng số liệu — tone lãi/lỗ theo chuẩn màu */}
              {m.reply?.rows && m.reply.rows.length > 0 && (
                <View className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  {m.reply.rows.map((r, i) => (
                    <View
                      key={i}
                      className={`flex-row items-center justify-between gap-3 px-2.5 py-1.5 ${
                        i > 0 ? "border-t border-slate-200 dark:border-slate-700" : ""
                      }`}
                    >
                      <Text
                        className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400"
                        numberOfLines={1}
                      >
                        {r.label}
                      </Text>
                      <Text
                        className={`text-xs font-medium ${
                          r.tone === "pos"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : r.tone === "neg"
                              ? "text-red-500 dark:text-red-400"
                              : "text-slate-900 dark:text-slate-100"
                        }`}
                      >
                        {r.value}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Biểu đồ cột mini — doanh thu theo ngày của báo cáo tuần/tháng */}
              {m.reply?.chart && m.reply.chart.points.length > 1 && (
                <View className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                  <Text className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {m.reply.chart.caption}
                  </Text>
                  <MiniBarChart points={m.reply.chart.points} />
                </View>
              )}

              {/* Chip hỏi lại (câu mơ hồ) */}
              {m.reply?.chips && m.reply.chips.length > 0 && (
                <View className="mt-2 flex-row flex-wrap gap-1.5">
                  {m.reply.chips.map((c) => (
                    <Chip
                      key={c.intent}
                      label={c.label}
                      onPress={() =>
                        void ask({ intent: c.intent, question: c.label }, c.label)
                      }
                    />
                  ))}
                </View>
              )}

              {/* Câu mẫu gợi ý (miss / analysis / help) */}
              {m.reply?.suggestions && m.reply.suggestions.length > 0 && (
                <View className="mt-2 flex-row flex-wrap gap-1.5">
                  {m.reply.suggestions.map((s) => (
                    <Chip key={s} label={s} onPress={() => void ask({ question: s }, s)} />
                  ))}
                </View>
              )}
            </View>
          )
        )}

        {loading && (
          <View className="mr-auto rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2.5 dark:bg-slate-800">
            <ActivityIndicator size="small" color="#10b981" />
          </View>
        )}
      </ScrollView>

      {/* ── Ô hỏi: gõ tay hoặc bấm mic nói ── */}
      <View
        className="flex-row items-center gap-2 border-t border-slate-200 bg-white px-3 pt-3 dark:border-slate-800 dark:bg-slate-900"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submit}
          returnKeyType="send"
          placeholder={
            voice.listening ? "Em đang nghe, anh/chị nói đi ạ…" : "Hỏi về lãi, đơn, tồn kho…"
          }
          placeholderTextColor="#94a3b8"
          maxLength={300}
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 dark:border-slate-700 dark:text-slate-100"
        />
        {voice.supported && (
          <Pressable
            onPress={() => {
              hapticTap();
              void voice.toggle();
            }}
            accessibilityLabel={voice.listening ? "Dừng nghe và gửi" : "Hỏi bằng giọng nói"}
            className={`size-10 items-center justify-center rounded-lg border active:opacity-80 ${
              voice.listening
                ? "border-red-500 bg-red-500"
                : "border-emerald-300 bg-white dark:border-emerald-700 dark:bg-slate-900"
            }`}
          >
            <Ionicons
              name="mic"
              size={18}
              color={voice.listening ? "#ffffff" : "#10b981"}
            />
          </Pressable>
        )}
        <Pressable
          onPress={submit}
          disabled={!input.trim() || loading}
          accessibilityLabel="Gửi câu hỏi"
          className={`size-10 items-center justify-center rounded-lg bg-emerald-500 active:opacity-80 ${
            !input.trim() || loading ? "opacity-40" : ""
          }`}
        >
          <Ionicons name="send" size={16} color="#ffffff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
