import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import { Image } from "expo-image";
import { fetchReturns } from "@/api/warehouse";
import { ApiError } from "@/api/client";
import type {
  ChannelName,
  ReturnOrderDto,
  ReturnShippingFilter,
  ReturnsSummaryResponse,
} from "@/types/api";
import { RETURN_STATUS, RETURN_SHIP_RETURNED, CHANNEL_LABEL } from "@/lib/labels";
import {
  RETURN_SHIP_FILTERS,
  RETURN_SHIP_LABEL,
  returnShipView,
  type ReturnShipTone,
} from "@/lib/return-shipping";
import { useReturnCarrierStatus } from "@/lib/useReturnCarrierStatus";
import { Badge } from "@/components/Badge";
import { ActiveChip, PickChip } from "@/components/FilterChips";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { Card } from "@/components/Card";
import { ICON_TINT, TABULAR, type IconTint } from "@/theme/tokens";
import { useColorScheme } from "nativewind";

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

// Trạng thái chi tiết bên trong tab "Đã nhận hoàn" — cho sheet Bộ lọc
const SCANNED_DETAIL_KEYS = [
  "RECEIVED",
  "RECEIVED_INTACT",
  "DAMAGED",
  "CLAIM_SETTLED",
  "WRITTEN_OFF",
] as const;
type ScannedDetail = "" | (typeof SCANNED_DETAIL_KEYS)[number];

/** Lọc theo Trạng thái vận chuyển chiều hoàn — chỉ có nghĩa ở tab "Chờ nhận hoàn". */
type ShipFilter = "" | ReturnShippingFilter;
type ShipCounts = NonNullable<ReturnsSummaryResponse["shippingCounts"]>;

