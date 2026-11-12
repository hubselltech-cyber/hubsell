import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { fetchOrderTracking, type OrderTrackingDto, type TrackingEventDto } from "@/api/orders";
import { ApiError } from "@/api/client";
import { formatDateTime } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { CHANNEL_LABEL } from "@/lib/labels";
import { TABULAR } from "@/theme/tokens";
import type { OrderDto } from "@/types/api";

/**
 * HÀNH TRÌNH VẬN CHUYỂN ở cuối Chi tiết đơn hàng (12/11/2026, khách: "chi tiết đơn cần
 * có timeline hành trình"; anh Trung: hành trình của BÊN VẬN CHUYỂN, lấy từ API sàn).
 *
 * Mỗi lượt xem = 1 call sàn (máy chủ nhớ 10 phút) nên:
 *   · đơn chưa giao cho vận chuyển → không gọi, chỉ ghi một dòng;
 *   · `load` = false (màn quét, người dùng chưa vuốt xuống) → hiện nút "Xem hành trình",
 *     nhân viên quét liên tục không tốn call nào;
 *   · `load` = true (mở từ Đơn hàng, hoặc đã vuốt xuống) → tự tải một lần cho mỗi đơn.
 *
 * Mốc mới nhất trên cùng, in đậm; mốc giao thất bại đỏ, đã giao xanh. Quá COLLAPSED mốc
 * thì gập bớt — phần hay cần xem là vài mốc gần nhất.
 */
const COLLAPSED = 5;

const DOT: Record<TrackingEventDto["kind"], string> = {
  normal: "#94a3b8",
  delivered: "#10b981",
  failed: "#ef4444",
  returning: "#f59e0b",
};

