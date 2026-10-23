import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { useRouter, type Href } from "expo-router";
import { ApiError, isPlanLockedError } from "@/api/client";
import { fetchTiktokAdsDashboard, requestTiktokAdsRefresh } from "@/api/ads-tiktok";
import type { TiktokAdsCampaignRow, TiktokAdsDashboard } from "@/types/api";
import { rangeFor, type DateRange } from "@/lib/dates";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { ShopFilterField } from "@/components/ShopFilter";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { compactMoney } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import {
  attentionAction,
  dryRunPlanned,
  fmtRoi,
  fmtSyncedAt,
  openSellerCenter,
  sortAttention,
  TIKTOK_ADVICE_TONE,
  TIKTOK_AUTO_MODE_PILL,
  TIKTOK_STATUS_LABEL,
  tiktokStatusKey,
} from "@/lib/tiktok-ads";
import { Card } from "@/components/Card";
import { PlanLockedCard } from "@/components/PlanLockedCard";
import { TiktokCampaignSheet } from "@/components/TiktokCampaignSheet";
import { TiktokRecommendSection } from "@/components/TiktokRecommendSection";
import { TABULAR } from "@/theme/tokens";

/**
 * TRỢ LÝ QUẢNG CÁO TIKTOK trên app — thân của trang Quảng cáo khi chọn chip
 * TikTok (16/10/2026, docs/ADS-TIKTOK-TREN-MOBILE.md). Giữ đúng khung Shopee
 * (4 số → tab → thẻ chiến dịch) để khách không học lại; chỉ đổi thứ TikTok
 * không có: không ví, không chế độ Trợ lý chung, không Tạm dừng.
 * Việc app làm được thật với TikTok là LOẠI / KHÔI PHỤC VIDEO (màn Video);
 * việc còn lại (ROI, ngân sách, bật / tắt) dẫn sang Seller Center.
 *
 * 17/10 anh Trung chốt (xem thật trên máy): (1) BỎ khối "Cần xử lý" trên 4 số —
 * đã có tab Cần xử lý, 100 việc thì không thành 100 thẻ chồng lên chỉ số; thẻ
 * trong tab giữ MỘT nút hành động của khối cũ. (2) Tab "Tất cả" → "Gợi ý" như
 * Shopee; chiến dịch đã dừng xem bằng dòng gấp dưới tab Đang chạy. (3) Chế độ
 * Tự loại video xuống dòng riêng, màu riêng (TIKTOK_AUTO_MODE_PILL).
 */

type ListFilter = "ongoing" | "flagged" | "reco";
const LIST_FILTERS: { key: ListFilter; label: string }[] = [
  { key: "ongoing", label: "Đang chạy" },
  { key: "flagged", label: "Cần xử lý" },
  // Nhãn ngắn "Gợi ý": 3 tab chia đều một hàng, máy 320px mỗi tab ~90px.
  { key: "reco", label: "Gợi ý" },
];

export function videosHref(c: { id: string; name: string }, range: DateRange, filter?: string): Href {
  const q = new URLSearchParams({ id: c.id, from: range.from, to: range.to, name: c.name });
  if (filter) q.set("filter", filter);
  return `/tiktok-campaign?${q.toString()}` as Href;
}