/** Màu chấm + chữ của dòng "chặng hoàn" dưới mã vận đơn. */
const SHIP_TONE: Record<ReturnShipTone, { dot: string; text: string }> = {
  red: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  blue: { dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" },
  amber: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  muted: { dot: "bg-slate-400 dark:bg-slate-500", text: "text-slate-500 dark:text-slate-400" },
};

/**
 * ĐƠN HOÀN — tab con phụ của màn Kho (trước 04/10 là trang 3 của Trang chủ).
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
  const [statusDetail, setStatusDetail] = useState<ScannedDetail>("");
  const [ship, setShip] = useState<ShipFilter>("");
  // Thẻ "Quá 14 ngày chưa về" đang bật — lọc tab Chờ nhận hoàn về các đơn quá hạn.
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [shipCounts, setShipCounts] = useState<ShipCounts>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef("");
  const channelRef = useRef<ChannelFilter>("");
  const tabRef = useRef<ReturnTab>("AWAITING");
  const statusDetailRef = useRef<ScannedDetail>("");
  const shipRef = useRef<ShipFilter>("");
  const overdueRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  /** Vị trí hàng tab + danh sách trong vùng cuộn — bấm thẻ số thì cuộn tới đây. */
  const listY = useRef(0);
  // Hãng vừa báo một kiện giao thất bại đã trả → backend đã lưu mốc, số đếm nhóm lọc đổi.
  // Chỉ tải lại SỐ ĐẾM (1 dòng), không đụng danh sách đang cuộn / các trang đã "Xem thêm".
  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetchReturns({
        page: 1,
        pageSize: 1,
        search: searchRef.current || undefined,
        channelName: channelRef.current || undefined,
        status:
          statusDetailRef.current ||
          (overdueRef.current && tabRef.current === "AWAITING" ? "OVERDUE" : tabRef.current),
      });
      setSummary(res.summary);
      setShipCounts(res.shippingCounts ?? {});
    } catch {
      // Số đếm cũ vẫn dùng được; lượt tải danh sách kế sẽ cập nhật.
    }
  }, []);
  // Kiện giao thất bại: hãng đã trả kiện chưa — hỏi cho các dòng đang hiện (đệm 10 phút).
  const carrierById = useReturnCarrierStatus(items, refreshCounts);

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
          // Chọn trạng thái chi tiết trong sheet thì lọc đúng trạng thái đó,
          // không thì lấy cả nhóm của tab (AWAITING / SCANNED); thẻ "Quá 14 ngày"
          // thu tab Chờ nhận hoàn về các đơn quá hạn (backend: status=OVERDUE).
          status:
            statusDetailRef.current ||
            (overdueRef.current && tabRef.current === "AWAITING" ? "OVERDUE" : tabRef.current),
          ship: shipRef.current || undefined,
        });
        setSummary(res.summary);
        setShipCounts(res.shippingCounts ?? {});
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
    statusDetailRef.current = statusDetail;
    shipRef.current = ship;
    overdueRef.current = overdueOnly;
    void load(1, false);
  }, [channel, tab, statusDetail, ship, overdueOnly, load]);

  const onSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchRef.current = text.trim();
      void load(1, false);
    }, 450);
  };

  // BỐN THẺ SỐ = BỘ LỌC BẤM ĐƯỢC (26/11/2026, anh Trung: "khối này click vào chưa ra đơn
  // cụ thể, khách hàng đang khá khó chịu") — cùng nết thẻ lọc của web Đối soát đơn hoàn.
  // Mỗi thẻ là một tổ hợp (tab, trạng thái chi tiết, quá hạn); thẻ khớp danh sách đang
  // hiện thì có viền. Bấm lại thẻ đang chọn = về mặc định (Chờ nhận hoàn, không lọc).
  type TileKey = "AWAITING" | "RECEIVED" | "OVERDUE" | "DAMAGED";
  const tiles: {
    key: TileKey;
    label: string;
    value: number;
    color: string;
    icon: "time-outline" | "archive-outline" | "alert-circle-outline" | "bandage-outline";
    tint: IconTint;
  }[] = [
    { key: "AWAITING", label: "Chờ hàng về", value: summary?.AWAITING ?? 0, color: "text-amber-600 dark:text-amber-400", icon: "time-outline", tint: "amber" },
    { key: "RECEIVED", label: "Đã nhận · chờ nhập kho", value: summary?.RECEIVED ?? 0, color: "text-sky-600 dark:text-sky-400", icon: "archive-outline", tint: "sky" },
    { key: "OVERDUE", label: "Quá 14 ngày chưa về", value: summary?.overdue ?? 0, color: "text-red-500 dark:text-red-400", icon: "alert-circle-outline", tint: "red" },
    { key: "DAMAGED", label: "Hàng hỏng · chờ khiếu nại sàn", value: summary?.DAMAGED ?? 0, color: "text-red-500 dark:text-red-400", icon: "bandage-outline", tint: "red" },
  ];
  const activeTile: TileKey | null =
    tab === "AWAITING"
      ? overdueOnly
        ? "OVERDUE"
        : "AWAITING"
      : statusDetail === "RECEIVED" || statusDetail === "DAMAGED"
        ? statusDetail
        : null;
  const pickTile = (key: TileKey) => {
    hapticSelect();
    // Bấm lại thẻ đang chọn → về mặc định; thẻ "Chờ hàng về" chính là mặc định.
    const next: TileKey = key === activeTile ? "AWAITING" : key;
    const scanned = next === "RECEIVED" || next === "DAMAGED";
    setTab(scanned ? "SCANNED" : "AWAITING");
    setStatusDetail(scanned ? next : "");
    setOverdueOnly(next === "OVERDUE");
    // Trạng thái vận chuyển chỉ có nghĩa với đơn chờ về — sang thẻ đã nhận thì gỡ.
    if (scanned) setShip("");
    // Đưa danh sách lên tầm mắt: người bấm thẻ muốn thấy NGAY các đơn của con số đó.
    scrollRef.current?.scrollTo({ y: Math.max(0, listY.current - 8), animated: true });
  };
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const filterCount =
    (channel ? 1 : 0) + (statusDetail ? 1 : 0) + (ship ? 1 : 0) + (overdueOnly ? 1 : 0);

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(1, false, true)} />
      }
    >
      {loading && !summary ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : (
        <>
          {/* Bộ lọc gom vào bottom sheet (pattern màn Đơn hàng) — sàn áp cho
              CẢ thẻ đếm lẫn danh sách, trạng thái chi tiết chỉ áp danh sách */}
          <View className="mb-3 flex-row items-center gap-2">
            <Pressable
              className="flex-row items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 active:opacity-70 dark:border-slate-700 dark:bg-slate-900"
              onPress={() => {
                hapticTap();
                setSheetOpen(true);
              }}
            >
              <Ionicons name="options-outline" size={15} color="#64748b" />
              <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Bộ lọc
              </Text>
              {filterCount > 0 ? (
                <View className="min-w-[16px] items-center rounded-full bg-slate-900 px-1 dark:bg-slate-600">
                  <Text className="text-[10px] font-bold text-white">{filterCount}</Text>
                </View>
              ) : null}
            </Pressable>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, alignItems: "center" }}
            >
              {channel ? (
                <ActiveChip
                  label={`Sàn: ${CHANNEL_LABEL[channel as ChannelName]}`}
                  onClear={() => setChannel("")}
                />
              ) : null}
              {statusDetail ? (
                <ActiveChip
                  label={RETURN_STATUS[statusDetail].label}
                  onClear={() => setStatusDetail("")}
                />
              ) : null}
              {overdueOnly ? (
                <ActiveChip label="Quá 14 ngày chưa về" onClear={() => setOverdueOnly(false)} />
              ) : null}
              {ship ? (
                <ActiveChip label={RETURN_SHIP_LABEL[ship]} onClear={() => setShip("")} />
              ) : null}
            </ScrollView>
          </View>

          <View className="mb-3 flex-row flex-wrap gap-2">
            {tiles.map((t) => {
              const tint = ICON_TINT[t.tint];
              const active = activeTile === t.key;
              return (
                <Card
                  key={t.key}
                  className="w-[48%] flex-grow p-4"
                  // Thẻ đang lọc: viền đậm màu của chính thẻ (viền 1.5 đè viền hairline của Card).
                  style={active ? { borderColor: tint.icon, borderWidth: 1.5 } : { borderWidth: 1.5 }}
                  onPress={() => pickTile(t.key)}
                >
                  {/* min-h 2 dòng: nhãn dài ("Hàng hỏng · chờ khiếu nại sàn") hiện đủ chữ,
                      bốn thẻ vẫn cao bằng nhau. */}
                  <View className="mb-1.5 min-h-[32px] flex-row items-center gap-2">
                    <View
                      className="h-6 w-6 items-center justify-center rounded-md"
                      style={{ backgroundColor: dark ? tint.dark : tint.light }}
                    >
                      <Ionicons name={t.icon} size={13} color={tint.icon} />
                    </View>
                    <Text
                      className="flex-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400"
                      numberOfLines={2}
                    >
                      {t.label}
                    </Text>
                  </View>
                  <Text className={`text-2xl font-bold ${t.color}`} style={TABULAR}>
                    {t.value}
                  </Text>
                </Card>
              );
            })}
          </View>

          {/* CTA quét — emerald đặc màu logo; bóng màu chỉ ăn iOS, Android
              trên nền tối elevation thành quầng đen bẩn nên không dùng */}
          <Pressable
            className="mb-4 flex-row items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-4 active:opacity-85"
            style={{
              shadowColor: "#059669",
              shadowOpacity: 0.35,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 5 },
            }}
            onPress={() => {
              hapticTap();
              router.push("/scan-returns" as Href);
            }}
          >
            <Ionicons name="scan" size={20} color="#fff" />
            <Text className="text-base font-bold text-white">
              Mở camera quét đơn hoàn
            </Text>
          </Pressable>

          {/* 2 tab: hàng đã về tay (đã quét) hay chưa — đơn xong việc không còn
              chen giữa đơn cần đi đòi. Số đếm SCANNED backend tính sẵn, cùng
              một định nghĩa với bộ lọc nên không sợ lệch. */}
          <View
            onLayout={(e) => {
              listY.current = e.nativeEvent.layout.y;
            }}
          />
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
            onChange={(k) => {
              setTab(k);
              // Trạng thái chi tiết + trạng thái vận chuyển thuộc về tab đang mở — đổi tab thì gỡ
              setStatusDetail("");
              setShip("");
              setOverdueOnly(false);
            }}
          />

          {/* Tìm kiếm đơn hoàn */}
          <View className="mb-2.5 flex-row items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3">
            <Ionicons name="search-outline" size={16} color="#94a3b8" />
            <TextInput
              className="flex-1 px-2 py-2.5 text-sm text-slate-900 dark:text-slate-100"
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
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Danh sách đơn hoàn
            </Text>
            <Text className="text-[11px] text-slate-400 dark:text-slate-500">{total} đơn</Text>
          </View>

          {error ? (
            <Text className="py-6 text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
          ) : loading ? (
            <ActivityIndicator className="py-6" color="#64748b" />
          ) : items.length === 0 ? (
            <Text className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
              {searchRef.current
                ? "Không tìm thấy đơn hoàn nào khớp từ khóa"
                : ship
                  ? `Không có đơn nào ở nhóm “${RETURN_SHIP_LABEL[ship]}”`
                  : overdueOnly
                    ? "Không có đơn nào quá 14 ngày chưa về"
                    : statusDetail
                      ? `Không có đơn nào ở trạng thái “${RETURN_STATUS[statusDetail].label}”`
                      : channel
                    ? `Không có đơn hoàn nào trên ${CHANNEL_LABEL[channel]}`
                    : tab === "AWAITING"
                      ? "Không có đơn nào chờ hàng về"
                      : "Chưa nhận đơn hoàn nào"}
            </Text>
          ) : (
            items.map((o, idx) => {
              // Đơn chờ về mà sàn / hãng báo kiện ĐÃ VỀ shop → nhãn "Ship báo đã hoàn"
              // thay cho "Chờ hàng về"; dòng phụ nói ai báo, lúc nào.
              const shipView = returnShipView(o, carrierById[o.id]);
              const ret = shipView?.shipReturned
                ? RETURN_SHIP_RETURNED
                : RETURN_STATUS[o.returnStatus];
              const thumb =
                o.items
                  .map((i) => i.imageUrl ?? i.product?.imageUrl)
                  .find((u) => u) ?? null;
              const overdue = o.agingLevel === "overdue";
              return (
                <Animated.View
                  key={o.id}
                  // So le tối đa 6 dòng đầu — dòng tải thêm vào ngay không chờ
                  entering={FadeInDown.duration(220).delay(Math.min(idx, 6) * 40)}
                  className="mb-2 flex-row gap-3 rounded-2xl border border-slate-900/5 bg-white p-3 dark:border-white/5 dark:bg-slate-900"
                  style={{ elevation: 1 }}
                >
                  <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
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
                        className="flex-1 pr-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100"
                        numberOfLines={1}
                      >
                        {o.orderCode}
                      </Text>
                      <Badge label={ret.label} bg={ret.bg} text={ret.text} />
                    </View>
                    <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
                      {/* Chỉ gọi "VĐ hoàn" khi sàn đã cấp mã hoàn; chưa có thì ghi rõ là
                          mã vận đơn chiều đi, kho khỏi so nhầm với tem hoàn (rà 26/10). */}
                      {o.returnTrackingCode
                        ? `VĐ hoàn: ${o.returnTrackingCode}`
                        : o.trackingCode
                          ? `VĐ đi: ${o.trackingCode} · chưa có mã hoàn`
                          : "Chưa có mã vận đơn hoàn"}
                    </Text>
                    {shipView?.line ? (
                      <View className="mt-0.5 flex-row items-start gap-1.5">
                        <View
                          className={`mt-[5px] h-1.5 w-1.5 rounded-full ${SHIP_TONE[shipView.tone].dot}`}
                        />
                        <Text
                          className={`flex-1 text-[11px] ${
                            shipView.shipReturned ? "font-semibold" : ""
                          } ${SHIP_TONE[shipView.tone].text}`}
                          numberOfLines={2}
                        >
                          {shipView.line}
                        </Text>
                      </View>
                    ) : null}
                    <View className="mt-0.5 flex-row items-center justify-between">
                      <Text className="text-[11px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
                        {CHANNEL_LABEL[o.channel.channelName] ?? o.channel.channelName}
                        {" · "}
                        {o.customerName}
                      </Text>
                      {o.daysWaiting !== null &&
                      !DONE_STATUSES.has(o.returnStatus) ? (
                        <Text
                          className={`text-[11px] font-semibold ${
                            overdue
                              ? "text-red-500 dark:text-red-400"
                              : o.agingLevel === "warning"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-slate-400 dark:text-slate-500"
                          }`}
                        >
                          {/* AWAITING: số ngày đang chờ; đã nhận/hỏng: backend trả số
                              ngày hàng ĐI ĐƯỜNG (requestedAt→returnedAt) — không phải
                              "chờ" nữa. */}
                          {overdue ? "⚠ " : ""}
                          {o.returnStatus === "AWAITING"
                            ? `chờ ${o.daysWaiting} ngày`
                            : `về sau ${o.daysWaiting} ngày`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Animated.View>
              );
            })
          )}

          {!loading && page < pageCount ? (
            <Pressable
              className="mt-1 items-center rounded-xl bg-slate-100 dark:bg-slate-800 py-3 active:opacity-70"
              onPress={() => void load(page + 1, true)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color="#64748b" />
              ) : (
                <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  Xem thêm ({total - items.length} đơn)
                </Text>
              )}
            </Pressable>
          ) : null}

          <View className="mt-3 rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
            <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
              Luồng 2 công đoạn: quét trên điện thoại chỉ ghi nhận ĐÃ NHẬN hàng
              về tay. Nhập kho (cộng tồn kho) làm trên web — Kho → Đối soát đơn
              hoàn: tích chọn đơn rồi bấm Nhập kho.
            </Text>
          </View>
        </>
      )}

      <ReturnsFilterSheet
        visible={sheetOpen}
        tab={tab}
        summary={summary}
        channel={channel}
        statusDetail={statusDetail}
        ship={ship}
        shipCounts={shipCounts}
        onClose={() => setSheetOpen(false)}
        onApply={(ch, st, sh) => {
          hapticSelect();
          setChannel(ch);
          setStatusDetail(st);
          setShip(sh);
          setSheetOpen(false);
        }}
      />
    </ScrollView>
  );
}

