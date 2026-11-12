import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { Badge } from "@/components/Badge";
import { isCancelled, summarizeBatch, type BatchLine } from "@/lib/batch-scan";
import { batchStore, type BatchEntry } from "@/lib/batch-scan-store";
import { groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { CARRIER_LABEL, CHANNEL_LABEL, orderStatusBadge } from "@/lib/labels";
import { useChannelColors } from "@/theme/channel-colors";
import { TABULAR } from "@/theme/tokens";
import type { OrderDto } from "@/types/api";

/**
 * HỘP "LÔ ĐÃ QUÉT" của chế độ Quét nhiều (12/11/2026): hai tab —
 *   Hàng — cộng sản phẩm của ĐÚNG các kiện đã quét (theo sản phẩm / theo SKU), mỗi dòng có
 *          số đơn chứa món đó;
 *   Kiện — danh sách kiện đã quét, mới nhất trước, bỏ được từng kiện, chép được mã.
 * Đơn ĐÃ HỦY đứng đầu tab Kiện, tô đỏ, và không tính vào số hàng (kiện phải rút ra).
 * Số trong hộp tính tại máy từ dữ liệu của lượt quét (lib/batch-scan.ts) — mở là có ngay.
 */
export type BatchTab = "goods" | "parcels";

export function carrierLabelOf(o: Pick<OrderDto, "shippingCarrierName" | "carrier">): string {
  return o.shippingCarrierName ?? (o.carrier ? (CARRIER_LABEL[o.carrier] ?? o.carrier) : "Chưa rõ hãng");
}

export function BatchSheet({
  visible,
  entries,
  tab,
  onTab,
  onClose,
}: {
  visible: boolean;
  entries: BatchEntry[];
  tab: BatchTab;
  onTab: (t: BatchTab) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useChannelColors();
  const [mode, setMode] = useState<"product" | "sku">("product");
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const summary = useMemo(() => summarizeBatch(entries.map((e) => e.order), carrierLabelOf), [entries]);
  const lines = mode === "product" ? summary.byProduct : summary.bySku;
  // Đơn hủy lên đầu — việc phải làm ngay là rút các kiện đó ra.
  const parcels = useMemo(
    () => [...entries].sort((a, b) => Number(isCancelled(b.order)) - Number(isCancelled(a.order)) || b.at - a.at),
    [entries]
  );
  const live = summary.parcels - summary.cancelled;

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="h-[86%] rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 12 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">Lô đã quét</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng">
              <Ionicons name="close" size={22} color="#64748b" />
            </Pressable>
          </View>

          {/* TÓM TẮT LÔ — ba con số + chia theo sàn / hãng */}
          <View className="mt-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
            <View className="flex-row">
              <Stat value={groupVN(live)} label="kiện" />
              <Stat value={groupVN(summary.qty)} label="sản phẩm" />
              <Stat value={groupVN(summary.bySku.length)} label="SKU" />
            </View>
            {live > 0 ? (
              <View className="mt-2.5 flex-row flex-wrap gap-1.5 border-t border-slate-200 pt-2.5 dark:border-slate-800">
                {summary.byChannel.map((c) => (
                  <View
                    key={`ch-${c.key}`}
                    className="flex-row items-center gap-1.5 rounded-full bg-white px-2.5 py-1 dark:bg-slate-900"
                  >
                    <View
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: colors[c.key as keyof typeof colors] ?? "#94a3b8" }}
                    />
                    <Text className="text-[11px] font-semibold text-slate-700 dark:text-slate-200" style={TABULAR}>
                      {CHANNEL_LABEL[c.key as keyof typeof CHANNEL_LABEL] ?? c.key} {groupVN(c.count)}
                    </Text>
                  </View>
                ))}
                {summary.byCarrier.map((c) => (
                  <View key={`ca-${c.key}`} className="rounded-full bg-white px-2.5 py-1 dark:bg-slate-900">
                    <Text
                      className="text-[11px] font-medium text-slate-500 dark:text-slate-400"
                      style={TABULAR}
                      numberOfLines={1}
                    >
                      {c.key} {groupVN(c.count)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {summary.cancelled > 0 ? (
            <View className="mt-2 flex-row items-start gap-2 rounded-2xl bg-red-50 px-3 py-2.5 dark:bg-red-500/10">
              <Ionicons name="ban" size={15} color="#dc2626" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-xs font-medium leading-[18px] text-red-700 dark:text-red-300">
                {groupVN(summary.cancelled)} đơn ĐÃ HỦY trong lô — rút các kiện đó ra, không giao. Số hàng ở trên
                không tính các đơn này.
              </Text>
            </View>
          ) : null}
          {summary.cancelRequested > 0 ? (
            <View className="mt-2 flex-row items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
              <Ionicons name="warning" size={15} color="#d97706" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-xs font-medium leading-[18px] text-amber-800 dark:text-amber-300">
                {groupVN(summary.cancelRequested)} đơn khách đang xin hủy — để riêng, chờ shop trả lời sàn.
              </Text>
            </View>
          ) : null}

          {/* TAB + cách gom / xóa lô */}
          <View className="mb-1 mt-3 flex-row items-center gap-2">
            <View className="flex-row rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <Seg label={`Hàng (${groupVN(lines.length)})`} active={tab === "goods"} onPress={() => onTab("goods")} />
              <Seg
                label={`Kiện (${groupVN(summary.parcels)})`}
                active={tab === "parcels"}
                onPress={() => onTab("parcels")}
              />
            </View>
            <View className="flex-1" />
            {tab === "goods" ? (
              <View className="flex-row rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                <Seg small label="Sản phẩm" active={mode === "product"} onPress={() => setMode("product")} />
                <Seg small label="SKU" active={mode === "sku"} onPress={() => setMode("sku")} />
              </View>
            ) : entries.length > 0 ? (
              <Pressable
                className="flex-row items-center gap-1 rounded-full px-2.5 py-1.5 active:opacity-60"
                onPress={() => {
                  hapticTap();
                  setConfirmClear(true);
                }}
                accessibilityRole="button"
              >
                <Ionicons name="trash-outline" size={14} color="#dc2626" />
                <Text className="text-xs font-semibold text-red-600 dark:text-red-400">Xóa lô</Text>
              </Pressable>
            ) : null}
          </View>

          {confirmClear ? (
            <View className="mb-2 rounded-2xl border border-red-200 p-3 dark:border-red-500/30">
              <Text className="text-[13px] text-slate-700 dark:text-slate-200">
                Xóa cả {groupVN(summary.parcels)} kiện khỏi lô để quét lô mới? Đơn hàng không bị đổi gì.
              </Text>
              <View className="mt-2.5 flex-row gap-2">
                <Pressable
                  className="flex-1 items-center rounded-xl bg-slate-100 py-2.5 active:opacity-70 dark:bg-slate-800"
                  onPress={() => setConfirmClear(false)}
                  accessibilityRole="button"
                >
                  <Text className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Giữ lại</Text>
                </Pressable>
                <Pressable
                  className="flex-1 items-center rounded-xl bg-red-600 py-2.5 active:opacity-80"
                  onPress={() => {
                    hapticTap();
                    batchStore.clear();
                    setConfirmClear(false);
                    onClose();
                  }}
                  accessibilityRole="button"
                >
                  <Text className="text-[13px] font-bold text-white">Xóa lô</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {tab === "goods" ? (
            <FlatList
              data={lines}
              keyExtractor={(l, i) => `${mode}-${l.sku ?? ""}-${l.name}-${i}`}
              initialNumToRender={14}
              windowSize={7}
              ListEmptyComponent={
                <Empty
                  icon="cube-outline"
                  title={entries.length === 0 ? "Chưa quét kiện nào" : "Lô này chưa có hàng để cộng"}
                  text={
                    entries.length === 0
                      ? "Quét từng kiện của lô, hàng của các kiện đó cộng lại ở đây."
                      : "Các kiện đã quét đều là đơn đã hủy, hoặc đơn chưa có chi tiết sản phẩm."
                  }
                />
              }
              renderItem={({ item, index }) => <GoodsRow line={item} index={index} bySku={mode === "sku"} />}
            />
          ) : (
            <FlatList
              data={parcels}
              keyExtractor={(e) => e.order.id}
              initialNumToRender={12}
              windowSize={7}
              ListEmptyComponent={
                <Empty
                  icon="scan-outline"
                  title="Chưa quét kiện nào"
                  text="Đưa tem của từng kiện vào khung camera — không cần bấm gì giữa hai kiện."
                />
              }
              renderItem={({ item }) => (
                <ParcelRow
                  entry={item}
                  copied={copied === item.order.id}
                  onCopy={() => {
                    hapticTap();
                    void Clipboard.setStringAsync(item.order.orderCode).catch(() => {});
                    setCopied(item.order.id);
                  }}
                  onRemove={() => {
                    hapticTap();
                    batchStore.remove(item.order.id);
                  }}
                />
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-2xl font-extrabold text-slate-900 dark:text-slate-50" style={TABULAR} numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-[11px] text-slate-500 dark:text-slate-400">{label}</Text>
    </View>
  );
}

function Seg({
  label,
  active,
  onPress,
  small = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  small?: boolean;
}) {
  return (
    <Pressable
      className={`${small ? "rounded-md px-2.5 py-1.5" : "rounded-lg px-3.5 py-2"} ${
        active ? "bg-white dark:bg-slate-600" : ""
      }`}
      onPress={() => {
        if (active) return;
        hapticTap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        className={`${small ? "text-xs" : "text-[13px]"} ${
          active ? "font-bold text-slate-900 dark:text-slate-50" : "font-medium text-slate-500 dark:text-slate-400"
        }`}
        style={TABULAR}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Empty({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  return (
    <View className="items-center px-6 py-12">
      <Ionicons name={icon} size={30} color="#94a3b8" />
      <Text className="mt-2 text-center text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</Text>
      <Text className="mt-1 text-center text-xs leading-[18px] text-slate-400 dark:text-slate-500">{text}</Text>
    </View>
  );
}

function GoodsRow({ line, index, bySku }: { line: BatchLine; index: number; bySku: boolean }) {
  const title = bySku && line.sku ? line.sku : line.name;
  // Dòng phụ: theo SKU → tên sản phẩm; theo sản phẩm → mã SKU, hoặc "N SKU" khi có nhiều phân loại.
  const sub = bySku
    ? line.sku
      ? line.name
      : "Không có mã SKU"
    : line.skuCount > 1
      ? `${line.skuCount} SKU`
      : (line.sku ?? "Không có mã SKU");
  return (
    <View className="flex-row items-center gap-2.5 border-b border-slate-100 py-2.5 dark:border-slate-800">
      <Text className="w-6 text-center text-xs font-bold text-slate-400 dark:text-slate-500" style={TABULAR}>
        {index + 1}
      </Text>
      <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
        {line.imageUrl ? (
          <Image source={{ uri: line.imageUrl }} style={{ width: 40, height: 40 }} contentFit="cover" />
        ) : (
          <Ionicons name="cube-outline" size={16} color="#94a3b8" />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[13px] font-semibold text-slate-800 dark:text-slate-200" numberOfLines={2}>
          {title}
        </Text>
        <Text className="text-[10px] text-slate-400 dark:text-slate-500" numberOfLines={1} style={TABULAR}>
          {sub} · {groupVN(line.orders)} đơn
        </Text>
      </View>
      <Text
        className="min-w-[44px] text-right text-lg font-bold text-slate-900 dark:text-slate-100"
        style={TABULAR}
      >
        ×{groupVN(line.qty)}
      </Text>
    </View>
  );
}

function ParcelRow({
  entry,
  copied,
  onCopy,
  onRemove,
}: {
  entry: BatchEntry;
  copied: boolean;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const o = entry.order;
  const cancelled = isCancelled(o);
  const badge = orderStatusBadge(o);
  const qty = o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  return (
    <View
      className={`mb-2 flex-row items-center gap-2 rounded-2xl border px-3 py-2.5 ${
        cancelled
          ? "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"
          : "border-slate-100 dark:border-slate-800"
      }`}
    >
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="min-w-0 shrink text-sm font-bold text-slate-900 dark:text-slate-100"
            style={TABULAR}
            numberOfLines={1}
            selectable
          >
            {o.orderCode}
          </Text>
          <Badge label={badge.label} bg={badge.bg} text={badge.text} />
        </View>
        <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1} style={TABULAR}>
          {o.channel.shopName} · {carrierLabelOf(o)}
          {qty > 0 ? ` · ${groupVN(qty)} món` : ""}
        </Text>
        {cancelled ? (
          <Text className="mt-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
            Rút kiện này ra — không giao
          </Text>
        ) : o.cancelRequestedAt ? (
          <Text className="mt-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            Khách đang xin hủy — để riêng
          </Text>
        ) : null}
      </View>
      <Pressable
        className="h-9 w-9 items-center justify-center rounded-full bg-slate-100 active:opacity-60 dark:bg-slate-800"
        onPress={onCopy}
        accessibilityRole="button"
        accessibilityLabel={`Sao chép mã đơn ${o.orderCode}`}
      >
        <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color={copied ? "#059669" : "#64748b"} />
      </Pressable>
      <Pressable
        className="h-9 w-9 items-center justify-center rounded-full bg-slate-100 active:opacity-60 dark:bg-slate-800"
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Bỏ kiện ${o.orderCode} khỏi lô`}
      >
        <Ionicons name="close" size={17} color="#64748b" />
      </Pressable>
    </View>
  );
}
