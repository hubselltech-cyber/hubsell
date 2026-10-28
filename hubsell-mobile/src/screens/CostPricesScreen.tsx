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
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import {
  fetchMissingCostSkus,
  fetchSkuProducts,
  updateSkuCostPrice,
  updateSkuCostPriceBulk,
} from "@/api/cost-prices";
import { ApiError } from "@/api/client";
import type { CatalogPendingChannel, ChannelName, MissingCostSku, SkuProduct } from "@/types/api";
import { rangeFor } from "@/lib/dates";
import { compactMoney, groupVN, num } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { CHANNEL_LABEL } from "@/lib/labels";
import { useChannelColors } from "@/theme/channel-colors";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { Card } from "@/components/Card";
import { PickChip } from "@/components/FilterChips";
import { ShopFilterField, type ShopOption, type ShopScope } from "@/components/ShopFilter";
import { TABULAR } from "@/theme/tokens";

/**
 * MÀN GIÁ VỐN (28/10/2026, bản 2 sau khi anh Trung phản biện) — bản RÚT GỌN
 * có chủ đích của trang Cấu hình giá vốn web: chỉ làm "nhập nhanh cái thiếu".
 *
 *   · Danh sách = MẪU SẢN PHẨM (gian + mã sản phẩm sàn — danh tính theo id, KHÔNG
 *     theo tên, luật 22/10 DONG-BO-SAN-PHAM-TRUNG-MA-PHAN-LOAI). Web xổ bảng cha–con
 *     ngay trong danh sách; màn hẹp không có chỗ nên con nằm trong HỘP TRƯỢT:
 *     bấm mẫu → mỗi phân loại một ô giá + ô "Giá chung cho cả mẫu". Phân loại 2–3 tầng (màu, size): nhóm theo
 *     một tầng (mặc định tầng cuối), mỗi nhóm một ô giá chung, mở rộng mới
 *     thấy từng dòng — mẫu 25 phân loại (5 màu × 5 size) chỉ còn 5 ô.
 *   · Tab CẦN NHẬP = mẫu có SKU đã bán 30 ngày chưa có giá vốn, xếp theo số đơn
 *     bị loại khỏi lợi nhuận (missing-cost); tab TẤT CẢ = tìm + chip "Chưa có giá".
 *   · Bộ lọc chỉ GIAN HÀNG (chọn gian là biết sàn) — bỏ lọc sàn / đã gỡ của web.
 *   · Tên sản phẩm: danh sách cắt 2 dòng, mã SKU luôn đủ; hộp nhập hiện đủ tên,
 *     phân loại, mã SKU, mã sàn + nút sao chép (web dùng tooltip, mobile không có).
 * KHÔNG có Excel, Mapping theo mã, Bảng giá mẫu, Áp giá cho đơn cũ — ở web.
 * Luật giữ nguyên: đơn cũ đã có giá vốn không bị áp giá mới (backend chỉ lấp
 * dòng = 0, trả backfilledOrderLines); giá ghi là giá riêng của gian.
 */

type Tab = "missing" | "all";

/** Bỏ dấu + thường hóa để tìm "ao thun" ra "Áo Thun". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const keyExt = (channelId: string, externalId: string | null | undefined) =>
  externalId ? `${channelId}|e|${externalId}` : "";
const keySku = (channelId: string, sku: string) => `${channelId}|s|${sku.trim().toUpperCase()}`;
/** Khóa MẪU: gian + mã sản phẩm sàn; hàng không có mã sàn = một mẫu một dòng. */
const modelKeyOf = (it: SkuProduct) =>
  it.channelId && it.itemId ? `${it.channelId}|${it.itemId}` : `one|${it.skuId}`;

/** Một mẫu sản phẩm trên một gian với các phân loại (chỉ dòng đang bán). */
interface ModelGroup {
  key: string;
  name: string;
  imageUrl: string | null;
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  itemId: string | null;
  rows: SkuProduct[];
  /** Số phân loại chưa có giá vốn. */
  missing: number;
  /** Số đơn 30 ngày bị loại khỏi lợi nhuận (tab Cần nhập). */
  orders: number;
  /** Mã SKU cho tìm kiếm — gộp mọi phân loại. */
  haystack: string;
}

