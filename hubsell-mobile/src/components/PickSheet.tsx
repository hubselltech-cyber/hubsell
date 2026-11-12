import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { fetchPickSummary, type OrdersFilter, type PickGroup } from "@/api/orders";
import { ApiError } from "@/api/client";
import type { PickSummaryResponse } from "@/types/api";
import { PickChip } from "@/components/FilterChips";
import { rangeFor, yesterdayRange } from "@/lib/dates";
import { groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { TABULAR } from "@/theme/tokens";

// ============================================================
// THỐNG KÊ SẢN PHẨM / PHIẾU NHẶT HÀNG (05/11/2026, tên cũ "Thống kê bốc hàng") — số lượng
// theo SKU / sản phẩm của MỘT nhóm đơn, trong phạm vi sàn / gian / hãng / từ khóa đang
// lọc. Cùng nguồn số với popup của web (GET /api/orders/pick-summary) và trả ĐỦ mọi SKU.
// 12/11/2026 (khách: "muốn xem cả SKU của các đơn mới ra, đang giao, thành công"): thêm
// hàng chip chọn nhóm theo đúng dây chuyền của đơn — Chờ xử lý · Chưa in phiếu · Chờ đóng
// gói (phiếu nhặt hàng như cũ) · Đã đóng gói · Đang giao · Đã giao; đơn chưa hủy nào cũng
// thuộc đúng một nhóm. "Đã giao" luôn đi kèm KỲ (theo ngày giao thành công), không thì là
// cả lịch sử.
// ============================================================
type DeliveredPeriod = "today" | "yesterday" | "7d";

const PICK_GROUPS: {
  key: PickGroup;
  label: string;
  /** Khóa trong bảng đếm của màn Đơn hàng; null = không hiện số (Đã giao là cả lịch sử). */
  countKey: string | null;
  title: string;
  hint: string;
  /** Động từ của dòng tổng: "Cần lấy 12 sản phẩm · 5 đơn · 4 SKU". */
  verb: string;
  emptyTitle: string;
  /** Nhóm còn phải nhặt hàng → tô đỏ món hỏa tốc để nhặt trước. */
  picking: boolean;
}[] = [
  {
    key: "PENDING",
    label: "Chờ xử lý",
    countKey: "PENDING",
    title: "Thống kê sản phẩm",
    hint: "Đơn CHỜ XỬ LÝ: đơn mới về, chưa chuẩn bị hàng — biết trước cần bao nhiêu hàng",
    verb: "Cần",
    emptyTitle: "Không có đơn nào chờ xử lý",
    picking: true,
  },
  {
    key: "NOT_PRINTED",
    label: "Chưa in phiếu",
    countKey: "PROCESSED_NOT_PRINTED",
    title: "Thống kê sản phẩm",
    hint: "Đơn CHƯA IN PHIẾU: đã chuẩn bị hàng, chưa in phiếu trên Hubsell",
    verb: "Cần lấy",
    emptyTitle: "Không có đơn nào chưa in phiếu",
    picking: true,
  },
  {
    key: "PACK",
    label: "Chờ đóng gói",
    countKey: "PROCESSED_PRINTED",
    title: "Phiếu nhặt hàng",
    hint: "Đơn CHỜ ĐÓNG GÓI: đã in phiếu, chưa quét đóng gói — hỏa tốc đỏ, nhặt trước",
    verb: "Cần lấy",
    emptyTitle: "Không có đơn nào chờ đóng gói",
    picking: true,
  },
  {
    key: "PACKED",
    label: "Đã đóng gói",
    countKey: "PROCESSED_PACKED",
    title: "Thống kê sản phẩm",
    hint: "Đơn ĐÃ ĐÓNG GÓI: đã quét đóng gói, chờ giao cho đơn vị vận chuyển",
    verb: "Đã gói",
    emptyTitle: "Không có đơn nào đã đóng gói chờ giao",
    picking: false,
  },
  {
    key: "SHIPPING",
    label: "Đang giao",
    countKey: "SHIPPING",
    title: "Thống kê sản phẩm",
    hint: "Đơn ĐANG GIAO: đã giao cho đơn vị vận chuyển, chưa tới tay khách",
    verb: "Đang giao",
    emptyTitle: "Không có đơn nào đang giao",
    picking: false,
  },
  {
    key: "DELIVERED",
    label: "Đã giao",
    countKey: null,
    title: "Thống kê sản phẩm",
    hint: "Đơn ĐÃ GIAO thành công trong kỳ, tính theo ngày giao",
    verb: "Đã giao",
    emptyTitle: "Không có đơn nào giao thành công trong kỳ này",
    picking: false,
  },
];

const DELIVERED_PERIODS: { key: DeliveredPeriod; label: string }[] = [
  { key: "today", label: "Hôm nay" },
  { key: "yesterday", label: "Hôm qua" },
  { key: "7d", label: "7 ngày" },
];

function deliveredRange(p: DeliveredPeriod): { from: string; to: string } {
  return p === "yesterday" ? yesterdayRange() : rangeFor(p);
}

export function PickSheet({
  visible,
  scope,
  initialGroup,
  counts,
  notPrintedCount,
  onClose,
}: {
  visible: boolean;
  scope: OrdersFilter;
  /** Nhóm mở sẵn — theo tab trạng thái đang xem ở màn Đơn hàng. */
  initialGroup: PickGroup;
  /** Bảng đếm đơn theo trạng thái của màn Đơn hàng (cùng phạm vi lọc) — số trên chip. */
  counts: Record<string, number>;
  /** Số đơn Đã xử lý CHƯA in phiếu trong cùng phạm vi — gợi ý khi phiếu trống. */
  notPrintedCount: number;
  onClose: () => void;
}) {
  // Đáy hộp chừa phần nút điều hướng / vạch vuốt của máy.
  const sheetInsets = useSafeAreaInsets();
  const [group, setGroup] = useState<PickGroup>(initialGroup);
  const [period, setPeriod] = useState<DeliveredPeriod>("today");
  const meta = PICK_GROUPS.find((g) => g.key === group) ?? PICK_GROUPS[2];
  const [mode, setMode] = useState<"product" | "sku">("product");
  // Hàng chip dài hơn màn (6 nhóm) → nhóm đang chọn phải tự trượt vào tầm nhìn, kể cả lúc
  // vừa mở popup ở một nhóm nằm khuất bên phải.
  const chipRow = useRef<ScrollView>(null);
  const chipX = useRef<Partial<Record<PickGroup, number>>>({});
  const revealChip = (key: PickGroup, animated: boolean) => {
    const x = chipX.current[key];
    // Chừa 56 px bên trái: lộ một phần chip đứng trước để biết còn nhóm phía đó.
    if (x !== undefined) chipRow.current?.scrollTo({ x: Math.max(0, x - 56), animated });
  };
  const [data, setData] = useState<PickSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError("");
    // Lượt mở trước có thể là phạm vi khác — không để số cũ nằm dưới vòng chờ.
    setData(null);
    let stale = false;
    fetchPickSummary(scope, group, deliveredRange(period))
      .then((res) => {
        if (!stale) setData(res);
      })
      .catch((err) => {
        if (!stale) setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
    // scope dựng mới mỗi render — nạp lại khi MỞ panel hoặc đổi nhóm / kỳ là đủ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, group, period]);

  const rows = mode === "product" ? (data?.byProduct ?? []) : (data?.bySku ?? []);
  const totals = data?.totals;

  return (
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="h-[75%] rounded-t-3xl bg-white dark:bg-slate-900 px-4 pt-3"
          style={{ paddingBottom: 20 + sheetInsets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
              {meta.title}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng">
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>

          {/* NHÓM ĐƠN — hàng chip cuộn ngang theo thứ tự dây chuyền của đơn. */}
          <ScrollView
            ref={chipRow}
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4 mb-1.5"
            // Không co giãn theo chiều dọc: thiếu dòng này, trên web hàng chip bị danh sách bên dưới ép dẹp.
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {PICK_GROUPS.map((g) => {
              const n = g.countKey ? counts[g.countKey] : undefined;
              return (
                <View
                  key={g.key}
                  onLayout={(e) => {
                    chipX.current[g.key] = e.nativeEvent.layout.x;
                    if (g.key === group) revealChip(g.key, false);
                  }}
                >
                  <PickChip
                    label={n !== undefined && n > 0 ? `${g.label} (${groupVN(n)})` : g.label}
                    active={group === g.key}
                    onPress={() => {
                      hapticTap();
                      setGroup(g.key);
                      revealChip(g.key, true);
                    }}
                  />
                </View>
              );
            })}
          </ScrollView>
          <Text className="mb-2 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
            {meta.hint}
          </Text>

          {/* Hàng phụ: kỳ (chỉ Đã giao) bên trái · cách gom bên phải. */}
          <View className="mb-2 flex-row items-center gap-2">
            {group === "DELIVERED" ? (
              <View className="flex-row rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {DELIVERED_PERIODS.map((p) => (
                  <MiniSeg
                    key={p.key}
                    label={p.label}
                    active={period === p.key}
                    onPress={() => setPeriod(p.key)}
                  />
                ))}
              </View>
            ) : null}
            <View className="flex-1" />
            <View className="flex-row rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              <MiniSeg label="Sản phẩm" active={mode === "product"} onPress={() => setMode("product")} />
              <MiniSeg label="SKU" active={mode === "sku"} onPress={() => setMode("sku")} />
            </View>
          </View>

          {/* Dòng TỔNG cho kho: cần lấy bao nhiêu món, thuộc mấy đơn, mấy mã. */}
          {totals && totals.orders > 0 && !loading ? (
            <View className="mb-2 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2">
              <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300" style={TABULAR}>
                {meta.verb} {groupVN(totals.qty)} sản phẩm · {groupVN(totals.orders)} đơn ·{" "}
                {groupVN(totals.skuCount)} SKU
              </Text>
              {meta.picking && totals.expressQty > 0 ? (
                <Text className="mt-0.5 text-xs font-bold text-red-500 dark:text-red-400" style={TABULAR}>
                  ⚡ Trong đó {groupVN(totals.expressQty)} món HỎA TỐC — nhặt trước!
                </Text>
              ) : null}
            </View>
          ) : null}

          {loading ? (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#64748b" />
            </View>
          ) : error ? (
            <Text className="py-10 text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(r, i) => `${mode}-${r.sku ?? ""}-${r.name}-${i}`}
              initialNumToRender={14}
              windowSize={7}
              ListEmptyComponent={
                // Trống có hai nghĩa khác nhau: gói hết rồi, hoặc shop chưa in phiếu trên
                // Hubsell (in ở Seller Center thì đơn không bao giờ vào nhóm này).
                <View className="items-center px-4 py-10">
                  <Ionicons name="checkmark-circle-outline" size={30} color="#94a3b8" />
                  <Text className="mt-2 text-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {meta.emptyTitle}
                  </Text>
                  {group === "PACK" ? (
                    <Text className="mt-1 text-center text-xs leading-[18px] text-slate-400 dark:text-slate-500">
                      Đơn vào phiếu này sau khi in phiếu trên Hubsell và ra khỏi phiếu khi được quét
                      đóng gói.
                      {notPrintedCount > 0
                        ? ` Đang có ${groupVN(notPrintedCount)} đơn Đã xử lý chưa in phiếu.`
                        : ""}
                    </Text>
                  ) : null}
                </View>
              }
              renderItem={({ item, index }) => (
                <View className="flex-row items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 py-2.5">
                  <Text className="w-6 text-center text-xs font-bold text-slate-400 dark:text-slate-500" style={TABULAR}>
                    {index + 1}
                  </Text>
                  <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                    {item.imageUrl ? (
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={{ width: 40, height: 40 }}
                        contentFit="cover"
                      />
                    ) : (
                      <Ionicons name="cube-outline" size={16} color="#94a3b8" />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[13px] font-semibold text-slate-800 dark:text-slate-200" numberOfLines={2}>
                      {mode === "sku" && item.sku ? item.sku : item.name}
                    </Text>
                    {/* Dòng phụ: theo SKU → tên sản phẩm; theo sản phẩm → mã SKU, hoặc "N SKU"
                        khi sản phẩm có nhiều phân loại (kho biết phải lấy mấy loại). */}
                    <Text className="text-[10px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
                      {mode === "sku"
                        ? item.sku
                          ? item.name
                          : "Không có mã SKU"
                        : (item.skuCount ?? 1) > 1
                          ? `${item.skuCount} SKU`
                          : (item.sku ?? "Không có mã SKU")}
                    </Text>
                    {meta.picking && item.expressQty > 0 ? (
                      <Text className="text-[10px] font-bold text-red-500 dark:text-red-400" style={TABULAR}>
                        ⚡ {groupVN(item.expressQty)} món hỏa tốc
                      </Text>
                    ) : null}
                  </View>
                  {/* SỐ LƯỢNG to bên phải, một cột thẳng hàng — kho liếc dọc là đọc được
                      (đỏ khi có món hỏa tốc). */}
                  <Text
                    className={`min-w-[44px] text-right text-lg font-bold ${
                      meta.picking && item.expressQty > 0
                        ? "text-red-500 dark:text-red-400"
                        : "text-slate-900 dark:text-slate-100"
                    }`}
                    style={TABULAR}
                  >
                    ×{groupVN(item.qty)}
                  </Text>
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Một nấc của công tắc nhỏ trong popup Thống kê (kỳ / cách gom). */
function MiniSeg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      className={`rounded-md px-2.5 py-1.5 ${active ? "bg-white dark:bg-slate-600" : ""}`}
      onPress={() => {
        hapticTap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        className={`text-xs ${
          active
            ? "font-bold text-slate-900 dark:text-slate-50"
            : "font-medium text-slate-500 dark:text-slate-400"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
