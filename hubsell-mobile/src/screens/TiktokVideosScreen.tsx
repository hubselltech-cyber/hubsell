import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { ApiError, isPlanLockedError } from "@/api/client";
import {
  fetchTiktokCampaignVideos,
  fetchTiktokVideoMeta,
  sendTiktokVideoAction,
} from "@/api/ads-tiktok";
import type {
  TiktokAdsCampaignVideos,
  TiktokAdsVideoActionLog,
  TiktokAdsVideoRow,
  TiktokVideoMeta,
} from "@/types/api";
import { useAuth } from "@/auth/AuthContext";
import { compactMoney, formatDateTime, formatMoney } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import {
  ddmm,
  fmtRoi,
  shortVideoId,
  TIKTOK_AUTO_VERDICT,
  TIKTOK_DELIVERY_LABEL,
  tiktokStatusKey,
} from "@/lib/tiktok-ads";
import { Card } from "@/components/Card";
import { PlanLockedCard } from "@/components/PlanLockedCard";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { TABULAR } from "@/theme/tokens";

/**
 * MÀN VIDEO của một chiến dịch GMV Max — màn làm việc chính của TikTok trên
 * app (trang riêng, không popup): chip lọc có số đếm → dòng video 2 tầng →
 * thanh Loại / Khôi phục dính đáy có hộp xác nhận nêu số → tab Lịch sử với
 * Khôi phục cả lệnh. Số sống từ TikTok (2–3 lượt gọi) nên chỉ gọi khi mở màn.
 * Ảnh bìa / tên video qua oEmbed công khai — TikTok đang chặn 503 (16/10) nên
 * dòng phải đứng được không ảnh: "@kênh · mã video" + sao chép.
 */

type Quick = "all" | "no_order" | "below" | "exclude" | "flag" | "learning" | "excluded";
const QUICK: { key: Quick; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "no_order", label: "Chưa ra đơn" },
  { key: "below", label: "ROI dưới mục tiêu" },
  { key: "exclude", label: "Máy sẽ loại" },
  { key: "flag", label: "Cần xem" },
  { key: "learning", label: "Đang học" },
  { key: "excluded", label: "Đã loại" },
];

const META_CHUNK = 24;
const META_MAX = 72;

