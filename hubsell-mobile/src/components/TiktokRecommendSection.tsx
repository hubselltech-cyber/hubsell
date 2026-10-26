import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { ApiError, isPlanLockedError } from "@/api/client";
import { fetchTiktokProductBreakeven } from "@/api/ads-tiktok";
import type {
  TiktokProductBreakevenData,
  TiktokProductBreakevenRow,
  TiktokProductRunAdvice,
} from "@/types/api";
import { compactMoney, formatMoney, groupVN } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { fmtRoi, openSellerCenter } from "@/lib/tiktok-ads";
import { Card } from "@/components/Card";
import { PlanLockedCard } from "@/components/PlanLockedCard";
import { TABULAR } from "@/theme/tokens";

/**
 * GỢI Ý CHẠY ADS cho TikTok trên app (17/10/2026, anh Trung: "bỏ tab Tất cả, thay bằng
 * Gợi ý giống bên Shopee") — nội dung TAB thứ 3 (Đang chạy / Cần xử lý / Gợi ý) của chip
 * TikTok. Cùng backend với cột "Nên chạy / Chạy thử" ở tab Hòa vốn sản phẩm trên web
 * (GET /api/quang-cao/tiktok/product-breakeven, backend product-run-advice.ts): chỉ sản
 * phẩm CHƯA chạy quảng cáo, hòa vốn đã tin được, xét 3 điều kiện (khả thi · đà bán · tồn),
 * ra ROI mục tiêu khởi điểm + ngân sách ngày theo công thức TikTok.
 *
 * Khác Shopee ở một chỗ quyết định: TikTok KHÔNG có API tạo chiến dịch (40002) → không có
 * nút tạo; hộp chi tiết chốt bằng hai con số phải đặt + MỘT nút Mở Seller Center. Cố ý thu
 * gọn cho điện thoại như khối Shopee: chỉ liệt kê SP có việc để làm (Nên chạy · Chạy thử),
 * tối đa 3 dòng rồi "Xem thêm"; "Chưa nên" / "Đang chạy ads" chỉ hiện số đếm.
 */

const TIER: Record<TiktokProductRunAdvice["tier"], { label: string; bg: string; text: string }> = {
  run: { label: "Nên chạy", bg: "bg-emerald-500", text: "text-white" },
  test: { label: "Chạy thử", bg: "bg-amber-500", text: "text-white" },
  not_yet: {
    label: "Chưa nên",
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-600 dark:text-slate-300",
  },
};

const CHECK: Record<
  NonNullable<TiktokProductRunAdvice["checks"]>[number]["status"],
  { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; word: string; text: string }
> = {
  pass: { icon: "checkmark-circle", color: "#10b981", word: "đạt", text: "text-emerald-600 dark:text-emerald-400" },
  caution: { icon: "alert-circle", color: "#d97706", word: "cần dè chừng", text: "text-amber-600 dark:text-amber-400" },
  block: { icon: "close-circle", color: "#ef4444", word: "chưa đạt", text: "text-red-500 dark:text-red-400" },
  unknown: { icon: "help-circle", color: "#94a3b8", word: "chưa có số", text: "text-slate-400 dark:text-slate-500" },
};

const PREVIEW_ROWS = 3;

// "Nên chạy" = CHỈ bậc run như web tiktok-product-breakeven-tab (should_run);
// "Chạy thử" là lời khuyên khác, không cộng vào số trên tab (rà 26/10).
const isActionable = (p: TiktokProductBreakevenRow) => p.runAdvice?.tier === "run";
/** Biên lãi 1 số lẻ kiểu Việt "23,4%" như web. */
const fmtMargin = (m: number) => `${String(Math.round(m * 1000) / 10).replace(".", ",")}%`;
const isRunning = (p: TiktokProductBreakevenRow) => p.campaigns.some((c) => c.status === "ongoing");
const sold = (p: TiktokProductBreakevenRow) => p.revenue + p.missingCostRevenue;

/** Số SP có việc để làm — trang cha in lên tab. */
export function countTiktokRecommend(data: TiktokProductBreakevenData): number {
  return data.products.filter(isActionable).length;
}

