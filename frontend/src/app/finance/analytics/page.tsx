"use client";

import { useCallback, useEffect, useState } from "react";
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
import { canAccessFinance } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import {
  ALL_CHANNELS,
  ChannelFilter,
  type ChannelFilterValue,
} from "@/components/channel-filter";
import { DateRangePicker } from "@/components/date-range-picker";
import { Refreshing } from "@/components/refreshing";
import { defaultRange, type DateRange } from "@/lib/date-range";
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
  ApiError,
  fetchFinanceAnalytics,
  getStoredUser,
  getToken,
  type FinanceAnalytics,
} from "@/lib/api";
import { formatVND, formatNumber } from "@/lib/format";

// Bố cục 4 cột theo chuẩn kế toán (backend quyết định toàn bộ items):
//   - Cột Doanh thu: có thêm dòng "Thu nhập vận hành khác" ở cuối (khoản ngoài
//     đơn hàng, không cộng vào tổng cột).
//   - Cột Chi phí: gồm cả 2 dòng nghĩa vụ thuế thật từ module Hóa đơn & Thuế
//     ("Thuế sàn TMĐT ước tính" + "Thuế bổ sung dự phòng") — tổng cột đã bao gồm.
//   - Cột Lợi nhuận: TINH GIẢN — Tổng lợi nhuận tạm tính = Thực tế + Dự kiến,
//     chỉ phân rã theo trạng thái đơn để quản trị rủi ro dòng tiền TMĐT.

export default function FinanceAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<FinanceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchFinanceAnalytics(range, channel));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      // 409 (chưa có kênh) — AppShell overlay xử lý
    } finally {
      setLoading(false);
    }
  }, [router, range, channel]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Báo cáo tài chính: chỉ Chủ shop
    if (!canAccessFinance(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

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

        {/* ===== BÓC TÁCH DÒNG TIỀN 4 CỘT ===== */}
        {data && (
          <Refreshing
            active={loading}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          >
            <BreakdownCard
              title="Tổng giá trị sản phẩm"
              subtitle={`${formatNumber(data.breakdown.gross.orderCount)} đơn (chưa trừ chi phí)`}
              total={data.breakdown.gross.total}
              icon={ShoppingBag}
              tone="info"
              items={data.breakdown.gross.items}
              itemsAreDeductions
              footer={
                <span>
                  Tổng sàn khấu trừ:{" "}
                  <b className="text-rose-600">
                    − {formatVND(data.breakdown.gross.totalDeduction)}
                  </b>
                </span>
              }
            />

            <BreakdownCard
              title="Doanh thu"
              subtitle="Sau khi trừ các khoản sàn giữ lại"
              total={data.breakdown.revenue.total}
              icon={Wallet}
              tone="positive"
              colorValue
              items={data.breakdown.revenue.items}
            />

            <BreakdownCard
              title="Chi phí"
              subtitle="Giá vốn + chi phí vận hành + nghĩa vụ thuế"
              total={data.breakdown.costs.total}
              icon={Receipt}
              tone="negative"
              colorValue
              items={data.breakdown.costs.items}
            />

            <BreakdownCard
              title="Tổng lợi nhuận tạm tính"
              subtitle="Thực tế + Dự kiến — thuế đã tách sang cột Chi phí"
              total={data.breakdown.profit.total}
              icon={Scale}
              items={data.breakdown.profit.items}
              colorBySign
              featured /* ← Card Ngôi Sao: chỉ số cốt lõi của trang này */
              footer={<span>% là biên lợi nhuận trên dòng tiền tương ứng</span>}
            />
          </Refreshing>
        )}

        {/* Ghi chú cách đọc số liệu */}
        {data && (
          <p className="text-xs text-muted-foreground">
            Phạm vi tính: {formatNumber(data.breakdown.gross.orderCount)} đơn Đã giao
            và Đang giao (không tính đơn đã hủy). Đơn đã quyết toán dùng số phí
            <b> thực tế</b> sàn trả về; đơn đang đi đường dùng số <b>tạm tính</b>.
          </p>
        )}

        {/* ===== BẢNG PHÂN BỔ DÒNG TIỀN THEO GIAN HÀNG ===== */}
        <CashFlowTable />

        {/* Biểu đồ vùng: Doanh thu vs Tổng chi phí */}
        <Card>
          <CardHeader>
            <CardTitle>Doanh thu vs Tổng chi phí (14 ngày)</CardTitle>
            <CardDescription>
              Tổng chi phí mỗi ngày = giá vốn đơn Đã giao + chi phí vận hành phát
              sinh trong ngày.
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
