import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { adjustStock, adjustStockBulk, fetchProducts, fetchStockLocations } from "@/api/inventory";
import { ApiError } from "@/api/client";
import type { ProductDto, StockLocationDto } from "@/types/api";
import { groupVN } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { tierLayout } from "@/lib/variant-tiers";
import { ActionButton } from "@/components/ActionButton";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { PickChip } from "@/components/FilterChips";
import { TABULAR } from "@/theme/tokens";

/** Số MẪU mỗi trang (máy chủ phân trang theo mẫu, một mẫu không bị cắt đôi). */
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
 * KHÔNG CÒN GÌ ĐỂ BÁN = tồn − đang giữ ≤ 0 (cùng luật với ô tồn web InlineStockEditor và
 * cờ isLowStock backend low-stock.ts) — SKU tồn 5 giữ 5 là hết hàng, không phải "sắp hết".
 */
const isOut = (p: ProductDto) => p.quantityInStock - p.holdQuantity <= 0;

/** Một MẪU hàng với các phân loại (SKU) của nó — sản phẩm đơn là mẫu một dòng. */
interface StockGroup {
  /** groupKey của mẫu, hoặc id của SKU đứng một mình. */
  key: string;
  name: string;
  imageUrl: string | null;
  rows: ProductDto[];
  /**
   * TỔNG phân loại của mẫu khi danh sách đang lọc / tìm (máy chủ chỉ trả dòng khớp):
   * mẫu 6 phân loại mà chỉ 1 khớp vẫn phải đọc là "1/6 phân loại", không thành sản phẩm đơn.
   */
  totalRows: number;
}

/** Gom dòng phẳng (máy chủ đã xếp theo mẫu rồi theo phân loại) thành mẫu, giữ thứ tự. */
function buildGroups(items: ProductDto[], groupTotals: Record<string, number>): StockGroup[] {
  const map = new Map<string, StockGroup>();
  const seen = new Set<string>();
  for (const p of items) {
    // Tải thêm trang trong lúc kho đang đổi có thể trả lại một SKU đã có — bỏ bản lặp.
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const key = p.groupKey ?? p.id;
    let g = map.get(key);
    if (!g) {
      g = { key, name: p.productName, imageUrl: p.imageUrl, rows: [], totalRows: 0 };
      map.set(key, g);
    }
    g.rows.push(p);
    if (!g.imageUrl && p.imageUrl) g.imageUrl = p.imageUrl;
  }
  for (const g of map.values()) {
    g.totalRows = Math.max(g.rows.length, groupTotals[g.key] ?? 0);
  }
  return [...map.values()];
}

/**
 * TỒN KHO — tab chính của Kho trên mobile (anh Trung 04/10). Chỉ làm đúng hai việc: nhập
 * thêm và xuất bớt theo số lượng. Kiểm kê, chuyển vị trí, cất lên kệ vẫn ở web.
 *
 * 05/11/2026 (anh Trung: "giống như cập nhật giá vốn, sản phẩm cha – con"): danh sách là
 * MẪU hàng, bấm vào mở hộp trượt có từng phân loại — trước đây mỗi SKU một thẻ, mẫu 6
 * phân loại là 6 thẻ trùng tên, không thấy màu / size. Máy chủ phân trang theo mẫu
 * (`/api/products?view=grouped`, cùng nguồn với bảng Tổng kho web).
 */