export function TiktokRecommendSection({
  channelId,
  reloadToken,
  visible,
  onCount,
}: {
  channelId: string;
  /** Đổi giá trị = tải lại (kéo xuống làm mới ở trang cha). */
  reloadToken: number;
  /** Tab Gợi ý đang mở — false thì không vẽ gì nhưng vẫn tải nền để đếm số cho tab. */
  visible: boolean;
  onCount: (n: number) => void;
}) {
  const [data, setData] = useState<TiktokProductBreakevenData | null>(null);
  const loadKey = `${channelId}#${reloadToken}`;
  const [loaded, setLoaded] = useState<{ key: string; error: string; locked?: boolean } | null>(null);
  const loading = loaded?.key !== loadKey;
  const error = loaded?.key === loadKey ? loaded.error : "";
  const planLocked = loaded?.key === loadKey && loaded.locked === true;
  const [retryTick, setRetryTick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const reqSeq = useRef(0);
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  });

  useEffect(() => {
    const seq = ++reqSeq.current;
    fetchTiktokProductBreakeven(channelId)
      .then((res) => {
        if (seq !== reqSeq.current) return;
        setData(res);
        onCountRef.current(countTiktokRecommend(res));
        setLoaded({ key: loadKey, error: "" });
      })
      .catch((err) => {
        if (seq !== reqSeq.current) return;
        setLoaded({
          key: loadKey,
          error: err instanceof ApiError ? err.message : "Không tải được gợi ý",
          locked: isPlanLockedError(err),
        });
      });
  }, [channelId, loadKey, retryTick]);

  const products = data?.products ?? [];
  // Nên chạy trước Chạy thử; cùng bậc thì SP bán nhiều hơn đứng trước.
  const actionable = products
    .filter(isActionable)
    .sort((a, b) => (a.runAdvice!.tier === b.runAdvice!.tier ? sold(b) - sold(a) : a.runAdvice!.tier === "run" ? -1 : 1));
  const shown = expanded ? actionable : actionable.slice(0, PREVIEW_ROWS);
  const hidden = actionable.length - shown.length;
  const notYet = products.filter((p) => p.runAdvice?.tier === "not_yet").length;
  const running = products.filter(isRunning).length;
  const noCost = products.filter((p) => p.verdict === "no_cost").length;
  const detail = products.find((p) => p.productId === detailId) ?? null;

  if (!visible) return null;

  return (
    <View className="mb-4">
      {data ? (
        <Text className="mb-2 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
          {actionable.length} sản phẩm nên chạy · {notYet} chưa nên · {running} đang chạy ads
        </Text>
      ) : null}

      {loading && !data ? (
        <View className="items-center py-6">
          <ActivityIndicator color="#64748b" />
          <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">Đang xét từng sản phẩm…</Text>
        </View>
      ) : planLocked && !data ? (
        <PlanLockedCard
          compact
          message={error}
          onRetry={() => {
            setLoaded(null);
            setRetryTick((t) => t + 1);
          }}
        />
      ) : error && !data ? (
        <Text className="py-3 text-center text-xs text-red-500 dark:text-red-400">{error}</Text>
      ) : data ? (
        <>
          {noCost > 0 ? (
            <View className="mb-2.5 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
              <Ionicons name="alert-circle-outline" size={16} color="#d97706" />
              <Text className="flex-1 text-xs text-slate-700 dark:text-slate-300">
                <Text className="font-semibold">{noCost} sản phẩm đang bán chưa có giá vốn</Text>
                {" "}nên chưa xét được — nhập giá vốn trên web là gợi ý mở ngay.
              </Text>
            </View>
          ) : null}

          {actionable.length === 0 ? (
            <Text className="px-4 py-4 text-center text-xs leading-4 text-slate-400 dark:text-slate-500">
              {products.length === 0
                ? "Gian chưa có sản phẩm nào có đơn đã đối soát để xét."
                : "Chưa có sản phẩm nào đủ điều kiện để gợi ý chạy quảng cáo."}
            </Text>
          ) : (
            <View className="gap-2.5">
              {shown.map((p) => (
                <RecommendCard
                  key={p.productId}
                  row={p}
                  onPress={() => {
                    hapticTap();
                    setDetailId(p.productId);
                  }}
                />
              ))}
              {hidden > 0 || expanded ? (
                <Pressable
                  className="items-center py-1.5"
                  onPress={() => {
                    hapticSelect();
                    setExpanded((v) => !v);
                  }}
                >
                  <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    {expanded ? "Thu gọn" : `Xem thêm ${hidden} sản phẩm`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </>
      ) : null}

      <RecommendSheet row={detail} onClose={() => setDetailId(null)} />
    </View>
  );
}

/** Một dòng gợi ý: nhãn + tên + hai số phải đặt và mốc hòa vốn. Không vạch viền trái (đã nằm trong tab riêng). */
function RecommendCard({ row, onPress }: { row: TiktokProductBreakevenRow; onPress: () => void }) {
  const a = row.runAdvice!;
  const t = TIER[a.tier];
  return (
    <Card className="p-3" onPress={onPress}>
      <View className="flex-row items-center gap-2">
        <View className={`rounded-full px-2 py-0.5 ${t.bg}`}>
          <Text className={`text-[10px] font-bold ${t.text}`}>{t.label}</Text>
        </View>
        {row.breakeven.margin != null ? (
          <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR} numberOfLines={1}>
            biên lãi {fmtMargin(row.breakeven.margin)}
          </Text>
        ) : null}
        <View className="flex-1" />
        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
      </View>
      <Text className="mt-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100" numberOfLines={3}>
        {row.name}
      </Text>
      <View className="mt-2.5 flex-row border-t border-slate-100 pt-2 dark:border-slate-800">
        <Mini label="ROI mục tiêu" value={fmtRoi(a.suggestedRoi)} />
        <Mini label="Hòa vốn" value={fmtRoi(row.breakeven.roi)} />
        <Mini label="Ngân sách / ngày" value={a.budget ? compactMoney(a.budget.daily) : "—"} right />
      </View>
    </Card>
  );
}

function Mini({ label, value, right }: { label: string; value: string; right?: boolean }) {
  return (
    <View className={`flex-1 ${right ? "items-end" : ""}`}>
      <Text className="text-[10px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
        {label}
      </Text>
      <Text className="text-[13px] font-bold text-slate-900 dark:text-slate-100" style={TABULAR} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Hộp trượt lên: số của sản phẩm → căn cứ 3 điều kiện → kết luận → hai số phải đặt → Mở
 * Seller Center. Không có nút tạo (API TikTok không tạo được chiến dịch).
 */
function RecommendSheet({ row, onClose }: { row: TiktokProductBreakevenRow | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const dark = useColorScheme().colorScheme === "dark";
  const a = row?.runAdvice ?? null;
  const toneBox =
    a?.tone === "warn"
      ? "bg-red-50 dark:bg-red-500/15"
      : a?.tone === "ok"
        ? "bg-emerald-50 dark:bg-emerald-500/10"
        : "bg-amber-50 dark:bg-amber-500/10";
  const toneIcon = a?.tone === "warn" ? "#ef4444" : a?.tone === "ok" ? "#10b981" : "#d97706";

  return (
    <Modal
      visible={row !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="max-h-[85%] rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          {row && a ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100">{row.name}</Text>
                <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Đóng">
                  <Ionicons name="close" size={20} color="#64748b" />
                </Pressable>
              </View>
              <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
                <View className={`rounded-full px-2 py-0.5 ${TIER[a.tier].bg}`}>
                  <Text className={`text-[10px] font-bold ${TIER[a.tier].text}`}>{TIER[a.tier].label}</Text>
                </View>
                <Text className="text-xs text-slate-500 dark:text-slate-400">
                  TikTok · chưa chạy quảng cáo · {row.skuCount} phân loại
                </Text>
              </View>

              <View className="mt-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <Row
                  label="Biên lãi trước quảng cáo"
                  value={row.breakeven.margin != null ? fmtMargin(row.breakeven.margin) : "—"}
                />
                <Row label="ROI hòa vốn" value={fmtRoi(row.breakeven.roi)} />
                <Row label="Bán ra 7 ngày / 30 ngày" value={`${groupVN(row.units7d)} / ${groupVN(row.units30d)}`} />
                <Row label="Tồn trên sàn" value={row.stock == null ? "chưa đọc được" : groupVN(row.stock)} />
                <Row
                  label={`Đơn đã đối soát (${row.breakeven.orders})`}
                  value={formatMoney(row.revenue)}
                />
              </View>

              {(a.checks?.length ?? 0) > 0 ? (
                <View className="mt-3">
                  <Text className="mb-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Căn cứ — 3 điều kiện đã xét
                  </Text>
                  {a.checks!.map((c) => {
                    const s = CHECK[c.status];
                    return (
                      <View key={c.key} className="mb-2 flex-row gap-2">
                        <Ionicons name={s.icon} size={16} color={s.color} style={{ marginTop: 1 }} />
                        <View className="flex-1">
                          <Text className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {c.title} <Text className={`font-normal ${s.text}`}>· {s.word}</Text>
                          </Text>
                          <Text className="text-xs leading-4 text-slate-600 dark:text-slate-300">{c.text}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : a.points.length > 0 ? (
                <View className="mt-3">
                  <Text className="mb-1 text-xs font-semibold text-slate-900 dark:text-slate-100">Căn cứ</Text>
                  {a.points.map((r, i) => (
                    <Text key={i} className="mb-0.5 text-xs text-slate-600 dark:text-slate-300">
                      • {r}
                    </Text>
                  ))}
                </View>
              ) : null}

              <View className={`mt-3 flex-row gap-2 rounded-xl px-3 py-2.5 ${toneBox}`}>
                <Ionicons name="bulb-outline" size={16} color={toneIcon} />
                <Text className="flex-1 text-[13px] leading-5 text-slate-900 dark:text-slate-100">
                  <Text className="font-bold">Kết luận: </Text>
                  {a.conclusion}
                </Text>
              </View>

              {/* Hai con số phải đặt khi tạo chiến dịch — in to, vì đây là thứ khách đem sang Seller Center. */}
              <View className="mt-3 flex-row gap-3">
                <View className="flex-1 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                  <Text className="text-[11px] text-slate-500 dark:text-slate-400">ROI mục tiêu khởi điểm</Text>
                  <Text className="mt-0.5 text-[20px] font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
                    {fmtRoi(a.suggestedRoi)}
                  </Text>
                  {a.floorRoi != null ? (
                    <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                      không dưới {fmtRoi(a.floorRoi)}
                    </Text>
                  ) : null}
                </View>
                <View className="flex-1 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                  <Text className="text-[11px] text-slate-500 dark:text-slate-400">Ngân sách / ngày</Text>
                  <Text
                    className="mt-0.5 text-[20px] font-bold text-slate-900 dark:text-slate-100"
                    style={TABULAR}
                    numberOfLines={1}
                  >
                    {a.budget ? compactMoney(a.budget.daily) : "—"}
                  </Text>
                  {a.budget?.byTiktok != null ? (
                    <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                      TikTok gợi ý {compactMoney(a.budget.byTiktok)}
                    </Text>
                  ) : null}
                </View>
              </View>
              {/* Cách ra số (a.budget.note) cố ý KHÔNG in: đoạn ~6 dòng, khách cần đơn giản — web có tooltip, app chỉ giữ hai con số. */}

              <View className="mt-4 gap-2">
                <Pressable
                  className="flex-row items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-3 active:opacity-80 dark:bg-slate-100"
                  onPress={openSellerCenter}
                >
                  <Ionicons name="open-outline" size={16} color={dark ? "#0f172a" : "#fff"} />
                  <Text className="text-sm font-semibold text-white dark:text-slate-900">
                    Mở Seller Center để tạo chiến dịch
                  </Text>
                </Pressable>
                <Text className="text-center text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                  Tạo chiến dịch GMV Max chỉ làm được trong TikTok Seller Center — đặt ROI mục tiêu và ngân sách
                  như trên, Hubsell sẽ theo dõi từ lúc chạy.
                </Text>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3 py-[3px]">
      <Text className="flex-1 text-[13px] text-slate-500 dark:text-slate-400">{label}</Text>
      <Text className="text-[13px] font-semibold text-slate-900 dark:text-slate-100" style={TABULAR}>
        {value}
      </Text>
    </View>
  );
}
