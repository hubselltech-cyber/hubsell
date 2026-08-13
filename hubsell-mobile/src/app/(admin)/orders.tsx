import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Image } from "expo-image";
import { fetchOrders, fetchOrderStats, type OrdersFilter } from "@/api/orders";
import { fetchChannels } from "@/api/channels";
import { ApiError } from "@/api/client";
import type {
  ChannelListItem,
  OrderDto,
  OrderItemDto,
  OrderStatsResponse,
  ShippingStatus,
} from "@/types/api";
import { compactMoney, formatDateTime, formatMoney } from "@/lib/format";
import {
  CARRIER_LABEL,
  CARRIER_SHORT,
  CHANNEL_LABEL,
  RETURN_STATUS,
  SHIPPING_STATUS,
} from "@/lib/labels";
import { CHANNEL_COLOR } from "@/components/ChannelDonut";
import { Badge } from "@/components/Badge";

/** Số dòng hàng hiện sẵn trên card — đơn dài hơn thì bấm "Xem thêm". */
const ITEMS_PREVIEW = 2;

// Bộ lọc sàn — cùng thứ tự với tab Tin nhắn / trang Kho (chốt 13/08)
const CHANNEL_FILTERS = ["", "SHOPEE", "TIKTOK", "LAZADA"] as const;
type ChannelFilter = (typeof CHANNEL_FILTERS)[number];

const STATUS_TABS: { key: "" | ShippingStatus; label: string }[] = [
  { key: "", label: "Tất cả" },
  { key: "PENDING", label: "Chờ xử lý" },
  { key: "PROCESSED", label: "Đã xử lý" },
  { key: "SHIPPING", label: "Đang giao" },
  { key: "DELIVERED", label: "Đã giao" },
  { key: "CANCELLED", label: "Hủy/Hoàn" },
];

const CARRIER_KEYS = Object.keys(CARRIER_SHORT);

