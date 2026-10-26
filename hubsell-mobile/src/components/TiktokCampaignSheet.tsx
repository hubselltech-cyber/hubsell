import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { Ionicons } from "@expo/vector-icons";
import type { TiktokAdsCampaignRow } from "@/types/api";
import { formatMoney, groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import {
  fmtRoi,
  openSellerCenter,
  TIKTOK_ADVICE_TONE,
  TIKTOK_AUTO_MODE_LABEL,
  TIKTOK_STATUS_LABEL,
  tiktokStatusKey,
  fmtBreakeven,
  isLosingCampaign,
} from "@/lib/tiktok-ads";
import { TABULAR } from "@/theme/tokens";

/**
 * Hộp chi tiết chiến dịch GMV Max: số của kỳ, CĂN CỨ từng dòng, KẾT LUẬN
 * riêng, đề xuất + nấc ROI kế tiếp, rồi tối đa hai nút: Xem video (app làm
 * được: loại video) và Mở Seller Center (ROI / ngân sách / bật tắt — API không
 * sửa được). Không có Tạm dừng / Bật lại / Theo dõi thêm / Bỏ qua như Shopee.
 */
export function TiktokCampaignSheet({
  campaign,
  onClose,
  onVideos,
}: {
  campaign: TiktokAdsCampaignRow | null;
  onClose: () => void;
  onVideos: (c: TiktokAdsCampaignRow, filter?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const dark = useColorScheme().colorScheme === "dark";
  const c = campaign;
  const a = c?.advice ?? null;
  const ongoing = c ? tiktokStatusKey(c.status) === "ongoing" : false;
  const beSource =
    c?.breakeven?.source === "shop"
      ? " (mượn của gian)"
      : c?.breakeven?.source === "product"
        ? " (sản phẩm)"
        : "";

  return (
    <Modal
      visible={c !== null}
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
          {c ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100">
                  {c.name}
                </Text>
                <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Đóng">
                  <Ionicons name="close" size={20} color="#64748b" />
                </Pressable>
              </View>
              <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
                <Text className="text-xs text-slate-500 dark:text-slate-400">
                  TikTok · {TIKTOK_STATUS_LABEL[tiktokStatusKey(c.status)]}
                  {c.auto && c.auto.mode !== "off"
                    ? ` · Tự loại video: ${TIKTOK_AUTO_MODE_LABEL[c.auto.mode]}`
                    : ""}
                </Text>
                {a && a.kind !== "paused" && a.kind !== "no_spend" ? (
                  <View className={`rounded-full px-2 py-0.5 ${TIKTOK_ADVICE_TONE[a.tone].bg}`}>
                    <Text className={`text-[10px] font-bold ${TIKTOK_ADVICE_TONE[a.tone].text}`}>
                      {a.label}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View className="mt-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <Row label="Chi phí" value={formatMoney(c.spend)} />
                <Row label="Doanh thu GMV Max" value={formatMoney(c.gmv)} />
                <Row
                  label="Đơn · CPA"
                  value={`${groupVN(c.orders)}${c.costPerOrder != null ? ` · ${formatMoney(c.costPerOrder)}` : ""}`}
                />
                <Row
                  label="ROI thực / mục tiêu"
                  value={`${fmtRoi(c.roi)} / ${
                    c.biddingMethod === "max_delivery" ? "tối đa" : fmtRoi(c.roasTarget)
                  }`}
                  tone={c.belowTarget || isLosingCampaign(c) ? "red" : undefined}
                />
                <Row
                  label={`ROI hòa vốn${beSource}`}
                  value={fmtBreakeven(c.breakeven)}
                  tone={c.breakeven?.negativeMargin ? "red" : undefined}
                />
                <Row
                  label="Lãi/lỗ ước tính"
                  value={c.estProfit == null ? "—" : formatMoney(c.estProfit)}
                  tone={c.estProfit == null ? undefined : c.estProfit < 0 ? "red" : "emerald"}
                />
                {c.budget > 0 ? (
                  <Row
                    label="Ngân sách ngày"
                    value={`${formatMoney(c.budget)}${
                      a?.budgetUsedPct != null ? ` · dùng ~${Math.round(a.budgetUsedPct)}%` : ""
                    }`}
                  />
                ) : null}
              </View>

              {a && a.points && a.points.length > 0 ? (
                <View className="mt-3">
                  <Text className="mb-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Căn cứ của Trợ lý
                  </Text>
                  {a.points.map((r, i) => (
                    <Text key={i} className="mb-0.5 text-xs text-slate-600 dark:text-slate-300">
                      • {r}
                    </Text>
                  ))}
                </View>
              ) : null}

              {a && a.kind !== "paused" && a.kind !== "no_spend" ? (
                <View className="mt-3 flex-row gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10">
                  <Ionicons name="bulb-outline" size={16} color="#d97706" />
                  <View className="flex-1">
                    <Text className="text-[13px] text-slate-900 dark:text-slate-100">
                      <Text className="font-bold">Kết luận: </Text>
                      {a.conclusion ?? a.text}
                    </Text>
                    {a.nextTarget != null ? (
                      <Text className="mt-1 text-xs text-slate-700 dark:text-slate-200" style={TABULAR}>
                        {/* Lãi giữ được ở nấc kế đã nằm trong câu kết luận của backend
                            (1 số lẻ) — không in lại với cách làm tròn khác (rà 26/10). */}
                        Nấc kế tiếp: ROI mục tiêu {fmtRoi(a.nextTarget)}
                        {a.safeTarget != null ? ` · không hạ dưới ${fmtRoi(a.safeTarget)}` : ""}
                      </Text>
                    ) : null}
                    {a.nextBudget != null ? (
                      <Text className="mt-1 text-xs text-slate-700 dark:text-slate-200" style={TABULAR}>
                        Ngân sách ngày nên nâng lên {formatMoney(a.nextBudget)}
                      </Text>
                    ) : null}
                    {a.watchHoursLeft != null && a.watchHoursLeft > 0 ? (
                      <Text className="mt-1 text-xs text-slate-700 dark:text-slate-200">
                        Còn ~{Math.round(a.watchHoursLeft)} giờ theo dõi sau lần đổi mục tiêu gần nhất
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <View className="mt-4 gap-2">
                {a?.editInSellerCenter ? (
                  <Pressable
                    className="flex-row items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-3 active:opacity-80 dark:bg-slate-100"
                    onPress={openSellerCenter}
                  >
                    <Ionicons name="open-outline" size={16} color={dark ? "#0f172a" : "#fff"} />
                    <Text className="text-sm font-semibold text-white dark:text-slate-900">
                      Mở Seller Center để sửa chiến dịch
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  className={`flex-row items-center justify-center gap-1.5 rounded-xl py-3 active:opacity-80 ${
                    a?.editInSellerCenter
                      ? "border border-slate-300 dark:border-slate-600"
                      : "bg-slate-900 dark:bg-slate-100"
                  }`}
                  onPress={() => {
                    hapticTap();
                    onVideos(c, a?.kind === "no_orders" || a?.kind === "losing" ? "no_order" : undefined);
                  }}
                >
                  <Ionicons
                    name="videocam-outline"
                    size={16}
                    color={a?.editInSellerCenter ? (dark ? "#e2e8f0" : "#334155") : dark ? "#0f172a" : "#fff"}
                  />
                  <Text
                    className={`text-sm font-semibold ${
                      a?.editInSellerCenter
                        ? "text-slate-800 dark:text-slate-100"
                        : "text-white dark:text-slate-900"
                    }`}
                  >
                    {ongoing ? "Xem video · loại video đốt tiền" : "Xem video của chiến dịch"}
                  </Text>
                </Pressable>
                <Text className="text-center text-[11px] text-slate-400 dark:text-slate-500">
                  Tạm dừng, đổi ROI mục tiêu hay ngân sách chỉ làm được trong TikTok Seller Center.
                </Text>
              </View>
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
