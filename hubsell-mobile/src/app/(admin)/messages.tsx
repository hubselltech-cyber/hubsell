import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { fetchMessages, sendImage, sendMessage } from "@/api/operations";
import { ApiError } from "@/api/client";
import type { OpsConversationDto, OpsMessageDto } from "@/types/api";
import { CHANNEL_LABEL } from "@/lib/labels";
import { useChannelColors } from "@/theme/channel-colors";
import { useConversations } from "@/chat/ConversationsContext";

// Thứ tự tab chốt với anh Trung 13/08: Shopee → TikTok → Lazada.
const CHANNEL_TABS = ["SHOPEE", "TIKTOK", "LAZADA"] as const;
type ChannelTab = (typeof CHANNEL_TABS)[number];

/** Khung chat mở thì mới đáng poll dày hơn nhịp 30s của inbox chung. */
const CHAT_POLL_MS = 10_000;

/** Bộ lọc theo tin CUỐI của hội thoại (lastFromShop backend tính sẵn). */
const REPLY_FILTERS = [
  { key: "" as const, label: "Tất cả" },
  { key: "UNREPLIED" as const, label: "Chưa trả lời" },
  { key: "REPLIED" as const, label: "Đã trả lời" },
];
type ReplyFilter = (typeof REPLY_FILTERS)[number]["key"];

/** epoch ms → "HH:mm" nếu hôm nay, ngược lại "dd/MM HH:mm". */
function formatMs(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return sameDay ? hm : `${p(d.getDate())}/${p(d.getMonth() + 1)} ${hm}`;
}