/** Bộ giá trị của panel Bộ lọc — trạng thái + hãng VC + gian hàng. */
interface FilterValue {
  status: "" | ShippingStatus;
  carrier: string;
  shopId: string;
}

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"" | ShippingStatus>("");
  const [carrier, setCarrier] = useState("");
  const [shopId, setShopId] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("");
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef({
    search: "",
    status: "" as "" | ShippingStatus,
    channel: "" as ChannelFilter,
    carrier: "",
    shopId: "",
  });

  // Thẻ đếm trạng thái ở trang Tổng quan đẩy sang đây kèm ?status= để mở
  // đúng bộ lọc — đổi param là đổi lọc, kể cả khi màn này đã mount sẵn.
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  useEffect(() => {
    if (typeof statusParam !== "string") return;
    if (STATUS_TABS.some((t) => t.key === statusParam)) {
      setStatus(statusParam as ShippingStatus);
    }
  }, [statusParam]);

  // DS gian hàng cho mục "Lọc theo shop" — đổi rất hiếm, nạp 1 lần là đủ
  useEffect(() => {
    fetchChannels()
      .then(setChannels)
      .catch(() => {}); // lỗi thì panel đơn giản là không có mục shop
  }, []);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      const q = queryRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const res = await fetchOrders({
          page: nextPage,
          search: q.search || undefined,
          shippingStatus: q.status || undefined,
          channelName: q.channel || undefined,
          carrier: q.carrier || undefined,
          channelId: q.shopId || undefined,
        });
        setOrders((prev) => (append ? [...prev, ...res.items] : res.items));
        setCounts(res.counts);
        setPage(res.page);
        setPageCount(res.pageCount);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    queryRef.current.status = status;
    queryRef.current.channel = channel;
    queryRef.current.carrier = carrier;
    queryRef.current.shopId = shopId;
    void load(1, false);
  }, [status, channel, carrier, shopId, load]);

  const onSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      queryRef.current.search = text.trim();
      void load(1, false);
    }, 450);
  };

  /** Bộ lọc hiện hành — truyền nguyên cho màn Thống kê để cùng phạm vi. */
  const currentFilter: OrdersFilter = {
    search: search.trim() || undefined,
    shippingStatus: status || undefined,
    channelName: channel || undefined,
    carrier: carrier || undefined,
    channelId: shopId || undefined,
  };
  const activeFilterCount =
    (status ? 1 : 0) + (carrier ? 1 : 0) + (shopId ? 1 : 0);

  // Đơn đang MỞ RỘNG danh sách sản phẩm (mặc định chỉ hiện ITEMS_PREVIEW dòng)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderItemRow = (it: OrderItemDto) => {
    const img = it.imageUrl ?? it.product?.imageUrl ?? null;
    return (
      <View key={it.id} className="mt-2 flex-row items-center gap-2.5">
        <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
          {img ? (
            <Image
              source={{ uri: img }}
              style={{ width: 40, height: 40 }}
              contentFit="cover"
            />
          ) : (
            <Ionicons name="cube-outline" size={16} color="#94a3b8" />
          )}
        </View>
        <View className="flex-1">
          <Text className="text-xs text-slate-800" numberOfLines={1}>
            {it.productName}
          </Text>
          {it.channelSku ? (
            <Text className="text-[10px] text-slate-400" numberOfLines={1}>
              {it.channelSku}
            </Text>
          ) : null}
        </View>
        <Text className="text-xs font-semibold text-slate-500">
          x{it.quantity}
        </Text>
      </View>
    );
  };

  const renderOrder = ({ item }: { item: OrderDto }) => {
    const ship = SHIPPING_STATUS[item.shippingStatus];
    const ret = item.returnStatus !== "NONE" ? RETURN_STATUS[item.returnStatus] : null;
    const isExpanded = expanded.has(item.id);
    const visibleItems = isExpanded
      ? item.items
      : item.items.slice(0, ITEMS_PREVIEW);
    const hiddenCount = item.items.length - ITEMS_PREVIEW;
    return (
      <View className="mb-2.5 rounded-2xl bg-white p-3" style={{ elevation: 1 }}>
        <View className="flex-row items-center justify-between">
          <Text
            className="flex-1 pr-2 text-[13px] font-semibold text-slate-900"
            numberOfLines={1}
          >
            {item.orderCode}
          </Text>
          <Badge label={ship.label} bg={ship.bg} text={ship.text} />
        </View>
        {/* Tên SHOP thay nhãn sàn (anh Trung chốt 13/08) — nhà nhiều gian
            nhìn phát biết đơn của DarkMan hay Hi.Bé; sàn đã có chip lọc. */}
        <Text className="mt-0.5 text-[11px] text-slate-500" numberOfLines={1}>
          {item.customerName}
          {" · "}
          {item.channel.shopName}
          {" · "}
          {formatDateTime(item.createdAt)}
        </Text>

        {visibleItems.map(renderItemRow)}
        {hiddenCount > 0 ? (
          <Pressable
            className="mt-1.5 flex-row items-center justify-center gap-1 rounded-lg py-1.5 active:bg-slate-50"
            onPress={() => toggleExpand(item.id)}
            hitSlop={4}
          >
            <Text className="text-[11px] font-semibold text-sky-600">
              {isExpanded ? "Thu gọn" : `Xem thêm ${hiddenCount} sản phẩm`}
            </Text>
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={12}
              color="#0284c7"
            />
          </Pressable>
        ) : null}

        {/* Chân card: hãng vận chuyển + mã vận đơn | tổng tiền */}
        <View className="mt-2.5 flex-row items-center justify-between border-t border-slate-100 pt-2">
          <View className="flex-1 flex-row items-center gap-1.5 pr-2">
            <Ionicons name="car-outline" size={13} color="#64748b" />
            <Text className="flex-1 text-[11px] text-slate-500" numberOfLines={1}>
              {item.carrier
                ? (CARRIER_LABEL[item.carrier] ?? item.carrier)
                : "Chưa gán hãng vận chuyển"}
              {item.trackingCode ? ` · ${item.trackingCode}` : ""}
            </Text>
          </View>
          <Text className="text-[13px] font-bold text-slate-900">
            {formatMoney(item.totalAmount)}
          </Text>
        </View>
        {ret ? (
          <View className="mt-1.5 flex-row">
            <Badge label={ret.label} bg={ret.bg} text={ret.text} />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-slate-50" style={{ paddingTop: insets.top + 16 }}>
      <View className="mb-3 flex-row items-center justify-between px-4">
        <View>
          <Text className="text-2xl font-bold text-slate-900">Đơn hàng</Text>
          <Text className="text-xs text-slate-500">{counts.ALL ?? 0} đơn</Text>
        </View>
        {/* Lối tắt cho chủ shop tự quét thử luồng kho */}
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-xl bg-slate-900 active:opacity-80"
          onPress={() => router.push("/(warehouse)/scan" as Href)}
        >
          <Ionicons name="scan-outline" size={18} color="#fff" />
        </Pressable>
      </View>

      <View className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-slate-200 bg-white px-3">
        <Ionicons name="search-outline" size={16} color="#94a3b8" />
        <TextInput
          className="flex-1 px-2 py-2.5 text-sm text-slate-900"
          placeholder="Mã đơn, tên khách, SĐT, mã vận đơn…"
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={onSearch}
          autoCapitalize="none"
        />
      </View>

      {/* Bộ lọc sàn — số đếm trạng thái trong panel lọc cũng lọc theo sàn */}
      <View className="mb-2 flex-row gap-2 px-4">
        {CHANNEL_FILTERS.map((ch) => {
          const active = channel === ch;
          return (
            <Pressable
              key={ch || "ALL"}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full px-2 py-1.5 ${
                active ? "bg-slate-900" : "bg-white border border-slate-200"
              }`}
              onPress={() => setChannel(ch)}
            >
              {ch ? (
                <View
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: CHANNEL_COLOR[ch] }}
                />
              ) : null}
              <Text
                className={`text-xs font-semibold ${
                  active ? "text-white" : "text-slate-600"
                }`}
              >
                {ch ? CHANNEL_LABEL[ch] : "Tất cả"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Hai nút thay dãy tab trạng thái cũ: Bộ lọc (gom trạng thái + hãng
          VC + shop, học Salework) và Thống kê SP/SKU trong phạm vi đang lọc */}
      <View className="mb-2 flex-row gap-2 px-4">
        <Pressable
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 active:bg-slate-50"
          onPress={() => setFilterOpen(true)}
        >
          <Ionicons name="funnel-outline" size={14} color="#0f172a" />
          <Text className="text-xs font-semibold text-slate-800">Bộ lọc</Text>
          {activeFilterCount > 0 ? (
            <View className="min-w-[16px] items-center rounded-full bg-slate-900 px-1">
              <Text className="text-[10px] font-bold text-white">
                {activeFilterCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 active:bg-slate-50"
          onPress={() => setStatsOpen(true)}
        >
          <Ionicons name="bar-chart-outline" size={14} color="#0f172a" />
          <Text className="text-xs font-semibold text-slate-800">Thống kê</Text>
        </Pressable>
      </View>

      {/* Tóm tắt bộ lọc đang bật — bấm ✕ trên chip là gỡ ngay khỏi cần mở panel */}
      {activeFilterCount > 0 ? (
        <View className="mb-2 flex-row flex-wrap gap-1.5 px-4">
          {status ? (
            <ActiveChip
              label={SHIPPING_STATUS[status].label}
              onClear={() => setStatus("")}
            />
          ) : null}
          {carrier ? (
            <ActiveChip
              label={CARRIER_SHORT[carrier] ?? carrier}
              onClear={() => setCarrier("")}
            />
          ) : null}
          {shopId ? (
            <ActiveChip
              label={channels.find((c) => c.id === shopId)?.shopName ?? "Shop"}
              onClear={() => setShopId("")}
            />
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : error ? (
        <Text className="px-6 py-10 text-center text-sm text-red-500">{error}</Text>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderOrder}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!loadingMore && page < pageCount) void load(page + 1, true);
          }}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator className="py-4" color="#0f172a" />
            ) : null
          }
          ListEmptyComponent={
            <Text className="py-10 text-center text-sm text-slate-400">
              Không có đơn nào khớp bộ lọc
            </Text>
          }
        />
      )}

      <FilterSheet
        visible={filterOpen}
        counts={counts}
        channels={channels}
        value={{ status, carrier, shopId }}
        onClose={() => setFilterOpen(false)}
        onApply={(v) => {
          setStatus(v.status);
          setCarrier(v.carrier);
          setShopId(v.shopId);
          setFilterOpen(false);
        }}
      />
      <StatsSheet
        visible={statsOpen}
        filter={currentFilter}
        onClose={() => setStatsOpen(false)}
      />
    </View>
  );
}

/** Chip bộ lọc đang bật kèm nút gỡ nhanh. */
function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Pressable
      className="flex-row items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 active:opacity-80"
      onPress={onClear}
      hitSlop={4}
    >
      <Text className="text-[11px] font-semibold text-white">{label}</Text>
      <Ionicons name="close" size={11} color="#cbd5e1" />
    </Pressable>
  );
}

/** Chip chọn MỘT giá trị trong panel lọc. */
function PickChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${
        active ? "bg-slate-900" : "bg-slate-100"
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-xs font-semibold ${active ? "text-white" : "text-slate-600"}`}
      >
        {label}
      </Text>
      {count !== undefined && count > 0 ? (
        <Text className={`text-[10px] ${active ? "text-slate-300" : "text-slate-400"}`}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ============================================================
// Panel BỘ LỌC — trạng thái đơn + hãng vận chuyển + gian hàng
// ============================================================
function FilterSheet({
  visible,
  counts,
  channels,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  counts: Record<string, number>;
  channels: ChannelListItem[];
  value: FilterValue;
  onClose: () => void;
  onApply: (v: FilterValue) => void;
}) {
  // Nháp trong panel — bấm Áp dụng mới đổ ra ngoài, đóng ngang thì bỏ
  const [draft, setDraft] = useState<FilterValue>(value);
  useEffect(() => {
    if (visible) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="max-h-[85%] rounded-t-3xl bg-white px-4 pb-6 pt-3">
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200" />
          </View>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900">Bộ lọc</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="mb-1.5 text-xs font-semibold text-slate-500">
              Trạng thái đơn
            </Text>
            <View className="mb-3 flex-row flex-wrap gap-1.5">
              {STATUS_TABS.map((t) => (
                <PickChip
                  key={t.key || "ALL"}
                  label={t.label}
                  count={t.key === "" ? counts.ALL : counts[t.key]}
                  active={draft.status === t.key}
                  onPress={() => setDraft((d) => ({ ...d, status: t.key }))}
                />
              ))}
            </View>

            <Text className="mb-1.5 text-xs font-semibold text-slate-500">
              Đơn vị vận chuyển
            </Text>
            <View className="mb-3 flex-row flex-wrap gap-1.5">
              <PickChip
                label="Tất cả"
                active={draft.carrier === ""}
                onPress={() => setDraft((d) => ({ ...d, carrier: "" }))}
              />
              {CARRIER_KEYS.map((c) => (
                <PickChip
                  key={c}
                  label={CARRIER_SHORT[c]}
                  active={draft.carrier === c}
                  onPress={() => setDraft((d) => ({ ...d, carrier: c }))}
                />
              ))}
            </View>

            {channels.length > 0 ? (
              <>
                <Text className="mb-1.5 text-xs font-semibold text-slate-500">
                  Gian hàng
                </Text>
                <View className="mb-3 flex-row flex-wrap gap-1.5">
                  <PickChip
                    label="Tất cả"
                    active={draft.shopId === ""}
                    onPress={() => setDraft((d) => ({ ...d, shopId: "" }))}
                  />
                  {channels.map((c) => (
                    <PickChip
                      key={c.id}
                      label={`${c.shopName} · ${CHANNEL_LABEL[c.channelName] ?? c.channelName}`}
                      active={draft.shopId === c.id}
                      onPress={() => setDraft((d) => ({ ...d, shopId: c.id }))}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>

          <View className="mt-2 flex-row gap-2">
            <Pressable
              className="flex-1 items-center rounded-xl bg-slate-100 py-3 active:opacity-80"
              onPress={() => setDraft({ status: "", carrier: "", shopId: "" })}
            >
              <Text className="text-sm font-semibold text-slate-600">Bỏ lọc</Text>
            </Pressable>
            <Pressable
              className="flex-1 items-center rounded-xl bg-slate-900 py-3 active:opacity-80"
              onPress={() => onApply(draft)}
            >
              <Text className="text-sm font-semibold text-white">Áp dụng</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================
// Panel THỐNG KÊ — top sản phẩm / SKU bán ra trong phạm vi đang lọc
// ============================================================
function StatsSheet({
  visible,
  filter,
  onClose,
}: {
  visible: boolean;
  filter: OrdersFilter;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"product" | "sku">("product");
  const [data, setData] = useState<OrderStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError("");
    fetchOrderStats(filter)
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra")
      )
      .finally(() => setLoading(false));
    // filter dựng mới mỗi render — chỉ nạp lại khi MỞ panel là đủ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const rows = mode === "product" ? (data?.byProduct ?? []) : (data?.bySku ?? []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="h-[75%] rounded-t-3xl bg-white px-4 pb-6 pt-3">
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200" />
          </View>
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900">Thống kê bán ra</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>
          <Text className="mb-2 text-[11px] text-slate-400">
            {data?.days ?? 30} ngày gần nhất · theo bộ lọc đang chọn
          </Text>

          <View className="mb-3 flex-row gap-2">
            <PickChip
              label="Theo sản phẩm"
              active={mode === "product"}
              onPress={() => setMode("product")}
            />
            <PickChip
              label="Theo SKU"
              active={mode === "sku"}
              onPress={() => setMode("sku")}
            />
          </View>

          {loading ? (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#0f172a" />
            </View>
          ) : error ? (
            <Text className="py-10 text-center text-sm text-red-500">{error}</Text>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(r, i) => `${r.sku ?? r.name}-${i}`}
              ListEmptyComponent={
                <Text className="py-10 text-center text-sm text-slate-400">
                  Không có dữ liệu trong phạm vi này
                </Text>
              }
              renderItem={({ item, index }) => (
                <View className="flex-row items-center gap-2.5 border-b border-slate-100 py-2.5">
                  <Text className="w-6 text-center text-xs font-bold text-slate-400">
                    {index + 1}
                  </Text>
                  <View className="flex-1">
                    <Text className="text-xs text-slate-800" numberOfLines={2}>
                      {mode === "sku" && item.sku ? item.sku : item.name}
                    </Text>
                    <Text className="text-[10px] text-slate-400" numberOfLines={1}>
                      {mode === "sku" ? item.name + " · " : ""}
                      {item.orders} đơn
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs font-bold text-slate-900">
                      {item.qty} sp
                    </Text>
                    <Text className="text-[10px] text-emerald-600">
                      {compactMoney(item.revenue)}
                    </Text>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