function buildGroups(items: SkuProduct[]): Map<string, ModelGroup> {
  const m = new Map<string, ModelGroup>();
  for (const it of items) {
    if (it.status !== "ACTIVE") continue;
    const k = modelKeyOf(it);
    let g = m.get(k);
    if (!g) {
      g = {
        key: k,
        name: it.productName,
        imageUrl: it.imageUrl,
        channelId: it.channelId,
        channelName: it.channelName,
        shopName: it.shopName,
        itemId: it.itemId,
        rows: [],
        missing: 0,
        orders: 0,
        haystack: "",
      };
      m.set(k, g);
    }
    g.rows.push(it);
    if (!g.imageUrl && it.imageUrl) g.imageUrl = it.imageUrl;
    if (num(it.costPrice) <= 0) g.missing += 1;
    g.haystack += ` ${fold(it.sku)} ${fold(it.variantName ?? "")} ${it.itemId ?? ""} ${it.modelId ?? ""}`;
  }
  for (const g of m.values()) g.haystack = `${fold(g.name)} ${g.haystack}`;
  return m;
}

/** Giá vốn hiển thị của một mẫu: một số / khoảng / thiếu. */
function groupPrice(g: ModelGroup): { text: string; tone: "ok" | "warn" | "mixed" } {
  const priced = g.rows.map((r) => num(r.costPrice)).filter((c) => c > 0);
  if (priced.length === 0) return { text: "Chưa có giá vốn", tone: "warn" };
  const min = Math.min(...priced);
  const max = Math.max(...priced);
  if (min === max) return { text: `${groupVN(min)} ₫`, tone: g.missing > 0 ? "warn" : "ok" };
  return { text: `${compactMoney(min)} – ${compactMoney(max)}`, tone: "mixed" };
}