export function TiktokAdsSection({ header }: { header: React.ReactNode }) {
  const router = useRouter();
  // Kỳ xem riêng của TikTok: mặc định 7 ngày như web (chi phí video trễ tới 11 giờ).
  const [range, setRange] = useState<DateRange>(() => rangeFor("7d"));
  const [channelId, setChannelId] = useState("");
  const [data, setData] = useState<TiktokAdsDashboard | null>(null);
  const [filter, setFilter] = useState<ListFilter>("ongoing");
  const [detail, setDetail] = useState<TiktokAdsCampaignRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [planLocked, setPlanLocked] = useState<string | null>(null);
  // Tăng mỗi lần kéo xuống làm mới → tab Gợi ý xét lại (khối đó không theo nhịp 60s).
  const [recoToken, setRecoToken] = useState(0);
  // Số SP có việc để làm — tải nền nên có số trên tab trước khi bấm.
  const [recoCount, setRecoCount] = useState<number | null>(null);
  // Chiến dịch đã dừng / kết thúc gấp dưới tab Đang chạy (thay tab Tất cả đã bỏ 17/10).
  const [showEnded, setShowEnded] = useState(false);
  const reqSeq = useRef(0);

  const load = useCallback(
    async ({ from, to }: DateRange, chId: string, asRefresh: boolean | "silent" = false) => {
      const seq = ++reqSeq.current;
      if (asRefresh === true) setRefreshing(true);
      else if (!asRefresh) setLoading(true);
      if (asRefresh !== "silent") setError("");
      try {
        const res = await fetchTiktokAdsDashboard({ from, to, channelId: chId || undefined });
        if (seq !== reqSeq.current) return;
        setData(res);
        setPlanLocked(null);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        if (isPlanLockedError(err)) {
          setPlanLocked(err.message);
          return;
        }
        if (asRefresh === "silent") return;
        setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, kéo xuống thử lại");
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void load(range, channelId);
  }, [range, channelId, load]);

  useAutoRefresh(() => void load(range, channelId, "silent"));

  // Backend đang kéo số 30 ngày (vừa nối / vừa bấm làm mới) → hỏi lại mỗi 20s như web, tối đa 6 lượt.
  const pollLeft = useRef(0);
  useEffect(() => {
    if (!data?.adsRefreshing) {
      pollLeft.current = 0;
      return;
    }
    if (pollLeft.current === 0) pollLeft.current = 6;
    const t = setTimeout(() => {
      pollLeft.current -= 1;
      if (pollLeft.current > 0) void load(range, channelId, "silent");
    }, 20_000);
    return () => clearTimeout(t);
  }, [data?.adsRefreshing, data?.adsSyncedAt, range, channelId, load]);

  const onRefresh = () => {
    const ch = data?.selectedChannelId;
    // Kéo xuống = xin TikTok số mới (không chặn) rồi đọc lại DB.
    if (ch && adsLinked && !linkBroken) requestTiktokAdsRefresh(ch).catch(() => undefined);
    setRecoToken((t) => t + 1);
    void load(range, channelId, true);
  };

  const campaigns = data?.campaigns ?? [];
  // Cần xử lý: xếp nặng trước (tiền đang mất → tiền có thể kiếm thêm), cùng mức thì chi phí giảm dần.
  const attention = sortAttention(campaigns);
  const ongoingRows = campaigns.filter((c) => tiktokStatusKey(c.status) === "ongoing");
  const endedRows = campaigns.filter((c) => tiktokStatusKey(c.status) !== "ongoing");
  const listed = filter === "ongoing" ? ongoingRows : filter === "flagged" ? attention : [];
  const s = data?.summary ?? null;
  const selected = data?.channels.find((c) => c.id === data.selectedChannelId) ?? null;
  // Đã nối (dù đang hỏng) vẫn có số trong DB → hiện số + dải đỏ, như web; chưa nối mới chỉ đường về web.
  const adsLinked = !!selected?.ads;
  const linkBroken = !!selected?.ads && selected.ads.status !== "ACTIVE";
  const syncedAt = fmtSyncedAt(data?.adsSyncedAt);

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1 bg-slate-50 dark:bg-slate-950"
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {header}

        {/* Một hàng hai ô: gian TikTok (hộp trượt) + kỳ xem (mặc định 7 ngày) */}
        <View className="mb-2 flex-row gap-2">
          {data && data.channels.length > 0 ? (
            <ShopFilterField
              mode="single"
              compact
              className="flex-1"
              channels={data.channels.map((ch) => ({ id: ch.id, shopName: ch.shopName, channelName: "TIKTOK" }))}
              value={{ channelName: "TIKTOK", channelId: data.selectedChannelId ?? "" }}
              onChange={(next) => setChannelId(next.channelId)}
            />
          ) : null}
          <DateRangeFilter compact className="flex-1" value={range} onChange={setRange} />
        </View>
        {/* Số TikTok trễ (video tới 11 giờ) nên nói rõ số tới lúc nào — thay chỗ nhãn chế độ Trợ lý của Shopee. */}
        {data && adsLinked ? (
          <Text className="mb-2 text-right text-[11px] text-slate-400 dark:text-slate-500">
            {data.adsRefreshing
              ? "Đang kéo số từ TikTok…"
              : syncedAt
                ? `Số tới ${syncedAt} · kéo xuống để cập nhật`
                : "Chưa kéo được số từ TikTok"}
          </Text>
        ) : (
          <View className="mb-2" />
        )}

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#64748b" />
          </View>
        ) : planLocked ? (
          <View className="mt-2">
            <PlanLockedCard message={planLocked} onRetry={() => void load(range, channelId)} />
          </View>
        ) : error ? (
          <View className="items-center rounded-2xl bg-white p-6 dark:bg-slate-900">
            <Text className="text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
          </View>
        ) : !data || !data.configured ? (
          <Card className="mt-2 items-center p-6">
            <Ionicons name="megaphone-outline" size={28} color="#94a3b8" />
            <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              Trợ lý quảng cáo TikTok chưa sẵn sàng trên hệ thống.
            </Text>
          </Card>
        ) : data.channels.length === 0 ? (
          <Card className="mt-2 items-center p-6">
            <Ionicons name="megaphone-outline" size={28} color="#94a3b8" />
            <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              Chưa có gian TikTok nào đang kết nối.
            </Text>
          </Card>
        ) : !adsLinked ? (
          // Gian chưa nối tài khoản quảng cáo — việc nối là OAuth TikTok Business, làm trên
          // web; app chỉ chỉ đường, một câu (khách cần đơn giản).
          <View className="mb-3 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
            <Ionicons name="link-outline" size={16} color="#d97706" />
            <View className="flex-1">
              <Text className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Gian này chưa nối tài khoản quảng cáo TikTok
              </Text>
              <Text className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                Mở Hubsell trên máy tính, vào Trợ lý quảng cáo TikTok → Kết nối tài khoản quảng cáo.
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* Nối rồi nhưng hỏng (hủy ủy quyền / token hết hạn): số cũ vẫn xem được, nối lại trên web. */}
            {linkBroken ? (
              <View className="mb-3 flex-row gap-2 rounded-xl bg-red-50 px-3 py-2.5 dark:bg-red-500/15">
                <Ionicons name="warning" size={16} color="#ef4444" />
                <View className="flex-1">
                  <Text className="text-xs font-semibold text-red-700 dark:text-red-300">
                    Kết nối quảng cáo TikTok đang hỏng — số bên dưới là số cũ
                  </Text>
                  <Text className="mt-0.5 text-xs text-red-600 dark:text-red-300">
                    {selected?.ads?.problem ?? "TikTok không cho đọc số nữa."} Kết nối lại trên Hubsell web → Trợ lý quảng cáo TikTok.
                  </Text>
                </View>
              </View>
            ) : data.link?.lastSyncError ? (
              <View className="mb-3 flex-row items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
                <Ionicons name="warning-outline" size={16} color="#d97706" />
                <Text className="flex-1 text-xs font-medium text-amber-700 dark:text-amber-300" numberOfLines={3}>
                  Lần kéo số gần nhất lỗi: {data.link.lastSyncError}
                </Text>
              </View>
            ) : null}

            {/* ===== 4 SỐ CỦA KỲ — 5 số của web gộp cho vừa 2×2 ===== */}
            {s ? (
              <>
                <View className="mb-3 mt-1 flex-row gap-3">
                  <Tile
                    label="Chi phí quảng cáo"
                    value={compactMoney(s.spend)}
                    tone="red"
                    sub={`${s.liveCampaigns} chiến dịch đang chạy`}
                  />
                  <Tile
                    label="Doanh thu GMV Max"
                    value={compactMoney(s.gmv)}
                    sub={`${s.orders} đơn${s.costPerOrder != null ? ` · CPA ${compactMoney(s.costPerOrder)}` : ""}`}
                  />
                </View>
                <View className="mb-4 flex-row gap-3">
                  {/* Không tô màu ROI: hòa vốn gian có thể lệch hòa vốn từng chiến dịch — ô Lãi nói màu. */}
                  <Tile
                    label="ROI"
                    value={fmtRoi(s.roi)}
                    sub={
                      data.breakeven?.roi != null
                        ? `Hòa vốn của shop ${fmtRoi(data.breakeven.roi)}`
                        : "Chưa có hòa vốn của shop"
                    }
                  />
                  <Tile
                    label="Lãi/lỗ ước tính"
                    value={s.estProfit == null ? "—" : compactMoney(s.estProfit)}
                    tone={s.estProfit == null ? undefined : s.estProfit < 0 ? "red" : "emerald"}
                    sub={s.estProfit == null ? "chưa có biên lãi" : "sau quảng cáo"}
                  />
                </View>
              </>
            ) : null}

            {/* ===== HÀNG TAB — ba tab chia đều một hàng, số đếm trên Cần xử lý / Gợi ý ===== */}
            <View className="mb-2 flex-row items-center gap-1.5">
              {LIST_FILTERS.map((f) => {
                const active = filter === f.key;
                const n =
                  f.key === "flagged" ? attention.length : f.key === "reco" ? (recoCount ?? 0) : 0;
                const label = n > 0 ? `${f.label} (${n})` : f.label;
                return (
                  <Pressable
                    key={f.key}
                    className={`flex-1 items-center rounded-full px-1 py-1.5 ${
                      active
                        ? "bg-slate-900 dark:bg-slate-100"
                        : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    }`}
                    onPress={() => {
                      if (!active) hapticSelect();
                      setFilter(f.key);
                    }}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        active ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                      }`}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {/* Khối gợi ý LUÔN mount khi có gian (tải nền + đếm số cho tab), chỉ vẽ khi tab Gợi ý mở. */}
            {data.selectedChannelId ? (
              <TiktokRecommendSection
                channelId={data.selectedChannelId}
                reloadToken={recoToken}
                visible={filter === "reco"}
                onCount={setRecoCount}
              />
            ) : null}
            {filter === "reco" ? null : listed.length === 0 ? (
              filter === "flagged" ? (
                <View className="mb-4 flex-row items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 dark:bg-emerald-500/10">
                  <Ionicons name="checkmark-circle" size={16} color="#10b981" />
                  <Text className="flex-1 text-xs text-emerald-700 dark:text-emerald-300">
                    Không có chiến dịch nào cần xử lý.
                  </Text>
                </View>
              ) : (
                <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  Không có chiến dịch nào đang chạy.
                </Text>
              )
            ) : (
              <View className="gap-2.5">
                {listed.map((c) => (
                  <CampaignCard
                    key={c.id}
                    c={c}
                    onPress={() => setDetail(c)}
                    // Tab Cần xử lý giữ MỘT nút của khối cũ: việc app làm được (Xem video) hoặc đúng chỗ (Seller Center).
                    onVideos={filter === "flagged" ? (f) => router.push(videosHref(c, range, f)) : undefined}
                  />
                ))}
              </View>
            )}
            {/* Chiến dịch đã dừng / kết thúc: gấp lại dưới tab Đang chạy (tab Tất cả bỏ 17/10). */}
            {filter === "ongoing" && endedRows.length > 0 ? (
              <View className="mt-2.5 gap-2.5">
                <Pressable
                  className="flex-row items-center justify-center gap-1 py-1.5"
                  onPress={() => {
                    hapticSelect();
                    setShowEnded((v) => !v);
                  }}
                >
                  <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {showEnded ? "Ẩn chiến dịch đã dừng" : `Xem ${endedRows.length} chiến dịch đã dừng`}
                  </Text>
                  <Ionicons name={showEnded ? "chevron-up" : "chevron-down"} size={14} color="#94a3b8" />
                </Pressable>
                {showEnded
                  ? endedRows.map((c) => <CampaignCard key={c.id} c={c} onPress={() => setDetail(c)} />)
                  : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <TiktokCampaignSheet
        campaign={detail}
        onClose={() => setDetail(null)}
        onVideos={(c, f) => {
          setDetail(null);
          router.push(videosHref(c, range, f));
        }}
      />
    </View>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "red" | "emerald";
}) {
  const color =
    tone === "red"
      ? "text-red-500 dark:text-red-400"
      : tone === "emerald"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-slate-900 dark:text-slate-100";
  return (
    <Card className="flex-1 p-3.5">
      <Text className="text-[11px] font-medium text-slate-500 dark:text-slate-400" numberOfLines={2}>
        {label}
      </Text>
      <Text className={`mt-1 text-[20px] font-bold ${color}`} style={TABULAR} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Card>
  );
}

/** Nhãn nhận định — màu theo tông, chữ do backend đặt (cùng web). */
export function AdviceChip({ c }: { c: TiktokAdsCampaignRow }) {
  const a = c.advice;
  if (!a || a.kind === "paused" || a.kind === "no_spend") return null;
  const t = TIKTOK_ADVICE_TONE[a.tone];
  return (
    <View className={`rounded-full px-2 py-0.5 ${t.bg}`}>
      <Text className={`text-[10px] font-bold ${t.text}`} numberOfLines={1}>
        {a.label}
      </Text>
    </View>
  );
}

/** Dòng trạng thái dưới tên: "Đang chạy · ROI mục tiêu 15x" (chế độ Tự loại tách ra AutoPill — 17/10). */
export function statusLine(c: TiktokAdsCampaignRow): string {
  const parts = [TIKTOK_STATUS_LABEL[tiktokStatusKey(c.status)]];
  if (c.biddingMethod === "max_delivery") parts.push("Phân phối tối đa");
  else if (c.roasTarget != null) parts.push(`ROI mục tiêu ${fmtRoi(c.roasTarget)}`);
  return parts.join(" · ");
}

/** Chế độ Tự loại video — dòng riêng, màu riêng để khỏi lẫn với trạng thái và nhận định (anh Trung 17/10). */
export function AutoPill({ c }: { c: TiktokAdsCampaignRow }) {
  if (!c.auto || c.auto.mode === "off") return null;
  const m = TIKTOK_AUTO_MODE_PILL[c.auto.mode];
  return (
    <View className={`flex-row items-center gap-1 self-start rounded-full px-2 py-0.5 ${m.bg}`}>
      <Ionicons name="flash-outline" size={11} color={m.icon} />
      <Text className={`text-[10px] font-semibold ${m.text}`} numberOfLines={1}>
        {m.label}
      </Text>
    </View>
  );
}

/**
 * MỘT nút hành động của thẻ Cần xử lý (khảo sát 04/10 kết luận 4: app báo triệu
 * chứng mà không có chỗ xử lý là bị chê): việc app làm được (Xem video → loại)
 * hoặc dẫn đúng chỗ (Seller Center). Từ 17/10 nằm dưới thẻ chiến dịch trong tab
 * Cần xử lý (khối Cần xử lý trên 4 số đã bỏ).
 */
function AttentionAction({ c, onVideos }: { c: TiktokAdsCampaignRow; onVideos: (filter: string) => void }) {
  const dark = useColorScheme().colorScheme === "dark";
  const planned = dryRunPlanned(c);
  const a = c.advice;
  const warnKind = a && (a.kind === "no_orders" || a.kind === "losing");
  // Chỉ diễn tập định loại (nhận định không cảnh báo) → nút nói đúng số video máy định loại.
  const onlyPlanned = !warnKind && !(a && a.tone === "warn") && planned > 0 && !(a && a.editInSellerCenter);
  if (attentionAction(c) === "videos" || onlyPlanned) {
    return (
      <Pressable
        className="mt-2.5 flex-row items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 active:opacity-80 dark:bg-slate-100"
        onPress={() => {
          hapticTap();
          onVideos(onlyPlanned || (planned > 0 && !warnKind) ? "exclude" : "no_order");
        }}
      >
        <Ionicons name="videocam-outline" size={15} color={dark ? "#0f172a" : "#fff"} />
        <Text className="text-[13px] font-semibold text-white dark:text-slate-900" numberOfLines={1}>
          {onlyPlanned ? `Xem ${planned} video máy định loại` : "Xem video đang đốt tiền"}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      className="mt-2.5 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-2.5 active:opacity-70 dark:border-slate-600"
      onPress={openSellerCenter}
    >
      <Ionicons name="open-outline" size={15} color={dark ? "#e2e8f0" : "#334155"} />
      <Text className="text-[13px] font-semibold text-slate-800 dark:text-slate-100" numberOfLines={1}>
        Mở Seller Center để sửa
      </Text>
    </Pressable>
  );
}

/**
 * Thẻ chiến dịch: tên, dòng trạng thái + nhận định, dòng Tự loại (riêng), ba số như thẻ
 * Shopee (ROAS → ROI). Có `onVideos` (tab Cần xử lý) thì thêm vạch trái theo mức nặng + MỘT nút.
 */
function CampaignCard({
  c,
  onPress,
  onVideos,
}: {
  c: TiktokAdsCampaignRow;
  onPress: () => void;
  onVideos?: (filter: string) => void;
}) {
  const be = c.breakeven?.roi ?? null;
  const below = c.roi != null && be != null && c.roi < be;
  const ongoing = tiktokStatusKey(c.status) === "ongoing";
  const a = c.advice;
  const edge = onVideos
    ? a && a.tone === "warn"
      ? "border-l-4 border-l-red-500"
      : a && a.tone === "info"
        ? "border-l-4 border-l-amber-500"
        : "border-l-4 border-l-slate-400"
    : "";
  const planned = ongoing ? dryRunPlanned(c) : 0;
  return (
    <Card className={`p-3 ${edge}`} onPress={onPress}>
      <Text className="text-[13px] font-semibold text-slate-900 dark:text-slate-100" numberOfLines={2}>
        {c.name}
      </Text>
      <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
        <Text
          className={`text-[11px] font-medium ${
            ongoing ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {statusLine(c)}
        </Text>
        {ongoing ? <AdviceChip c={c} /> : null}
      </View>
      {c.auto && c.auto.mode !== "off" ? (
        <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
          <AutoPill c={c} />
          {planned > 0 ? (
            <Text className="text-[10px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
              định loại {planned} video
            </Text>
          ) : null}
        </View>
      ) : null}
      <View className="mt-2.5 flex-row border-t border-slate-100 pt-2 dark:border-slate-800">
        <Metric label="Chi phí" value={compactMoney(c.spend)} />
        <Metric
          label="ROI / hòa vốn"
          value={`${fmtRoi(c.roi)} / ${fmtRoi(be)}`}
          tone={c.roi == null || be == null ? undefined : below ? "red" : "emerald"}
        />
        <Metric
          label="Lãi ước tính"
          value={c.estProfit == null ? "—" : compactMoney(c.estProfit)}
          tone={c.estProfit == null ? undefined : c.estProfit < 0 ? "red" : "emerald"}
          dim={c.breakeven?.source === "shop"}
          right
        />
      </View>
      {onVideos ? <AttentionAction c={c} onVideos={onVideos} /> : null}
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  right,
  dim,
}: {
  label: string;
  value: string;
  tone?: "red" | "emerald";
  right?: boolean;
  /** Hòa vốn mượn của gian → số mờ như cột web. */
  dim?: boolean;
}) {
  const color =
    tone === "red"
      ? "text-red-500 dark:text-red-400"
      : tone === "emerald"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-slate-900 dark:text-slate-100";
  return (
    <View className={`flex-1 ${right ? "items-end" : ""}`}>
      <Text className="text-[10px] text-slate-400 dark:text-slate-500">{label}</Text>
      <Text
        className={`text-[13px] font-bold ${color} ${dim ? "opacity-60" : ""}`}
        style={TABULAR}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}
