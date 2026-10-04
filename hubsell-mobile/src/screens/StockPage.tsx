import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { adjustStock, fetchProducts, fetchStockLocations } from "@/api/inventory";
import { ApiError } from "@/api/client";
import type { ProductDto, StockLocationDto } from "@/types/api";
import { groupVN } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { ActionButton } from "@/components/ActionButton";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { PickChip } from "@/components/FilterChips";
import { TABULAR } from "@/theme/tokens";

const PAGE_SIZE = 20;

type AdjustType = "IMPORT" | "EXPORT";

// Lý do chọn nhanh — ghi nguyên văn vào nhật ký kho trên web.
const REASONS: Record<AdjustType, string[]> = {
  IMPORT: ["Nhập hàng mới", "Kiểm lại thấy dư", "Khách trả tại shop"],
  EXPORT: ["Hàng hỏng", "Kiểm lại thấy thiếu", "Bán ngoài sàn", "Tặng / dùng nội bộ"],
};

/**
 * SKU này có đẩy tồn lên sàn không? App CHỈ thông báo — nối SKU và bật đồng bộ
 * làm trên web cho chuẩn (anh Trung 04/10).
 *   unlinked = chưa nối gian nào; off = đã nối nhưng chưa gian nào bật đồng bộ.
 */
function linkState(p: ProductDto): "unlinked" | "off" | "on" {
  const links = p.channelLinks ?? [];
  if (links.length === 0) return "unlinked";
  return links.some((l) => l.stockSyncEnabled) ? "on" : "off";
}

/**
 * TỒN KHO — tab chính của Kho trên mobile (anh Trung 04/10). Chỉ làm đúng hai
 * việc: nhập thêm và xuất bớt theo số lượng. Kiểm kê, chuyển vị trí, cất lên
 * kệ, phiếu nhiều mã vẫn ở web.
 */