export function StockPage() {
  const [items, setItems] = useState<ProductDto[]>([]);
  const [groupTotals, setGroupTotals] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [skuTotal, setSkuTotal] = useState(0);
  const [outCount, setOutCount] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyOut, setOnlyOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<StockGroup | null>(null);
  const [locations, setLocations] = useState<StockLocationDto[]>([]);
  const [toast, setToast] = useState("");
  const queryRef = useRef({ search: "", onlyOut: false });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lượt tải mới nhất thắng — gõ tìm nhanh không để kết quả cũ về sau đè lên.
  const loadSeq = useRef(0);

  const notify = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  };

  const load = useCallback(async (nextPage: number, append: boolean, asRefresh = false) => {
    const seq = ++loadSeq.current;
    if (append) setLoadingMore(true);
    else if (asRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const q = queryRef.current;
      const res = await fetchProducts({
        page: nextPage,
        pageSize: PAGE_SIZE,
        search: q.search || undefined,
        grouped: true,
        stock: q.onlyOut ? "out" : undefined,
      });
      if (seq !== loadSeq.current) return;
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setGroupTotals((prev) => (append ? { ...prev, ...(res.groupTotals ?? {}) } : (res.groupTotals ?? {})));
      setPage(res.page);
      setPageCount(res.pageCount);
      setTotal(res.total);
      // Máy chủ cũ chưa có view=grouped trả danh sách phẳng, không có skuTotal → total chính là số SKU.
      setSkuTotal(res.skuTotal ?? res.total);
      setOutCount(res.outOfStockCount ?? 0);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      // Đổi bộ lọc / từ khóa mà tải hỏng: bỏ danh sách cũ, kẻo hàng của bộ lọc trước nằm dưới chip mới.
      if (!append && !asRefresh) setItems([]);
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
      queryRef.current.search = text.trim();
      void load(1, false);
    }, 450);
  };

  const toggleOnlyOut = () => {
    hapticSelect();
    const next = !onlyOut;
    setOnlyOut(next);
    queryRef.current.onlyOut = next;
    void load(1, false);
  };

  const groups = useMemo(() => buildGroups(items, groupTotals), [items, groupTotals]);

  /**
   * Sau khi nhập / xuất: ghi ngay số tồn máy chủ vừa trả, rồi đọc lại các SKU đó để có cả
   * "Có thể bán" mới (số này còn trừ tồn an toàn, app không tự tính được). Đọc lại bằng
   * tên mẫu — một lượt gọi cho cả mẫu, không gọi từng SKU.
   */
  const applySaved = async (group: StockGroup, stocks: Map<string, number>) => {
    setItems((prev) =>
      prev.map((x) => {
        const s = stocks.get(x.id);
        return s === undefined ? x : { ...x, quantityInStock: s };
      })
    );
    try {
      const res = await fetchProducts({ search: group.name, pageSize: 100 });
      const fresh = new Map(res.items.filter((x) => stocks.has(x.id)).map((x) => [x.id, x]));
      if (fresh.size > 0) setItems((prev) => prev.map((x) => fresh.get(x.id) ?? x));
    } catch {
      // Giữ số tồn máy chủ vừa trả; "Có thể bán" đúng lại ở lượt vuốt làm mới kế.
    }
    // Chip "Hết hàng N" đếm cả shop — đọc lại con số, không đụng danh sách đang xem.
    fetchProducts({ pageSize: 1 })
      .then((r) => setOutCount(r.outOfStockCount ?? 0))
      .catch(() => {});
  };

  const renderGroup = ({ item: g }: { item: StockGroup }) => {
    const multi = g.totalRows > 1;
    const single = multi ? null : g.rows[0];
    const stock = g.rows.reduce((a, p) => a + p.quantityInStock, 0);
    const sellable = g.rows.reduce((a, p) => a + p.availableToSell, 0);
    const hold = g.rows.reduce((a, p) => a + p.holdQuantity, 0);
    const outRows = g.rows.filter(isOut).length;
    const lowRows = g.rows.filter((p) => !isOut(p) && p.isLowStock).length;
    const allOut = outRows === g.rows.length;
    const unsynced = g.rows.filter((p) => linkState(p) !== "on").length;
    const allUnlinked = g.rows.every((p) => linkState(p) === "unlinked");
    // Đang lọc / tìm: chỉ một phần phân loại của mẫu nằm trong danh sách.
    const partial = g.rows.length < g.totalRows;
    return (
      <Pressable
        className="mb-2 flex-row items-center gap-3 rounded-2xl border border-slate-900/5 bg-white p-3 active:opacity-75 dark:border-white/5 dark:bg-slate-900"
        style={{ elevation: 1 }}
        onPress={() => {
          hapticTap();
          setEditing(g);
        }}
      >
        <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
          {g.imageUrl ? (
            <Image source={{ uri: g.imageUrl }} style={{ width: 48, height: 48 }} contentFit="cover" />
          ) : (
            <Ionicons name="cube-outline" size={20} color="#94a3b8" />
          )}
        </View>
        <View className="min-w-0 flex-1">
          {/* Tên cắt 2 dòng (đủ nhận mẫu; hộp nhập / xuất hiện đủ tên) */}
          <Text
            className="text-[13px] font-semibold leading-[18px] text-slate-900 dark:text-slate-100"
            numberOfLines={2}
          >
            {g.name}
          </Text>
          {single ? (
            <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
              {single.variantName ? `${single.variantName} · ` : ""}
              {single.skuCode}
            </Text>
          ) : (
            <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
              {partial ? `${g.rows.length}/${g.totalRows}` : g.totalRows} phân loại
              {outRows > 0 ? (
                <Text className="font-medium text-red-500 dark:text-red-400"> · {outRows} hết hàng</Text>
              ) : null}
              {lowRows > 0 ? (
                <Text className="font-medium text-amber-600 dark:text-amber-400"> · {lowRows} sắp hết</Text>
              ) : null}
            </Text>
          )}
          <Text className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
            Có thể bán {groupVN(sellable)}
            {hold > 0 ? ` · đang giữ ${groupVN(hold)}` : ""}
          </Text>
          {unsynced > 0 ? (
            <Text className="mt-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              {single
                ? linkState(single) === "unlinked"
                  ? "Chưa liên kết gian hàng"
                  : "Chưa bật đồng bộ tồn lên sàn"
                : allUnlinked
                  ? "Chưa liên kết gian hàng"
                  : `${unsynced}/${g.rows.length} phân loại chưa đẩy tồn lên sàn`}
            </Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text className="text-[10px] text-slate-400 dark:text-slate-500">
            {single ? "Tồn kho" : "Tổng tồn"}
          </Text>
          <Text
            className={`text-xl font-bold ${
              allOut
                ? "text-red-500 dark:text-red-400"
                : single && single.isLowStock
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-slate-900 dark:text-slate-100"
            }`}
            style={TABULAR}
          >
            {groupVN(stock)}
          </Text>
          {allOut ? (
            <Text className="text-[10px] font-semibold text-red-500 dark:text-red-400">
              {stock > 0 ? `Hết hàng · giữ ${groupVN(hold)}` : "Hết hàng"}
            </Text>
          ) : single && single.isLowStock ? (
            <Text className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Sắp hết</Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View className="flex-1">
      <View className="px-4 pb-2">
        <View className="flex-row items-center rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
          <Ionicons name="search-outline" size={16} color="#94a3b8" />
          <TextInput
            className="flex-1 px-2 py-2.5 text-sm text-slate-900 dark:text-slate-100"
            style={{ minWidth: 0 }}
            placeholder="Tìm tên sản phẩm, mã SKU, phân loại…"
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
        <View className="mt-2 flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR} numberOfLines={1}>
            {/* Web ghi "N sản phẩm · M SKU" — app nay cũng đếm theo mẫu nên dùng đúng câu đó. */}
            {loading ? " " : `${groupVN(total)} sản phẩm · ${groupVN(skuTotal)} SKU`}
          </Text>
          {/* Chip chỉ hiện khi shop có SKU hết hàng (ẩn bằng vắng mặt, như web) hoặc đang bật. */}
          {outCount > 0 || onlyOut ? (
            <PickChip label="Hết hàng" count={outCount} active={onlyOut} onPress={toggleOnlyOut} />
          ) : null}
        </View>
      </View>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1, false, true)} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!loadingMore && !error && page < pageCount) void load(page + 1, true);
          }}
          ListEmptyComponent={
            error || search.trim() || onlyOut ? (
              <Text
                className={`py-10 text-center text-sm ${
                  error ? "text-red-500 dark:text-red-400" : "text-slate-400 dark:text-slate-500"
                }`}
              >
                {error ||
                  (search.trim()
                    ? "Không tìm thấy sản phẩm nào khớp từ khóa"
                    : "Không có SKU nào hết hàng")}
              </Text>
            ) : (
              // Shop chưa có hàng trong kho: chỉ thông báo, tạo sản phẩm kho làm trên web.
              <View className="mt-6 items-center rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 dark:border-amber-500/30 dark:bg-amber-500/10">
                <Ionicons name="cube-outline" size={28} color="#d97706" />
                <Text className="mt-2 text-center text-[15px] font-bold text-slate-900 dark:text-slate-100">
                  Kho chưa có sản phẩm nào
                </Text>
                <Text className="mt-1.5 text-center text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                  Mở Hubsell trên máy tính, vào Quản lý kho → Tổng kho để tạo sản phẩm kho (tạo
                  mới hoặc sao chép từ sàn). Xong bước đó, sản phẩm sẽ hiện ở đây để nhập / xuất.
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator className="py-4" color="#64748b" /> : null
          }
          renderItem={renderGroup}
        />
      )}

      {toast ? (
        <View className="absolute inset-x-4 top-2 rounded-xl bg-slate-900 px-4 py-3 dark:bg-slate-100">
          <Text className="text-center text-xs font-medium text-white dark:text-slate-900">{toast}</Text>
        </View>
      ) : null}

      <StockSheet
        group={editing}
        locations={locations}
        onClose={() => setEditing(null)}
        onDone={(g, stocks, summary) => {
          setEditing(null);
          notify(summary);
          void applySaved(g, stocks);
        }}
      />
    </View>
  );
}

