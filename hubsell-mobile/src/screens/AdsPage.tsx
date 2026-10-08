import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, isPlanLockedError } from "@/api/client";
import { PlanLockedCard } from "@/components/PlanLockedCard";
import {
  decideAdsCampaign,
  fetchAdsOverview,
  pauseAdsCampaign,
  resumeAdsCampaign,
} from "@/api/ads";
import type {
  AdsCampaignDto,
  AdsOverviewResponse,
  AdsPlatform,
  AdsVerdict,
} from "@/types/api";
import { defaultRange, type DateRange } from "@/lib/dates";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { compactMoney, formatMoney } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { useChannelColors } from "@/theme/channel-colors";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Card } from "@/components/Card";
import { AdsRecommendSection } from "@/components/AdsRecommendSection";
import { TABULAR } from "@/theme/tokens";

/**
 * Trang QUẢNG CÁO — trang 3 của pager Trang chủ (chủ shop). Bố cục anh Trung
 * duyệt 04/10 sau khảo sát (docs/KHAO-SAT-TRO-LY-QUANG-CAO-MOBILE.md): app chỉ
 * trả lời "có chiến dịch nào đang đốt tiền không, và xử lý ngay":
 *   ngữ cảnh + chế độ Trợ lý → dải ví → CẦN XỬ LÝ (trên chỉ số) → 4 số của kỳ
 *   → hàng tab Đang chạy / Cần xử lý / Tất cả / GỢI Ý CHẠY ADS → danh sách của
 *   tab đó → hộp chi tiết có Tạm dừng / Bật lại.
 * Gợi ý chạy Ads (Shopee, thêm 05/10) là TAB thứ 4 của hàng tab, không phải
 * khối riêng chen giữa trang (anh Trung chốt 05/10 sau khi xem bản mô phỏng):
 * người chỉ muốn canh tiền không bị khối gợi ý đẩy danh sách xuống; số đếm
 * trên tab để gợi ý không bị "giấu". Đó là chỗ duy nhất app TẠO chiến dịch
 * (1 SP, từ đề xuất đã tính sẵn — AdsRecommendSection). Cấu hình quy tắc, tạo
 * chiến dịch tự do, từ khóa, GMV Max cấp shop ở lại web.
 */

const PLATFORMS: { key: AdsPlatform; label: string; channelName: string }[] = [
  { key: "shopee", label: "Shopee", channelName: "SHOPEE" },
  { key: "lazada", label: "Lazada", channelName: "LAZADA" },
];

// Cùng nhãn với web (VERDICT_META). Thứ tự mảng = mức nặng, dùng để xếp "Cần xử lý".
const FLAGGED: AdsVerdict[] = ["spike", "pause_now", "review"];
const VERDICT: Record<AdsVerdict, { label: string; bg: string; text: string }> = {
  spike: { label: "Vọt chi hôm nay", bg: "bg-red-600", text: "text-white" },
  pause_now: { label: "Đề xuất tạm dừng", bg: "bg-red-500", text: "text-white" },
  grace: { label: "Theo dõi sát", bg: "bg-violet-600", text: "text-white" },
  review: { label: "Cần duyệt", bg: "bg-amber-500", text: "text-white" },
  healthy: {
    label: "Ổn",
    bg: "bg-emerald-50 dark:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  insufficient_data: {
    label: "Chưa đủ dữ liệu",
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-500 dark:text-slate-400",
  },
};

const STATUS_LABEL: Record<string, string> = {
  ongoing: "Đang chạy",
  scheduled: "Đã đặt lịch",
  paused: "Tạm dừng",
  ended: "Kết thúc",
  closed: "Kết thúc",
  deleted: "Đã xóa",
};

const MODE_LABEL = { off: "Trợ lý: chỉ đề xuất", dry_run: "Trợ lý: diễn tập", live: "Trợ lý: tự xử lý" };

type ListFilter = "ongoing" | "flagged" | "all" | "reco";
const LIST_FILTERS: { key: ListFilter; label: string }[] = [
  { key: "ongoing", label: "Đang chạy" },
  { key: "flagged", label: "Cần xử lý" },
  { key: "all", label: "Tất cả" },
  // Tab Gợi ý chỉ có trên Shopee (backend mới có lệnh tạo cho Shopee). Nhãn
  // ngắn "Gợi ý" (không phải "Gợi ý chạy Ads"): 4 tab chia đều một hàng trên
  // màn 360px chỉ còn ~77px mỗi tab — nhãn dài là rớt dòng (anh Trung 05/10).
  { key: "reco", label: "Gợi ý" },
];

