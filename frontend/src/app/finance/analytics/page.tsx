"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Scale,
  Receipt,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AccessDenied } from "@/components/access-denied";
import { can } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import {
  ALL_CHANNELS,
  ChannelFilter,
  type ChannelFilterValue,
} from "@/components/channel-filter";
import { DateRangePicker } from "@/components/date-range-picker";
import { Refreshing } from "@/components/refreshing";
import {
  defaultRange,
  formatDayVN,
  previousRange,
  type DateRange,
} from "@/lib/date-range";
import { BreakdownCard } from "@/components/finance/breakdown-card";
import { CashFlowTable } from "@/components/finance/cash-flow-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchFinanceAnalytics,
  getStoredUser,
  getToken,
} from "@/lib/api";
import { formatVND, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";

// Bố cục 4 thẻ = THÁC NƯỚC dòng tiền (chốt 31/07, backend quyết định items):
//   Giá trị SP − Tổng sàn khấu trừ (phí + thuế sàn + voucher + chênh lệch VC
//   − trợ giá) = Doanh thu → Doanh thu − Chi phí (giá vốn + ads + vận hành)
//   + Thu khác − Thuế bổ sung dự phòng = Lợi nhuận ròng.
//   - Cột Doanh thu = "Tổng tiền" sàn báo (payout thật / số API đơn khi chờ).
//   - Cột Chi phí KHÔNG còn Phí sàn/Thuế sàn (đã cấn trừ trong Doanh thu —
//     trừ nữa là trùng); 2 khoản đó là dòng khấu trừ của thẻ Giá trị SP.
//   - Cột Lợi nhuận (chốt 07/08, chuẩn P&L): 3 dòng Thực tế + Dự kiến + Thu
//     vận hành khác = LN TRƯỚC thuế, dòng 4 "Thuế bổ sung dự phòng" là KHẤU
//     TRỪ (amount âm từ backend) → số to trên thẻ = LN RÒNG sau thuế dự phòng.

export default function FinanceAnalyticsPage() {
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);
  // Báo cáo tài chính: chỉ Chủ shop
  const allowed = can(getStoredUser(), "finance.analytics");

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // Kỳ hiện tại + KỲ LIỀN TRƯỚC (cùng độ dài, vẽ mũi tên tăng/giảm) nằm trong
  // cache React Query — quay lại trang là thấy số ngay, refetch chạy ngầm.
  const dataQ = useApiQuery({
    queryKey: qk.financeAnalytics(range, channel),
    queryFn: () => fetchFinanceAnalytics(range, channel),
    enabled: allowed,
  });
  // Kỳ trước nạp lỗi cũng không sao (null → ẩn mũi tên, trang vẫn chạy).
  const prevQ = useApiQuery({
    queryKey: qk.financeAnalytics(previousRange(range), channel),
    queryFn: () =>
      fetchFinanceAnalytics(previousRange(range), channel).catch(() => null),
    enabled: allowed,
  });

  const data = dataQ.data ?? null;
  const prevData = prevQ.data ?? null;
  const loading = dataQ.refreshing;
  const denied = !allowed || dataQ.denied;
  const load = () => {
    dataQ.refetch();
    prevQ.refetch();
  };

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Dòng tiền của shop — doanh thu, chi phí và lợi nhuận (đơn Đã giao:{" "}
            {data ? formatNumber(data.deliveredOrderCount) : "—"}).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ChannelFilter value={channel} onChange={setChannel} />
            <DateRangePicker value={range} onChange={setRange} disabled={loading} />
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          </div>
        </div>

        {/* ===== BÓC TÁCH DÒNG TIỀN 4 CỘT =====
            Chú thích công thức ẩn hết vào tooltip (?) cạnh tiêu đề cho gọn;
            góc phải mỗi thẻ: tỷ trọng % + mũi tên so kỳ liền trước. */}
        {data &&
          (() => {
            const prevR = previousRange(range);
            const deltaHint = `so với kỳ liền trước cùng độ dài (${formatDayVN(prevR.from)} - ${formatDayVN(prevR.to)})`;
            // % thay đổi so kỳ trước; kỳ trước = 0 thì không so được → null.
            const deltaOf = (cur: number, prev: number | undefined) =>
              prevData == null || prev == null || prev === 0
                ? null
                : ((cur - prev) / Math.abs(prev)) * 100;
            // Tỷ trọng %: chia cho 0 → 0 (kỳ trống, hiện 0% thay vì NaN).
            const share = (part: number, whole: number) =>
              whole === 0 ? 0 : (part / whole) * 100;
            const b = data.breakdown;
            const pb = prevData?.breakdown;

            return (
              <Refreshing
                active={loading}
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
              >
                <BreakdownCard
                  title="Tổng giá trị sản phẩm"
                  subtitle={`${formatNumber(b.gross.orderCount)} đơn (chưa trừ chi phí)`}
                  total={b.gross.total}
                  delta={deltaOf(b.gross.total, pb?.gross.total)}
                  deltaHint={deltaHint}
                  icon={ShoppingBag}
                  tone="info"
                  items={b.gross.items}
                  itemsAreDeductions
                  footer={
                    <span>
                      Tổng sàn khấu trừ:{" "}
                      <b className="text-red-500">
                        − {formatVND(b.gross.totalDeduction)}
                      </b>
                    </span>
                  }
                />

                <BreakdownCard
                  title="Doanh thu"
                  titleHint="Tiền sàn thực trả về cho shop — đã trừ sẵn phí và thuế sàn."
                  total={b.revenue.total}
                  share={{
                    percent: share(b.revenue.total, b.gross.total),
                    label: "trên giá trị SP",
                  }}
                  delta={deltaOf(b.revenue.total, pb?.revenue.total)}
                  deltaHint={deltaHint}
                  icon={Wallet}
                  tone="positive"
                  colorValue
                  items={b.revenue.items}
                />

                <BreakdownCard
                  title="Chi phí"
                  titleHint="Giá vốn + quảng cáo + chi phí vận hành. Khoản thuế để dành xem ở thẻ Lợi nhuận."
                  total={b.costs.total}
                  share={{
                    percent: share(b.costs.total, b.revenue.total),
                    label: "trên doanh thu",
                  }}
                  delta={deltaOf(b.costs.total, pb?.costs.total)}
                  deltaInverted /* chi phí tăng là XẤU → mũi tên đảo màu */
                  deltaHint={deltaHint}
                  icon={Receipt}
                  tone="negative"
                  colorValue
                  items={b.costs.items}
                />

                <BreakdownCard
                  title="Lợi nhuận ròng tạm tính"
                  titleHint="Tiền lãi thực còn lại = Doanh thu − Chi phí + Thu khác − Thuế để dành."
                  total={b.profit.total}
                  share={{
                    percent: share(b.profit.total, b.revenue.total),
                    label: "biên ròng",
                  }}
                  delta={deltaOf(b.profit.total, pb?.profit.total)}
                  deltaHint={deltaHint}
                  icon={Scale}
                  items={b.profit.items}
                  colorBySign
                  featured /* ← Card Ngôi Sao: chỉ số cốt lõi của trang này */
                  footer={<span>% là biên lợi nhuận trên dòng tiền tương ứng</span>}
                />
              </Refreshing>
            );
          })()}

        {/* Ghi chú cách đọc số liệu */}
        {data && (
          <p className="text-xs text-muted-foreground">
            Phạm vi tính: {formatNumber(data.breakdown.gross.orderCount)} đơn Đã giao
            và Đang giao (không tính đơn đã hủy). Phí &amp; thuế sàn CHỈ ghi số
            <b> thực tế</b> từ đối soát; đơn chưa quyết toán <b>chờ đối soát</b> —
            không ước phí %, nên lợi nhuận dự kiến là mức trần lạc quan.
          </p>
        )}

        {/* ===== BẢNG PHÂN BỔ DÒNG TIỀN THEO GIAN HÀNG ===== */}
        <CashFlowTable />

        {/* Biểu đồ vùng: Doanh thu vs Tổng chi phí */}
        <Card>
          <CardHeader>
            <CardTitle>Doanh thu vs Tổng chi phí (14 ngày)</CardTitle>
            <CardDescription>
              Doanh thu = tiền trên sàn của đơn phát sinh trong ngày (Đã giao +
              Đang giao, gồm cả đơn chờ đối soát — khớp thẻ Doanh thu). Tổng chi
              phí = giá vốn + quảng cáo + chi phí vận hành trong ngày (khớp thẻ
              Chi phí, không gồm phí sàn vì đã khấu trừ trong doanh thu).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80 w-full">
              {data && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.series}>
                    <defs>
                      <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f87171" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#f87171" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={12} tickLine={false} />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      width={110}
                      // Hiển thị ĐẦY ĐỦ tiền tệ, không viết tắt (VD: 1.000.000 ₫)
                      tickFormatter={(v: number) => formatVND(v)}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatVND(Number(value)),
                        name === "revenue" ? "Doanh thu" : "Tổng chi phí",
                      ]}
                    />
                    <Legend
                      formatter={(value) =>
                        value === "revenue" ? "Doanh thu" : "Tổng chi phí"
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#gradRevenue)"
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="#f87171"
                      strokeWidth={2}
                      fill="url(#gradCost)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Báo cáo dòng tiền
        </p>
      </div>
    </AppShell>
  );
}