const LOG_STATUS: Record<TiktokAdsVideoActionLog["status"], { label: string; cls: string }> = {
  SUCCESS: { label: "Đã gửi", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  SENDING: { label: "Đang gửi — chưa xác nhận", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  PLANNED: { label: "Diễn tập — chưa loại", cls: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  FAILED: { label: "TikTok từ chối", cls: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300" },
};

export function TiktokVideosScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dark = useColorScheme().colorScheme === "dark";
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string; from: string; to: string; name?: string; filter?: string }>();
  const id = String(params.id ?? "");
  const range = useMemo(() => ({ from: String(params.from ?? ""), to: String(params.to ?? "") }), [params.from, params.to]);
  const isOwner = user?.role === "ADMIN";

  const [data, setData] = useState<TiktokAdsCampaignVideos | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [planLocked, setPlanLocked] = useState<string | null>(null);
  const [tab, setTab] = useState<"videos" | "history">("videos");
  const [quick, setQuick] = useState<Quick>(() => {
    const f = String(params.filter ?? "");
    return (QUICK.some((q) => q.key === f) ? f : "all") as Quick;
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Record<string, TiktokVideoMeta>>({});
  const [confirm, setConfirm] = useState<"REMOVE" | "ADD" | null>(null);
  const [undoLog, setUndoLog] = useState<TiktokAdsVideoActionLog | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [toast, setToast] = useState("");
  const reqSeq = useRef(0);

  const load = useCallback(
    async (asRefresh = false) => {
      if (!id || !range.from || !range.to) return;
      const seq = ++reqSeq.current;
      if (asRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const res = await fetchTiktokCampaignVideos(id, range);
        if (seq !== reqSeq.current) return;
        setData(res);
        setPlanLocked(null);
        setPicked(new Set());
      } catch (err) {
        if (seq !== reqSeq.current) return;
        if (isPlanLockedError(err)) {
          setPlanLocked(err.message);
          return;
        }
        setError(err instanceof ApiError ? err.message : "Không lấy được số từ TikTok, kéo xuống thử lại");
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [id, range]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // oEmbed: hỏi theo lô 24 mã cho tối đa 72 video đầu (đã xếp 0 đơn trước); hỏng thì thôi, không báo.
  useEffect(() => {
    if (!data) return;
    const ids = data.videos.slice(0, META_MAX).map((v) => v.videoId).filter((v) => !meta[v]);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < ids.length; i += META_CHUNK) {
        try {
          const r = await fetchTiktokVideoMeta(ids.slice(i, i + META_CHUNK));
          if (cancelled) return;
          setMeta((m) => ({ ...m, ...r.items }));
        } catch {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const c = data?.campaign ?? null;
  const ongoing = c ? tiktokStatusKey(c.status) === "ongoing" : false;
  const canAct = isOwner && ongoing;
  const videos = data?.videos ?? [];
  const spending = videos.filter((v) => !v.excluded);
  const target = c?.roasTarget ?? null;

  const counts: Record<Quick, number> = {
    all: videos.length,
    no_order: spending.filter((v) => v.noOrder).length,
    below: target == null ? 0 : spending.filter((v) => v.orders > 0 && v.roi != null && v.roi < target).length,
    exclude: spending.filter((v) => v.auto?.verdict === "exclude").length,
    flag: spending.filter((v) => v.auto?.verdict === "flag").length,
    learning: spending.filter((v) => v.deliveryStatus === "LEARNING").length,
    excluded: videos.filter((v) => v.excluded).length,
  };
  const hasAuto = !!c?.auto && c.auto.mode !== "off";
  const quickChips = QUICK.filter(
    (q) =>
      (q.key !== "below" || target != null) && (q.key !== "exclude" && q.key !== "flag" ? true : hasAuto)
  );
  const shown = videos.filter((v) => {
    switch (quick) {
      case "no_order":
        return !v.excluded && v.noOrder;
      case "below":
        return !v.excluded && v.orders > 0 && v.roi != null && target != null && v.roi < target;
      case "exclude":
        return !v.excluded && v.auto?.verdict === "exclude";
      case "flag":
        return !v.excluded && v.auto?.verdict === "flag";
      case "learning":
        return !v.excluded && v.deliveryStatus === "LEARNING";
      case "excluded":
        return v.excluded;
      default:
        return true;
    }
  });

  // Một lệnh chỉ một chiều: chọn trong mục Đã loại = khôi phục, còn lại = loại.
  const restoring = quick === "excluded";
  const pickedRows = shown.filter((v) => picked.has(v.videoId) && v.pending == null);
  const togglePick = (v: TiktokAdsVideoRow) => {
    if (!canAct || v.pending) return;
    hapticSelect();
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(v.videoId)) n.delete(v.videoId);
      else n.add(v.videoId);
      return n;
    });
  };
  const pickAllShown = () => {
    hapticSelect();
    setPicked(new Set(shown.filter((v) => v.pending == null).map((v) => v.videoId)));
  };

  const run = async (action: "REMOVE" | "ADD", rows: TiktokAdsVideoRow[]) => {
    if (!c || rows.length === 0) return;
    setSending(true);
    setSendError("");
    try {
      const r = await sendTiktokVideoAction(
        c.id,
        action,
        rows.map((v) => ({ videoId: v.videoId, spuId: v.spuId, cost: v.cost, orders: v.orders }))
      );
      setConfirm(null);
      setUndoLog(null);
      setToast(r.message || (action === "REMOVE" ? "Đã gửi lệnh loại video" : "Đã gửi lệnh khôi phục"));
      setTimeout(() => setToast(""), 4000);
      await load(true);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      setSending(false);
    }
  };

  const excludedRows = videos.filter((v) => v.excluded);
  const undoRows = undoLog
    ? excludedRows.filter(
        (v) => undoLog.videos.some((x) => x.videoId === v.videoId) && v.pending == null
      )
    : [];

  const title = c?.name || String(params.name ?? "Chiến dịch TikTok");

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 6 }}>
      {/* Đầu trang: lối về + tên + dòng ROI */}
      <View className="flex-row items-center gap-2 px-3 pb-2">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate("/(admin)/home"))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
        >
          <Ionicons name="arrow-back" size={22} color={dark ? "#e2e8f0" : "#334155"} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-slate-900 dark:text-slate-100" numberOfLines={1}>
            {title}
          </Text>
          {c ? (
            <Text className="text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR} numberOfLines={1}>
              {c.biddingMethod === "max_delivery" ? "Phân phối tối đa" : `ROI mục tiêu ${fmtRoi(c.roasTarget)}`}
              {" · thực "}
              {fmtRoi(c.spend > 0 ? c.gmv / c.spend : null)}
              {c.breakeven?.roi != null ? ` · hòa vốn ${fmtRoi(c.breakeven.roi)}` : ""}
              {" · "}
              {ddmm(range.from)}–{ddmm(range.to)}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
          <Text className="mt-3 text-xs text-slate-400 dark:text-slate-500">Đang hỏi TikTok…</Text>
        </View>
      ) : planLocked ? (
        <View className="px-4 pt-2">
          <PlanLockedCard message={planLocked} onRetry={() => void load()} />
        </View>
      ) : error || !data || !c ? (
        <ScrollView
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
        >
          <View className="items-center rounded-2xl bg-white p-6 dark:bg-slate-900">
            <Text className="text-center text-sm text-red-500 dark:text-red-400">
              {error || "Không có dữ liệu"}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <>
          <SegmentedTabs
            className="mx-4 mb-2"
            options={[
              { key: "videos", label: `Video (${data.totals.videoCount})` },
              { key: "history", label: `Lịch sử (${data.actions.length})` },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === "history" ? (
            <HistoryList
              actions={data.actions}
              canAct={canAct}
              onUndo={(log) => {
                setSendError("");
                setUndoLog(log);
              }}
              refreshing={refreshing}
              onRefresh={() => void load(true)}
            />
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(v) => v.videoId}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
              ListHeaderComponent={
                <View>
                  {/* Ba số nhỏ của chiến dịch */}
                  <View className="mb-2 flex-row gap-2">
                    <MiniTile label="Đang phân phối" value={`${data.totals.spendingCount} / ${data.totals.videoCount}`} />
                    <MiniTile
                      label="Chưa ra đơn"
                      value={String(data.totals.noOrderCount)}
                      tone={data.totals.noOrderCount > 0 ? "red" : undefined}
                    />
                    <MiniTile
                      label="Tiêu không ra đơn"
                      value={compactMoney(data.totals.noOrderSpend)}
                      tone={data.totals.noOrderSpend > 0 ? "red" : undefined}
                    />
                  </View>
                  {/* Chip lọc một chạm có số đếm */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
                    <View className="flex-row gap-1.5">
                      {quickChips.map((q) => {
                        const active = quick === q.key;
                        return (
                          <Pressable
                            key={q.key}
                            className={`rounded-full px-3 py-1.5 ${
                              active
                                ? "bg-slate-900 dark:bg-slate-100"
                                : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                            }`}
                            onPress={() => {
                              if (active) return;
                              hapticSelect();
                              setQuick(q.key);
                              setPicked(new Set());
                            }}
                          >
                            <Text
                              className={`text-xs font-semibold ${
                                active ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"
                              }`}
                            >
                              {q.label} {counts[q.key]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                  {canAct && shown.length > 0 ? (
                    <View className="mb-1 flex-row items-center justify-between">
                      <Text className="text-[11px] text-slate-400 dark:text-slate-500">
                        {restoring ? "Chọn video để khôi phục" : "Chọn video để loại khỏi chiến dịch"}
                      </Text>
                      <Pressable onPress={pickAllShown} hitSlop={6}>
                        <Text className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                          Chọn hết ({shown.filter((v) => v.pending == null).length})
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              }
              renderItem={({ item: v }) => (
                <VideoRow
                  v={v}
                  meta={meta[v.videoId]}
                  picked={picked.has(v.videoId)}
                  canAct={canAct}
                  hasAuto={hasAuto}
                  dark={dark}
                  onToggle={() => togglePick(v)}
                />
              )}
              ListEmptyComponent={
                <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  Không có video nào trong mục này.
                </Text>
              }
              ListFooterComponent={
                <View className="mt-3">
                  <Text className="text-[11px] text-slate-400 dark:text-slate-500">
                    Chi phí từng video TikTok cập nhật trễ tới 11 giờ; ROI gồm cả đơn tự nhiên.
                    {!ongoing ? " Chiến dịch không chạy nên không loại / khôi phục được." : ""}
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* Thanh hành động dính đáy — chỉ khi có video được chọn */}
      {canAct && tab === "videos" && pickedRows.length > 0 ? (
        <View
          className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 pt-3 dark:border-slate-800 dark:bg-slate-900"
          style={{ paddingBottom: 12 + insets.bottom }}
        >
          <View className="flex-row items-center gap-2">
            <Pressable
              className="h-11 w-11 items-center justify-center rounded-xl border border-slate-200 active:opacity-70 dark:border-slate-700"
              onPress={() => setPicked(new Set())}
              accessibilityLabel="Bỏ chọn"
            >
              <Ionicons name="close" size={18} color="#64748b" />
            </Pressable>
            <Pressable
              className={`h-11 flex-1 items-center justify-center rounded-xl active:opacity-80 ${
                restoring ? "bg-emerald-600" : "bg-red-500"
              }`}
              onPress={() => {
                hapticTap();
                setSendError("");
                setConfirm(restoring ? "ADD" : "REMOVE");
              }}
            >
              <Text className="text-sm font-semibold text-white">
                {restoring
                  ? `Khôi phục ${pickedRows.length} video`
                  : `Loại ${pickedRows.length} video khỏi chiến dịch`}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {toast ? (
        <View className="absolute inset-x-4 top-20 rounded-xl bg-slate-900 px-4 py-3 dark:bg-slate-100">
          <Text className="text-center text-xs font-medium text-white dark:text-slate-900">{toast}</Text>
        </View>
      ) : null}

      {/* Hộp xác nhận lệnh chọn tay — lệnh thật lên sàn nên luôn nêu số */}
      <ConfirmModal
        visible={confirm !== null}
        title={
          confirm === "ADD"
            ? `Khôi phục ${pickedRows.length} video vào chiến dịch?`
            : `Loại ${pickedRows.length} video khỏi chiến dịch?`
        }
        body={
          confirm === "ADD"
            ? "TikTok sẽ đưa các video này trở lại chiến dịch và có thể phân phối tiếp. Lệnh có hiệu lực sau khoảng 20 phút."
            : `${pickedRows.length} video này tiêu ${formatMoney(
                pickedRows.reduce((s, v) => s + v.cost, 0)
              )}, ${pickedRows.reduce((s, v) => s + v.orders, 0)} đơn trong kỳ xem. TikTok sẽ ngừng dùng chúng để quảng cáo trong chiến dịch; video trên kênh không bị ảnh hưởng. Khôi phục được bất cứ lúc nào ở mục Đã loại.`
        }
        okLabel={confirm === "ADD" ? "Khôi phục" : "Loại video"}
        okTone={confirm === "ADD" ? "emerald" : "red"}
        busy={sending}
        error={sendError}
        onCancel={() => !sending && setConfirm(null)}
        onOk={() => void run(confirm === "ADD" ? "ADD" : "REMOVE", pickedRows)}
      />
      {/* Khôi phục cả lệnh từ tab Lịch sử */}
      <ConfirmModal
        visible={undoLog !== null}
        title={`Khôi phục ${undoRows.length} video của lệnh ${
          undoLog ? formatDateTime(undoLog.createdAt) : ""
        }?`}
        body={
          undoRows.length === 0
            ? "Các video của lệnh này đã được khôi phục hoặc đang chờ TikTok xử lý."
            : "TikTok sẽ đưa các video này trở lại chiến dịch và có thể phân phối tiếp, có hiệu lực sau khoảng 20 phút. Trợ lý tự động sẽ không loại lại chúng trong 30 ngày."
        }
        okLabel="Khôi phục cả lệnh"
        okTone="emerald"
        busy={sending}
        error={sendError}
        okDisabled={undoRows.length === 0}
        onCancel={() => !sending && setUndoLog(null)}
        onOk={() => void run("ADD", undoRows)}
      />
    </View>
  );
}

function MiniTile({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <Card className="flex-1 px-2.5 py-2">
      <Text className="text-[10px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className={`mt-0.5 text-[15px] font-bold ${
          tone === "red" ? "text-red-500 dark:text-red-400" : "text-slate-900 dark:text-slate-100"
        }`}
        style={TABULAR}
        numberOfLines={1}
      >
        {value}
      </Text>
    </Card>
  );
}

/** Dòng video 2 tầng: chọn · ảnh · tên / mã · trạng thái — rồi Chi phí · Đơn · CPA · ROI. */
function VideoRow({
  v,
  meta,
  picked,
  canAct,
  hasAuto,
  dark,
  onToggle,
}: {
  v: TiktokAdsVideoRow;
  meta?: TiktokVideoMeta;
  picked: boolean;
  canAct: boolean;
  hasAuto: boolean;
  dark: boolean;
  onToggle: () => void;
}) {
  const [showReason, setShowReason] = useState(false);
  const status = v.pending
    ? v.pending === "REMOVE"
      ? "Đang chờ TikTok loại"
      : "Đang chờ TikTok khôi phục"
    : v.excluded
      ? "Đã loại"
      : (TIKTOK_DELIVERY_LABEL[v.deliveryStatus] ?? v.deliveryStatus);
  const verdict = hasAuto && v.auto && !v.excluded ? TIKTOK_AUTO_VERDICT[v.auto.verdict] : null;
  const cpa = v.orders > 0 ? Math.round(v.cost / v.orders) : null;
  const copyId = async () => {
    await Clipboard.setStringAsync(v.videoId);
    hapticSelect();
  };
  return (
    <Pressable
      onPress={canAct && !v.pending ? onToggle : undefined}
      className={`mb-2 rounded-2xl border p-3 ${
        picked
          ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-800"
          : v.noOrder && !v.excluded
            ? "border-rose-100 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/10"
            : "border-slate-900/5 bg-white dark:border-white/5 dark:bg-slate-900"
      }`}
    >
      <View className="flex-row items-start gap-2.5">
        {canAct ? (
          <View className="pt-0.5">
            <Ionicons
              name={picked ? "checkbox" : "square-outline"}
              size={22}
              color={v.pending ? "#cbd5e1" : picked ? (dark ? "#f1f5f9" : "#0f172a") : "#94a3b8"}
            />
          </View>
        ) : null}
        <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
          {meta?.thumbnailUrl ? (
            <Image source={{ uri: meta.thumbnailUrl }} style={{ width: 48, height: 48 }} contentFit="cover" />
          ) : (
            <Ionicons name="logo-tiktok" size={18} color="#94a3b8" />
          )}
        </View>
        <View className="flex-1">
          <Text className="text-[13px] font-semibold text-slate-900 dark:text-slate-100" numberOfLines={2}>
            {meta?.caption?.trim()
              ? meta.caption.trim()
              : meta?.author
                ? `@${meta.author} · ${shortVideoId(v.videoId)}`
                : `Video ${shortVideoId(v.videoId)}`}
          </Text>
          <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
            <Pressable onPress={copyId} hitSlop={6} className="flex-row items-center gap-1">
              <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                {v.videoId}
              </Text>
              <Ionicons name="copy-outline" size={11} color="#94a3b8" />
            </Pressable>
          </View>
          <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
            <Text
              className={`text-[11px] font-medium ${
                v.pending
                  ? "text-amber-600 dark:text-amber-400"
                  : v.excluded
                    ? "text-slate-400 dark:text-slate-500"
                    : v.deliveryStatus === "DELIVERING"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {status}
            </Text>
            {verdict ? (
              <Pressable
                className={`rounded-full px-2 py-0.5 ${verdict.bg}`}
                onPress={() => setShowReason((s) => !s)}
                hitSlop={4}
              >
                <Text className={`text-[10px] font-bold ${verdict.text}`}>{verdict.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      {showReason && v.auto ? (
        <Text className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
          {v.auto.reason}
          {v.auto.graduatedOn ? ` · học xong ${ddmm(v.auto.graduatedOn)}` : ""}
        </Text>
      ) : null}
      <View className="mt-2 flex-row border-t border-slate-100 pt-2 dark:border-slate-800">
        <Num label="Chi phí" value={compactMoney(v.cost)} />
        <Num label="Đơn" value={String(v.orders)} tone={v.orders === 0 && !v.excluded ? "red" : undefined} />
        <Num label="CPA" value={cpa == null ? "—" : compactMoney(cpa)} />
        <Num label="ROI" value={fmtRoi(v.roi)} right />
      </View>
    </Pressable>
  );
}

function Num({ label, value, tone, right }: { label: string; value: string; tone?: "red"; right?: boolean }) {
  return (
    <View className={`flex-1 ${right ? "items-end" : ""}`}>
      <Text className="text-[10px] text-slate-400 dark:text-slate-500">{label}</Text>
      <Text
        className={`text-[13px] font-bold ${
          tone === "red" ? "text-red-500 dark:text-red-400" : "text-slate-900 dark:text-slate-100"
        }`}
        style={TABULAR}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** Tab Lịch sử: đối tượng (mã) + lý do + trạng thái + Khôi phục cả lệnh (điểm 7 khẩu vị bảng). */
function HistoryList({
  actions,
  canAct,
  onUndo,
  refreshing,
  onRefresh,
}: {
  actions: TiktokAdsVideoActionLog[];
  canAct: boolean;
  onUndo: (log: TiktokAdsVideoActionLog) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <FlatList
      data={actions}
      keyExtractor={(a) => a.id}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <Text className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
          Chưa có lệnh loại / khôi phục nào.
        </Text>
      }
      renderItem={({ item: a }) => {
        const st = LOG_STATUS[a.status];
        const n = a.videos.length;
        const head =
          a.action === "config_change"
            ? "Đổi cấu hình tự động"
            : a.action === "restore_video"
              ? `Khôi phục ${n} video`
              : a.status === "PLANNED"
                ? `Sẽ loại ${n} video`
                : `Loại ${n} video`;
        return (
          <Card className="mb-2 p-3">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100">{head}</Text>
              <Text className="text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                {formatDateTime(a.createdAt)}
              </Text>
            </View>
            <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
              <View className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                <Text className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  {a.source === "auto" ? "Trợ lý tự động" : "Thủ công"}
                </Text>
              </View>
              {a.action !== "config_change" ? (
                <View className={`rounded-full px-2 py-0.5 ${st.cls}`}>
                  <Text className="text-[10px] font-semibold">{st.label}</Text>
                </View>
              ) : null}
            </View>
            {a.grounds.length > 0 ? (
              <View className="mt-2">
                {a.grounds.map((g, i) => (
                  <Text key={i} className="text-[11px] text-slate-600 dark:text-slate-300">
                    • {g}
                  </Text>
                ))}
              </View>
            ) : null}
            {a.videos.length > 0 ? (
              <View className="mt-2">
                {a.videos.slice(0, 6).map((x) => (
                  <Text key={x.videoId} className="text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
                    {x.videoId}
                    {x.note ? ` — ${x.note}` : ""}
                  </Text>
                ))}
                {a.videos.length > 6 ? (
                  <Text className="text-[11px] text-slate-400 dark:text-slate-500">
                    … và {a.videos.length - 6} video nữa
                  </Text>
                ) : null}
              </View>
            ) : null}
            {a.error ? (
              <Text className="mt-1.5 text-[11px] text-red-500 dark:text-red-400">{a.error}</Text>
            ) : null}
            {canAct && a.action === "exclude_video" && a.mode === "live" && a.status === "SUCCESS" ? (
              <Pressable
                className="mt-2.5 items-center rounded-xl border border-slate-300 py-2 active:opacity-70 dark:border-slate-600"
                onPress={() => onUndo(a)}
              >
                <Text className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                  Khôi phục cả lệnh
                </Text>
              </Pressable>
            ) : null}
          </Card>
        );
      }}
    />
  );
}

function ConfirmModal({
  visible,
  title,
  body,
  okLabel,
  okTone,
  busy,
  error,
  okDisabled,
  onCancel,
  onOk,
}: {
  visible: boolean;
  title: string;
  body: string;
  okLabel: string;
  okTone: "red" | "emerald";
  busy: boolean;
  error: string;
  okDisabled?: boolean;
  onCancel: () => void;
  onOk: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onCancel} />
        <View
          className="rounded-t-3xl bg-white px-4 pt-4 dark:bg-slate-900"
          style={{ paddingBottom: 20 + insets.bottom }}
        >
          <Text className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</Text>
          <Text className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{body}</Text>
          {error ? <Text className="mt-2 text-xs text-red-500 dark:text-red-400">{error}</Text> : null}
          <View className="mt-4 flex-row gap-2">
            <Pressable
              className="flex-1 items-center rounded-xl border border-slate-200 py-3 active:opacity-70 dark:border-slate-700"
              onPress={onCancel}
              disabled={busy}
            >
              <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">Hủy</Text>
            </Pressable>
            <Pressable
              className={`flex-1 items-center rounded-xl py-3 active:opacity-80 ${
                okTone === "red" ? "bg-red-500" : "bg-emerald-600"
              } ${okDisabled ? "opacity-50" : ""}`}
              disabled={busy || okDisabled}
              onPress={onOk}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-sm font-semibold text-white">{okLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
