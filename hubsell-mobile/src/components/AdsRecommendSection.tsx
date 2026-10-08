import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, isPlanLockedError } from "@/api/client";
import { PlanLockedCard } from "@/components/PlanLockedCard";
import {
  createAdsCampaignFromRecommendation,
  fetchAdsRecommendations,
  refreshAdsRecommendationItem,
} from "@/api/ads";
import type {
  AdsRecommendTier,
  AdsRecommendationRow,
  AdsRecommendationsResponse,
} from "@/types/api";
import { compactMoney, formatMoney, groupVN } from "@/lib/format";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { Card } from "@/components/Card";
import { TABULAR } from "@/theme/tokens";

/**
 * GỢI Ý CHẠY ADS trên app (05/10) — nội dung của TAB thứ 4 (Đang chạy / Cần xử
 * lý / Tất cả / Gợi ý chạy Ads) trên trang Quảng cáo Shopee. Luôn mount khi có
 * gian Shopee để tải nền + báo số đếm lên tab (onCount); chỉ vẽ khi `visible`.
 *
 * Cùng backend với tab "Gợi ý chạy Ads" web (ads-recommend-tab.tsx): backend
 * chấm 3 tầng (cổng loại → điểm → đề xuất mục tiêu + ngân sách), app CHỈ hiển
 * thị + MỘT lệnh tạo. Khác web ở chỗ cố ý thu gọn cho điện thoại:
 *   · chỉ liệt kê SP có việc để làm (Nên chạy ngay · Thử nhỏ), tối đa 3 dòng,
 *     bấm "Xem thêm" mới bung hết. "Chưa nên" / "Đang chạy" chỉ hiện số đếm —
 *     đọc lý do từng SP chưa nên chạy là việc ngồi máy tính;
 *   · không có nút "Lấy số của sàn" (lượt nền 1–2 phút, phải hỏi lại liên tục)
 *     — số của sàn tự về mỗi ngày, cần gấp thì bấm trên web;
 *   · không tìm kiếm, không phân trang.
 * Bấm một dòng → hộp trượt lên: căn cứ (cổng + điểm) → chọn mục tiêu ROAS →
 * ngân sách ngày → xác nhận → tạo. Tạo là LỆNH THẬT lên Shopee nên luôn qua
 * bước xác nhận có số, giống Tạm dừng / Bật lại chiến dịch.
 */