export function CostPricesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useChannelColors();

  const [tab, setTab] = useState<Tab>("missing");
  const [items, setItems] = useState<SkuProduct[]>([]);
  const [missing, setMissing] = useState<MissingCostSku[]>([]);
  const [missingOrders, setMissingOrders] = useState(0);
  const [missingCount, setMissingCount] = useState(0);
  const [catalogPending, setCatalogPending] = useState<CatalogPendingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ShopScope>({ channelName: "", channelId: "" });
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<ModelGroup | null>(null);
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  const load = useCallback(async (mode: "first" | "pull" | "silent") => {
    if (mode === "pull") setRefreshing(true);
    else if (mode === "first") setLoading(true);
    try {
      const { from, to } = rangeFor("30d");
      const [cat, miss] = await Promise.all([
        fetchSkuProducts(),
        fetchMissingCostSkus(from, to).catch(() => null),
      ]);
      setItems(cat.items);
      setMissingCount(cat.missingCostCount);
      setCatalogPending(cat.catalogPending ?? []);
      setMissing(miss?.items ?? []);
      setMissingOrders(miss?.orderCount ?? 0);
      setError("");
    } catch (err) {
      if (mode !== "silent") setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("first");
  }, [load]);

  useEffect(() => {
    if (catalogPending.length === 0) return;
    const t = setInterval(() => void load("silent"), 15_000);
    return () => clearInterval(t);
  }, [catalogPending.length, load]);

  // Gõ tìm: chờ 200 ms rồi mới lọc — gian vài nghìn SKU không giật theo từng phím.
  const onSearch = (t: string) => {
    setSearch(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(t), 200);
  };

  /** Gian hàng có trong danh mục — nguồn cho bộ lọc (không gọi thêm API). */
  const shops = useMemo<ShopOption[]>(() => {
    const seen = new Map<string, ShopOption>();
    for (const it of items) {
      if (it.channelId && !seen.has(it.channelId)) {
        seen.set(it.channelId, { id: it.channelId, shopName: it.shopName, channelName: it.channelName });
      }
    }
    return [...seen.values()];
  }, [items]);

  const groups = useMemo(() => buildGroups(items), [items]);

  const byKey = useMemo(() => {
    const m = new Map<string, SkuProduct>();
    for (const it of items) {
      if (!it.channelId) continue;
      const ke = keyExt(it.channelId, it.externalId);
      if (ke && !m.has(ke)) m.set(ke, it);
      const ks = keySku(it.channelId, it.sku);
      if (!m.has(ks)) m.set(ks, it);
    }
    return m;
  }, [items]);

  /** Tab Cần nhập: mẫu có dòng thiếu giá vốn trong sổ cái 30 ngày, cộng dồn số đơn. */
  const missingGroups = useMemo(() => {
    const out = new Map<string, ModelGroup>();
    const orphans: ModelGroup[] = [];
    for (const r of missing) {
      const sku =
        byKey.get(keyExt(r.channelId, r.externalId)) ?? byKey.get(keySku(r.channelId, r.channelSku));
      if (sku && num(sku.costPrice) > 0) continue; // vừa lưu, sổ cái chưa tính lại
      if (!sku) {
        // Mã trên đơn không còn trong danh mục gian (đổi mã / gỡ) — không nhập được từ đây.
        orphans.push({
          key: `orphan|${r.channelId}|${r.externalId ?? ""}|${r.channelSku}`,
          name: r.productName,
          imageUrl: null,
          channelId: r.channelId,
          channelName: "SHOPEE",
          shopName: "",
          itemId: null,
          rows: [],
          missing: 0,
          orders: r.orders,
          haystack: `${fold(r.productName)} ${fold(r.channelSku)}`,
        });
        continue;
      }
      const base = groups.get(modelKeyOf(sku));
      if (!base) continue;
      let g = out.get(base.key);
      if (!g) {
        g = { ...base, orders: 0 };
        out.set(base.key, g);
      }
      g.orders += r.orders;
    }
    return [...out.values(), ...orphans].sort((a, b) => b.orders - a.orders);
  }, [missing, byKey, groups]);

  const q = fold(query.trim());
  const inScope = (g: ModelGroup) =>
    (!scope.channelId || g.channelId === scope.channelId) &&
    (!scope.channelName || g.channelName === scope.channelName);
  const matches = (g: ModelGroup) => !q || g.haystack.includes(q);

  const missingFiltered = useMemo(
    () => missingGroups.filter((g) => inScope(g) && matches(g)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [missingGroups, q, scope]
  );
  const allFiltered = useMemo(
    () => [...groups.values()].filter((g) => inScope(g) && matches(g) && (!onlyMissing || g.missing > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, q, scope, onlyMissing]
  );

  const applyLocal = (prices: Map<string, number>) => {
    setItems((prev) =>
      prev.map((x) => {
        const c = prices.get(x.skuId);
        return c === undefined ? x : { ...x, costPrice: String(c), costSource: "shop" };
      })
    );
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate("/(admin)/home");
  };

  const renderGroup = (g: ModelGroup, showOrders: boolean) => {
    const orphan = g.rows.length === 0;
    const price = orphan ? null : groupPrice(g);
    const single = g.rows.length === 1 ? g.rows[0] : null;
    return (
      <Pressable
        className={`flex-row items-start gap-3 border-b border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 ${
          orphan ? "opacity-60" : "active:bg-slate-50 dark:active:bg-slate-800"
        }`}
        disabled={orphan}
        onPress={() => {
          hapticTap();
          setEditing(g);
        }}
      >
        <View className="h-12 w-12 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
          {g.imageUrl ? (
            <Image source={{ uri: g.imageUrl }} style={{ width: 48, height: 48 }} contentFit="cover" />
          ) : (
            <View className="h-12 w-12 items-center justify-center">
              <Ionicons name={orphan ? "help-outline" : "cube-outline"} size={18} color="#94a3b8" />
            </View>
          )}
        </View>
        <View className="min-w-0 flex-1">
          {/* Tên cắt 2 dòng (đủ nhận mẫu, phần đuôi xem đủ trong hộp nhập) */}
          <Text className="text-[13px] font-medium leading-[18px] text-slate-900 dark:text-slate-100" numberOfLines={2}>
            {g.name}
          </Text>
          {orphan ? (
            <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Mã không còn trên gian · nhập ở web
            </Text>
          ) : single ? (
            <>
              {single.variantName ? (
                <Text className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400" numberOfLines={1}>
                  {single.variantName}
                </Text>
              ) : null}
              {/* Mã SKU KHÔNG cắt — dài thì xuống dòng */}
              <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
                {single.sku}
              </Text>
            </>
          ) : (
            <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {g.rows.length} phân loại
              {g.missing > 0 ? (
                <Text className="text-amber-600 dark:text-amber-400"> · {g.missing} chưa có giá</Text>
              ) : null}
            </Text>
          )}
          <View className="mt-1 flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors[g.channelName] }} />
            <Text className="text-[11px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
              {g.shopName || CHANNEL_LABEL[g.channelName]}
            </Text>
          </View>
        </View>
        <View className="items-end">
          {price ? (
            <Text
              className={`text-[13px] font-semibold ${
                price.tone === "warn"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-slate-900 dark:text-slate-100"
              }`}
              style={TABULAR}
            >
              {price.text}
            </Text>
          ) : null}
          {showOrders ? (
            <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
              {groupVN(g.orders)} đơn
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const header = (
    <View className="px-4 pb-2">
      <SegmentedTabs
        className="mb-3"
        options={[
          { key: "missing", label: `Cần nhập${missingGroups.length ? ` · ${groupVN(missingGroups.length)}` : ""}` },
          { key: "all", label: "Tất cả" },
        ]}
        value={tab}
        onChange={(k) => {
          hapticSelect();
          setTab(k);
        }}
      />
      <View className="flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
        <Ionicons name="search" size={16} color="#94a3b8" />
        <TextInput
          className="h-10 flex-1 text-sm text-slate-900 dark:text-slate-100"
          style={{ minWidth: 0 }}
          placeholder="Tìm theo mã SKU, tên, mã sản phẩm sàn"
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={onSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search ? (
          <Pressable onPress={() => onSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color="#94a3b8" />
          </Pressable>
        ) : null}
      </View>
      {/* Bộ lọc: gian hàng (chọn gian là biết sàn) + chip Chưa có giá (tab Tất cả) */}
      <View className="mt-2 flex-row items-center gap-2">
        <ShopFilterField mode="scope" channels={shops} value={scope} onChange={setScope} compact />
        {tab === "all" ? (
          <PickChip
            label="Chưa có giá"
            count={[...groups.values()].filter((g) => inScope(g) && g.missing > 0).length}
            active={onlyMissing}
            onPress={() => {
              hapticSelect();
              setOnlyMissing((v) => !v);
            }}
          />
        ) : null}
      </View>
      {tab === "missing" ? (
        <Text className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
          {missingGroups.length > 0
            ? `${groupVN(missingOrders)} đơn trong 30 ngày đang bị loại khỏi lợi nhuận vì thiếu giá vốn — nhập từ mẫu nhiều đơn nhất.`
            : missingCount > 0
              ? `Đơn 30 ngày đã đủ giá vốn. Còn ${groupVN(missingCount)} SKU đang bán chưa có giá — xem ở Tất cả.`
              : "Mọi SKU đang bán đã có giá vốn."}
        </Text>
      ) : (
        <Text className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          {groupVN(allFiltered.length)} mẫu
          {missingCount > 0 ? ` · ${groupVN(missingCount)} SKU chưa có giá vốn` : ""}
        </Text>
      )}
      {catalogPending.length > 0 ? (
        <View className="mt-2 flex-row items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
          <ActivityIndicator size="small" color="#d97706" />
          <Text className="flex-1 text-[11px] text-amber-800 dark:text-amber-300">
            Đang kéo danh mục sản phẩm của {catalogPending.map((c) => c.shopName).join(", ")}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const data = tab === "missing" ? missingFiltered : allFiltered;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 6 }}>
      <View className="mb-1 flex-row items-center gap-1 px-2">
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
        >
          <Ionicons name="chevron-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Giá vốn</Text>
      </View>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : error ? (
        <Card className="mx-4 items-center p-6">
          <Text className="text-center text-sm text-red-600 dark:text-red-400">{error}</Text>
          <Pressable className="mt-3" onPress={() => void load("first")}>
            <Text className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Thử lại</Text>
          </Pressable>
        </Card>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(g) => g.key}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("pull")} />}
          contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
          ListEmptyComponent={
            <View className="items-center px-6 py-12">
              <Ionicons
                name={tab === "missing" && !q ? "checkmark-circle-outline" : "search-outline"}
                size={32}
                color={tab === "missing" && !q ? "#10b981" : "#94a3b8"}
              />
              <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                {q
                  ? "Không có mẫu nào khớp từ khóa"
                  : tab === "missing"
                    ? "Không còn SKU bán trong 30 ngày thiếu giá vốn"
                    : onlyMissing
                      ? "Mọi mẫu trong phạm vi này đã có giá vốn"
                      : "Chưa có SKU nào — gian vừa nối thì chờ danh mục về"}
              </Text>
            </View>
          }
          renderItem={({ item }) => renderGroup(item, tab === "missing")}
        />
      )}

      {toast ? (
        <View className="absolute inset-x-4 top-20 rounded-xl bg-slate-900 px-4 py-3 dark:bg-slate-100">
          <Text className="text-center text-xs font-medium text-white dark:text-slate-900">{toast}</Text>
        </View>
      ) : null}

      <ModelSheet
        group={editing}
        onClose={() => setEditing(null)}
        onCopied={() => notify("Đã sao chép mã")}
        onSaved={(prices, backfilled) => {
          setEditing(null);
          applyLocal(prices);
          const n = prices.size;
          const vals = new Set(prices.values());
          const tail = backfilled ? ` · tính lại ${groupVN(backfilled)} dòng đơn cũ` : "";
          notify(
            n > 1
              ? vals.size === 1
                ? `Đã đặt ${groupVN([...vals][0])} ₫ cho ${n} phân loại${tail}`
                : `Đã lưu giá vốn ${n} phân loại${tail}`
              : `Đã lưu giá vốn ${groupVN([...vals][0])} ₫${tail}`
          );
        }}
      />
    </View>
  );
}

// ============================================================
// HỘP NHẬP GIÁ CHO MỘT MẪU — trượt từ dưới lên. Hiện ĐỦ tên, phân loại, mã SKU,
// mã sàn (+ sao chép). Mẫu nhiều phân loại: ô "Giá chung" điền một lần cho
// mọi ô, từng ô vẫn sửa riêng được. Lưu = gọi bulk khi mọi ô cùng giá, còn lại
// từng dòng.
// ============================================================
function ModelSheet({
  group,
  onClose,
  onCopied,
  onSaved,
}: {
  group: ModelGroup | null;
  onClose: () => void;
  onCopied: () => void;
  onSaved: (prices: Map<string, number>, backfilled: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useChannelColors();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [common, setCommon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Phân loại 2–3 tầng ("Hồng, 5-7kg"): nhóm theo tầng nào (chỉ số tầng). */
  const [axis, setAxis] = useState(-1);
  /** Nhóm đang mở rộng để sửa từng dòng. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (group) {
      const d: Record<string, string> = {};
      for (const r of group.rows) {
        const c = num(r.costPrice);
        d[r.skuId] = c > 0 ? String(Math.round(c)) : "";
      }
      setDrafts(d);
      setCommon("");
      setError("");
      setAxis(-1);
      setExpanded(new Set());
    }
  }, [group]);

  if (!group) return null;
  const rows = group.rows;
  const multi = rows.length > 1;
  const digits = (t: string) => t.replace(/[^0-9]/g, "").slice(0, 12);

  // ----- Tầng phân loại: cả 3 sàn nối tên tầng bằng ", " (Shopee model_name,
  // TikTok sales_attributes, Lazada saleProp — backend normalizeVariantName).
  // Đủ điều kiện nhóm khi mọi dòng cùng số tầng ≥ 2 và ≥ 4 dòng (ít hơn thì
  // danh sách phẳng đã đủ nhìn).
  const tiersOf = (r: SkuProduct) =>
    (r.variantName ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const tierCount = rows.length ? tiersOf(rows[0]).length : 0;
  const tiered =
    multi && tierCount >= 2 && rows.length >= 4 && rows.every((r) => tiersOf(r).length === tierCount);
  // Mặc định nhóm theo tầng CUỐI (sàn hay xếp "Màu, Size"; giá vốn lệch theo size
  // nhiều hơn theo màu) — khách đổi trục bằng chip.
  const axisIdx = tiered ? (axis >= 0 ? axis : tierCount - 1) : -1;
  const axisOptions = tiered
    ? Array.from({ length: tierCount }, (_, i) => {
        const vals = [...new Set(rows.map((r) => tiersOf(r)[i]))];
        return { i, label: `${vals.slice(0, 2).join(", ")}${vals.length > 2 ? "…" : ""}`, count: vals.length };
      })
    : [];
  const tierGroups: { key: string; rows: SkuProduct[] }[] = [];
  if (tiered) {
    const m = new Map<string, SkuProduct[]>();
    for (const r of rows) {
      const k = tiersOf(r)[axisIdx];
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    for (const [key, list] of m) tierGroups.push({ key, rows: list });
  }
  /** Nhãn dòng con trong nhóm = các tầng còn lại ("Hồng" khi đang nhóm theo size). */
  const restLabel = (r: SkuProduct) =>
    tiersOf(r)
      .filter((_, i) => i !== axisIdx)
      .join(", ") || r.sku;
  const setGroupPrice = (list: SkuProduct[], d: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of list) next[r.skuId] = d;
      return next;
    });
  /** Giá chung của nhóm: mọi ô bằng nhau → số đó; khác nhau → null ("nhiều giá"). */
  const groupDraft = (list: SkuProduct[]) => {
    const vals = new Set(list.map((r) => drafts[r.skuId] ?? ""));
    return vals.size === 1 ? [...vals][0] : null;
  };

  /** Dòng có giá thay đổi so với giá đang lưu → map skuId → giá mới. */
  const changes = new Map<string, number>();
  for (const r of rows) {
    const t = drafts[r.skuId] ?? "";
    if (t === "") continue;
    const v = Number(t);
    if (!Number.isFinite(v) || v < 0) continue;
    if (v !== Math.round(num(r.costPrice))) changes.set(r.skuId, v);
  }
  const canSave = changes.size > 0 && !busy;

  const copy = async (text: string) => {
    hapticTap();
    await Clipboard.setStringAsync(text);
    onCopied();
  };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      let backfilled = 0;
      const vals = new Set(changes.values());
      if (changes.size > 1 && vals.size === 1) {
        const r = await updateSkuCostPriceBulk([...changes.keys()], [...vals][0]);
        backfilled = r.backfilledOrderLines;
      } else {
        // Từng dòng, tuần tự — tối đa vài chục phân loại/mẫu, không cần song song.
        for (const [skuId, cost] of changes) {
          const r = await updateSkuCostPrice(skuId, cost);
          backfilled += r.backfilledOrderLines;
        }
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(changes, backfilled);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại");
    } finally {
      setBusy(false);
    }
  };

  const externalCode = (r: SkuProduct) => r.externalId ?? (r.itemId ? `${r.itemId}${r.modelId ? `-${r.modelId}` : ""}` : "");

  const priceInput = (r: SkuProduct, autoFocus: boolean) => {
    const selling = num(r.sellingPrice);
    const t = drafts[r.skuId] ?? "";
    const v = t === "" ? null : Number(t);
    const margin = v !== null && selling > 0 ? Math.round(((selling - v) / selling) * 1000) / 10 : null;
    return (
      <View className="items-end">
        <TextInput
          className={`h-11 w-[132px] rounded-xl border bg-slate-50 px-3 text-right text-base font-bold text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${
            t === "" ? "border-amber-300 dark:border-amber-500/60" : "border-slate-300 dark:border-slate-600"
          }`}
          style={[TABULAR, { minWidth: 0 }]}
          keyboardType="number-pad"
          placeholder="Giá vốn"
          placeholderTextColor="#94a3b8"
          value={t ? groupVN(Number(t)) : ""}
          onChangeText={(x) => setDrafts((d) => ({ ...d, [r.skuId]: digits(x) }))}
          autoFocus={autoFocus}
        />
        <Text className="mt-1 text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
          {selling > 0 ? `Bán ${groupVN(selling)} ₫` : "—"}
          {margin !== null ? (
            <Text className={margin < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}>
              {" "}· biên {String(margin).replace(".", ",")}%
            </Text>
          ) : null}
        </Text>
      </View>
    );
  };

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView className="flex-1 justify-end bg-black/40" behavior="padding">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ maxHeight: "92%", paddingBottom: 16 + insets.bottom }}
        >
          <View className="mb-2 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Đầu hộp: tên ĐỦ (xuống dòng), gian */}
            <View className="mb-3 flex-row items-start gap-3">
              <View className="h-14 w-14 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                {group.imageUrl ? (
                  <Image source={{ uri: group.imageUrl }} style={{ width: 56, height: 56 }} contentFit="cover" />
                ) : null}
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-bold leading-[21px] text-slate-900 dark:text-slate-100">
                  {group.name}
                </Text>
                <View className="mt-1 flex-row items-center gap-1.5">
                  <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors[group.channelName] }} />
                  <Text className="text-xs text-slate-500 dark:text-slate-400">
                    {CHANNEL_LABEL[group.channelName]} · {group.shopName}
                  </Text>
                </View>
              </View>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color="#64748b" />
              </Pressable>
            </View>

            {multi ? (
              <>
                {/* Giá chung: gõ một lần điền mọi ô (kể cả ô đã có giá — khách chủ
                    động gõ ở đây là muốn cả mẫu cùng giá; từng ô vẫn sửa lại được). */}
                <View className="mb-3 flex-row items-center justify-between rounded-2xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-500/10">
                  <View className="flex-1 pr-3">
                    <Text className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300">
                      Giá chung cho cả mẫu
                    </Text>
                    <Text className="text-[10px] text-emerald-700/80 dark:text-emerald-300/70">
                      Điền cho {rows.length} phân loại, sửa riêng bên dưới nếu khác
                    </Text>
                  </View>
                  <TextInput
                    className="h-11 w-[132px] rounded-xl border border-emerald-300 bg-white px-3 text-right text-base font-bold text-slate-900 dark:border-emerald-500/50 dark:bg-slate-950 dark:text-slate-100"
                    style={[TABULAR, { minWidth: 0 }]}
                    keyboardType="number-pad"
                    placeholder="Giá vốn"
                    placeholderTextColor="#94a3b8"
                    value={common ? groupVN(Number(common)) : ""}
                    onChangeText={(x) => {
                      const d = digits(x);
                      setCommon(d);
                      setDrafts((prev) => {
                        const next = { ...prev };
                        for (const r of rows) next[r.skuId] = d;
                        return next;
                      });
                    }}
                    autoFocus
                  />
                </View>
                {tiered ? (
                  <>
                    {/* Trục nhóm: chip = hai giá trị đầu của tầng đó ("Hồng, Vàng…" / "5-7kg, 7-9kg…") */}
                    <View className="mb-1 flex-row flex-wrap items-center gap-1.5">
                      <Text className="mr-1 text-[11px] text-slate-500 dark:text-slate-400">Nhóm theo</Text>
                      {axisOptions.map((o) => (
                        <PickChip
                          key={o.i}
                          label={o.label}
                          count={o.count}
                          active={o.i === axisIdx}
                          onPress={() => {
                            hapticSelect();
                            setAxis(o.i);
                            setExpanded(new Set());
                          }}
                        />
                      ))}
                    </View>
                    {tierGroups.map((tg) => {
                      const open = expanded.has(tg.key);
                      const gd = groupDraft(tg.rows);
                      const miss = tg.rows.filter((r) => (drafts[r.skuId] ?? "") === "").length;
                      const toggle = () => {
                        hapticSelect();
                        setExpanded((prev) => {
                          const n = new Set(prev);
                          if (n.has(tg.key)) n.delete(tg.key);
                          else n.add(tg.key);
                          return n;
                        });
                      };
                      return (
                        <View key={tg.key} className="border-t border-slate-100 dark:border-slate-800">
                          {/* Đầu nhóm: tên tầng + số dòng + ô giá chung của nhóm */}
                          <View className="flex-row items-center justify-between gap-3 py-3">
                            <Pressable className="min-w-0 flex-1 flex-row items-center gap-2" onPress={toggle} hitSlop={6}>
                              <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={16} color="#94a3b8" />
                              <View className="min-w-0 flex-1">
                                <Text className="text-[14px] font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
                                  {tg.key}
                                </Text>
                                <Text className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {tg.rows.length} phân loại
                                  {miss > 0 ? (
                                    <Text className="text-amber-600 dark:text-amber-400"> · {miss} chưa có giá</Text>
                                  ) : gd === null ? (
                                    <Text className="text-slate-400"> · nhiều giá, mở để xem</Text>
                                  ) : null}
                                </Text>
                              </View>
                            </Pressable>
                            <TextInput
                              className={`h-11 w-[132px] rounded-xl border bg-slate-50 px-3 text-right text-base font-bold text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${
                                miss > 0 ? "border-amber-300 dark:border-amber-500/60" : "border-slate-300 dark:border-slate-600"
                              }`}
                              style={[TABULAR, { minWidth: 0 }]}
                              keyboardType="number-pad"
                              placeholder={gd === null ? "Nhiều giá" : "Giá vốn"}
                              placeholderTextColor="#94a3b8"
                              value={gd ? groupVN(Number(gd)) : ""}
                              onChangeText={(x) => setGroupPrice(tg.rows, digits(x))}
                            />
                          </View>
                          {open
                            ? tg.rows.map((r) => (
                                <View
                                  key={r.skuId}
                                  className="ml-6 flex-row items-start justify-between gap-3 border-t border-dashed border-slate-100 py-2.5 dark:border-slate-800"
                                >
                                  <View className="min-w-0 flex-1">
                                    <Text className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                                      {restLabel(r)}
                                    </Text>
                                    <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
                                      {r.sku}
                                    </Text>
                                    {externalCode(r) ? (
                                      <Pressable className="mt-0.5 flex-row items-center gap-1" onPress={() => void copy(externalCode(r))} hitSlop={6}>
                                        <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                                          Mã sàn {externalCode(r)}
                                        </Text>
                                        <Ionicons name="copy-outline" size={11} color="#94a3b8" />
                                      </Pressable>
                                    ) : null}
                                  </View>
                                  {priceInput(r, false)}
                                </View>
                              ))
                            : null}
                        </View>
                      );
                    })}
                  </>
                ) : (
                  rows.map((r, i) => (
                    <View
                      key={r.skuId}
                      className={`flex-row items-start justify-between gap-3 py-3 ${
                        i > 0 ? "border-t border-slate-100 dark:border-slate-800" : ""
                      }`}
                    >
                      <View className="min-w-0 flex-1">
                        <Text className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                          {r.variantName || r.sku}
                        </Text>
                        <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
                          {r.sku}
                        </Text>
                        {externalCode(r) ? (
                          <Pressable className="mt-0.5 flex-row items-center gap-1" onPress={() => void copy(externalCode(r))} hitSlop={6}>
                            <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                              Mã sàn {externalCode(r)}
                            </Text>
                            <Ionicons name="copy-outline" size={11} color="#94a3b8" />
                          </Pressable>
                        ) : null}
                      </View>
                      {priceInput(r, false)}
                    </View>
                  ))
                )}
              </>
            ) : (
              <View className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
                {rows[0].variantName ? (
                  <Text className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
                    {rows[0].variantName}
                  </Text>
                ) : null}
                <View className="mt-1 flex-row items-center gap-1.5">
                  <Text className="text-[11px] text-slate-500 dark:text-slate-400">Mã SKU</Text>
                  <Text className="flex-1 text-[12px] text-slate-900 dark:text-slate-100" style={TABULAR}>
                    {rows[0].sku}
                  </Text>
                  <Pressable onPress={() => void copy(rows[0].sku)} hitSlop={8}>
                    <Ionicons name="copy-outline" size={14} color="#94a3b8" />
                  </Pressable>
                </View>
                {externalCode(rows[0]) ? (
                  <View className="mt-1 flex-row items-center gap-1.5">
                    <Text className="text-[11px] text-slate-500 dark:text-slate-400">Mã sàn</Text>
                    <Text className="flex-1 text-[12px] text-slate-900 dark:text-slate-100" style={TABULAR}>
                      {externalCode(rows[0])}
                    </Text>
                    <Pressable onPress={() => void copy(externalCode(rows[0]))} hitSlop={8}>
                      <Ionicons name="copy-outline" size={14} color="#94a3b8" />
                    </Pressable>
                  </View>
                ) : null}
                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Giá vốn (₫)</Text>
                  {priceInput(rows[0], true)}
                </View>
              </View>
            )}

            {error ? (
              <Text className="mt-3 text-center text-xs text-red-600 dark:text-red-400">{error}</Text>
            ) : null}
          </ScrollView>

          <Pressable
            className={`mt-3 h-14 items-center justify-center rounded-2xl ${canSave ? "bg-emerald-600 active:opacity-85" : "bg-slate-300 dark:bg-slate-700"}`}
            onPress={() => void submit()}
            disabled={!canSave}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-bold text-white">
                {changes.size > 1 ? `Lưu ${changes.size} phân loại` : "Lưu giá vốn"}
              </Text>
            )}
          </Pressable>
          <Text className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
            Đơn cũ đã có giá vốn giữ nguyên; chỉ đơn còn thiếu được điền giá này.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
