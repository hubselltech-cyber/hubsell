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
import type { OrderDto, ShippingStatus } from "@/types/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CHANNEL_LABEL, RETURN_STATUS, SHIPPING_STATUS } from "@/lib/labels";
import { Badge } from "@/components/Badge";

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef({ search: "", status: "" as "" | ShippingStatus });

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
      const { search: s, status: st } = queryRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const res = await fetchOrders({
          page: nextPage,
          search: s || undefined,
          shippingStatus: st || undefined,
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
    void load(1, false);
  }, [status, load]);

  const onSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      queryRef.current.search = text.trim();
      void load(1, false);
    }, 450);
  };

  const renderOrder = ({ item }: { item: OrderDto }) => {
    const ship = SHIPPING_STATUS[item.shippingStatus];
    const ret = item.returnStatus !== "NONE" ? RETURN_STATUS[item.returnStatus] : null;
    const firstImage = item.items.find((i) => i.product?.imageUrl)?.product
      ?.imageUrl;
    return (
      <View
        className="mb-2.5 flex-row gap-3 rounded-2xl bg-white p-3"
        style={{ elevation: 1 }}
      >
        <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
          {firstImage ? (
            <Image
              source={{ uri: firstImage }}
              style={{ width: 56, height: 56 }}
              contentFit="cover"
            />
          ) : (
            <Ionicons name="cube-outline" size={22} color="#94a3b8" />
          )}
        </View>
        <View className="flex-1">
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 pr-2 text-[13px] font-semibold text-slate-900" numberOfLines={1}>
              {item.orderCode}
            </Text>
            <Badge label={ship.label} bg={ship.bg} text={ship.text} />
          </View>
          <Text className="mt-0.5 text-xs text-slate-500" numberOfLines={1}>
            {item.customerName} · {item.itemCount || item.items.length} SP
          </Text>
          <View className="mt-1 flex-row items-center justify-between">
            <Text className="text-[11px] text-slate-400">
              {CHANNEL_LABEL[item.channel.channelName] ?? item.channel.channelName}
              {" · "}
              {formatDateTime(item.createdAt)}
            </Text>
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