const TIER: Record<AdsRecommendTier, { label: string; bg: string; text: string }> = {
  run_now: { label: "Nên chạy ngay", bg: "bg-emerald-500", text: "text-white" },
  test_small: { label: "Thử nhỏ", bg: "bg-amber-500", text: "text-white" },
  not_yet: {
    label: "Chưa nên",
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-600 dark:text-slate-300",
  },
  running: {
    label: "Đang chạy ads",
    bg: "bg-emerald-50 dark:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

type TargetKey = "push" | "balanced" | "keep";
const TARGETS: { key: TargetKey; label: string; hint: string }[] = [
  { key: "push", label: "Đẩy số", hint: "Mức an toàn thấp nhất — sàn dễ phân phối, lãi mỗi đơn mỏng." },
  { key: "balanced", label: "Cân bằng", hint: "Giữa mức an toàn và mức sàn đang chạy — vừa có lượng vừa giữ lãi." },
  { key: "keep", label: "Giữ lãi", hint: "Bằng mức quảng cáo tương tự trên sàn — ít đơn hơn, lãi mỗi đơn dày." },
];

/** Mục tiêu ROAS làm tròn 0,1 ở backend → hiện 1 số lẻ (web cũng vậy). */
const roas1 = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toFixed(1).replace(".", ",").replace(/,0$/, "")}x`;

const PREVIEW_ROWS = 3;

export function AdsRecommendSection({
  channelId,
  adsLinked,
  reloadToken,
  visible,
  onCount,
  onCreated,
}: {
  channelId: string;
  /** Gian đã nối Hubsell Ads — mới lấy được số của sàn và mới tạo được chiến dịch. */
  adsLinked: boolean;
  /** Đổi giá trị = tải lại bảng (kéo xuống làm mới ở trang cha). */
  reloadToken: number;
  /** Tab Gợi ý đang mở — false thì không vẽ gì nhưng vẫn tải nền. */
  visible: boolean;
  /** Báo số SP có việc để làm (Nên chạy ngay + Thử nhỏ) để in trên tab. */
  onCount: (n: number) => void;
  /** Tạo chiến dịch xong — trang cha nạp lại danh sách chiến dịch. */
  onCreated: () => void;
}) {
  const [data, setData] = useState<AdsRecommendationsResponse | null>(null);
  // Khóa lượt tải đã về (gian + token) — "đang tải" = khóa hiện tại chưa về,
  // không cần setState đồng bộ trong effect.
  const loadKey = `${channelId}#${reloadToken}`;
  const [loaded, setLoaded] = useState<{ key: string; error: string; locked?: boolean } | null>(
    null
  );
  const loading = loaded?.key !== loadKey;
  const error = loaded?.key === loadKey ? loaded.error : "";
  const planLocked = loaded?.key === loadKey && loaded.locked === true;
  const [retryTick, setRetryTick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [itemLoadingId, setItemLoadingId] = useState<string | null>(null);
  const [createdMsg, setCreatedMsg] = useState("");
  const reqSeq = useRef(0);
  // Giữ callback mới nhất trong ref (cùng cách useAutoRefresh) — effect tải
  // không phải phụ thuộc vào onCount.
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  });
  const countOf = (res: AdsRecommendationsResponse) =>
    res.rows.filter((r) => r.tier === "run_now" || r.tier === "test_small").length;

  // Chấm cả kho SP mỗi lần gọi — chỉ tải khi đổi gian / kéo làm mới / vừa tạo
  // xong, KHÔNG theo nhịp 60s của trang cha.
  useEffect(() => {
    const seq = ++reqSeq.current;
    fetchAdsRecommendations(channelId)
      .then((res) => {
        if (seq !== reqSeq.current) return;
        setData(res);
        onCountRef.current(countOf(res));
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
    // retryTick: nút "Đã gia hạn, tải lại" của thẻ khóa.
  }, [channelId, loadKey, retryTick]);

  /** Mở một SP chưa có dải ROAS của sàn → lấy riêng cho SP đó (3 call), chấm lại cả bảng. */
  const openDetail = (row: AdsRecommendationRow) => {
    hapticTap();
    setDetailId(row.itemId);
    const needsMarket =
      adsLinked && row.tier !== "running" && row.safeRoas != null && row.market?.roiExact == null;
    if (!needsMarket || itemLoadingId) return;
    setItemLoadingId(row.itemId);
    refreshAdsRecommendationItem(channelId, row.itemId, row.safeRoas)
      .then((res) => setData(res))
      .catch(() => undefined) // không có số của sàn thì vẫn xem được bản chấm bằng số Hubsell
      .finally(() => setItemLoadingId(null));
  };

  const rows = data?.rows ?? [];
  // Chỉ SP có việc để làm; backend đã xếp theo bậc rồi theo điểm.
  const actionable = rows.filter((r) => r.tier === "run_now" || r.tier === "test_small");
  const shown = expanded ? actionable : actionable.slice(0, PREVIEW_ROWS);
  const hidden = actionable.length - shown.length;
  const counts = data?.counts;
  const detail = rows.find((r) => r.itemId === detailId) ?? null;

  if (!visible) return null;

  return (
    <View className="mb-4">
      {counts ? (
        <Text className="mb-2 text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
          {actionable.length} sản phẩm nên chạy · {counts.not_yet} chưa nên · {counts.running} đang chạy ads
        </Text>
      ) : null}

      {createdMsg ? (
        <View className="mb-2.5 flex-row items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-500/10">
          <Ionicons name="checkmark-circle" size={16} color="#10b981" />
          <Text className="flex-1 text-xs text-emerald-700 dark:text-emerald-300">{createdMsg}</Text>
          <Pressable onPress={() => setCreatedMsg("")} hitSlop={8}>
            <Ionicons name="close" size={14} color="#10b981" />
          </Pressable>
        </View>
      ) : null}

      {loading && !data ? (
        <View className="items-center py-6">
          <ActivityIndicator color="#64748b" />
          <Text className="mt-2 text-xs text-slate-400 dark:text-slate-500">Đang chấm điểm sản phẩm…</Text>
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
          {(data.missingCostCount ?? 0) > 0 ? (
            <View className="mb-2.5 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
              <Ionicons name="alert-circle-outline" size={16} color="#d97706" />
              <Text className="flex-1 text-xs text-slate-700 dark:text-slate-300">
                <Text className="font-semibold">{data.missingCostCount} sản phẩm đang bán chưa có giá vốn</Text>
                {" "}nên chưa được gợi ý — nhập giá vốn trên web là gợi ý mở ngay.
              </Text>
            </View>
          ) : null}
          {!data.signalsSyncedAt ? (
            <Text className="mb-2.5 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
              Chưa có số thị trường của Shopee cho gian này — gợi ý đang chấm bằng số của Hubsell
              (biên lãi, tồn, nhịp bán). Số của sàn tự về mỗi ngày.
            </Text>
          ) : null}

          {actionable.length === 0 ? (
            <Text className="py-4 text-center text-xs text-slate-400 dark:text-slate-500">
              Chưa có sản phẩm nào đủ điều kiện để gợi ý chạy quảng cáo.
            </Text>
          ) : (
            <View className="gap-2.5">
              {shown.map((r) => (
                <RecommendCard key={r.itemId} row={r} onPress={() => openDetail(r)} />
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

      <RecommendSheet
        row={detail}
        channelId={channelId}
        adsLinked={adsLinked}
        loadingMarket={detail != null && itemLoadingId === detail.itemId}
        onClose={() => setDetailId(null)}
        onCreated={(msg) => {
          setDetailId(null);
          setCreatedMsg(msg);
          onCreated();
          // Chấm lại: SP vừa tạo chuyển sang "Đang chạy ads", khỏi gợi ý trùng.
          fetchAdsRecommendations(channelId)
            .then((res) => {
              setData(res);
              onCountRef.current(countOf(res));
            })
            .catch(() => undefined);
        }}
      />
    </View>
  );
}

/** Một dòng gợi ý: nhãn + tên + ba số quyết định. Không vạch viền trái (đã nằm trong tab riêng — anh Trung 05/10). */
function RecommendCard({ row, onPress }: { row: AdsRecommendationRow; onPress: () => void }) {
  const t = TIER[row.tier];
  const p = row.proposal;
  return (
    <Card className="p-3" onPress={onPress}>
      <View className="flex-row items-center gap-2">
        <View className={`rounded-full px-2 py-0.5 ${t.bg}`}>
          <Text className={`text-[10px] font-bold ${t.text}`}>{t.label}</Text>
        </View>
        <Text className="text-[10px] text-slate-400 dark:text-slate-500" style={TABULAR}>
          {row.score}/100
        </Text>
        <View className="flex-1" />
        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
      </View>
      {/* Tên SP được tới 3 dòng; câu lý do (headline) KHÔNG in trên thẻ — anh
          Trung 05/10: nhường chỗ cho tên, lý do đọc trong hộp chi tiết. */}
      <Text className="mt-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100" numberOfLines={3}>
        {row.productName}
      </Text>
      <View className="mt-2.5 flex-row border-t border-slate-100 pt-2 dark:border-slate-800">
        <Mini label="Cần đạt" value={roas1(row.safeRoas)} />
        <Mini label="Sàn đang chạy" value={roas1(row.market?.roiExact)} />
        <Mini label="Ngân sách / ngày" value={p ? compactMoney(p.dailyBudget) : "—"} right />
      </View>
    </Card>
  );
}

function Mini({ label, value, right }: { label: string; value: string; right?: boolean }) {
  return (
    <View className={`flex-1 ${right ? "items-end" : ""}`}>
      <Text className="text-[10px] text-slate-400 dark:text-slate-500">{label}</Text>
      <Text className="text-[13px] font-bold text-slate-900 dark:text-slate-100" style={TABULAR} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Hộp trượt lên: căn cứ → thiết lập → xác nhận → tạo. Thứ tự cố ý: chủ shop
 * phải đọc qua cổng + điểm trước khi chạm vào nút tiêu tiền.
 */
function RecommendSheet({
  row,
  channelId,
  adsLinked,
  loadingMarket,
  onClose,
  onCreated,
}: {
  row: AdsRecommendationRow | null;
  channelId: string;
  adsLinked: boolean;
  loadingMarket: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [target, setTarget] = useState<TargetKey>("balanced");
  const [budget, setBudget] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Mỗi lần mở một SP khác (hoặc bảng chấm lại sau khi có số của sàn): nạp
  // lại lựa chọn đề xuất của SP đó. Làm ngay trong render (so với row của
  // lượt trước) thay vì useEffect — khỏi một nhịp render hiện số cũ.
  const [seenRow, setSeenRow] = useState<AdsRecommendationRow | null>(null);
  if (row !== seenRow) {
    setSeenRow(row);
    setError("");
    setConfirm(false);
    if (row?.proposal) {
      setTarget(row.proposal.recommended);
      setBudget(String(row.proposal.dailyBudget));
    }
  }

  const close = () => {
    setConfirm(false);
    setError("");
    onClose();
  };

  const p = row?.proposal ?? null;
  const budgetNum = Number(budget.replace(/\D/g, "")) || 0;
  const failed = row?.gates.filter((g) => !g.ok) ?? [];
  // Hai mức trùng giá trị (sàn không có số) thì chỉ hiện một — như web.
  const targetOptions = p
    ? TARGETS.filter((t, i, arr) => arr.findIndex((o) => p.targets[o.key] === p.targets[t.key]) === i)
    : [];

  const create = async () => {
    if (!row || !p || busy || budgetNum <= 0) return;
    setBusy(true);
    setError("");
    try {
      const r = await createAdsCampaignFromRecommendation({
        channelId,
        itemId: row.itemId,
        roasTarget: p.targets[target],
        dailyBudget: budgetNum,
        snapshot: {
          tier: row.tier,
          score: row.score,
          headline: row.headline,
          breakevenRoas: row.breakevenRoas,
          safeRoas: row.safeRoas,
          headroom: row.headroom,
          chosenTarget: target,
          targets: p.targets,
          proposedBudget: p.dailyBudget,
          chosenBudget: budgetNum,
          source: "mobile",
        },
      });
      setConfirm(false);
      onCreated(`${r.message}: "${row.productName}".`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Tạo chiến dịch thất bại, thử lại sau");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={row !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        className="flex-1 justify-end bg-black/40"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable className="flex-1" onPress={close} />
        <View
          className="max-h-[88%] rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          {row ? (
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100">
                  {row.productName}
                </Text>
                <Pressable onPress={close} hitSlop={8} accessibilityLabel="Đóng">
                  <Ionicons name="close" size={20} color="#64748b" />
                </Pressable>
              </View>
              <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
                <View className={`rounded-full px-2 py-0.5 ${TIER[row.tier].bg}`}>
                  <Text className={`text-[10px] font-bold ${TIER[row.tier].text}`}>{TIER[row.tier].label}</Text>
                </View>
                <Text className="text-xs text-slate-500 dark:text-slate-400" style={TABULAR}>
                  {row.score}/100 điểm · {row.itemSku ?? `#${row.itemId}`} · {compactMoney(row.price)}
                </Text>
              </View>

              {/* Một câu kết luận của Trợ lý — cùng kiểu hộp "Đề xuất" ở hộp chiến dịch */}
              <View className="mt-3 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
                <Ionicons name="bulb-outline" size={16} color="#d97706" />
                <Text className="flex-1 text-[13px] text-slate-900 dark:text-slate-100">{row.headline}</Text>
              </View>

              {loadingMarket ? (
                <View className="mt-3 flex-row items-center gap-2 rounded-xl bg-sky-50 px-3 py-2.5 dark:bg-sky-500/10">
                  <ActivityIndicator size="small" color="#0ea5e9" />
                  <Text className="flex-1 text-xs text-sky-800 dark:text-sky-300">
                    Đang lấy số của Shopee cho sản phẩm này — điểm và đề xuất sẽ tự cập nhật sau vài giây.
                  </Text>
                </View>
              ) : null}

              {failed.length > 0 ? (
                <View className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <Text className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Việc cần làm trước khi chạy quảng cáo
                  </Text>
                  {failed.map((g) => (
                    <Text key={g.key} className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                      • {g.todo ?? g.text}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Điều kiện (cổng loại) */}
              <View className="mt-3">
                <Text className="mb-1 text-xs font-semibold text-slate-900 dark:text-slate-100">Điều kiện</Text>
                {row.gates.map((g) => (
                  <View key={g.key} className="mb-1 flex-row items-start gap-2">
                    <Ionicons
                      name={g.ok ? "checkmark-circle" : "close-circle"}
                      size={15}
                      color={g.ok ? "#10b981" : "#ef4444"}
                      style={{ marginTop: 1 }}
                    />
                    <Text className="flex-1 text-xs text-slate-600 dark:text-slate-300">{g.text}</Text>
                  </View>
                ))}
              </View>

              {/* Chấm điểm từng yếu tố — thanh điểm + một dòng lý do */}
              {row.factors.length > 0 ? (
                <View className="mt-3">
                  <Text className="mb-1 text-xs font-semibold text-slate-900 dark:text-slate-100">Chấm điểm</Text>
                  {row.factors.map((f) => (
                    <View key={f.key} className="mb-2">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="text-xs text-slate-700 dark:text-slate-200">{f.label}</Text>
                        <Text className="text-xs font-semibold text-slate-900 dark:text-slate-100" style={TABULAR}>
                          {f.points}/{f.max}
                        </Text>
                      </View>
                      <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <View
                          className={`h-full rounded-full ${f.points < 0 ? "bg-red-400" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, f.max > 0 ? (Math.abs(f.points) / f.max) * 100 : 0)}%` }}
                        />
                      </View>
                      <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{f.text}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Thiết lập đề xuất — chỉ khi qua hết cổng */}
              {p ? (
                <View className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Text className="mb-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Mục tiêu ROAS
                  </Text>
                  <View className="flex-row gap-2">
                    {targetOptions.map((t) => {
                      const active = target === t.key;
                      return (
                        <Pressable
                          key={t.key}
                          className={`flex-1 rounded-xl border px-2.5 py-2 ${
                            active
                              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15"
                              : "border-slate-200 dark:border-slate-700"
                          }`}
                          disabled={busy || confirm}
                          onPress={() => {
                            if (!active) hapticSelect();
                            setTarget(t.key);
                          }}
                        >
                          <Text
                            className={`text-[10px] ${
                              active ? "text-emerald-700 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400"
                            }`}
                            numberOfLines={1}
                          >
                            {t.label}
                            {p.recommended === t.key ? " · đề xuất" : ""}
                          </Text>
                          <Text
                            className={`mt-0.5 text-lg font-bold ${
                              active ? "text-emerald-700 dark:text-emerald-300" : "text-slate-900 dark:text-slate-100"
                            }`}
                            style={TABULAR}
                          >
                            {roas1(p.targets[t.key])}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {TARGETS.find((t) => t.key === target)?.hint}
                  </Text>

                  <Text className="mb-1.5 mt-3 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Ngân sách mỗi ngày
                  </Text>
                  <View className="flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 dark:border-slate-700 dark:bg-slate-950">
                    <TextInput
                      className="flex-1 py-3 text-base font-semibold text-slate-900 dark:text-slate-100"
                      style={TABULAR}
                      keyboardType="number-pad"
                      value={budgetNum ? groupVN(budgetNum) : ""}
                      onChangeText={setBudget}
                      editable={!busy && !confirm}
                      placeholder={groupVN(p.dailyBudget)}
                      placeholderTextColor="#94a3b8"
                    />
                    <Text className="text-sm text-slate-500 dark:text-slate-400">₫</Text>
                  </View>
                  <Text className="mt-1.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                    {p.budgetNote} Tiền thử tối đa 7 ngày:{" "}
                    <Text className="font-semibold text-slate-900 dark:text-slate-100" style={TABULAR}>
                      {formatMoney(budgetNum * 7)}
                    </Text>
                    .
                  </Text>

                  {error ? <Text className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</Text> : null}

                  {!adsLinked ? (
                    <View className="mt-4 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
                      <Ionicons name="link-outline" size={16} color="#d97706" />
                      <Text className="flex-1 text-xs text-slate-700 dark:text-slate-300">
                        Gian chưa ủy quyền quảng cáo cho Hubsell — kết nối Hubsell Ads trên web trước khi tạo
                        chiến dịch từ app.
                      </Text>
                    </View>
                  ) : confirm ? (
                    <View className="mt-4 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                      <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Tạo chiến dịch cho sản phẩm này?
                      </Text>
                      <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400" style={TABULAR}>
                        Mục tiêu ROAS {roas1(p.targets[target])} · {formatMoney(budgetNum)}/ngày, đấu thầu tự động.
                        Lệnh được gửi thẳng lên Shopee và có hiệu lực ngay; Trợ lý gác bằng các quy tắc đang bật.
                      </Text>
                      <View className="mt-3 flex-row gap-2">
                        <Pressable
                          className="flex-1 items-center rounded-xl border border-slate-200 py-3 active:opacity-70 dark:border-slate-700"
                          onPress={() => setConfirm(false)}
                          disabled={busy}
                        >
                          <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">Bỏ qua</Text>
                        </Pressable>
                        <Pressable
                          className="flex-1 items-center rounded-xl bg-emerald-600 py-3 active:opacity-80"
                          disabled={busy}
                          onPress={() => {
                            hapticTap();
                            void create();
                          }}
                        >
                          {busy ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text className="text-sm font-semibold text-white">Tạo chiến dịch</Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      className={`mt-4 flex-row items-center justify-center gap-2 rounded-xl py-3 active:opacity-80 ${
                        budgetNum > 0 ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"
                      }`}
                      disabled={budgetNum <= 0}
                      onPress={() => {
                        hapticTap();
                        setConfirm(true);
                      }}
                    >
                      <Ionicons name="rocket-outline" size={16} color="#fff" />
                      <Text className="text-sm font-semibold text-white">Tạo chiến dịch trên Shopee</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
