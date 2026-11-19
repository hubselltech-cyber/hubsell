import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { fetchOrders, lookupOrder, type OrdersFilter } from "@/api/orders";
import { fetchChannels } from "@/api/channels";
import { ApiError } from "@/api/client";
import type {
  ChannelListItem,
  OrderDto,
  OrderItemDto,
  ShippingStatus,
} from "@/types/api";
import { formatDateTime, formatMoney, groupVN } from "@/lib/format";
import { lineText } from "@/lib/order-lines";
import {
  CARRIER_LABEL,
  CARRIER_SHORT,
  CHANNEL_LABEL,
  RETURN_STATUS,
  SHIPPING_STATUS,
  orderStatusBadge,
} from "@/lib/labels";
import { useChannelColors } from "@/theme/channel-colors";
import { groupChannelsByPlatform } from "@/lib/channel-groups";
import { ActiveChip, PickChip } from "@/components/FilterChips";
import { isExpressShipping } from "@/lib/shipping";
import { hapticTap } from "@/lib/haptics";
import { Badge } from "@/components/Badge";
import { OrderDetailSheet } from "@/components/OrderDetailSheet";
import { PickSheet } from "@/components/PickSheet";
import { CancelRequestBar } from "@/components/CancelRequestBar";
import { ProcessSheet, type ProcessStage } from "@/components/ProcessSheet";
import { ArrangeSheet, CheckBox } from "@/components/ArrangeSheet";
import { PrintSheet, type PrintTarget } from "@/components/PrintSheet";
import {
  idsOfStage,
  pipelineCounts,
  selectAllStages,
  selectionCounts,
  workStageOf,
  type WorkStage,
} from "@/lib/fulfill";
import { fetchProcessQueue } from "@/api/fulfill";
import { printSupport } from "@/lib/print-labels";
import { RAISED_SHADOW, TABULAR } from "@/theme/tokens";

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
  // Nhãn tab = đúng nhãn tab trang Đơn hàng web (frontend/src/app/orders/page.tsx TABS)
  { key: "DELIVERED", label: "Đã giao thành công" },
  { key: "CANCELLED", label: "Đơn hủy / Hoàn trả" },
];

const CARRIER_KEYS = Object.keys(CARRIER_SHORT);

/**
 * Bộ lọc con của ĐÃ XỬ LÝ — cùng nhãn, cùng khóa đếm với chip trên trang Đơn hàng web
 * (frontend/src/app/orders/page.tsx PRINTED_FILTERS): dây chuyền Chưa in phiếu → Chờ
 * đóng gói (đã in, chưa quét) → Đã đóng gói (đã quét kiện).
 */
type PrintedFilter = "" | "no" | "yes" | "packed";
const PRINTED_FILTERS: { key: PrintedFilter; label: string; countKey: string | null }[] = [
  { key: "", label: "Tất cả đã xử lý", countKey: null },
  { key: "no", label: "Chưa in phiếu", countKey: "PROCESSED_NOT_PRINTED" },
  { key: "yes", label: "Chờ đóng gói", countKey: "PROCESSED_PRINTED" },
  { key: "packed", label: "Đã đóng gói", countKey: "PROCESSED_PACKED" },
];

/**
 * iOS không dựng được hộp trượt mới khi hộp cũ còn đang trượt xuống → chờ hộp cũ đóng hẳn
 * rồi mới mở hộp kế (Android / web mở ngay được).
 */
function afterSheetClose(fn: () => void) {
  if (Platform.OS === "ios") setTimeout(fn, 380);
  else fn();
}

/** Lựa chọn rỗng dùng chung — giữ nguyên một tham chiếu để không dựng Map mới mỗi lần vẽ. */
const EMPTY_SELECTION: ReadonlyMap<string, WorkStage> = new Map();

/** Bộ giá trị của panel Bộ lọc — trạng thái + hãng VC + gian hàng. */
interface FilterValue {
  status: "" | ShippingStatus;
  /** Chỉ có nghĩa khi status = PROCESSED. */
  printed: PrintedFilter;
  carrier: string;
  shopId: string;
  /** Chỉ đơn khách đang xin hủy (đi kèm mọi trạng thái). */
  cancelRequested: boolean;
}