export default function MessagesScreen() {
  const channelColors = useChannelColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<ChannelTab>("SHOPEE");
  const [filter, setFilter] = useState<ReplyFilter>("");
  // Inbox nằm ở ConversationsProvider (layout admin) — badge tab dùng chung
  const {
    conversations,
    errors: channelErrors,
    loading,
    error,
    refresh,
  } = useConversations();
  const [refreshing, setRefreshing] = useState(false);
  // Hội thoại đang mở — null = danh sách. Giữ trong state nội bộ thay vì
  // route con để không đẻ thêm tab dưới thanh Tabs của expo-router.
  const [active, setActive] = useState<OpsConversationDto | null>(null);

  const byTab = useMemo(
    () => conversations.filter((c) => c.channelName === tab),
    [conversations, tab]
  );
  // lastFromShop null (Lazada chưa trả người gửi cuối) chỉ nằm trong "Tất cả"
  const filtered = useMemo(
    () =>
      filter === ""
        ? byTab
        : byTab.filter((c) =>
            filter === "REPLIED" ? c.lastFromShop === true : c.lastFromShop === false
          ),
    [byTab, filter]
  );
  const filterCount = useCallback(
    (f: ReplyFilter) =>
      f === ""
        ? byTab.length
        : byTab.filter((c) =>
            f === "REPLIED" ? c.lastFromShop === true : c.lastFromShop === false
          ).length,
    [byTab]
  );
  const unreadOf = useCallback(
    (ch: ChannelTab) =>
      conversations
        .filter((c) => c.channelName === ch)
        .reduce((s, c) => s + c.unread, 0),
    [conversations]
  );

  if (active) {
    return (
      <ChatView
        conversation={active}
        topInset={insets.top}
        onBack={() => {
          setActive(null);
          void refresh({ silent: true }); // cập nhật unread/lastMessage sau khi rời chat
        }}
      />
    );
  }

  const renderConversation = ({ item }: { item: OpsConversationDto }) => (
    <Pressable
      className="mb-2.5 flex-row items-center gap-3 rounded-2xl bg-white dark:bg-slate-900 p-3 active:opacity-70"
      style={{ elevation: 1 }}
      onPress={() => setActive(item)}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: `${channelColors[item.channelName]}1a` }}
      >
        <Text
          className="text-base font-bold"
          style={{ color: channelColors[item.channelName] }}
        >
          {(item.customer || "?").charAt(0).toUpperCase()}
        </Text>
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text
            className={`flex-1 pr-2 text-[13px] ${
              item.unread ? "font-bold text-slate-900 dark:text-slate-100" : "font-semibold text-slate-800"
            }`}
            numberOfLines={1}
          >
            {item.customer}
          </Text>
          <Text className="text-[11px] text-slate-400 dark:text-slate-500">{formatMs(item.lastAt)}</Text>
        </View>
        <View className="mt-0.5 flex-row items-center justify-between">
          <Text
            className={`flex-1 pr-2 text-xs ${
              item.unread ? "font-semibold text-slate-700 dark:text-slate-300" : "text-slate-500 dark:text-slate-400"
            }`}
            numberOfLines={1}
          >
            {item.lastMessage || "…"}
          </Text>
          {item.unread ? (
            <View className="min-w-[18px] items-center rounded-full bg-emerald-50 dark:bg-emerald-500/100 px-1.5 py-0.5">
              <Text className="text-[10px] font-bold text-white">
                {item.unread > 99 ? "99+" : item.unread}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
          {item.shopName}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 16 }}>
      <View className="mb-3 px-4">
        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">Tin nhắn</Text>
        <Text className="text-xs text-slate-500 dark:text-slate-400">
          Trả lời khách ngay trên sàn
        </Text>
      </View>

      <View className="mb-2.5 flex-row gap-2 px-4">
        {CHANNEL_TABS.map((ch) => {
          const activeTab = tab === ch;
          const unread = unreadOf(ch);
          return (
            <Pressable
              key={ch}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full px-2 py-2 ${
                activeTab ? "bg-slate-900 dark:bg-slate-100" : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
              }`}
              onPress={() => setTab(ch)}
            >
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: channelColors[ch] }}
              />
              <Text
                className={`text-xs font-semibold ${
                  activeTab ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                }`}
              >
                {CHANNEL_LABEL[ch]}
              </Text>
              {unread ? (
                <View className="min-w-[16px] items-center rounded-full bg-emerald-50 dark:bg-emerald-500/100 px-1">
                  <Text className="text-[9px] font-bold text-white">
                    {unread > 99 ? "99+" : unread}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {tab !== "TIKTOK" ? (
        <View className="mb-2.5 flex-row gap-2 px-4">
          {REPLY_FILTERS.map((f) => {
            const activeF = filter === f.key;
            const count = filterCount(f.key);
            return (
              <Pressable
                key={f.key || "ALL"}
                className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${
                  activeF ? "bg-slate-900 dark:bg-slate-100" : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                }`}
                onPress={() => setFilter(f.key)}
              >
                <Text
                  className={`text-xs font-semibold ${
                    activeF ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {f.label}
                </Text>
                {count ? (
                  <Text
                    className={`text-[10px] ${activeF ? "text-slate-300 dark:text-slate-600" : "text-slate-400 dark:text-slate-500"}`}
                  >
                    {count}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {tab === "TIKTOK" ? (
        <View className="mx-4 mt-6 items-center rounded-2xl bg-white dark:bg-slate-900 p-6" style={{ elevation: 1 }}>
          <Ionicons name="chatbubbles-outline" size={36} color="#94a3b8" />
          <Text className="mt-3 text-center text-sm font-semibold text-slate-700 dark:text-slate-300">
            TikTok Shop chưa mở API chat
          </Text>
          <Text className="mt-1 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
            Hubsell sẽ bổ sung ngay khi sàn hỗ trợ. Tạm thời anh/chị trả lời
            khách trong app TikTok Seller.
          </Text>
        </View>
      ) : loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : error ? (
        <Text className="px-6 py-10 text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          renderItem={renderConversation}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
          ListHeaderComponent={
            channelErrors.length ? (
              <View className="mb-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2">
                {channelErrors.map((e) => (
                  <Text key={e.channelId} className="text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                    {e.shopName}: {e.message}
                  </Text>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              {filter
                ? "Không có hội thoại nào khớp bộ lọc"
                : `Chưa có hội thoại nào trên ${CHANNEL_LABEL[tab]}`}
            </Text>
          }
        />
      )}
    </View>
  );
}

// ============================================================
// Khung chat một hội thoại
// ============================================================

/** Tin đang gửi/lỗi hiển thị lạc quan trước khi sàn xác nhận. */
interface PendingMessage extends OpsMessageDto {
  pending?: boolean;
  failed?: boolean;
}

function ChatView({
  conversation,
  topInset,
  onBack,
}: {
  conversation: OpsConversationDto;
  topInset: number;
  onBack: () => void;
}) {
  const channelColors = useChannelColors();
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Đếm phiên gửi để poll nền không ghi đè tin lạc quan chưa lên sàn
  const pendingRef = useRef<PendingMessage[]>([]);

  const load = useCallback(
    async (silent: boolean) => {
      try {
        const res = await fetchMessages({
          channelId: conversation.channelId,
          conversationId: conversation.externalId,
          buyerId: conversation.buyerId,
        });
        setMessages([...res.messages, ...pendingRef.current]);
        setError("");
      } catch (err) {
        if (!silent) {
          setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra");
        }
      } finally {
        setLoading(false);
      }
    },
    [conversation]
  );

  useEffect(() => {
    void load(false);
    const t = setInterval(() => void load(true), CHAT_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  /** Thêm bong bóng lạc quan; trả về hàm gỡ (thành công) + hàm đánh lỗi. */
  const pushOptimistic = (msg: PendingMessage) => {
    pendingRef.current = [...pendingRef.current, msg];
    setMessages((prev) => [...prev, msg]);
    const markFailed = () => {
      // Giữ bong bóng kèm cờ lỗi để người dùng biết tin CHƯA tới khách
      const flag = (m: PendingMessage) =>
        m.id === msg.id ? { ...m, pending: false, failed: true } : m;
      pendingRef.current = pendingRef.current.map(flag);
      setMessages((prev) => prev.map(flag));
    };
    const remove = () => {
      pendingRef.current = pendingRef.current.filter((m) => m.id !== msg.id);
    };
    return { markFailed, remove };
  };

  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    const { markFailed, remove } = pushOptimistic({
      id: `local-${Date.now()}`,
      fromShop: true,
      text: body,
      at: Date.now(),
      itemId: null,
      imageUrl: null,
      pending: true,
    });
    try {
      await sendMessage({
        channelId: conversation.channelId,
        conversationId: conversation.externalId,
        buyerId: conversation.buyerId,
        text: body,
      });
      remove();
      await load(true); // sàn đã nhận — tải lại cho tin chính thức thế chỗ
    } catch (err) {
      markFailed();
      setError(err instanceof ApiError ? err.message : "Gửi tin thất bại");
    } finally {
      setSending(false);
    }
  };

  /** Chọn ảnh từ thư viện rồi gửi — chỉ Shopee (backend upload lên sàn). */
  const onPickImage = async () => {
    if (sending || !conversation.buyerId) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    setSending(true);
    const { markFailed, remove } = pushOptimistic({
      id: `local-${Date.now()}`,
      fromShop: true,
      text: "",
      at: Date.now(),
      itemId: null,
      imageUrl: asset.uri,
      pending: true,
    });
    try {
      await sendImage({
        channelId: conversation.channelId,
        buyerId: conversation.buyerId,
        uri: asset.uri,
        mime: asset.mimeType ?? "image/jpeg",
        name: asset.fileName ?? "photo.jpg",
      });
      remove();
      await load(true);
    } catch (err) {
      markFailed();
      setError(err instanceof ApiError ? err.message : "Gửi ảnh thất bại");
    } finally {
      setSending(false);
    }
  };

  // FlatList inverted cần dữ liệu MỚI → CŨ
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const renderMessage = ({ item }: { item: PendingMessage }) => (
    <View
      className={`mb-2 max-w-[80%] ${item.fromShop ? "self-end items-end" : "self-start items-start"}`}
    >
      {item.imageUrl ? (
        <View
          className={`overflow-hidden rounded-2xl ${
            item.failed ? "border-2 border-red-400" : ""
          }`}
          style={item.pending ? { opacity: 0.55 } : undefined}
        >
          <Image
            source={{ uri: item.imageUrl }}
            style={{ width: 180, height: 180 }}
            contentFit="cover"
            transition={150}
          />
        </View>
      ) : (
        <View
          className={`rounded-2xl px-3 py-2 ${
            item.fromShop
              ? item.failed
                ? "bg-red-100 dark:bg-red-500/15"
                : "bg-slate-900 dark:bg-slate-700"
              : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
          }`}
          style={item.pending ? { opacity: 0.55 } : undefined}
        >
          <Text
            className={`text-[13px] leading-5 ${
              item.fromShop
                ? item.failed
                  ? "text-red-600"
                  : "text-white"
                : "text-slate-900 dark:text-slate-100"
            }`}
          >
            {item.text}
          </Text>
        </View>
      )}
      <Text className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
        {item.failed
          ? "Gửi thất bại"
          : item.pending
            ? "Đang gửi…"
            : formatMs(item.at)}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        className="flex-row items-center gap-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 pb-3"
        style={{ paddingTop: topInset + 10 }}
      >
        <Pressable
          className="h-9 w-9 items-center justify-center rounded-xl active:bg-slate-100 dark:active:bg-slate-800"
          onPress={onBack}
        >
          <Ionicons name="arrow-back" size={20} color="#64748b" />
        </Pressable>
        <View
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `${channelColors[conversation.channelName]}1a` }}
        >
          <Text
            className="text-sm font-bold"
            style={{ color: channelColors[conversation.channelName] }}
          >
            {(conversation.customer || "?").charAt(0).toUpperCase()}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-sm font-bold text-slate-900 dark:text-slate-100" numberOfLines={1}>
            {conversation.customer}
          </Text>
          <Text className="text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
            {CHANNEL_LABEL[conversation.channelName]} · {conversation.shopName}
          </Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={inverted}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
          ListEmptyComponent={
            <Text className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              Chưa có tin nhắn trong hội thoại này
            </Text>
          }
        />
      )}

      {error ? (
        <Text className="px-4 pb-1 text-center text-xs text-red-500 dark:text-red-400">{error}</Text>
      ) : null}

      <View className="flex-row items-end gap-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
        {conversation.channelName === "SHOPEE" && conversation.buyerId ? (
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800"
            onPress={() => void onPickImage()}
            disabled={sending}
          >
            <Ionicons name="image-outline" size={22} color="#64748b" />
          </Pressable>
        ) : null}
        <TextInput
          className="max-h-24 flex-1 rounded-2xl bg-slate-100 dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100"
          placeholder="Nhập tin nhắn…"
          placeholderTextColor="#94a3b8"
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable
          className={`h-10 w-10 items-center justify-center rounded-full ${
            text.trim() && !sending ? "bg-emerald-50 dark:bg-emerald-500/100" : "bg-slate-200 dark:bg-slate-700"
          }`}
          onPress={() => void onSend()}
          disabled={!text.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name="send"
              size={16}
              color={text.trim() ? "#fff" : "#94a3b8"}
            />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
