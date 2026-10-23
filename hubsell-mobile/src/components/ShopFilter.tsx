import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CHANNEL_LABEL as CHANNEL_LABEL_TYPED } from "@/lib/labels";

/** Nhãn sàn tra bằng chuỗi bất kỳ (ChannelListItem.channelName là enum, AdsPage truyền string). */
const CHANNEL_LABEL: Record<string, string> = CHANNEL_LABEL_TYPED;
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { useChannelColors } from "@/theme/channel-colors";
import { PickChip } from "@/components/FilterChips";

/**
 * BỘ LỌC GIAN HÀNG của app (anh Trung 23/10/2026): khách nhiều gian nên KHÔNG
 * bày hết chip ra màn — một ô hiện phạm vi đang xem, bấm mở HỘP TRƯỢT LÊN
 * chọn sàn + gian. Hai cách dùng:
 *   · mode "scope" (Tài chính): chọn "Tất cả sàn" / cả một sàn / đúng một gian.
 *   · mode "single" (Quảng cáo): sàn đã cố định ở chip ngoài, chỉ chọn MỘT gian
 *     (API quảng cáo luôn tính theo từng gian).
 * Chạm một dòng là chọn xong và đóng — không có nút Áp dụng vì chỉ một giá trị.
 * Quá 6 gian thì có ô tìm theo tên.
 */
export interface ShopOption {
  id: string;
  shopName: string;
  channelName: string;
  /** "DISCONNECTED" → ghi chú "Đã ngắt", vẫn chọn được để xem số cũ. */
  status?: string;
}

export interface ShopScope {
  /** "" = mọi sàn. */
  channelName: string;
  /** "" = mọi gian của sàn đang chọn. */
  channelId: string;
}

const CHANNEL_ORDER = ["SHOPEE", "TIKTOK", "LAZADA"];
const SEARCH_FROM = 7;

function channelOptions(all: ShopOption[]) {
  const present = new Set(all.map((c) => c.channelName));
  return [
    { key: "", label: "Tất cả sàn" },
    ...CHANNEL_ORDER.filter((k) => present.has(k)).map((k) => ({ key: k, label: CHANNEL_LABEL[k] ?? k })),
  ];
}