// ============================================================
// Hộp NHẬP / XUẤT của một MẪU — trượt từ dưới lên. Cộng trừ theo số lượng (không gõ đè
// tồn), luôn cho thấy trước "số cũ → số mới" để người bấm tự soát.
//   · Sản phẩm đơn: một ô số to với nút − / + (như trước 05/11).
//   · Mẫu nhiều phân loại: mỗi phân loại một dòng có ô số riêng; mẫu 2–3 tầng (màu,
//     size) chia mục theo một tầng cho dễ tìm. KHÔNG có ô "số chung cho cả mẫu" như ô Giá
//     chung của màn Giá vốn: giá vốn các phân loại thường bằng nhau, tồn thì không — gõ
//     nhầm một ô là cộng sai cả mẫu.
//   · Lưu: 1 phân loại → /adjust; từ 2 → /adjust-bulk (một giao dịch: xuất thiếu một mã
//     thì không mã nào bị ghi; máy chủ lập một Phiếu kho như "Phiếu nhiều mã" trên web).
// ============================================================
function StockSheet({
  group,
  locations,
  onClose,
  onDone,
}: {
  group: StockGroup | null;
  locations: StockLocationDto[];
  onClose: () => void;
  /** stocks: id SKU → tồn mới máy chủ trả; summary: câu báo ngắn hiện sau khi đóng hộp. */
  onDone: (group: StockGroup, stocks: Map<string, number>, summary: string) => void;
}) {
  const [type, setType] = useState<AdjustType>("IMPORT");
  /** Số lượng gõ ở từng phân loại (chuỗi số, rỗng = không đổi). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  /** Mẫu nhiều tầng: đang chia mục theo tầng nào (-1 = mặc định tầng cuối). */
  const [axis, setAxis] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (group) {
      setType("IMPORT");
      setDrafts({});
      setReason("");
      setLocOpen(false);
      setAxis(-1);
      setError("");
      // Vị trí GIỮ lựa chọn lần trước — nhập cả lô vào cùng một kệ không phải chọn lại.
    }
  }, [group]);

  if (!group) return null;

  const rows = group.rows;
  const single = rows.length === 1 && group.totalRows === 1 ? rows[0] : null;
  const location = locations.find((l) => l.id === locationId);
  // Vị trí "không bán" (kệ lỗi, chờ kiểm) KHÔNG đổi tồn bán: sổ kho chỉ cộng
  // sellableDelta vào quantityInStock (backend stock-ledger.ts). Trước 26/10 app
  // báo "10 → 15" rồi lưu xong vẫn 10, khách tưởng nhập hỏng.
  const nonSellable = location ? !location.sellable : false;

  const qtyOf = (p: ProductDto) => {
    const n = Number(drafts[p.id] ?? "");
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const nextOf = (p: ProductDto) =>
    nonSellable ? p.quantityInStock : p.quantityInStock + (type === "IMPORT" ? qtyOf(p) : -qtyOf(p));
  const overOf = (p: ProductDto) => type === "EXPORT" && !nonSellable && qtyOf(p) > p.quantityInStock;

  const changed = rows.filter((p) => qtyOf(p) > 0);
  const totalQty = changed.reduce((a, p) => a + qtyOf(p), 0);
  const anyOver = changed.some(overOf);
  const canSave = changed.length > 0 && !anyOver && !busy;

  const setQty = (p: ProductDto, text: string) =>
    setDrafts((d) => ({ ...d, [p.id]: text.replace(/[^0-9]/g, "").slice(0, 7) }));
  const step = (p: ProductDto, d: number) => {
    hapticSelect();
    const n = Math.max(0, qtyOf(p) + d);
    setDrafts((prev) => ({ ...prev, [p.id]: n === 0 ? "" : String(n) }));
  };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    const verb = type === "IMPORT" ? "nhập" : "xuất";
    const sign = type === "IMPORT" ? "+" : "−";
    try {
      const stocks = new Map<string, number>();
      let summary: string;
      if (changed.length === 1) {
        const p = changed[0];
        const res = await adjustStock({
          productId: p.id,
          type,
          quantity: qtyOf(p),
          reason: reason.trim() || undefined,
          locationId: location ? location.id : undefined,
        });
        stocks.set(p.id, res.product.quantityInStock);
        summary = `Đã ${verb} ${groupVN(qtyOf(p))} · ${p.skuCode} còn ${groupVN(res.product.quantityInStock)}`;
      } else {
        const res = await adjustStockBulk({
          type,
          items: changed.map((p) => ({ productId: p.id, quantity: qtyOf(p) })),
          reason: reason.trim() || undefined,
          locationId: location ? location.id : undefined,
        });
        for (const p of res.products) stocks.set(p.productId, p.quantityInStock);
        summary = `Đã ${verb} ${res.count} phân loại · ${sign}${groupVN(res.totalQuantity)} · phiếu ${res.voucher.code}`;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone(group, stocks, summary);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại");
    } finally {
      setBusy(false);
    }
  };

  // ----- Chia mục theo tầng phân loại (mẫu nhiều dòng, 2–3 tầng) -----
  const layout = single ? null : tierLayout(rows, (p) => p.variantName);
  const axisIdx = layout ? (axis >= 0 && axis < layout.tierCount ? axis : layout.tierCount - 1) : -1;
  const sections = layout ? layout.sections(axisIdx) : [];

  /** Một dòng phân loại: tên + mã + tồn bên trái, ô số − / + bên phải, xem trước bên dưới. */
  const variantRow = (p: ProductDto, label: string, first: boolean) => {
    const q = qtyOf(p);
    const over = overOf(p);
    const out = isOut(p);
    return (
      <View
        key={p.id}
        className={`flex-row items-center gap-3 py-2.5 ${
          first ? "" : "border-t border-slate-100 dark:border-slate-800"
        }`}
      >
        <View className="min-w-0 flex-1">
          <Text className="text-[13px] font-semibold text-slate-900 dark:text-slate-100" numberOfLines={2}>
            {label}
          </Text>
          {label !== p.skuCode ? (
            <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
              {p.skuCode}
            </Text>
          ) : null}
          <Text className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
            Tồn{" "}
            <Text
              className={`font-semibold ${
                out ? "text-red-500 dark:text-red-400" : "text-slate-700 dark:text-slate-200"
              }`}
            >
              {groupVN(p.quantityInStock)}
            </Text>
            {" · "}bán được {groupVN(p.availableToSell)}
            {p.holdQuantity > 0 ? ` · giữ ${groupVN(p.holdQuantity)}` : ""}
          </Text>
          {linkState(p) !== "on" ? (
            <Text className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {linkState(p) === "unlinked" ? "Chưa liên kết gian hàng" : "Chưa bật đồng bộ tồn"}
            </Text>
          ) : null}
        </View>
        <View className="items-end">
          <View className="flex-row items-center gap-1.5">
            <Pressable
              className="h-10 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white active:opacity-70 dark:border-slate-600 dark:bg-slate-800"
              onPress={() => step(p, -1)}
              accessibilityLabel={`Giảm số lượng ${label}`}
            >
              <Ionicons name="remove" size={18} color="#64748b" />
            </Pressable>
            <TextInput
              className={`h-10 w-[58px] rounded-xl border bg-slate-50 text-center text-base font-bold text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${
                over
                  ? "border-red-400 dark:border-red-500/70"
                  : q > 0
                    ? "border-emerald-400 dark:border-emerald-500/70"
                    : "border-slate-300 dark:border-slate-600"
              }`}
              // minWidth 0: ô nhập trên web có bề rộng tối thiểu riêng, không ép thì đẩy cả dòng tràn ngang.
              style={[TABULAR, { minWidth: 0, paddingVertical: 0 }]}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#94a3b8"
              value={drafts[p.id] ?? ""}
              onChangeText={(t) => setQty(p, t)}
              accessibilityLabel={`Số lượng ${type === "IMPORT" ? "nhập" : "xuất"} ${label}`}
            />
            <Pressable
              className="h-10 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white active:opacity-70 dark:border-slate-600 dark:bg-slate-800"
              onPress={() => step(p, 1)}
              accessibilityLabel={`Tăng số lượng ${label}`}
            >
              <Ionicons name="add" size={18} color="#64748b" />
            </Pressable>
          </View>
          {over ? (
            <Text className="mt-1 text-[10px] font-semibold text-red-500 dark:text-red-400" style={TABULAR}>
              Kho chỉ còn {groupVN(p.quantityInStock)}
            </Text>
          ) : q > 0 ? (
            <Text className="mt-1 text-[10px] text-slate-500 dark:text-slate-400" style={TABULAR}>
              {groupVN(p.quantityInStock)} →{" "}
              <Text className="font-bold text-slate-900 dark:text-slate-100">{groupVN(nextOf(p))}</Text>
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  const unsynced = rows.filter((p) => linkState(p) !== "on");

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
            {/* Đầu hộp: ảnh + tên ĐỦ (xuống dòng) */}
            <View className="mb-3 flex-row items-start gap-3">
              {single ? null : (
                <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                  {group.imageUrl ? (
                    <Image source={{ uri: group.imageUrl }} style={{ width: 48, height: 48 }} contentFit="cover" />
                  ) : (
                    <Ionicons name="cube-outline" size={20} color="#94a3b8" />
                  )}
                </View>
              )}
              <View className="min-w-0 flex-1">
                <Text className="text-base font-bold leading-[21px] text-slate-900 dark:text-slate-100">
                  {group.name}
                </Text>
                <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" style={TABULAR}>
                  {single
                    ? `${single.variantName ? `${single.variantName} · ` : ""}${single.skuCode}`
                    : rows.length < group.totalRows
                      ? `Đang hiện ${rows.length}/${group.totalRows} phân loại khớp bộ lọc`
                      : `${rows.length} phân loại`}
                </Text>
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

            {single ? (
              <>
                {/* Số lượng: nút − / + to cho tay đeo găng, ô giữa gõ số trực tiếp */}
                <View className="flex-row items-center gap-3">
                  <Pressable
                    className="h-14 w-14 items-center justify-center rounded-2xl border border-slate-300 bg-white active:opacity-70 dark:border-slate-600 dark:bg-slate-800"
                    onPress={() => step(single, -1)}
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
                    value={drafts[single.id] ?? ""}
                    onChangeText={(t) => setQty(single, t)}
                    autoFocus
                  />
                  <Pressable
                    className="h-14 w-14 items-center justify-center rounded-2xl border border-slate-300 bg-white active:opacity-70 dark:border-slate-600 dark:bg-slate-800"
                    onPress={() => step(single, 1)}
                    accessibilityLabel="Tăng số lượng"
                  >
                    <Ionicons name="add" size={24} color="#64748b" />
                  </Pressable>
                </View>

                {/* Xem trước số cũ → số mới */}
                <View
                  className={`mt-3 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2.5 ${
                    overOf(single) ? "bg-red-50 dark:bg-red-500/10" : "bg-slate-100 dark:bg-slate-800"
                  }`}
                >
                  {overOf(single) ? (
                    <Text className="text-center text-[13px] font-medium text-red-600 dark:text-red-300">
                      Kho chỉ còn {groupVN(single.quantityInStock)}, không xuất được {groupVN(qtyOf(single))}
                    </Text>
                  ) : (
                    <>
                      <Text className="text-xs text-slate-500 dark:text-slate-400">Tồn kho</Text>
                      <Text className="text-base font-bold text-slate-500 dark:text-slate-400" style={TABULAR}>
                        {groupVN(single.quantityInStock)}
                      </Text>
                      <Ionicons name="arrow-forward" size={14} color="#94a3b8" />
                      <Text className="text-base font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
                        {qtyOf(single) > 0 ? groupVN(nextOf(single)) : "—"}
                      </Text>
                      {qtyOf(single) > 0 ? (
                        <Text
                          className={`text-xs font-semibold ${
                            type === "IMPORT"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-500 dark:text-red-400"
                          }`}
                          style={TABULAR}
                        >
                          ({type === "IMPORT" ? "+" : "−"}
                          {groupVN(qtyOf(single))})
                        </Text>
                      ) : null}
                    </>
                  )}
                </View>
              </>
            ) : layout ? (
              <>
                {/* Chia mục theo tầng: chip = hai giá trị đầu của tầng đó ("Hồng, Vàng…" / "5-7kg, 7-9kg…") */}
                <View className="mb-1 flex-row flex-wrap items-center gap-1.5">
                  <Text className="mr-1 text-[11px] text-slate-500 dark:text-slate-400">Xếp theo</Text>
                  {layout.axes.map((a) => (
                    <PickChip
                      key={a.index}
                      label={a.label}
                      count={a.count}
                      active={a.index === axisIdx}
                      onPress={() => {
                        hapticSelect();
                        setAxis(a.index);
                      }}
                    />
                  ))}
                </View>
                {sections.map((sec) => {
                  const secQty = sec.rows.reduce((a, p) => a + qtyOf(p), 0);
                  return (
                    <View key={sec.key} className="mt-2">
                      <View className="flex-row items-center justify-between rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800">
                        <Text className="flex-1 text-[12px] font-bold text-slate-700 dark:text-slate-200" numberOfLines={1}>
                          {sec.key}
                          <Text className="font-normal text-slate-400 dark:text-slate-500">
                            {"  "}
                            {sec.rows.length} phân loại
                          </Text>
                        </Text>
                        {secQty > 0 ? (
                          <Text
                            className={`text-[12px] font-bold ${
                              type === "IMPORT"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-500 dark:text-red-400"
                            }`}
                            style={TABULAR}
                          >
                            {type === "IMPORT" ? "+" : "−"}
                            {groupVN(secQty)}
                          </Text>
                        ) : null}
                      </View>
                      {sec.rows.map((p, i) =>
                        variantRow(p, layout.restLabel(p, axisIdx) || p.skuCode, i === 0)
                      )}
                    </View>
                  );
                })}
              </>
            ) : (
              rows.map((p, i) => variantRow(p, p.variantName || p.skuCode, i === 0))
            )}

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
                      ? nonSellable
                        ? "Vị trí không bán: hàng vào kho chờ kiểm, tồn bán giữ nguyên."
                        : ""
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

            {unsynced.length > 0 ? (
              <View className="mt-3 flex-row items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-500/40 dark:bg-amber-500/10">
                <Ionicons name="information-circle" size={18} color="#d97706" />
                <Text className="flex-1 text-[12px] leading-[18px] text-amber-800 dark:text-amber-300">
                  {single
                    ? linkState(single) === "unlinked"
                      ? "Sản phẩm này chưa liên kết với gian hàng nào. Số tồn chỉ đổi trong Hubsell, không đẩy lên sàn. Nối gian trên web, trang Sản phẩm trên sàn."
                      : "Các gian đã liên kết chưa bật đồng bộ tồn. Số tồn chỉ đổi trong Hubsell, không đẩy lên sàn. Bật trên web, trang Tổng kho, nút Đồng bộ tồn kho."
                    : `${unsynced.length}/${rows.length} phân loại chưa đẩy tồn lên sàn (chưa nối gian, hoặc gian chưa bật đồng bộ). Số tồn của các phân loại đó chỉ đổi trong Hubsell. Nối gian ở trang Sản phẩm trên sàn, bật đồng bộ ở trang Tổng kho trên web.`}
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
              changed.length === 0
                ? type === "IMPORT"
                  ? "Nhập kho"
                  : "Xuất kho"
                : changed.length === 1
                  ? nonSellable
                    ? `${type === "IMPORT" ? "Nhập" : "Xuất"} ${groupVN(totalQty)} kho chờ kiểm — tồn bán giữ ${groupVN(changed[0].quantityInStock)}`
                    : `${type === "IMPORT" ? "Nhập" : "Xuất"} ${groupVN(totalQty)} — tồn còn ${groupVN(Math.max(nextOf(changed[0]), 0))}`
                  : `${type === "IMPORT" ? "Nhập" : "Xuất"} ${changed.length} phân loại · ${type === "IMPORT" ? "+" : "−"}${groupVN(totalQty)}`
            }
            icon={type === "IMPORT" ? "add-circle" : "remove-circle"}
            variant={type === "IMPORT" ? "primary" : "danger"}
            className="mt-4"
            onPress={() => void submit()}
            disabled={!canSave}
            loading={busy}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