export function StockPage() {
  const [items, setItems] = useState<ProductDto[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [locations, setLocations] = useState<StockLocationDto[]>([]);
  const searchRef = useRef("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lượt tải mới nhất thắng — gõ tìm nhanh không để kết quả cũ về sau đè lên.
  const loadSeq = useRef(0);

  const load = useCallback(async (nextPage: number, append: boolean, asRefresh = false) => {
    const seq = ++loadSeq.current;
    if (append) setLoadingMore(true);
    else if (asRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await fetchProducts({
        page: nextPage,
        pageSize: PAGE_SIZE,
        search: searchRef.current || undefined,
      });
      if (seq !== loadSeq.current) return;
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setPage(res.page);
      setPageCount(res.pageCount);
      setTotal(res.total);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, kéo xuống thử lại");
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(1, false);
    // Vị trí chứa hàng: shop chưa tạo thì danh sách rỗng → hộp nhập không hiện ô chọn.
    fetchStockLocations()
      .then((r) => setLocations(r.enabled ? r.items : []))
      .catch(() => setLocations([]));
  }, [load]);

  const onSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchRef.current = text.trim();
      void load(1, false);
    }, 450);
  };

  /** Sau khi nhập / xuất: đọc lại đúng SKU đó để có cả Tồn lẫn Có thể bán mới. */
  const refreshOne = async (p: ProductDto, fallbackStock: number) => {
    try {
      const res = await fetchProducts({ search: p.skuCode, pageSize: 20 });
      const fresh = res.items.find((x) => x.id === p.id);
      if (fresh) {
        setItems((prev) => prev.map((x) => (x.id === p.id ? fresh : x)));
        return;
      }
    } catch {
      // rơi xuống dùng số máy chủ vừa trả
    }
    setItems((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, quantityInStock: fallbackStock } : x))
    );
  };

  return (
    <View className="flex-1">
      <View className="px-4 pb-2">
        <View className="flex-row items-center rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
          <Ionicons name="search-outline" size={16} color="#94a3b8" />
          <TextInput
            className="flex-1 px-2 py-2.5 text-sm text-slate-900 dark:text-slate-100"
            placeholder="Tìm mã SKU hoặc tên sản phẩm…"
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
        <Text className="mt-2 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
          {loading ? " " : `${groupVN(total)} sản phẩm · chạm vào dòng để nhập / xuất`}
        </Text>
      </View>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1, false, true)} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!loadingMore && !error && page < pageCount) void load(page + 1, true);
          }}
          ListEmptyComponent={
            error || searchRef.current ? (
              <Text
                className={`py-10 text-center text-sm ${
                  error ? "text-red-500 dark:text-red-400" : "text-slate-400 dark:text-slate-500"
                }`}
              >
                {error || "Không tìm thấy sản phẩm nào khớp từ khóa"}
              </Text>
            ) : (
              // Shop chưa dựng kho: chỉ thông báo, việc liên kết làm trên web.
              <View className="mt-6 items-center rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 dark:border-amber-500/30 dark:bg-amber-500/10">
                <Ionicons name="link-outline" size={28} color="#d97706" />
                <Text className="mt-2 text-center text-[15px] font-bold text-slate-900 dark:text-slate-100">
                  Kho chưa có sản phẩm nào
                </Text>
                <Text className="mt-1.5 text-center text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                  Mở Hubsell trên máy tính, vào trang Hàng hóa để kéo sản phẩm từ sàn
                  và liên kết SKU. Xong bước đó, sản phẩm sẽ hiện ở đây để nhập / xuất.
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator className="py-4" color="#64748b" /> : null
          }
          renderItem={({ item: p }) => (
            <Pressable
              className="mb-2 flex-row items-center gap-3 rounded-2xl border border-slate-900/5 bg-white p-3 active:opacity-75 dark:border-white/5 dark:bg-slate-900"
              style={{ elevation: 1 }}
              onPress={() => {
                hapticTap();
                setEditing(p);
              }}
            >
              <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                {p.imageUrl ? (
                  <Image source={{ uri: p.imageUrl }} style={{ width: 48, height: 48 }} contentFit="cover" />
                ) : (
                  <Ionicons name="cube-outline" size={20} color="#94a3b8" />
                )}
              </View>
              <View className="flex-1">
                <Text
                  className="text-[13px] font-semibold text-slate-900 dark:text-slate-100"
                  numberOfLines={1}
                >
                  {p.productName}
                </Text>
                <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
                  {p.skuCode}
                </Text>
                <Text className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                  Có thể bán {groupVN(p.availableToSell)}
                  {p.holdQuantity > 0 ? ` · đang giữ ${groupVN(p.holdQuantity)}` : ""}
                </Text>
                {linkState(p) !== "on" ? (
                  <Text className="mt-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    {linkState(p) === "unlinked" ? "Chưa liên kết gian hàng" : "Chưa bật đồng bộ tồn lên sàn"}
                  </Text>
                ) : null}
              </View>
              <View className="items-end">
                <Text className="text-[10px] text-slate-400 dark:text-slate-500">Tồn kho</Text>
                <Text
                  className={`text-xl font-bold ${
                    p.quantityInStock <= 0
                      ? "text-red-500 dark:text-red-400"
                      : p.isLowStock
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-slate-900 dark:text-slate-100"
                  }`}
                  style={TABULAR}
                >
                  {groupVN(p.quantityInStock)}
                </Text>
                {p.quantityInStock <= 0 ? (
                  <Text className="text-[10px] font-semibold text-red-500 dark:text-red-400">Hết hàng</Text>
                ) : p.isLowStock ? (
                  <Text className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Sắp hết</Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}

      <AdjustSheet
        product={editing}
        locations={locations}
        onClose={() => setEditing(null)}
        onDone={(p, newStock) => {
          setEditing(null);
          void refreshOne(p, newStock);
        }}
      />
    </View>
  );
}

// ============================================================
// Hộp NHẬP / XUẤT một SKU — trượt từ dưới lên. Cộng trừ theo số lượng, luôn
// cho thấy trước "số cũ → số mới" để người bấm tự soát.
// ============================================================
function AdjustSheet({
  product,
  locations,
  onClose,
  onDone,
}: {
  product: ProductDto | null;
  locations: StockLocationDto[];
  onClose: () => void;
  onDone: (product: ProductDto, newStock: number) => void;
}) {
  const [type, setType] = useState<AdjustType>("IMPORT");
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (product) {
      setType("IMPORT");
      setQtyText("");
      setReason("");
      setLocOpen(false);
      setError("");
      // Vị trí GIỮ lựa chọn lần trước — nhập cả lô vào cùng một kệ không phải chọn lại.
    }
  }, [product]);

  if (!product) return null;

  const qty = Number(qtyText);
  const validQty = Number.isInteger(qty) && qty > 0;
  const current = product.quantityInStock;
  const next = current + (type === "IMPORT" ? qty : -qty);
  const overExport = validQty && type === "EXPORT" && next < 0;
  const location = locations.find((l) => l.id === locationId);

  const step = (d: number) => {
    hapticSelect();
    const n = Math.max(0, (Number.isInteger(qty) ? qty : 0) + d);
    setQtyText(n === 0 ? "" : String(n));
  };

  const submit = async () => {
    if (!validQty || overExport) return;
    setBusy(true);
    setError("");
    try {
      const res = await adjustStock({
        productId: product.id,
        type,
        quantity: qty,
        reason: reason.trim() || undefined,
        locationId: location ? location.id : undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone(product, res.product.quantityInStock);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView className="flex-1 justify-end bg-black/40" behavior="padding">
        <Pressable className="flex-1" onPress={onClose} />
        {/* Co giãn: hộp cao tối đa 92% phần màn còn lại (đã trừ bàn phím), phần
            thân cuộn bên trong, nút lưu GHIM ở chân — màn 320×640 mở bàn phím
            vẫn thấy nút mà không phải cuộn. */}
        <View
          className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          // Đáy chừa thêm phần nút điều hướng / vạch vuốt của máy — không thì nút lưu bị che.
          style={{ maxHeight: "92%", paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-2 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="mb-3 flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text className="text-base font-bold text-slate-900 dark:text-slate-100" numberOfLines={2}>
                  {product.productName}
                </Text>
                <Text className="text-xs text-slate-500 dark:text-slate-400">{product.skuCode}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color="#64748b" />
              </Pressable>
            </View>

            <SegmentedTabs
              className="mb-3"
              options={[
                { key: "IMPORT", label: "Nhập thêm" },
                { key: "EXPORT", label: "Xuất bớt" },
              ]}
              value={type}
              onChange={(k) => {
                setType(k);
                setReason("");
                setError("");
              }}
            />

            {/* Số lượng: nút − / + to cho tay đeo găng, ô giữa gõ số trực tiếp */}
            <View className="flex-row items-center gap-3">
              <Pressable
                className="h-14 w-14 items-center justify-center rounded-2xl border border-slate-300 bg-white active:opacity-70 dark:border-slate-600 dark:bg-slate-800"
                onPress={() => step(-1)}
                accessibilityLabel="Giảm số lượng"
              >
                <Ionicons name="remove" size={24} color="#64748b" />
              </Pressable>
              <TextInput
                className="h-14 flex-1 rounded-2xl border border-slate-300 bg-slate-50 text-center text-2xl font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                // minWidth 0: ô nhập trên web có bề rộng tối thiểu riêng, không ép thì đẩy cả hộp tràn ngang.
                style={[TABULAR, { minWidth: 0 }]}
                keyboardType="number-pad"
                placeholder="Số lượng"
                placeholderTextColor="#94a3b8"
                value={qtyText}
                onChangeText={(t) => setQtyText(t.replace(/[^0-9]/g, "").slice(0, 7))}
                autoFocus
              />
              <Pressable
                className="h-14 w-14 items-center justify-center rounded-2xl border border-slate-300 bg-white active:opacity-70 dark:border-slate-600 dark:bg-slate-800"
                onPress={() => step(1)}
                accessibilityLabel="Tăng số lượng"
              >
                <Ionicons name="add" size={24} color="#64748b" />
              </Pressable>
            </View>

            {/* Xem trước số cũ → số mới */}
            <View
              className={`mt-3 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2.5 ${
                overExport ? "bg-red-50 dark:bg-red-500/10" : "bg-slate-100 dark:bg-slate-800"
              }`}
            >
              {overExport ? (
                <Text className="text-center text-[13px] font-medium text-red-600 dark:text-red-300">
                  Kho chỉ còn {groupVN(current)}, không xuất được {groupVN(qty)}
                </Text>
              ) : (
                <>
                  <Text className="text-xs text-slate-500 dark:text-slate-400">Tồn kho</Text>
                  <Text className="text-base font-bold text-slate-500 dark:text-slate-400" style={TABULAR}>
                    {groupVN(current)}
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color="#94a3b8" />
                  <Text className="text-base font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
                    {validQty ? groupVN(next) : "—"}
                  </Text>
                  {validQty ? (
                    <Text
                      className={`text-xs font-semibold ${
                        type === "IMPORT"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-500 dark:text-red-400"
                      }`}
                      style={TABULAR}
                    >
                      ({type === "IMPORT" ? "+" : "−"}
                      {groupVN(qty)})
                    </Text>
                  ) : null}
                </>
              )}
            </View>

            {locations.length > 0 ? (
              <View className="mt-3">
                <Pressable
                  className="flex-row items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 active:opacity-70 dark:border-slate-700"
                  onPress={() => setLocOpen((o) => !o)}
                >
                  <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Vị trí
                  </Text>
                  <View className="flex-1 flex-row items-center justify-end gap-1 pl-3">
                    <Text className="text-[13px] font-medium text-slate-900 dark:text-slate-100" numberOfLines={1}>
                      {location ? location.path : "Tự động"}
                    </Text>
                    <Ionicons name={locOpen ? "chevron-up" : "chevron-down"} size={14} color="#94a3b8" />
                  </View>
                </Pressable>
                {locOpen ? (
                  <ScrollView
                    className="mt-1 rounded-xl border border-slate-200 dark:border-slate-700"
                    style={{ maxHeight: 180 }}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {[{ id: "", path: "Tự động", sellable: true }, ...locations].map((l) => (
                      <Pressable
                        key={l.id || "auto"}
                        className="flex-row items-center justify-between px-3 py-2.5 active:bg-slate-100 dark:active:bg-slate-800"
                        onPress={() => {
                          hapticSelect();
                          setLocationId(l.id);
                          setLocOpen(false);
                        }}
                      >
                        <Text className="flex-1 text-[13px] text-slate-900 dark:text-slate-100" numberOfLines={1}>
                          {l.path}
                          {l.sellable ? "" : " · không bán"}
                        </Text>
                        {l.id === (location?.id ?? "") ? (
                          <Ionicons name="checkmark" size={16} color="#10b981" />
                        ) : null}
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                    {location
                      ? ""
                      : type === "IMPORT"
                        ? "Tự động: nhập vào vị trí mặc định của kho."
                        : "Tự động: trừ theo thứ tự ưu tiên vị trí đã đặt trên web."}
                  </Text>
                )}
              </View>
            ) : null}

            <Text className="mb-1.5 mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Lý do (ghi vào nhật ký kho)
            </Text>
            <View className="mb-2 flex-row flex-wrap gap-1.5">
              {REASONS[type].map((r) => (
                <PickChip key={r} label={r} active={reason === r} onPress={() => setReason(reason === r ? "" : r)} />
              ))}
            </View>
            <TextInput
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              placeholder="Hoặc ghi lý do khác — tùy chọn"
              placeholderTextColor="#94a3b8"
              value={REASONS[type].includes(reason) ? "" : reason}
              onChangeText={setReason}
            />

            {linkState(product) !== "on" ? (
              <View className="mt-3 flex-row items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-500/40 dark:bg-amber-500/10">
                <Ionicons name="information-circle" size={18} color="#d97706" />
                <Text className="flex-1 text-[12px] leading-[18px] text-amber-800 dark:text-amber-300">
                  {linkState(product) === "unlinked"
                    ? "Sản phẩm này chưa liên kết với gian hàng nào. Số tồn chỉ đổi trong Hubsell, không đẩy lên sàn. Liên kết SKU trên web, trang Hàng hóa."
                    : "Các gian đã liên kết chưa bật đồng bộ tồn. Số tồn chỉ đổi trong Hubsell, không đẩy lên sàn. Bật đồng bộ trên web, trang Hàng hóa."}
                </Text>
              </View>
            ) : null}

          </ScrollView>
          {error ? (
            <Text className="mt-3 text-center text-[13px] font-medium text-red-600 dark:text-red-300">
              {error}
            </Text>
          ) : null}

          <ActionButton
            label={
              validQty
                ? `${type === "IMPORT" ? "Nhập" : "Xuất"} ${groupVN(qty)} — tồn còn ${groupVN(Math.max(next, 0))}`
                : type === "IMPORT"
                  ? "Nhập kho"
                  : "Xuất kho"
            }
            icon={type === "IMPORT" ? "add-circle" : "remove-circle"}
            variant={type === "IMPORT" ? "primary" : "danger"}
            className="mt-4"
            onPress={() => void submit()}
            disabled={!validQty || overExport}
            loading={busy}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