export function OrderTrackingSection({ order, load }: { order: OrderDto; load: boolean }) {
  const shipped = order.shippingStatus !== "PENDING" && !!order.trackingCode;
  // Kết quả gắn theo id đơn — đổi đơn là kết quả cũ tự hết hiệu lực (không cần reset tay).
  const [result, setResult] = useState<{ id: string; data?: OrderTrackingDto; error?: string } | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const wanted = shipped && (load || requested === order.id);
  const mine = result && result.id === order.id ? result : null;

  const run = useCallback((orderId: string) => {
    let stale = false;
    fetchOrderTracking(orderId)
      .then((data) => {
        if (!stale) setResult({ id: orderId, data });
      })
      .catch((err: unknown) => {
        if (!stale) {
          setResult({
            id: orderId,
            error: err instanceof ApiError ? err.message : "Không tải được hành trình, thử lại",
          });
        }
      });
    return () => {
      stale = true;
    };
  }, []);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!wanted) return;
    return run(order.id);
  }, [wanted, order.id, attempt, run]);

  const retry = () => {
    hapticTap();
    setResult(null);
    setAttempt((n) => n + 1);
  };

  const data = mine?.data;
  const events = data?.events ?? [];
  const shown = expanded ? events : events.slice(0, COLLAPSED);
  const platform = CHANNEL_LABEL[order.channel.channelName] ?? order.channel.channelName;

  return (
    <View className="mt-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
      <View className="mb-2 flex-row items-center gap-1.5">
        <Ionicons name="navigate-outline" size={15} color="#64748b" />
        <Text className="flex-1 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
          Hành trình vận chuyển
        </Text>
        {data?.fetchedAt && data.state === "ok" ? (
          <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
            cập nhật {formatDateTime(data.fetchedAt).slice(6)}
          </Text>
        ) : null}
      </View>

      {/* Mã vận đơn + sao chép — để dán vào app hãng / Seller Center khi cần đối chiếu */}
      {order.trackingCode ? (
        <View className="mb-2 flex-row items-center gap-2 rounded-xl bg-white py-1.5 pl-3 pr-1.5 dark:bg-slate-900">
          <Text className="text-[11px] text-slate-400 dark:text-slate-500">Mã vận đơn</Text>
          <Text
            className="min-w-0 flex-1 text-[13px] font-bold text-slate-800 dark:text-slate-100"
            style={TABULAR}
            numberOfLines={1}
            selectable
          >
            {order.trackingCode}
          </Text>
          <Pressable
            className="flex-row items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1.5 active:opacity-70 dark:bg-slate-800"
            hitSlop={6}
            onPress={() => {
              hapticTap();
              void Clipboard.setStringAsync(order.trackingCode ?? "").catch(() => {});
              setCopied(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Sao chép mã vận đơn"
          >
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={13} color={copied ? "#059669" : "#64748b"} />
            <Text
              className={`text-[11px] font-semibold ${
                copied ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-200"
              }`}
            >
              {copied ? "Đã chép" : "Sao chép"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!shipped ? (
        <Note icon="time-outline" text="Đơn chưa giao cho đơn vị vận chuyển nên chưa có hành trình." />
      ) : !wanted ? (
        <Pressable
          className="flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 active:opacity-70 dark:border-slate-700 dark:bg-slate-900"
          onPress={() => {
            hapticTap();
            setRequested(order.id);
          }}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-down" size={14} color="#059669" />
          <Text className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">Xem hành trình</Text>
        </Pressable>
      ) : !mine ? (
        <View className="flex-row items-center gap-2 py-3">
          <ActivityIndicator size="small" color="#64748b" />
          <Text className="text-xs text-slate-500 dark:text-slate-400">Đang hỏi {platform} hành trình của đơn…</Text>
        </View>
      ) : mine.error ? (
        <View className="items-start gap-2 py-1">
          <Note icon="cloud-offline-outline" text={mine.error} />
          <Pressable
            className="rounded-full bg-white px-3 py-1.5 active:opacity-70 dark:bg-slate-900"
            onPress={retry}
            accessibilityRole="button"
          >
            <Text className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Thử lại</Text>
          </Pressable>
        </View>
      ) : data?.state === "not_shipped" ? (
        <Note icon="time-outline" text="Đơn chưa giao cho đơn vị vận chuyển nên chưa có hành trình." />
      ) : data?.state === "unsupported" ? (
        <Note
          icon="information-circle-outline"
          text={
            order.channel.channelName === "LAZADA"
              ? "Hành trình của đơn Lazada sẽ có ở bản cập nhật sau. Tạm thời dùng mã vận đơn ở trên để tra trên Lazada."
              : "Gian hàng này chưa lấy được hành trình từ sàn."
          }
        />
      ) : events.length === 0 ? (
        <Note icon="hourglass-outline" text="Đơn vị vận chuyển chưa cập nhật mốc nào cho đơn này." />
      ) : (
        <View>
          {shown.map((e, i) => {
            const latest = i === 0;
            const last = i === shown.length - 1;
            const tone =
              e.kind === "failed"
                ? "text-red-600 dark:text-red-400"
                : e.kind === "delivered"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : e.kind === "returning"
                    ? "text-amber-700 dark:text-amber-300"
                    : latest
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-600 dark:text-slate-300";
            return (
              <View key={`${e.at ?? "x"}-${i}`} className="flex-row gap-2.5">
                {/* Cột chấm + đường nối */}
                <View className="w-3 items-center">
                  <View
                    className="mt-[5px] rounded-full"
                    style={{
                      width: latest ? 10 : 8,
                      height: latest ? 10 : 8,
                      backgroundColor: e.kind === "normal" && latest ? "#10b981" : DOT[e.kind],
                    }}
                  />
                  {last ? null : <View className="w-px flex-1 bg-slate-200 dark:bg-slate-700" />}
                </View>
                <View className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
                  <Text className={`text-[13px] leading-[18px] ${latest ? "font-semibold" : "font-normal"} ${tone}`}>
                    {e.description}
                  </Text>
                  {e.at ? (
                    <Text className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                      {formatDateTime(e.at)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
          {events.length > COLLAPSED ? (
            <Pressable
              className="mt-2 flex-row items-center justify-center gap-1 rounded-xl bg-white py-2 active:opacity-70 dark:bg-slate-900"
              onPress={() => {
                hapticTap();
                setExpanded((v) => !v);
              }}
              accessibilityRole="button"
            >
              <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {expanded ? "Thu gọn" : `Xem cả ${events.length} mốc`}
              </Text>
              <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color="#64748b" />
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Note({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View className="flex-row items-start gap-2 py-1">
      <Ionicons name={icon} size={14} color="#94a3b8" style={{ marginTop: 2 }} />
      <Text className="flex-1 text-xs leading-[18px] text-slate-500 dark:text-slate-400">{text}</Text>
    </View>
  );
}