export function ShopFilterField({
  mode,
  channels,
  value,
  onChange,
  className = "",
  compact = false,
}: {
  mode: "scope" | "single";
  channels: ShopOption[];
  value: ShopScope;
  onChange: (next: ShopScope) => void;
  className?: string;
  /** Ô chia đôi hàng với bộ lọc ngày (anh chốt 23/10): nhãn ngắn "Tất cả" / tên sàn / tên shop, không đếm gian. */
  compact?: boolean;
}) {
  const colors = useChannelColors();
  const [open, setOpen] = useState(false);
  const selected = value.channelId ? channels.find((c) => c.id === value.channelId) : undefined;

  // Nhãn trên ô: "Shopee · ANO Official Store" / "Tất cả gian Shopee" / "Tất cả sàn · 12 gian".
  let label: string;
  let dotColor: string | null = null;
  if (selected) {
    label = selected.shopName;
    dotColor = colors[selected.channelName] ?? "#94a3b8";
  } else if (mode === "single") {
    label = channels.length === 0 ? "Chưa có gian hàng" : "Chọn gian hàng";
  } else if (value.channelName) {
    const n = channels.filter((c) => c.channelName === value.channelName).length;
    const name = CHANNEL_LABEL[value.channelName] ?? value.channelName;
    label = compact ? name : `Tất cả gian ${name}${n > 0 ? ` · ${n}` : ""}`;
    dotColor = colors[value.channelName] ?? "#94a3b8";
  } else {
    label = compact ? "Tất cả" : channels.length > 0 ? `Tất cả sàn · ${channels.length} gian hàng` : "Tất cả sàn";
  }

  return (
    <>
      <Pressable
        className={`flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 active:opacity-70 dark:border-slate-700 dark:bg-slate-900 ${className}`}
        onPress={() => {
          hapticTap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Gian hàng đang xem: ${label}. Bấm để đổi`}
      >
        {dotColor ? (
          <View className="h-4 w-4 items-center justify-center">
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
          </View>
        ) : (
          <Ionicons name="storefront-outline" size={16} color="#64748b" />
        )}
        <Text
          className="flex-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100"
          numberOfLines={1}
        >
          {label}
        </Text>
        {selected && mode === "scope" && !compact ? (
          <Text className="text-[11px] text-slate-400 dark:text-slate-500">
            {CHANNEL_LABEL[selected.channelName] ?? selected.channelName}
          </Text>
        ) : null}
        <Ionicons name="chevron-down" size={14} color="#94a3b8" />
      </Pressable>
      <ShopFilterSheet
        visible={open}
        mode={mode}
        channels={channels}
        value={value}
        onClose={() => setOpen(false)}
        onPick={(next) => {
          setOpen(false);
          onChange(next);
        }}
      />
    </>
  );
}

function ShopFilterSheet({
  visible,
  mode,
  channels,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  mode: "scope" | "single";
  channels: ShopOption[];
  value: ShopScope;
  onClose: () => void;
  onPick: (next: ShopScope) => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useChannelColors();
  // Sàn đang lọc trong hộp — đổi sàn chỉ lọc danh sách, chưa đóng hộp.
  const [channelName, setChannelName] = useState(value.channelName);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (visible) {
      setChannelName(value.channelName);
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const options = useMemo(() => channelOptions(channels), [channels]);
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = channels
      .filter((c) => !channelName || c.channelName === channelName)
      .filter((c) => !q || c.shopName.toLowerCase().includes(q));
    // Sàn lạ (OFFLINE…) xếp cuối, không chen lên đầu.
    const rank = (k: string) => (CHANNEL_ORDER.includes(k) ? CHANNEL_ORDER.indexOf(k) : 99);
    return list.sort(
      (a, b) => rank(a.channelName) - rank(b.channelName) || a.shopName.localeCompare(b.shopName, "vi")
    );
  }, [channels, channelName, q]);

  const allLabel = channelName
    ? `Tất cả gian ${CHANNEL_LABEL[channelName] ?? channelName}`
    : "Tất cả sàn, tất cả gian hàng";
  const allActive = !value.channelId && value.channelName === channelName;

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="max-h-[80%] rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 12 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
              {mode === "single" ? "Chọn gian hàng" : "Gian hàng"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Đóng">
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>

          {mode === "scope" ? (
            <View className="mb-2 flex-row flex-wrap gap-1.5">
              {options.map((o) => (
                <PickChip
                  key={o.key || "ALL"}
                  label={o.label}
                  active={channelName === o.key}
                  onPress={() => {
                    if (channelName !== o.key) hapticSelect();
                    setChannelName(o.key);
                  }}
                />
              ))}
            </View>
          ) : null}

          {channels.length >= SEARCH_FROM ? (
            <View className="mb-2 flex-row items-center gap-2 rounded-xl bg-slate-100 px-3 dark:bg-slate-800">
              <Ionicons name="search" size={15} color="#94a3b8" />
              <TextInput
                className="flex-1 py-2 text-sm text-slate-900 dark:text-slate-100"
                style={{ fontSize: 14 }}
                placeholder="Tìm tên gian hàng"
                placeholderTextColor="#94a3b8"
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                returnKeyType="search"
              />
              {search ? (
                <Pressable onPress={() => setSearch("")} hitSlop={6}>
                  <Ionicons name="close-circle" size={16} color="#94a3b8" />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {mode === "scope" && !q ? (
              <Row
                label={allLabel}
                sub={`${channels.filter((c) => !channelName || c.channelName === channelName).length} gian hàng`}
                dot={channelName ? (colors[channelName] ?? "#94a3b8") : null}
                icon={channelName ? undefined : "storefront-outline"}
                active={allActive}
                onPress={() => {
                  hapticSelect();
                  onPick({ channelName, channelId: "" });
                }}
              />
            ) : null}
            {rows.map((c) => (
              <Row
                key={c.id}
                label={c.shopName}
                sub={`${CHANNEL_LABEL[c.channelName] ?? c.channelName}${c.status === "DISCONNECTED" ? " · Đã ngắt" : ""}`}
                dot={colors[c.channelName] ?? "#94a3b8"}
                active={value.channelId === c.id}
                onPress={() => {
                  hapticSelect();
                  onPick({ channelName: c.channelName, channelId: c.id });
                }}
              />
            ))}
            {rows.length === 0 ? (
              <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                {q ? "Không có gian nào khớp" : "Chưa có gian hàng trên sàn này"}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  label,
  sub,
  dot,
  icon,
  active,
  onPress,
}: {
  label: string;
  sub?: string;
  dot: string | null;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`flex-row items-center gap-3 rounded-xl px-2 py-2.5 active:opacity-70 ${
        active ? "bg-emerald-50 dark:bg-emerald-500/15" : ""
      }`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        {icon ? (
          <Ionicons name={icon} size={16} color="#64748b" />
        ) : (
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: dot ?? "#94a3b8" }} />
        )}
      </View>
      <View className="flex-1">
        <Text
          className={`text-sm ${active ? "font-semibold text-emerald-700 dark:text-emerald-300" : "font-medium text-slate-900 dark:text-slate-100"}`}
          numberOfLines={1}
        >
          {label}
        </Text>
        {sub ? (
          <Text className="text-[11px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {active ? <Ionicons name="checkmark-circle" size={20} color="#10b981" /> : null}
    </Pressable>
  );
}
