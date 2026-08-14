import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { Image } from "expo-image";
import { fetchReturns } from "@/api/warehouse";
import { ApiError } from "@/api/client";
import type { ReturnOrderDto, ReturnsSummaryResponse } from "@/types/api";
import { RETURN_STATUS, CHANNEL_LABEL } from "@/lib/labels";
import { CHANNEL_COLOR } from "@/components/ChannelDonut";
import { Badge } from "@/components/Badge";
import { SegmentedTabs } from "@/components/SegmentedTabs";

// Bộ lọc sàn — cùng thứ tự với tab Tin nhắn (chốt 13/08)
const CHANNEL_FILTERS = ["", "SHOPEE", "TIKTOK", "LAZADA"] as const;
type ChannelFilter = (typeof CHANNEL_FILTERS)[number];

// 2 tab theo tiêu chí "hàng đã về tay hay chưa" (chốt 14/08):
// AWAITING = chưa quét; SCANNED = backend gộp mọi trạng thái sau khi quét nhận
const RETURN_TABS = [
  { key: "AWAITING", label: "Chờ nhận hoàn" },
  { key: "SCANNED", label: "Đã nhận hoàn" },
] as const;
type ReturnTab = (typeof RETURN_TABS)[number]["key"];

// Trạng thái đã xong việc — không còn chờ gì nên ẩn đồng hồ "chờ X ngày"
const DONE_STATUSES = new Set(["RECEIVED_INTACT", "CLAIM_SETTLED", "WRITTEN_OFF"]);

/**
 * Trang KHO — trang 3 của pager Trang chủ (chủ shop).
 * Số liệu đơn hoàn + nút mở camera + Ô TÌM KIẾM + DANH SÁCH đơn hoàn
 * (đơn chờ lâu nhất lên đầu — backend sắp sẵn). Nhập kho hàng loạt vẫn trên web.
 */