export default function OrdersScreen() {
  const channelColors = useChannelColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winWidth } = useWindowDimensions();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Thẻ/phễu ở Tổng quan đẩy sang kèm ?status= → khởi tạo NGAY từ param
  // (trước đây set trong effect → lượt tải "tất cả" và lượt tải đã lọc chạy
  // song song, lượt nào về sau thắng → chip "Đang giao" mà list đủ mọi trạng
  // thái; anh Trung bắt được 03/10). Kèm reqSeq bên dưới chặn mọi ca đua khác.
  // Chuông thông báo đẩy sang kèm ?cancelRequested=1 (khách xin hủy) / ?search=<mã đơn> (hỏa tốc,
  // đơn bị hủy) / ?status=SHIPPING (giao không thành công) + ?n=<id tin> (notification-links.ts).
  const {
    status: statusParam,
    cancelRequested: cancelParam,
    search: searchParam,
    open: openParam,
    n: nonceParam,
  } = useLocalSearchParams<{
    status?: string;
    cancelRequested?: string;
    search?: string;
    open?: string;
    n?: string;
  }>();
  const statusFromParam = (p: unknown): "" | ShippingStatus =>
    typeof p === "string" && STATUS_TABS.some((t) => t.key === p) ? (p as ShippingStatus) : "";
  const [status, setStatus] = useState<"" | ShippingStatus>(() => statusFromParam(statusParam));
  // Bộ lọc con của Đã xử lý. Chỉ GỬI khi đang ở Đã xử lý (`printedInUse`): backend không
  // tự kèm trạng thái, gửi trần là dính cả đơn Đang giao / Đã giao đã in từ trước.
  const [printed, setPrinted] = useState<PrintedFilter>("");
  const printedInUse: PrintedFilter = status === "PROCESSED" ? printed : "";
  const [total, setTotal] = useState(0);
  const [carrier, setCarrier] = useState("");
  const [shopId, setShopId] = useState("");
  const [cancelRequested, setCancelRequested] = useState(cancelParam === "1");
  const [channel, setChannel] = useState<ChannelFilter>("");
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  // Mỗi lần mở popup Thống kê là một lượt mới (key) → nhóm đơn khởi tạo theo tab đang xem.
  const [statsSeq, setStatsSeq] = useState(0);
  const [search, setSearch] = useState(typeof searchParam === "string" ? searchParam : "");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Vuốt xuống làm mới (anh Trung 05/11): danh sách GIỮ NGUYÊN trong lúc tải, chỉ
  // hiện vòng quay của RefreshControl — không đổi cả màn sang vòng chờ như lượt tải đầu.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef({
    search: typeof searchParam === "string" ? searchParam.trim() : "",
    status: "" as "" | ShippingStatus,
    printed: "" as PrintedFilter,
    channel: "" as ChannelFilter,
    carrier: "",
    shopId: "",
    cancelRequested: cancelParam === "1",
  });

  // Đổi param khi màn này đã mount sẵn (bấm ô khác ở Tổng quan / bấm thông báo) → đổi lọc.
  // `nonceParam` nằm trong deps để tin thứ hai cùng mã đơn (khách đã bấm X xóa) vẫn áp lại.
  useEffect(() => {
    if (typeof statusParam !== "string") return;
    const next = statusFromParam(statusParam);
    if (next) {
      setStatus(next);
      // Thẻ ở Tổng quan / chuông dẫn tới CẢ trạng thái — bộ lọc con đang bật sẽ giấu bớt đơn.
      setPrinted("");
    }
  }, [statusParam, nonceParam]);
  useEffect(() => {
    if (cancelParam === "1") setCancelRequested(true);
  }, [cancelParam, nonceParam]);
  useEffect(() => {
    if (typeof searchParam !== "string" || !searchParam) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearch(searchParam);
    queryRef.current.search = searchParam.trim();
    // load() khai báo bên dưới — gọi qua ref để effect này không phụ thuộc thứ tự.
    loadRef.current?.(1, false);
  }, [searchParam, nonceParam]);
  const loadRef = useRef<((page: number, append: boolean) => Promise<void>) | null>(null);
  // Số thứ tự lượt tải — phản hồi của lượt CŨ về muộn thì bỏ, không ghi đè.
  const reqSeq = useRef(0);

  // DS gian hàng cho mục "Lọc theo shop" — đổi rất hiếm, nạp 1 lần là đủ
  useEffect(() => {
    fetchChannels()
      .then(setChannels)
      .catch(() => {}); // lỗi thì panel đơn giản là không có mục shop
  }, []);

  const load = useCallback(
    async (nextPage: number, append: boolean, asRefresh = false) => {
      const q = queryRef.current;
      const seq = ++reqSeq.current;
      if (append) setLoadingMore(true);
      else if (asRefresh) setRefreshing(true);
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
          cancelRequested: q.cancelRequested || undefined,
          printed: q.printed || undefined,
        });
        if (seq !== reqSeq.current) return; // đã có lượt tải mới hơn
        setOrders((prev) => (append ? [...prev, ...res.items] : res.items));
        setCounts(res.counts);
        setTotal(res.total);
        setPage(res.page);
        setPageCount(res.pageCount);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        // Đổi bộ lọc mà tải hỏng: bỏ danh sách của bộ lọc CŨ, kẻo đơn cũ nằm dưới
        // chip lọc mới. Vuốt làm mới / tải thêm hỏng thì giữ danh sách đang xem.
        if (!append && !asRefresh) setOrders([]);
        setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra");
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  // Gán trong effect, không gán lúc render (luật react-compiler của dự án).
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    queryRef.current.status = status;
    queryRef.current.printed = printedInUse;
    queryRef.current.channel = channel;
    queryRef.current.carrier = carrier;
    queryRef.current.shopId = shopId;
    queryRef.current.cancelRequested = cancelRequested;
    void load(1, false);
  }, [status, printedInUse, channel, carrier, shopId, cancelRequested, load]);

  const onSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      queryRef.current.search = text.trim();
      void load(1, false);
    }, 450);
  };
  /** Nút X trong ô tìm: về danh sách đầy đủ NGAY (không chờ 450 ms) — lối ra sau khi
   *  thông báo đổ sẵn mã đơn vào ô (anh Trung 25/10: "không có nút X để trở ra"). */
  const clearSearch = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearch("");
    queryRef.current.search = "";
    void load(1, false);
  };

  /** Đổi SÀN: gian hàng đang lọc mà thuộc sàn khác thì gỡ luôn — để nguyên
   *  là phép giao backend trả rỗng, người dùng tưởng mất đơn. */
  const pickChannel = (ch: ChannelFilter) => {
    setChannel(ch);
    if (ch && shopId) {
      const shop = channels.find((c) => c.id === shopId);
      if (shop && shop.channelName !== ch) setShopId("");
    }
  };

  /**
   * Phạm vi của popup Thống kê: sàn / gian / hãng / từ khóa / khách xin hủy đang lọc.
   * KHÔNG mang trạng thái — nhóm đơn chọn bằng chip ngay trong popup (api/orders.ts đè).
   */
  const pickScope: OrdersFilter = {
    search: search.trim() || undefined,
    channelName: channel || undefined,
    carrier: carrier || undefined,
    channelId: shopId || undefined,
    cancelRequested: cancelRequested || undefined,
  };
  const activeFilterCount =
    (status ? 1 : 0) +
    (printedInUse ? 1 : 0) +
    (carrier ? 1 : 0) +
    (shopId ? 1 : 0) +
    (cancelRequested ? 1 : 0);

  // ── XỬ LÝ ĐƠN (19/11/2026): hộp dây chuyền → Chuẩn bị hàng / In phiếu / Quét đóng gói.
  const [processOpen, setProcessOpen] = useState(false);
  /**
   * Hai hộp giữ nguyên đích khi đóng (không đổi tiêu đề trong lúc trượt xuống) và tăng `seq`
   * mỗi lần MỞ — `seq` làm key nên mỗi lượt mở là một hộp mới, trạng thái sạch.
   * orderIds có = chỉ làm đúng các đơn đó (mở từ chi tiết một đơn).
   */
  const [arrange, setArrange] = useState<{ open: boolean; seq: number; orderIds?: string[] }>({
    open: false,
    seq: 0,
  });
  const openArrange = (orderIds?: string[]) => setArrange((a) => ({ open: true, seq: a.seq + 1, orderIds }));
  const [print, setPrint] = useState<{ open: boolean; seq: number; target: PrintTarget }>({
    open: false,
    seq: 0,
    target: { kind: "queue", reprint: false },
  });
  const openPrint = (target: PrintTarget) => setPrint((p) => ({ open: true, seq: p.seq + 1, target }));
  const closePrint = () => setPrint((p) => ({ ...p, open: false }));
  const canPrint = printSupport();
  const workCount = (() => {
    const n = pipelineCounts(counts);
    return n.arrange + n.print;
  })();

  // ── TÍCH ĐƠN ngay trên thẻ (anh Trung 19/11: "thêm dấu tích để tích trực tiếp vào các đơn
  // hàng → ấn Xử lý đơn"). Có đơn tích → hộp Xử lý đơn làm đúng các đơn đó; không tích gì →
  // làm cả nhóm đang lọc. Lựa chọn gắn với BỘ LỌC lúc tích: đổi sàn / gian / hãng / trạng thái
  // / từ khóa là lựa chọn tự hết hiệu lực — không bao giờ làm trên đơn đang khuất mắt.
  const scopeKey = [status, printedInUse, channel, carrier, shopId, cancelRequested ? 1 : 0, search.trim()].join("|");
  const [selection, setSelection] = useState<{ key: string; map: Map<string, WorkStage> }>({
    key: "",
    map: new Map(),
  });
  const selected: ReadonlyMap<string, WorkStage> = selection.key === scopeKey ? selection.map : EMPTY_SELECTION;
  const picked = selectionCounts(selected);
  const clearSelection = () => setSelection({ key: "", map: new Map() });
  const toggleSelect = (order: OrderDto) => {
    const stage = workStageOf(order);
    if (!stage) return;
    hapticTap();
    setSelection((prev) => {
      const map = new Map(prev.key === scopeKey ? prev.map : []);
      if (map.has(order.id)) map.delete(order.id);
      else map.set(order.id, stage);
      return { key: scopeKey, map };
    });
  };
  /** "Chọn tất cả": mọi đơn còn việc trong phạm vi đang lọc (kể cả đơn chưa cuộn tới). */
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllNote, setSelectAllNote] = useState("");
  const selectAll = async () => {
    const stages = selectAllStages(status, printedInUse);
    if (stages.length === 0 || selectingAll) return;
    hapticTap();
    setSelectingAll(true);
    setSelectAllNote("");
    const key = scopeKey;
    try {
      const queues = await Promise.all(stages.map((st) => fetchProcessQueue(st, pickScope)));
      const map = new Map<string, WorkStage>();
      queues.forEach((q, i) => {
        const stage: WorkStage = stages[i] === "ARRANGE" ? "arrange" : stages[i] === "PRINT" ? "print" : "reprint";
        for (const g of q.groups) for (const c of g.carriers) for (const id of c.orderIds) map.set(id, stage);
      });
      setSelection({ key, map });
      const cut = queues.find((q) => q.truncated);
      setSelectAllNote(cut ? `Mỗi nhóm lấy tối đa ${groupVN(cut.max)} đơn, hỏa tốc và đơn cũ trước` : "");
    } catch (err) {
      setSelectAllNote(err instanceof ApiError ? err.message : "Chưa chọn được tất cả — thử lại");
    } finally {
      setSelectingAll(false);
    }
  };
  const scopeLabel =
    [
      shopId
        ? (channels.find((c) => c.id === shopId)?.shopName ?? "Một gian hàng")
        : channel
          ? `Gian ${CHANNEL_LABEL[channel]}`
          : "Tất cả gian hàng",
      carrier ? (CARRIER_SHORT[carrier] ?? carrier) : "",
      search.trim() ? `"${search.trim()}"` : "",
      cancelRequested ? "khách xin hủy" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  /** Xem danh sách đơn của một công đoạn = đặt đúng bộ lọc trạng thái + bộ lọc con. */
  const viewStage = (stage: ProcessStage) => {
    setProcessOpen(false);
    if (stage === "arrange") {
      setStatus("PENDING");
      setPrinted("");
    } else {
      setStatus("PROCESSED");
      setPrinted(stage === "print" ? "no" : stage === "pack" ? "yes" : "packed");
    }
  };
  const openLabelTemplate = () => {
    setProcessOpen(false);
    closePrint();
    afterSheetClose(() => router.push("/label-template"));
  };

  // Mở màn Quét đóng gói (route gốc, phủ thanh tab). Quay về thì tải lại danh sách: kiện
  // vừa quét đã đổi nhóm (Chờ đóng gói → Đã đóng gói), số trên chip cũng đổi.
  const packScanOpened = useRef(false);
  const openPackScan = () => {
    hapticTap();
    packScanOpened.current = true;
    router.push("/pack-scan");
  };
  useFocusEffect(
    useCallback(() => {
      if (!packScanOpened.current) return;
      packScanOpened.current = false;
      void load(1, false, true);
    }, [load])
  );

  // Đơn đang MỞ RỘNG danh sách sản phẩm (mặc định chỉ hiện ITEMS_PREVIEW dòng)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Đơn đang mở hộp Chi tiết đơn hàng (bấm vào thẻ đơn).
  const [detailOrder, setDetailOrder] = useState<OrderDto | null>(null);
  // Thông báo "đơn đã chuẩn bị hàng bị hủy" đẩy sang kèm ?search=<mã>&open=1 → mở THẲNG
  // hộp chi tiết của đúng đơn đó (12/11/2026: trước chỉ nhảy sang tab Đơn hoàn, khách
  // không biết đơn nào). Tra riêng theo mã nên không phụ thuộc tab trạng thái đang lọc.
  useEffect(() => {
    const code = typeof searchParam === "string" ? searchParam.trim() : "";
    if (openParam !== "1" || !code) return;
    let stale = false;
    lookupOrder(code)
      .then((res) => {
        if (!stale && res.order.orderCode === code) setDetailOrder(res.order);
      })
      .catch(() => {}); // không tra được thì ô tìm đã có sẵn mã — không che màn
    return () => {
      stale = true;
    };
  }, [openParam, searchParam, nonceParam]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderItemRow = (it: OrderItemDto) => {
    const img = it.imageUrl ?? it.product?.imageUrl ?? null;
    // Tên / PHÂN LOẠI / SKU người bán (19/11/2026) — mã máy của sàn không in ra.
    const text = lineText(it);
    return (
      <View key={it.id} className="mt-2 flex-row items-center gap-2.5">
        <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
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
          {/* Không tách được phân loại thì nó còn nằm ở đuôi tên → cho tên 4 dòng thay vì cắt ở 1 dòng. */}
          <Text className="text-xs text-slate-800 dark:text-slate-200" numberOfLines={text.variantName ? 1 : 4}>
            {text.baseName}
          </Text>
          {text.variantName ? (
            <Text className="text-[11px] font-semibold text-slate-700 dark:text-slate-200" numberOfLines={2}>
              {text.variantName}
            </Text>
          ) : null}
          {text.sellerSku ? (
            <Text className="text-[10px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
              {text.sellerSku}
            </Text>
          ) : null}
        </View>
        {/* Số lượng đỏ đậm — kho liếc là thấy nhặt mấy (anh Trung 03/10) */}
        <Text className="text-[13px] font-bold text-red-600 dark:text-red-400" style={TABULAR}>
          ×{it.quantity}
        </Text>
      </View>
    );
  };

  const renderOrder = ({ item }: { item: OrderDto }) => {
    const ship = orderStatusBadge(item);
    // Gói rồi sàn mới hủy, chưa lên biên bản → kiện còn nằm trong chồng hàng chờ giao.
    const pullParcel =
      item.shippingStatus === "CANCELLED" && Boolean(item.packingDoneAt) && !item.handoverSheetId;
    const ret = item.returnStatus !== "NONE" ? RETURN_STATUS[item.returnStatus] : null;
    const express = isExpressShipping(item.shippingCarrierName);
    const isExpanded = expanded.has(item.id);
    const visibleItems = isExpanded
      ? item.items
      : item.items.slice(0, ITEMS_PREVIEW);
    const hiddenCount = item.items.length - ITEMS_PREVIEW;
    // Ô tích chỉ có ở đơn CÒN VIỆC (chờ chuẩn bị / chờ in / đã in chưa gói) — đơn đang giao,
    // đã giao, đã hủy, khách chưa thanh toán không có gì để làm nên không có ô.
    const selectable = workStageOf(item) !== null;
    const isSelected = selected.has(item.id);
    return (
      <Pressable
        className={`mb-2.5 rounded-2xl border p-3 active:opacity-80 ${
          isSelected
            ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-500/60 dark:bg-emerald-500/10"
            : "border-slate-900/5 bg-white dark:border-white/5 dark:bg-slate-900"
        }`}
        style={{ elevation: 1 }}
        onPress={() => setDetailOrder(item)}
        accessibilityRole="button"
        accessibilityLabel={`Xem chi tiết đơn ${item.orderCode}`}
      >
        {/* HÀNG ĐẦU THẺ: [ô tích + MÃ ĐƠN] ........ [Hỏa tốc] [trạng thái].
            Luật (anh Trung 19/11: "cần phải đo độ dài của mã đơn hàng… tránh trường hợp mã đơn quá
            dài sẽ bị chèn chữ lên phần hỏa tốc"): MÃ ĐƠN LUÔN HIỆN ĐỦ — người bán nhận đơn bằng mấy
            ký tự cuối. Hàng cho phép XUỐNG DÒNG: không đủ chỗ thì cụm nhãn bên phải tự rơi xuống
            dòng dưới (vẫn sát mép phải), mã đơn không bị cắt, không bao giờ đè lên nhãn. Mã đơn chỉ
            bị cắt khi tự nó dài hơn cả bề ngang thẻ.
            Đo 19/11 (DB local): mã Shopee 14 ký tự, Lazada 15 số, TikTok 18 số; soi thêm 16 và 19
            số. Bản một dòng cũ: 360 px cắt mã 14 ký tự chữ rộng + mã 16 / 19 số, 320 px cắt mọi mã.
            Bản này (đo 320 / 360 / 375 / 390 / 412 / 430 px, 8 mã, đều Hỏa tốc): 0 mã bị cắt, 0 mã
            đè nhãn; từ 390 px trở lên mọi mã nằm một dòng, dưới đó nhãn tự xuống dòng.
            Mã đơn KHÔNG dùng số đều cột (TABULAR): mã không cần gióng cột giữa các thẻ, mà số đều
            cột làm chuỗi 18–19 số rộng thêm. Chi tiết: docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 2.2. */}
        <View className="flex-row flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <View className="max-w-full shrink flex-row items-center gap-2">
            {selectable ? (
              <Pressable
                onPress={() => toggleSelect(item)}
                hitSlop={10}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`Chọn đơn ${item.orderCode}`}
              >
                <CheckBox checked={isSelected} />
              </Pressable>
            ) : null}
            <Text
              className="shrink text-[13px] font-semibold text-slate-900 dark:text-slate-100"
              numberOfLines={1}
            >
              {item.orderCode}
            </Text>
          </View>
          <View className="ml-auto flex-row items-center gap-2">
            {/* HỎA TỐC đỏ rực — anh Trung chốt 13/08: loại đơn quan trọng nhất */}
            {express ? (
              <View className="rounded-full bg-red-500 px-2 py-0.5">
                <Text className="text-[10px] font-bold text-white">⚡ Hỏa tốc</Text>
              </View>
            ) : null}
            <Badge label={ship.label} bg={ship.bg} text={ship.text} />
          </View>
        </View>
        {/* Tên SHOP thay nhãn sàn (anh Trung chốt 13/08) — nhà nhiều gian
            nhìn phát biết đơn của DarkMan hay Hi.Bé; sàn đã có chip lọc. */}
        <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
          {item.customerName}
          {" · "}
          {item.channel.shopName}
          {" · "}
          {formatDateTime(item.createdAt)}
        </Text>
        {pullParcel ? (
          <View className="mt-1.5 flex-row items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1.5 dark:bg-red-500/10">
            <Ionicons name="cube" size={13} color="#ef4444" />
            <Text className="flex-1 text-[11px] font-semibold text-red-600 dark:text-red-300">
              Đã gói — lấy kiện ra, không đưa ship
            </Text>
          </View>
        ) : null}
        {/* Dải đỏ + nút Trả lời sàn — sàn chốt xong thì tải lại danh sách */}
        <CancelRequestBar order={item} onDecided={() => void load(1, false)} />

        {visibleItems.map(renderItemRow)}
        {hiddenCount > 0 ? (
          <Pressable
            className="mt-1.5 flex-row items-center justify-center gap-1 rounded-lg py-1.5 active:bg-slate-50 dark:active:bg-slate-800"
            onPress={() => toggleExpand(item.id)}
            hitSlop={4}
          >
            <Text className="text-[11px] font-semibold text-sky-600 dark:text-sky-400">
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
        <View className="mt-2.5 flex-row items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
          <View className="flex-1 flex-row items-center gap-1.5 pr-2">
            <Ionicons
              name="car-outline"
              size={13}
              color={express ? "#ef4444" : "#64748b"}
            />
            <Text
              className={`flex-1 text-[11px] ${
                express ? "font-semibold text-red-500 dark:text-red-400" : "text-slate-500 dark:text-slate-400"
              }`}
              numberOfLines={1}
            >
              {/* Đơn hỏa tốc hiện TÊN NGUYÊN VĂN (AhaMove/GrabExpress…) —
                  enum gộp về "Hãng khác" là mất thông tin quan trọng nhất */}
              {express
                ? (item.shippingCarrierName ?? "Hỏa tốc")
                : item.carrier
                  ? (CARRIER_LABEL[item.carrier] ?? item.carrier)
                  : "Chưa gán hãng vận chuyển"}
              {item.trackingCode ? ` · ${item.trackingCode}` : ""}
            </Text>
          </View>
          {/* Tiền đơn xanh dịu — tách khỏi số lượng đỏ (anh Trung 03/10) */}
          <View className="items-end">
            <Text
              className="text-[13px] font-bold text-emerald-600 dark:text-emerald-400"
              style={TABULAR}
            >
              {formatMoney(item.totalAmount)}
            </Text>
            {/* Web ghi "Chưa thanh toán" dưới tổng tiền — app trước đây tô xanh
                mọi đơn kể cả COD chưa thu (rà 26/10). */}
            {item.paymentStatus === "UNPAID" ? (
              <Text className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Chưa thanh toán
              </Text>
            ) : item.paymentStatus === "REFUNDED" ? (
              <Text className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                Đã hoàn tiền
              </Text>
            ) : null}
          </View>
        </View>
        {ret ? (
          <View className="mt-1.5 flex-row">
            <Badge label={ret.label} bg={ret.bg} text={ret.text} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 16 }}>
      <View className="mb-3 flex-row items-center justify-between px-4">
        <View>
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">Đơn hàng</Text>
          {/* Số đơn của BỘ LỌC đang xem (tab / khách xin hủy) như web "N đơn khớp
              bộ lọc" — trước luôn in tổng mọi trạng thái nên tab Đang giao 37 đơn
              vẫn đề "1.240 đơn" (rà 26/10). */}
          {/* `total` = đúng số đơn của lượt tải đang xem (mọi bộ lọc, kể cả bộ lọc con
              Chờ đóng gói) — trước đây suy từ bảng đếm theo trạng thái nên bật hai bộ
              lọc cùng lúc là lệch. */}
          <Text className="text-xs text-slate-500 dark:text-slate-400" style={TABULAR}>
            {groupVN(total)} đơn{activeFilterCount > 0 ? " khớp bộ lọc" : ""}
          </Text>
        </View>
      </View>

      {/* Ô tìm + nút QUÉT ĐÓNG GÓI (anh Trung 05/11). Nút có chữ vì nút QR giữa thanh
          tab là việc khác (xem chi tiết đơn).
          Hai ô chia theo lưới 4 cột của hàng chip sàn bên dưới (4 ô bằng nhau, khe 8 px):
          nút = đúng một ô (cột Lazada), ô tìm = ba ô + hai khe → gốc 16 px rồi chia 3 : 1.
          Hai ô chia cột không được mang viền / đệm ngang (chúng đội gốc lên, nút sẽ rộng
          hơn chip) nên viền và đệm của ô tìm nằm ở lớp trong. */}
      <View className="mx-4 mb-2.5 flex-row items-center gap-2">
        <View style={{ flexGrow: 3, flexShrink: 1, flexBasis: 16, minWidth: 0 }}>
          <View className="flex-row items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3">
            <Ionicons name="search-outline" size={16} color="#94a3b8" />
            <TextInput
              className="flex-1 px-2 py-2.5 text-sm text-slate-900 dark:text-slate-100"
              // minWidth 0: trên web ô nhập có bề rộng tối thiểu riêng, không ép thì đẩy nút quét ra ngoài màn 320.
              style={{ minWidth: 0 }}
              placeholder="Mã đơn, tên khách, SĐT, mã vận đơn…"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={onSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {search ? (
              <Pressable
                onPress={() => {
                  hapticTap();
                  clearSearch();
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Xóa tìm kiếm"
              >
                <Ionicons name="close-circle" size={18} color="#94a3b8" />
              </Pressable>
            ) : null}
          </View>
        </View>
        <Pressable
          className="flex-row items-center justify-center gap-1 self-stretch rounded-xl bg-emerald-500 active:opacity-80"
          style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}
          onPress={openPackScan}
          accessibilityRole="button"
          accessibilityLabel="Quét đóng gói"
        >
          {/* Màn dưới 360 px một ô chip chỉ ~66 px: bỏ icon để chữ không bị cắt. */}
          {winWidth >= 360 ? <Ionicons name="qr-code-outline" size={16} color="#fff" /> : null}
          <Text className="text-xs font-bold text-white" numberOfLines={1}>
            Đóng gói
          </Text>
        </Pressable>
      </View>

      {/* Bộ lọc sàn — số đếm trạng thái trong panel lọc cũng lọc theo sàn */}
      <View className="mb-2 flex-row gap-2 px-4">
        {CHANNEL_FILTERS.map((ch) => {
          const active = channel === ch;
          return (
            <Pressable
              key={ch || "ALL"}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full px-2 py-1.5 ${
                active ? "bg-slate-900 dark:bg-slate-100" : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
              }`}
              onPress={() => pickChannel(ch)}
            >
              {ch ? (
                <View
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: channelColors[ch] }}
                />
              ) : null}
              <Text
                className={`text-xs font-semibold ${
                  active ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                }`}
              >
                {ch ? CHANNEL_LABEL[ch] : "Tất cả"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Hai nút thay dãy tab trạng thái cũ: Bộ lọc (gom trạng thái + hãng VC + shop,
          học Salework) và Thống kê = mở PHIẾU NHẶT HÀNG của nhóm Chờ đóng gói. Chữ trên
          nút GIỮ "Thống kê" như web (anh chốt 05/11: khách đã quen). */}
      <View className="mb-2 flex-row gap-2 px-4">
        <Pressable
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 active:bg-slate-50 dark:active:bg-slate-800"
          onPress={() => setFilterOpen(true)}
        >
          <Ionicons name="funnel-outline" size={14} color="#64748b" />
          <Text className="text-xs font-semibold text-slate-800 dark:text-slate-200">Bộ lọc</Text>
          {activeFilterCount > 0 ? (
            <View className="min-w-[16px] items-center rounded-full bg-slate-900 px-1 dark:bg-slate-600">
              <Text className="text-[10px] font-bold text-white">
                {activeFilterCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 active:bg-slate-50 dark:active:bg-slate-800"
          onPress={() => {
            setStatsSeq((n) => n + 1);
            setStatsOpen(true);
          }}
        >
          <Ionicons name="bar-chart-outline" size={14} color="#64748b" />
          <Text className="text-xs font-semibold text-slate-800 dark:text-slate-200">Thống kê</Text>
        </Pressable>
      </View>

      {/* Tóm tắt bộ lọc đang bật — bấm ✕ trên chip là gỡ ngay khỏi cần mở panel */}
      {activeFilterCount > 0 ? (
        <View className="mb-2 flex-row flex-wrap gap-1.5 px-4">
          {status ? (
            <ActiveChip
              label={SHIPPING_STATUS[status].label}
              onClear={() => {
                setStatus("");
                setPrinted("");
              }}
            />
          ) : null}
          {printedInUse ? (
            <ActiveChip
              label={PRINTED_FILTERS.find((f) => f.key === printedInUse)?.label ?? ""}
              onClear={() => setPrinted("")}
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
          {cancelRequested ? (
            <ActiveChip label="Khách xin hủy" onClear={() => setCancelRequested(false)} />
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : (
        // Lỗi nằm TRONG danh sách (không thay cả danh sách bằng dòng chữ như trước):
        // vuốt xuống là thử lại được, và lượt làm mới hỏng không làm mất đơn đang xem.
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderOrder}
          // flexGrow: danh sách rỗng / ít đơn vẫn vuốt được ở bất kỳ chỗ nào của vùng trống.
          // Đáy chừa 88 px: thanh nổi Xử lý đơn không che thẻ đơn cuối.
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 88 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(1, false, true)}
              tintColor="#64748b"
              colors={["#10b981"]}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!loadingMore && !refreshing && !error && page < pageCount) void load(page + 1, true);
          }}
          ListHeaderComponent={
            error ? (
              <Text className="px-2 pb-3 pt-1 text-center text-sm text-red-500 dark:text-red-400">
                {error} — vuốt xuống để thử lại
              </Text>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator className="py-4" color="#64748b" />
            ) : null
          }
          ListEmptyComponent={
            error ? null : (
              <Text className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                Không có đơn nào khớp bộ lọc
              </Text>
            )
          }
        />
      )}

      {/* THANH NỔI "XỬ LÝ ĐƠN" ở đáy danh sách (19/11/2026). Vì sao không nằm ở cụm đầu trang: cụm
          đó chia theo lưới 4 cột (ô tìm 3 + nút Đóng gói 1, bốn chip sàn, Bộ lọc 2 + Thống kê 2);
          nhét nút thứ ba vào hàng dưới là ba nút nằm lệch khe với bốn chip phía trên — anh Trung:
          "cụm này nó kiểu lộn xộn". Việc LÀM trên các đơn đang xem thuộc về vùng ngón cái:
            - chưa tích đơn nào → một viên "Xử lý đơn" + số đơn đang chờ (làm cả nhóm đang lọc);
            - đang tích đơn      → nở thành thanh đầy bề ngang: số đã chọn · Chọn tất cả · Bỏ chọn
                                   · nút Xử lý (làm đúng các đơn đã tích).
          Màu theo cặp đen / trắng của chip đang chọn để không tranh với nút Đóng gói xanh. */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", left: 16, right: 16, bottom: 12, alignItems: "flex-end" }}
      >
        {picked.total > 0 ? (
          <View
            className="w-full rounded-2xl bg-slate-900 px-3 py-2.5 dark:border dark:border-slate-600 dark:bg-slate-800"
            style={RAISED_SHADOW}
          >
            <View className="flex-row items-center gap-2.5">
              <Pressable
                className="h-7 w-7 items-center justify-center rounded-full bg-white/10 active:opacity-60"
                onPress={clearSelection}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Bỏ chọn"
              >
                <Ionicons name="close" size={15} color="#e2e8f0" />
              </Pressable>
              <Text className="min-w-0 flex-1 text-[13px] font-bold text-white" style={TABULAR} numberOfLines={1}>
                {/* Màn dưới 360 px chỉ còn "52 đơn": con số phải luôn đọc được, không để bị cắt
                    thành "Đã chọn …" (soi 320 px 19/11). */}
                {winWidth >= 360 ? `Đã chọn ${groupVN(picked.total)} đơn` : `${groupVN(picked.total)} đơn`}
              </Text>
              {selectAllStages(status, printedInUse).length > 0 ? (
                <Pressable onPress={() => void selectAll()} hitSlop={8} disabled={selectingAll} accessibilityRole="button">
                  <Text className="text-xs font-semibold text-sky-300">
                    {selectingAll ? "Đang chọn…" : "Chọn tất cả"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                className="flex-row items-center gap-1 rounded-full bg-emerald-500 px-3.5 py-2 active:opacity-80"
                onPress={() => {
                  hapticTap();
                  setProcessOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Xử lý ${picked.total} đơn đã chọn`}
              >
                <Ionicons name="flash" size={13} color="#fff" />
                <Text className="text-xs font-bold text-white">Xử lý</Text>
              </Pressable>
            </View>
            {selectAllNote ? (
              <Text className="mt-1 text-[11px] text-slate-300" numberOfLines={2}>
                {selectAllNote}
              </Text>
            ) : null}
          </View>
        ) : (
          <Pressable
            className="flex-row items-center gap-2 rounded-full bg-slate-900 px-4 py-3 active:opacity-80 dark:bg-slate-100"
            style={RAISED_SHADOW}
            onPress={() => {
              hapticTap();
              setProcessOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Xử lý đơn"
          >
            <Ionicons name="flash" size={15} color="#10b981" />
            <Text className="text-[13px] font-bold text-white dark:text-slate-900">Xử lý đơn</Text>
            {workCount > 0 ? (
              <View className="min-w-[20px] items-center rounded-full bg-emerald-500 px-1.5 py-0.5">
                <Text className="text-[11px] font-bold text-white" style={TABULAR}>
                  {workCount > 99 ? "99+" : workCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        )}
      </View>

      <FilterSheet
        visible={filterOpen}
        counts={counts}
        channels={channels}
        channel={channel}
        value={{ status, printed: printedInUse, carrier, shopId, cancelRequested }}
        onClose={() => setFilterOpen(false)}
        onApply={(v) => {
          setStatus(v.status);
          setPrinted(v.status === "PROCESSED" ? v.printed : "");
          setCarrier(v.carrier);
          setShopId(v.shopId);
          setCancelRequested(v.cancelRequested);
          setFilterOpen(false);
        }}
      />
      <PickSheet
        key={statsSeq}
        visible={statsOpen}
        scope={pickScope}
        // Đang đứng ở tab / chip con nào thì mở thống kê của nhóm đó; còn lại = Chờ đóng gói.
        initialGroup={
          status === "PENDING" || status === "SHIPPING" || status === "DELIVERED"
            ? status
            : printedInUse === "no"
              ? "NOT_PRINTED"
              : printedInUse === "packed"
                ? "PACKED"
                : "PACK"
        }
        counts={counts}
        notPrintedCount={counts.PROCESSED_NOT_PRINTED ?? 0}
        onClose={() => setStatsOpen(false)}
      />
      <OrderDetailSheet
        order={detailOrder}
        onClose={() => setDetailOrder(null)}
        onChanged={() => {
          setDetailOrder(null);
          void load(1, false);
        }}
        onArrange={(o) => {
          setDetailOrder(null);
          afterSheetClose(() => openArrange([o.id]));
        }}
        onPrint={(o) => {
          setDetailOrder(null);
          afterSheetClose(() => openPrint({ kind: "orders", orderIds: [o.id], waitReady: false }));
        }}
      />
      <ProcessSheet
        visible={processOpen}
        counts={counts}
        scopeLabel={scopeLabel}
        selection={picked.total > 0 ? picked : null}
        onClearSelection={clearSelection}
        onClose={() => setProcessOpen(false)}
        onView={viewStage}
        onAction={(stage) => {
          setProcessOpen(false);
          if (stage === "pack") afterSheetClose(openPackScan);
          else if (stage === "arrange") {
            // Có đơn tích → đúng các đơn đã tích đang chờ xử lý; không thì cả nhóm đang lọc.
            const ids = picked.total > 0 ? idsOfStage(selected, "arrange") : undefined;
            afterSheetClose(() => openArrange(ids));
          } else {
            const ids = picked.total > 0 ? idsOfStage(selected, "print") : null;
            afterSheetClose(() =>
              openPrint(ids ? { kind: "orders", orderIds: ids, waitReady: false } : { kind: "queue", reprint: false })
            );
          }
        }}
        onReprint={() => {
          setProcessOpen(false);
          const ids = picked.reprint > 0 ? idsOfStage(selected, "reprint") : null;
          afterSheetClose(() =>
            openPrint(ids ? { kind: "orders", orderIds: ids, waitReady: false } : { kind: "queue", reprint: true })
          );
        }}
        onLabelTemplate={openLabelTemplate}
      />
      <ArrangeSheet
        key={`arrange-${arrange.seq}`}
        visible={arrange.open}
        scope={pickScope}
        orderIds={arrange.orderIds}
        canPrint={canPrint.print || canPrint.share}
        onClose={() => setArrange((a) => ({ ...a, open: false }))}
        onDone={() => {
          // Đơn vừa đổi bước → ô tích cũ không còn đúng nghĩa.
          clearSelection();
          void load(1, false, true);
        }}
        onPrint={(ids) => {
          setArrange((a) => ({ ...a, open: false }));
          // Vừa chuẩn bị xong: sàn cấp mã vận đơn trễ vài giây → hộp In tự đợi cho đủ.
          afterSheetClose(() => openPrint({ kind: "orders", orderIds: ids, waitReady: true }));
        }}
      />
      <PrintSheet
        key={`print-${print.seq}`}
        visible={print.open}
        target={print.target}
        scope={pickScope}
        onClose={closePrint}
        onPrinted={() => {
          clearSelection();
          void load(1, false, true);
        }}
        onLabelTemplate={openLabelTemplate}
      />
    </View>
  );
}

// ============================================================
// Panel BỘ LỌC — trạng thái đơn + hãng vận chuyển + gian hàng
// ============================================================
function FilterSheet({
  visible,
  counts,
  channels,
  channel,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  counts: Record<string, number>;
  channels: ChannelListItem[];
  /** Sàn đang chọn ở chip ngoài — mục Gian hàng CHỈ hiện gian của sàn đó. */
  channel: ChannelFilter;
  value: FilterValue;
  onClose: () => void;
  onApply: (v: FilterValue) => void;
}) {
  // Đáy hộp chừa phần nút điều hướng / vạch vuốt của máy.
  const sheetInsets = useSafeAreaInsets();
  // Nháp trong panel — bấm Áp dụng mới đổ ra ngoài, đóng ngang thì bỏ
  const [draft, setDraft] = useState<FilterValue>(value);
  useEffect(() => {
    if (visible) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Map theo bộ lọc sàn (anh Trung chốt): chọn Shopee thì chỉ còn gian Shopee
  const visibleChannels = channel
    ? channels.filter((c) => c.channelName === channel)
    : channels;
  // Cây sàn → gian: sàn theo thứ tự hàng chip ở đầu màn, gian xếp theo tên.
  const shopGroups = groupChannelsByPlatform(visibleChannels);
  const channelColors = useChannelColors();

  return (
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="max-h-[85%] rounded-t-3xl bg-white dark:bg-slate-900 px-4 pt-3"
          style={{ paddingBottom: 20 + sheetInsets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">Bộ lọc</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Trạng thái đơn
            </Text>
            <View className="mb-3 flex-row flex-wrap gap-1.5">
              {STATUS_TABS.map((t) => (
                <PickChip
                  key={t.key || "ALL"}
                  label={t.label}
                  count={t.key === "" ? counts.ALL : counts[t.key]}
                  active={draft.status === t.key}
                  // Đổi trạng thái thì bỏ bộ lọc con — nó chỉ thuộc về Đã xử lý.
                  onPress={() => setDraft((d) => ({ ...d, status: t.key, printed: "" }))}
                />
              ))}
              {/* Cờ đi kèm MỌI trạng thái (anh chốt 23/10): bật/tắt độc lập với tab trạng thái */}
              <PickChip
                label="⚠ Khách xin hủy"
                count={counts.CANCEL_REQUESTED}
                active={draft.cancelRequested}
                onPress={() => setDraft((d) => ({ ...d, cancelRequested: !d.cancelRequested }))}
              />
            </View>

            {/* Bộ lọc con của Đã xử lý — chỉ hiện khi đang chọn Đã xử lý, như hàng chip
                dưới tab Đã xử lý trên web. Số đếm theo đúng sàn / gian / hãng đang lọc. */}
            {draft.status === "PROCESSED" ? (
              <>
                <Text className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  In phiếu và đóng gói
                </Text>
                <View className="mb-3 flex-row flex-wrap gap-1.5">
                  {PRINTED_FILTERS.map((f) => (
                    <PickChip
                      key={f.key || "ALL"}
                      label={f.label}
                      count={f.countKey ? counts[f.countKey] : undefined}
                      active={draft.printed === f.key}
                      onPress={() => setDraft((d) => ({ ...d, printed: f.key }))}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <Text className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
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

            {visibleChannels.length > 0 ? (
              <>
                <Text className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Gian hàng{channel ? ` ${CHANNEL_LABEL[channel]}` : ""}
                </Text>
                {/* CÂY SÀN → GIAN (anh Trung 19/11: "sắp xếp luôn bộ lọc dạng cha-con, vẫn liệt kê
                    hết các shop ra nhưng theo thứ tự Sàn - shop"). Trước đây gian nằm lẫn một
                    hàng theo thứ tự nối gian, mỗi chip phải kéo đuôi "· Shopee" để phân biệt.
                    Giờ: "Tất cả" đứng riêng, rồi mỗi sàn một dòng tên (chấm màu sàn) và các gian
                    của sàn đó thụt vào bên dưới, xếp theo tên — chip chỉ còn tên gian.
                    Dòng tên sàn chỉ là nhãn, KHÔNG bấm được: lọc theo sàn đã có hàng chip ở đầu
                    màn, thêm một chỗ bấm thứ hai cho cùng một việc là hai nút tranh nhau.
                    Đang lọc sẵn một sàn ở ngoài thì chỉ còn một nhóm → bỏ dòng tên sàn (tiêu đề
                    mục đã ghi "Gian hàng Shopee"). */}
                <View className="mb-3 gap-2">
                  <View className="flex-row">
                    <PickChip
                      label="Tất cả"
                      active={draft.shopId === ""}
                      onPress={() => setDraft((d) => ({ ...d, shopId: "" }))}
                    />
                  </View>
                  {shopGroups.map((g) => (
                    <View key={g.platform} className="gap-1.5">
                      {channel ? null : (
                        <View className="flex-row items-center gap-2">
                          <View
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: channelColors[g.platform] ?? "#94a3b8" }}
                          />
                          <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {CHANNEL_LABEL[g.platform as keyof typeof CHANNEL_LABEL] ?? g.platform}
                          </Text>
                        </View>
                      )}
                      <View className={`flex-row flex-wrap gap-1.5 ${channel ? "" : "pl-4"}`}>
                        {g.rows.map((c) => (
                          <PickChip
                            key={c.id}
                            label={c.shopName}
                            active={draft.shopId === c.id}
                            onPress={() => setDraft((d) => ({ ...d, shopId: c.id }))}
                          />
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>

          <View className="mt-2 flex-row gap-2">
            <Pressable
              className="flex-1 items-center rounded-xl bg-slate-100 dark:bg-slate-800 py-3 active:opacity-80"
              onPress={() =>
                setDraft({ status: "", printed: "", carrier: "", shopId: "", cancelRequested: false })
              }
            >
              <Text className="text-sm font-semibold text-slate-600 dark:text-slate-300">Bỏ lọc</Text>
            </Pressable>
            <Pressable
              className="flex-1 items-center rounded-xl bg-slate-900 py-3 active:opacity-80 dark:bg-slate-700"
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