// ============================================================
// Panel BỘ LỌC trang Kho — sàn + trạng thái vận chuyển (tab Chờ nhận hoàn) hoặc
// trạng thái chi tiết (tab Đã nhận hoàn).
// Nháp trong panel, bấm Áp dụng mới đổ ra ngoài — cùng nết với màn Đơn hàng.
// ============================================================
function ReturnsFilterSheet({
  visible,
  tab,
  summary,
  channel,
  statusDetail,
  ship,
  shipCounts,
  onClose,
  onApply,
}: {
  visible: boolean;
  tab: ReturnTab;
  summary: ReturnsSummaryResponse["summary"] | null;
  channel: ChannelFilter;
  statusDetail: ScannedDetail;
  ship: ShipFilter;
  /** Số đơn từng nhóm vận chuyển trong tab đang mở (chưa áp chính bộ lọc này). */
  shipCounts: ShipCounts;
  onClose: () => void;
  onApply: (channel: ChannelFilter, statusDetail: ScannedDetail, ship: ShipFilter) => void;
}) {
  const [draftChannel, setDraftChannel] = useState<ChannelFilter>(channel);
  const [draftStatus, setDraftStatus] = useState<ScannedDetail>(statusDetail);
  const [draftShip, setDraftShip] = useState<ShipFilter>(ship);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (visible) {
      setDraftChannel(channel);
      setDraftStatus(statusDetail);
      setDraftShip(ship);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
              Bộ lọc
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>

          <Text className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Sàn
          </Text>
          <View className="mb-3 flex-row flex-wrap gap-1.5">
            {CHANNEL_FILTERS.map((ch) => (
              <PickChip
                key={ch || "ALL"}
                label={ch ? CHANNEL_LABEL[ch] : "Tất cả"}
                active={draftChannel === ch}
                onPress={() => setDraftChannel(ch)}
              />
            ))}
          </View>

          {tab === "AWAITING" ? (
            <>
              <Text className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Trạng thái vận chuyển
              </Text>
              <View className="mb-1.5 flex-row flex-wrap gap-1.5">
                <PickChip
                  label="Tất cả"
                  active={draftShip === ""}
                  onPress={() => setDraftShip("")}
                />
                {RETURN_SHIP_FILTERS.map((f) => (
                  <PickChip
                    key={f.key}
                    label={f.label}
                    count={shipCounts[f.key] ?? 0}
                    active={draftShip === f.key}
                    onPress={() => setDraftShip(f.key)}
                  />
                ))}
              </View>
              <Text className="mb-3 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                “Ship báo đã hoàn” = sàn hoặc hãng vận chuyển báo kiện đã về shop mà kho chưa
                quét nhận. Kiện giao thất bại được hỏi hãng khi dòng hiện ra; hãng báo đã trả
                thì kiện chuyển từ “Giao thất bại” sang nhóm này.
              </Text>
            </>
          ) : null}

          {tab === "SCANNED" ? (
            <>
              <Text className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Trạng thái sau khi nhận
              </Text>
              <View className="mb-3 flex-row flex-wrap gap-1.5">
                <PickChip
                  label="Tất cả"
                  active={draftStatus === ""}
                  onPress={() => setDraftStatus("")}
                />
                {SCANNED_DETAIL_KEYS.map((k) => (
                  <PickChip
                    key={k}
                    label={RETURN_STATUS[k].label}
                    count={summary?.[k] ?? 0}
                    active={draftStatus === k}
                    onPress={() => setDraftStatus(k)}
                  />
                ))}
              </View>
            </>
          ) : null}

          <Pressable
            className="mt-1 items-center rounded-xl bg-slate-900 py-3 active:opacity-80 dark:bg-slate-700"
            onPress={() => onApply(draftChannel, draftStatus, draftShip)}
          >
            <Text className="text-sm font-semibold text-white">Áp dụng</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
