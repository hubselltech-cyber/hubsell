import React from "react";
import { Text, View, useWindowDimensions } from "react-native";
import type { CashFlowRow } from "@/types/api";
import { compactMoney } from "@/lib/format";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Card } from "@/components/Card";
import { useChannelColors } from "@/theme/channel-colors";
import { TABULAR } from "@/theme/tokens";

/**
 * BẢNG TIỀN THEO GIAN HÀNG — khối 4 của trang Tài chính (anh Trung 25/10/2026):
 *   Gian hàng | Đang giao | Ví sàn (anh chốt Ví sàn ngoài cùng phải), bỏ cột "Bank" (tiền đã về ngân hàng không cần
 *   trên app), hàng TỔNG kết luận theo Ví sàn + Đang giao đúng các dòng đang lọc.
 * Bố cục: tên gian 1 dòng co "…" (flex-1, minWidth 0), hai cột số bề rộng CỐ ĐỊNH
 * (MONEY_COL) nên tên dài không bao giờ đẩy số tràn — đo trên giả lập web 25/10 với tên
 * 40+ ký tự + số 7–10 chữ số ở 320 / 360 / 390 / 430 px: tên còn 124 px (~15 ký tự) ở 320.
 * Ví sàn: Shopee = số dư ví; TikTok = sổ cái withdrawals; Lazada = sao kê chưa chi; không
 * có → "—". Đang giao (pendingIncome): số sàn công bố, chưa sync → "—".
 * Màu theo NGHĨA (anh 25/10 "làm tí màu cho sinh động"): chấm màu sàn trước tên gian (cùng
 * bộ màu bộ lọc sàn ở Đơn hàng), Ví sàn xanh lá = tiền đã trong tay, Đang giao hổ phách =
 * tiền còn trên đường, số âm đỏ, "—" xám. Gian đã ngắt mờ cả dòng.
 */
export function CashByShopTable({ rows }: { rows: CashFlowRow[] }) {
  const channelColors = useChannelColors();
  // Khe giữa hai cột số (anh 25/10: "để quá sát khó nhìn"): số canh phải trong ô cố định nên khi hai
  // số cùng dài ("999,9 tr" cạnh "-999,9 tr") chỉ còn 8 px — thêm 12 px; máy 320 chỉ 6 px để tên gian
  // vẫn đủ chỗ cho "DARKMAN STORE" (115 px).
  const { width } = useWindowDimensions();
  const gap = width < 360 ? 6 : 12;
  const walletTotal = rows.reduce((s, r) => s + (r.walletBalance ?? 0), 0);
  const pendingTotal = rows.reduce((s, r) => s + (r.pendingIncome ?? 0), 0);
  return (
    <Card className="p-4">
      <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tiền theo gian hàng</Text>
      <Text className="mb-2 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
        Đang giao = sàn sẽ trả, chưa trả · Ví sàn = số dư thật trên sàn
      </Text>
      <View className="flex-row items-end pb-1.5">
        <Text className="flex-1 text-[11px] text-slate-400 dark:text-slate-500">Gian hàng</Text>
        <Text className="text-right text-[11px] text-slate-400 dark:text-slate-500" style={{ width: MONEY_COL }}>
          Đang giao
        </Text>
        <Text
          className="text-right text-[11px] text-slate-400 dark:text-slate-500"
          style={{ width: MONEY_COL, marginLeft: gap }}
        >
          Ví sàn
        </Text>
      </View>
      {rows.map((r) => (
        <View
          key={r.channelId}
          className="flex-row items-center border-t border-slate-100 py-2.5 dark:border-slate-800"
        >
          <View className="min-w-0 flex-1 pr-2">
            <Text
              className={`text-sm font-medium ${
                r.disconnected ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"
              }`}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {r.shopName}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <View
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: channelColors[r.channelName] ?? "#94a3b8", opacity: r.disconnected ? 0.4 : 1 }}
              />
              <Text className="text-[11px] text-slate-400 dark:text-slate-500" numberOfLines={1}>
                {CHANNEL_LABEL[r.channelName] ?? r.channelName}
                {r.disconnected ? " · Đã ngắt" : ""}
              </Text>
            </View>
          </View>
          <MoneyCell value={r.pendingIncome} tone="transit" muted={r.disconnected} />
          <MoneyCell value={r.walletBalance} tone="wallet" strong muted={r.disconnected} gap={gap} />
        </View>
      ))}
      {rows.length === 0 ? (
        <Text className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
          Không có gian hàng nào trên sàn này
        </Text>
      ) : (
        <View className="mt-0.5 flex-row items-center border-t border-slate-200 pt-2.5 dark:border-slate-700">
          <Text className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Tổng</Text>
          <MoneyCell value={pendingTotal} tone="transit" strong />
          <MoneyCell value={walletTotal} tone="wallet" strong gap={gap} />
        </View>
      )}
    </Card>
  );
}

/**
 * Bề rộng một cột tiền. Đo 25/10/2026 trên giả lập web (font hệ thống): chuỗi rộng nhất
 * compactMoney cho ra là "-999,9 tr" 14 px semibold tabular = 54 px, tiêu đề "Đang giao" 11 px
 * = 50 px → 62 px đủ + 8 px dư. Hai cột + khe = 130 px (320) / 136 px; tên gian còn 118 px ở máy 320
 * ("DARKMAN STORE" 115 px vừa), 152 px ở 360, 182 px ở 390, 222 px ở 430.
 */
const MONEY_COL = 62;

/** Màu chữ theo tông: ví = xanh lá (tiền trong tay), đang giao = hổ phách (trên đường); âm → đỏ. */
const TONE = {
  wallet: "text-emerald-600 dark:text-emerald-400",
  transit: "text-amber-600 dark:text-amber-400",
} as const;

/** Ô tiền căn phải, "—" xám khi sàn chưa có số (null) — dùng cho dòng gian lẫn hàng Tổng. */
function MoneyCell({
  value,
  tone,
  strong = false,
  muted = false,
  gap = 0,
}: {
  value: number | null;
  tone: keyof typeof TONE;
  strong?: boolean;
  muted?: boolean;
  /** Khe bên trái (cột thứ hai) — xem CashByShopTable. */
  gap?: number;
}) {
  const color =
    value == null || muted
      ? "text-slate-400 dark:text-slate-500"
      : value < 0
        ? "text-red-600 dark:text-red-400"
        : TONE[tone];
  return (
    <Text
      className={`text-right text-sm ${strong ? "font-semibold" : "font-medium"} ${color}`}
      style={[TABULAR, { width: MONEY_COL, marginLeft: gap }]}
      numberOfLines={1}
    >
      {value == null ? "—" : compactMoney(value)}
    </Text>
  );
}
