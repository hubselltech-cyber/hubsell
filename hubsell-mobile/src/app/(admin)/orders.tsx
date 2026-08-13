import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import { fetchOrders } from "@/api/orders";
import { ApiError } from "@/api/client";
import type { OrderDto, OrderItemDto, ShippingStatus } from "@/types/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import {
  CARRIER_LABEL,
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

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"" | ShippingStatus>("");
  const [channel, setChannel] = useState<ChannelFilter>("");
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
  });

  // Thẻ đếm trạng thái ở trang Tổng quan đẩy sang đây kèm ?status= để mở
  // đúng tab lọc — đổi param là đổi tab, kể cả khi màn này đã mount sẵn.
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  useEffect(() => {
    if (typeof statusParam !== "string") return;
    if (STATUS_TABS.some((t) => t.key === statusParam)) {
      setStatus(statusParam as ShippingStatus);
    }
  }, [statusParam]);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      const { search: s, status: st, channel: ch } = queryRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const res = await fetchOrders({
          page: nextPage,
          search: s || undefined,
          shippingStatus: st || undefined,
          channelName: ch || undefined,
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
    void load(1, false);
  }, [status, channel, load]);

  const onSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      queryRef.current.search = text.trim();
      void load(1, false);
    }, 450);
  };

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

      {/* Bộ lọc sàn — đứng trên hàng tab trạng thái, số đếm tab lọc theo sàn */}
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

      <View className="mb-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {STATUS_TABS.map((t) => {
            const active = status === t.key;
            const count = t.key === "" ? counts.ALL : counts[t.key];
            return (
              <Pressable
                key={t.key || "ALL"}
                className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${
                  active ? "bg-slate-900" : "bg-white border border-slate-200"
                }`}
                onPress={() => setStatus(t.key)}
              >
                <Text
                  className={`text-xs font-semibold ${
                    active ? "text-white" : "text-slate-600"
                  }`}
                >
                  {t.label}
                </Text>
                {count ? (
                  <Text
                    className={`text-[10px] ${active ? "text-slate-300" : "text-slate-400"}`}
                  >
                    {count}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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
    </View>
  );
}