const roas = (v: number | null) =>
  v == null ? "—" : `${v.toFixed(2).replace(".", ",")}x`;

/** Cảnh báo còn hiệu lực: máy gắn cờ, chiến dịch đang chạy, chủ shop chưa quyết. */
function isFlagged(c: AdsCampaignDto): boolean {
  return (
    c.status === "ongoing" &&
    FLAGGED.includes(c.assistant.verdict) &&
    !c.assistant.decisionActive
  );
}

/** Cần chủ shop nhìn: cảnh báo còn hiệu lực, hoặc Hubsell đã tự ra tay. */
function needsAttention(c: AdsCampaignDto): boolean {
  return isFlagged(c) || c.hubsellPause !== null || c.hubsellBudgetCut !== null;
}

export function AdsPage() {
  const channelColors = useChannelColors();
  const [platform, setPlatform] = useState<AdsPlatform>("shopee");
  const [channelId, setChannelId] = useState("");
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [data, setData] = useState<AdsOverviewResponse | null>(null);
  const [filter, setFilter] = useState<ListFilter>("ongoing");
  const [detail, setDetail] = useState<AdsCampaignDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Gói bị khóa (403 PLAN_LOCKED) → thẻ khóa thay ô lỗi, giữ câu backend.
  const [planLocked, setPlanLocked] = useState<string | null>(null);
  // Tăng mỗi lần kéo xuống làm mới → khối Gợi ý chạy Ads tải lại theo
  // (khối đó không theo nhịp 60s vì mỗi lần gọi là chấm cả kho SP).
  const [recoToken, setRecoToken] = useState(0);
  // Số SP có việc để làm — khối gợi ý báo lên để in trên tab (tải nền cả khi
  // tab khác đang mở, nên số có sẵn trước khi bấm).
  const [recoCount, setRecoCount] = useState<number | null>(null);
  // Số thứ tự lượt tải — đổi sàn/kỳ liên tiếp thì chỉ lượt MỚI NHẤT được ghi.
  const reqSeq = useRef(0);

  const load = useCallback(
    async (
      p: AdsPlatform,
      { from, to }: DateRange,
      chId: string,
      asRefresh: boolean | "silent" = false
    ) => {
      const seq = ++reqSeq.current;
      if (asRefresh === true) setRefreshing(true);
      else if (!asRefresh) setLoading(true);
      if (asRefresh !== "silent") setError("");
      try {
        const res = await fetchAdsOverview(p, { from, to, channelId: chId || undefined });
        if (seq !== reqSeq.current) return;
        setData(res);
        setPlanLocked(null);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        if (isPlanLockedError(err)) {
          setPlanLocked(err.message);
          return;
        }
        if (asRefresh === "silent") return; // tải nền hỏng thì giữ số cũ
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
    void load(platform, range, channelId);
  }, [platform, range, channelId, load]);

  useAutoRefresh(() => void load(platform, range, channelId, "silent"));

  const platformMeta = PLATFORMS.find((p) => p.key === platform)!;
  const campaigns = data?.campaigns ?? [];
  const attention = campaigns
    .filter(needsAttention)
    .sort(
      (a, b) =>
        // Cảnh báo còn hiệu lực trước (theo mức nặng), việc Hubsell đã làm sau.
        (isFlagged(a) ? FLAGGED.indexOf(a.assistant.verdict) : 9) -
          (isFlagged(b) ? FLAGGED.indexOf(b.assistant.verdict) : 9) || b.spend - a.spend
    );
  const listed = campaigns.filter((c) =>
    filter === "ongoing" ? c.status === "ongoing" : filter === "flagged" ? needsAttention(c) : true
  );
  const s = data?.summary ?? null;
  const mode = data?.assistant?.config.autoExecute.mode;
  // Gian đã nối Hubsell Ads (hoặc sàn không cần) — như shopee-ads-page web.
  const adsLinked = !data?.adsApp?.required || data.adsApp.status === "ACTIVE";

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1 bg-slate-50 dark:bg-slate-950"
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRecoToken((t) => t + 1);
              void load(platform, range, channelId, true);
            }}
          />
        }
      >
        <DateRangeFilter className="mb-2" value={range} onChange={setRange} />

        {/* Sàn + chế độ Trợ lý (chỉ xem — đổi chế độ ở web) */}
        <View className="mb-2 flex-row flex-wrap items-center gap-2">
          {PLATFORMS.map((p) => {
            const active = platform === p.key;
            return (
              <Pressable
                key={p.key}
                className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${
                  active
                    ? "bg-slate-900 dark:bg-slate-100"
                    : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                }`}
                onPress={() => {
                  if (active) return;
                  hapticSelect();
                  setChannelId("");
                  setData(null);
                  setRecoCount(null);
                  // Lazada không có tab Gợi ý — đang đứng ở đó thì về Đang chạy.
                  if (p.key !== "shopee") setFilter((f) => (f === "reco" ? "ongoing" : f));
                  setPlatform(p.key);
                }}
              >
                <View
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: channelColors[p.channelName] }}
                />
                <Text
                  className={`text-xs font-semibold ${
                    active ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
          <View className="flex-1" />
          {mode ? (
            <View className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
              <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {MODE_LABEL[mode]}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Chọn gian của sàn — một gian vẫn hiện tên để biết đang xem số của shop nào */}
        {data && data.channels.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            <View className="flex-row gap-2">
              {data.channels.map((ch) => {
                const active = ch.id === data.selectedChannelId;
                return (
                  <Pressable
                    key={ch.id}
                    className={`rounded-full border px-3 py-1.5 ${
                      active
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15"
                        : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    }`}
                    onPress={() => {
                      if (!active) hapticSelect();
                      setChannelId(ch.id);
                    }}
                  >
                    <Text
                      className={`text-xs font-medium ${
                        active
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {ch.shopName}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : null}

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#64748b" />
          </View>
        ) : planLocked ? (
          <View className="mt-2">
            <PlanLockedCard
              message={planLocked}
              onRetry={() => void load(platform, range, channelId)}
            />
          </View>
        ) : error ? (
          <View className="items-center rounded-2xl bg-white p-6 dark:bg-slate-900">
            <Text className="text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
          </View>
        ) : !data || data.channels.length === 0 ? (
          <Card className="mt-2 items-center p-6">
            <Ionicons name="megaphone-outline" size={28} color="#94a3b8" />
            <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              Chưa có gian {platformMeta.label} nào đang kết nối.
            </Text>
          </Card>
        ) : (
          <>
            {/* Gian chưa ủy quyền quảng cáo cho Hubsell (hoặc đã mất kết nối) — việc
                nối làm trên web, app chỉ báo để khách khỏi tưởng "không có số". */}
            {data.adsApp?.required && data.adsApp.status !== "ACTIVE" ? (
              <View className="mb-3 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
                <Ionicons name="link-outline" size={16} color="#d97706" />
                <View className="flex-1">
                  <Text className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {data.adsApp.status === "DISCONNECTED"
                      ? "Gian này đã mất kết nối quảng cáo với Hubsell"
                      : "Gian này chưa ủy quyền quảng cáo cho Hubsell"}
                  </Text>
                  <Text className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                    Mở Hubsell trên máy tính, vào Trợ lý quảng cáo {platformMeta.label} và bấm
                    Kết nối Hubsell Ads. Trước khi nối, số liệu ở đây không được cập nhật.
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Dải ví quảng cáo hết tiền */}
            {data.walletEmpty ? (
              <View className="mb-3 flex-row items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 dark:bg-red-500/15">
                <Ionicons name="warning" size={16} color="#ef4444" />
                <Text className="flex-1 text-xs font-medium text-red-600 dark:text-red-300">
                  Ví quảng cáo {platformMeta.label} đã hết tiền, quảng cáo đang ngừng hiển thị.
                </Text>
              </View>
            ) : null}

            {/* ===== CẦN XỬ LÝ — đặt trên chỉ số ===== */}
            <Text className="mb-2 mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Cần xử lý{attention.length > 0 ? ` (${attention.length})` : ""}
            </Text>
            {attention.length === 0 ? (
              <View className="mb-4 flex-row items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-500/10">
                <Ionicons name="checkmark-circle" size={16} color="#10b981" />
                <Text className="flex-1 text-xs text-emerald-700 dark:text-emerald-300">
                  Không có chiến dịch nào cần xử lý.
                </Text>
              </View>
            ) : (
              <View className="mb-4 gap-2.5">
                {attention.map((c) => (
                  <AttentionCard key={c.id} c={c} onPress={() => setDetail(c)} />
                ))}
              </View>
            )}

            {/* ===== 4 SỐ CỦA KỲ ===== */}
            {s ? (
              <>
                <View className="mb-3 flex-row gap-3">
                  <Tile label="Chi phí quảng cáo" value={compactMoney(s.spend)} tone="red" />
                  <Tile
                    label="Doanh thu từ quảng cáo"
                    value={compactMoney(s.broadGmv)}
                    sub={`${s.broadOrder} đơn`}
                  />
                </View>
                <View className="mb-4 flex-row gap-3">
                  {/* Không tô xanh / đỏ: ROAS gộp so với hòa vốn CHUNG của shop có thể
                      ngược dấu với ô Lãi (cộng theo hòa vốn từng chiến dịch). Màu để ô Lãi nói. */}
                  <Tile
                    label="ROAS"
                    value={roas(s.roasBroad)}
                    sub={`Hòa vốn của shop ${roas(s.shopBreakevenRoas)}`}
                  />
                  <Tile
                    label="Lãi ước tính sau quảng cáo"
                    value={compactMoney(s.estProfit)}
                    tone={s.estProfit < 0 ? "red" : "emerald"}
                  />
                </View>
              </>
            ) : null}

            {/* ===== HÀNG TAB: Đang chạy / Cần xử lý / Tất cả / Gợi ý =====
                LUÔN MỘT HÀNG: mỗi tab flex-1 chia đều bề rộng màn hình, chữ
                canh giữa, không rớt dòng ở mọi cỡ máy (anh Trung 05/10). */}
            <View className="mb-2 flex-row items-center gap-1.5">
              {LIST_FILTERS.filter((f) => f.key !== "reco" || platform === "shopee").map((f) => {
                const active = filter === f.key;
                const label =
                  f.key === "reco" && recoCount != null && recoCount > 0
                    ? `${f.label} (${recoCount})`
                    : f.label;
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
            {/* Khối gợi ý LUÔN mount khi có gian Shopee (để tải nền + đếm số cho
                tab), chỉ vẽ nội dung khi tab Gợi ý đang mở. */}
            {platform === "shopee" && data.selectedChannelId ? (
              <AdsRecommendSection
                channelId={data.selectedChannelId}
                adsLinked={adsLinked}
                reloadToken={recoToken}
                visible={filter === "reco"}
                onCount={setRecoCount}
                onCreated={() => void load(platform, range, channelId, "silent")}
              />
            ) : null}
            {filter === "reco" ? null : listed.length === 0 ? (
              <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                Không có chiến dịch nào trong mục này.
              </Text>
            ) : (
              <View className="gap-2.5">
                {listed.map((c) => (
                  <CampaignCard key={c.id} c={c} onPress={() => setDetail(c)} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <CampaignSheet
        platform={platform}
        platformLabel={platformMeta.label}
        campaign={detail}
        onClose={() => setDetail(null)}
        onChanged={() => {
          setDetail(null);
          void load(platform, range, channelId, "silent");
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
        <Text className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
          {sub}
        </Text>
      ) : null}
    </Card>
  );
}

function VerdictChip({ verdict }: { verdict: AdsVerdict }) {
  const v = VERDICT[verdict];
  return (
    <View className={`rounded-full px-2 py-0.5 ${v.bg}`}>
      <Text className={`text-[10px] font-bold ${v.text}`}>{v.label}</Text>
    </View>
  );
}

/** Nhãn nêu việc Hubsell đã tự làm với chiến dịch — null khi không có. */
function hubsellActionLabel(c: AdsCampaignDto): string | null {
  if (c.hubsellPause) return "Hubsell đã tạm dừng";
  if (c.hubsellBudgetCut) return "Hubsell đã hạ ngân sách";
  return null;
}

/** Thẻ "Cần xử lý": chỉ nhãn + tên + đề xuất; căn cứ bằng số nằm trong hộp chi tiết (anh Trung 04/10). */
function AttentionCard({ c, onPress }: { c: AdsCampaignDto; onPress: () => void }) {
  const acted = hubsellActionLabel(c);
  // Vạch trái theo mức nặng: đỏ = đang mất tiền, vàng = cần duyệt, xám = Hubsell đã xử lý.
  const edge = acted
    ? "border-l-slate-400"
    : c.assistant.verdict === "review"
      ? "border-l-amber-500"
      : "border-l-red-500";
  return (
    <Card className={`border-l-4 ${edge} p-3`} onPress={onPress}>
      <View className="flex-row items-center gap-2">
        {acted ? (
          <View className="rounded-full bg-slate-900 px-2 py-0.5 dark:bg-slate-100">
            <Text className="text-[10px] font-bold text-white dark:text-slate-900">{acted}</Text>
          </View>
        ) : (
          <VerdictChip verdict={c.assistant.verdict} />
        )}
        <View className="flex-1" />
        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
      </View>
      <Text
        className="mt-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100"
        numberOfLines={2}
      >
        {c.name}
      </Text>
      {c.assistant.recommendation ? (
        <Text className="mt-1 text-xs text-slate-600 dark:text-slate-300" numberOfLines={2}>
          <Text className="font-semibold text-slate-900 dark:text-slate-100">Đề xuất: </Text>
          {c.assistant.recommendation}
        </Text>
      ) : null}
    </Card>
  );
}

/** Thẻ chiến dịch: tên, trạng thái, tối đa ba số. */
function CampaignCard({ c, onPress }: { c: AdsCampaignDto; onPress: () => void }) {
  const below = c.roasBroad != null && c.breakevenRoas != null && c.roasBroad < c.breakevenRoas;
  const acted = hubsellActionLabel(c);
  return (
    <Card className="p-3" onPress={onPress}>
      <Text
        className="text-[13px] font-semibold text-slate-900 dark:text-slate-100"
        numberOfLines={2}
      >
        {c.name}
      </Text>
      <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
        <Text
          className={`text-[11px] font-medium ${
            c.status === "ongoing"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {acted ?? STATUS_LABEL[c.status] ?? c.status}
        </Text>
        {c.status === "ongoing" ? <VerdictChip verdict={c.assistant.verdict} /> : null}
      </View>
      <View className="mt-2.5 flex-row border-t border-slate-100 pt-2 dark:border-slate-800">
        <Metric label="Chi phí" value={compactMoney(c.spend)} />
        <Metric
          label="ROAS / hòa vốn"
          value={`${roas(c.roasBroad)} / ${roas(c.breakevenRoas)}`}
          tone={c.roasBroad == null || c.breakevenRoas == null ? undefined : below ? "red" : "emerald"}
        />
        <Metric
          label="Lãi ước tính"
          value={c.estProfit == null ? "—" : compactMoney(c.estProfit)}
          tone={c.estProfit == null ? undefined : c.estProfit < 0 ? "red" : "emerald"}
          right
        />
      </View>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
  right,
}: {
  label: string;
  value: string;
  tone?: "red" | "emerald";
  right?: boolean;
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
      <Text className={`text-[13px] font-bold ${color}`} style={TABULAR} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Hộp chi tiết chiến dịch: căn cứ của Trợ lý + hành động. Tạm dừng / Bật lại là
 * LỆNH THẬT lên sàn (kể cả khi Trợ lý đang diễn tập) nên luôn qua bước xác nhận.
 */
function CampaignSheet({
  platform,
  platformLabel,
  campaign,
  onClose,
  onChanged,
}: {
  platform: AdsPlatform;
  platformLabel: string;
  campaign: AdsCampaignDto | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState<"pause" | "resume" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setConfirm(null);
    setError("");
    onClose();
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setConfirm(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      setBusy(false);
    }
  };

  const c = campaign;
  const flagged = c ? isFlagged(c) : false;
  const reasons = c ? (c.hubsellPause?.reasons.length ? c.hubsellPause.reasons : c.assistant.reasons) : [];

  return (
    <Modal
      visible={c !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={close}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={close} />
        <View
          className="max-h-[85%] rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          {c ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100">
                  {c.name}
                </Text>
                <Pressable onPress={close} hitSlop={8} accessibilityLabel="Đóng">
                  <Ionicons name="close" size={20} color="#64748b" />
                </Pressable>
              </View>
              <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
                <Text className="text-xs text-slate-500 dark:text-slate-400">
                  {platformLabel} · {hubsellActionLabel(c) ?? STATUS_LABEL[c.status] ?? c.status}
                </Text>
                {c.status === "ongoing" ? <VerdictChip verdict={c.assistant.verdict} /> : null}
              </View>

              <View className="mt-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <Row label="Chi phí" value={formatMoney(c.spend)} />
                <Row label="Doanh thu từ quảng cáo" value={formatMoney(c.broadGmv)} />
                <Row label="Số đơn" value={String(c.broadOrder)} />
                <Row
                  label="Chi phí mỗi đơn (CPA)"
                  value={c.broadOrder > 0 ? formatMoney(Math.round(c.spend / c.broadOrder)) : "—"}
                />
                <Row label="ROAS" value={roas(c.roasBroad)} />
                <Row label="ROAS hòa vốn" value={roas(c.breakevenRoas)} />
                <Row
                  label="Lãi ước tính sau quảng cáo"
                  value={c.estProfit == null ? "—" : formatMoney(c.estProfit)}
                  tone={c.estProfit == null ? undefined : c.estProfit < 0 ? "red" : "emerald"}
                />
                {c.hubsellBudgetCut ? (
                  <Row
                    label="Ngân sách ngày"
                    value={`${formatMoney(c.hubsellBudgetCut.before)} → ${formatMoney(c.hubsellBudgetCut.cut)}`}
                  />
                ) : null}
              </View>

              {reasons.length > 0 ? (
                <View className="mt-3">
                  <Text className="mb-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Căn cứ của Trợ lý
                  </Text>
                  {reasons.map((r, i) => (
                    <Text key={i} className="mb-0.5 text-xs text-slate-600 dark:text-slate-300">
                      • {r}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Dòng kết luận: nên làm gì (anh Trung 04/10) */}
              {c.assistant.recommendation ? (
                <View className="mt-3 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
                  <Ionicons name="bulb-outline" size={16} color="#d97706" />
                  <Text className="flex-1 text-[13px] text-slate-900 dark:text-slate-100">
                    <Text className="font-bold">Đề xuất: </Text>
                    {c.assistant.recommendation}
                  </Text>
                </View>
              ) : null}

              {error ? (
                <Text className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</Text>
              ) : null}

              {confirm ? (
                <View className="mt-4 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                  <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {confirm === "pause" ? "Tạm dừng chiến dịch này?" : "Bật lại chiến dịch này?"}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Lệnh được gửi thẳng lên {platformLabel} và có hiệu lực ngay.
                  </Text>
                  <View className="mt-3 flex-row gap-2">
                    <Pressable
                      className="flex-1 items-center rounded-xl border border-slate-200 py-3 active:opacity-70 dark:border-slate-700"
                      onPress={() => setConfirm(null)}
                      disabled={busy}
                    >
                      <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Bỏ qua
                      </Text>
                    </Pressable>
                    <Pressable
                      className={`flex-1 items-center rounded-xl py-3 active:opacity-80 ${
                        confirm === "pause" ? "bg-red-500" : "bg-emerald-600"
                      }`}
                      disabled={busy}
                      onPress={() => {
                        hapticTap();
                        void run(() =>
                          confirm === "pause"
                            ? pauseAdsCampaign(platform, c.id)
                            : resumeAdsCampaign(platform, c.id)
                        );
                      }}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text className="text-sm font-semibold text-white">
                          {confirm === "pause" ? "Tạm dừng chiến dịch" : "Bật lại chiến dịch"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View className="mt-4 gap-2">
                  {c.status === "ongoing" ? (
                    <Pressable
                      className="items-center rounded-xl bg-red-500 py-3 active:opacity-80"
                      onPress={() => setConfirm("pause")}
                    >
                      <Text className="text-sm font-semibold text-white">Tạm dừng</Text>
                    </Pressable>
                  ) : c.status === "paused" ? (
                    <Pressable
                      className="items-center rounded-xl bg-emerald-600 py-3 active:opacity-80"
                      onPress={() => setConfirm("resume")}
                    >
                      <Text className="text-sm font-semibold text-white">Bật lại</Text>
                    </Pressable>
                  ) : null}
                  {flagged ? (
                    <View className="flex-row gap-2">
                      {(
                        [
                          { key: "WATCHING", label: "Theo dõi thêm" },
                          { key: "IGNORED", label: "Bỏ qua" },
                        ] as const
                      ).map((d) => (
                        <Pressable
                          key={d.key}
                          className="flex-1 items-center rounded-xl border border-slate-200 py-3 active:opacity-70 dark:border-slate-700"
                          disabled={busy}
                          onPress={() =>
                            void run(() =>
                              decideAdsCampaign(platform, c.id, d.key, c.assistant.verdict)
                            )
                          }
                        >
                          <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {d.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "red" | "emerald" }) {
  const color =
    tone === "red"
      ? "text-red-500 dark:text-red-400"
      : tone === "emerald"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-slate-900 dark:text-slate-100";
  return (
    <View className="flex-row items-center justify-between gap-3 py-[3px]">
      <Text className="text-[13px] text-slate-500 dark:text-slate-400">{label}</Text>
      <Text className={`text-[13px] font-semibold ${color}`} style={TABULAR}>
        {value}
      </Text>
    </View>
  );
}