export function WarehouseHubPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<ReturnsSummaryResponse["summary"] | null>(null);
  const [items, setItems] = useState<ReturnOrderDto[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("");
  const [tab, setTab] = useState<ReturnTab>("AWAITING");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef("");
  const channelRef = useRef<ChannelFilter>("");
  const tabRef = useRef<ReturnTab>("AWAITING");

  const load = useCallback(
    async (nextPage: number, append: boolean, asRefresh = false) => {
      if (append) setLoadingMore(true);
      else if (asRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const res = await fetchReturns({
          page: nextPage,
          pageSize: 20,
          search: searchRef.current || undefined,
          channelName: channelRef.current || undefined,
          status: tabRef.current,
        });
        setSummary(res.summary);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setPage(res.page);
        setPageCount(res.pageCount);
        setTotal(res.total);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Có lỗi xảy ra, kéo xuống thử lại"
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    channelRef.current = channel;
    tabRef.current = tab;
    void load(1, false);
  }, [channel, tab, load]);

  const onSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchRef.current = text.trim();
      void load(1, false);
    }, 450);
  };

  const tiles = [
    { label: "Chờ về kho", value: summary?.AWAITING ?? 0, color: "text-amber-600", icon: "time-outline" as const },
    { label: "Chờ nhập kho", value: summary?.RECEIVED ?? 0, color: "text-sky-600", icon: "archive-outline" as const },
    { label: "Quá hạn ≥14 ngày", value: summary?.overdue ?? 0, color: "text-red-500", icon: "alert-circle-outline" as const },
    { label: "Hàng hỏng chờ khiếu nại", value: summary?.DAMAGED ?? 0, color: "text-red-500", icon: "bandage-outline" as const },
  ];

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(1, false, true)} />
      }
    >
      {loading && !summary ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : (
        <>
          {/* Bộ lọc sàn — áp cho CẢ thẻ đếm lẫn danh sách (backend lọc chung) */}
          <View className="mb-3 flex-row gap-2">
            {CHANNEL_FILTERS.map((ch) => {
              const active = channel === ch;
              return (
                <Pressable
                  key={ch || "ALL"}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full px-2 py-2 ${
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

          <View className="mb-3 flex-row flex-wrap gap-2">
            {tiles.map((t) => (
              <View
                key={t.label}
                className="w-[48%] flex-grow rounded-2xl bg-white p-4"
                style={{ elevation: 1 }}
              >
                <View className="mb-1 flex-row items-center gap-1.5">
                  <Ionicons name={t.icon} size={14} color="#64748b" />
                  <Text className="text-[11px] text-slate-500">{t.label}</Text>
                </View>
                <Text className={`text-2xl font-bold ${t.color}`}>{t.value}</Text>
              </View>
            ))}
          </View>

          <Pressable
            className="mb-4 flex-row items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-4 active:opacity-80"
            style={{ elevation: 2 }}
            onPress={() => router.push("/(warehouse)/scan" as Href)}
          >
            <Ionicons name="scan" size={20} color="#fff" />
            <Text className="text-base font-bold text-white">
              Mở camera quét đơn hoàn
            </Text>
          </Pressable>

          {/* 2 tab: hàng đã về tay (đã quét) hay chưa — đơn xong việc không còn
              chen giữa đơn cần đi đòi. Số đếm SCANNED backend tính sẵn, cùng
              một định nghĩa với bộ lọc nên không sợ lệch. */}
          <SegmentedTabs
            className="mb-2.5"
            options={RETURN_TABS.map((t) => ({
              key: t.key,
              label: `${t.label} (${
                t.key === "AWAITING"
                  ? summary?.AWAITING ?? 0
                  : summary?.SCANNED ?? 0
              })`,
            }))}
            value={tab}
            onChange={setTab}
          />

          {/* Tìm kiếm đơn hoàn */}
          <View className="mb-2.5 flex-row items-center rounded-xl border border-slate-200 bg-white px-3">
            <Ionicons name="search-outline" size={16} color="#94a3b8" />
            <TextInput
              className="flex-1 px-2 py-2.5 text-sm text-slate-900"
              placeholder="Tìm mã đơn, mã vận đơn, tên khách…"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={onSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search ? (
              <Pressable onPress={() => onSearch("")} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="#cbd5e1" />
              </Pressable>
            ) : null}
          </View>

          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-slate-900">
              Danh sách đơn hoàn
            </Text>
            <Text className="text-[11px] text-slate-400">{total} đơn</Text>
          </View>

          {error ? (
            <Text className="py-6 text-center text-sm text-red-500">{error}</Text>
          ) : loading ? (
            <ActivityIndicator className="py-6" color="#0f172a" />
          ) : items.length === 0 ? (
            <Text className="py-6 text-center text-sm text-slate-400">
              {searchRef.current
                ? "Không tìm thấy đơn hoàn nào khớp từ khóa"
                : channel
                  ? `Không có đơn hoàn nào trên ${CHANNEL_LABEL[channel]}`
                  : tab === "AWAITING"
                    ? "Không có đơn nào chờ hàng về"
                    : "Chưa nhận đơn hoàn nào"}
            </Text>
          ) : (
            items.map((o) => {
              const ret = RETURN_STATUS[o.returnStatus];
              const thumb =
                o.items
                  .map((i) => i.imageUrl ?? i.product?.imageUrl)
                  .find((u) => u) ?? null;
              const overdue = o.agingLevel === "overdue";
              return (
                <View
                  key={o.id}
                  className="mb-2 flex-row gap-3 rounded-2xl bg-white p-3"
                  style={{ elevation: 1 }}
                >
                  <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                    {thumb ? (
                      <Image
                        source={{ uri: thumb }}
                        style={{ width: 48, height: 48 }}
                        contentFit="cover"
                      />
                    ) : (
                      <Ionicons name="cube-outline" size={20} color="#94a3b8" />
                    )}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text
                        className="flex-1 pr-2 text-[13px] font-semibold text-slate-900"
                        numberOfLines={1}
                      >
                        {o.orderCode}
                      </Text>
                      <Badge label={ret.label} bg={ret.bg} text={ret.text} />
                    </View>
                    <Text className="mt-0.5 text-[11px] text-slate-500" numberOfLines={1}>
                      VĐ hoàn: {o.returnTrackingCode ?? o.trackingCode ?? "—"}
                    </Text>
                    <View className="mt-0.5 flex-row items-center justify-between">
                      <Text className="text-[11px] text-slate-400" numberOfLines={1}>
                        {CHANNEL_LABEL[o.channel.channelName] ?? o.channel.channelName}
                        {" · "}
                        {o.customerName}
                      </Text>
                      {o.daysWaiting !== null &&
                      !DONE_STATUSES.has(o.returnStatus) ? (
                        <Text
                          className={`text-[11px] font-semibold ${
                            overdue
                              ? "text-red-500"
                              : o.agingLevel === "warning"
                                ? "text-amber-600"
                                : "text-slate-400"
                          }`}
                        >
                          {overdue ? "⚠ " : ""}chờ {o.daysWaiting} ngày
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            })
          )}

          {!loading && page < pageCount ? (
            <Pressable
              className="mt-1 items-center rounded-xl bg-slate-100 py-3 active:opacity-70"
              onPress={() => void load(page + 1, true)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <Text className="text-sm font-semibold text-slate-600">
                  Xem thêm ({total - items.length} đơn)
                </Text>
              )}
            </Pressable>
          ) : null}

          <View className="mt-3 rounded-2xl bg-slate-100 p-4">
            <Text className="text-[11px] leading-4 text-slate-500">
              Luồng 2 công đoạn: quét trên điện thoại chỉ ghi nhận ĐÃ NHẬN hàng
              về tay. Nút "Nhập kho tất cả" (cộng tồn kho) nằm trên web — Kho →
              Đối soát đơn hoàn.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}
