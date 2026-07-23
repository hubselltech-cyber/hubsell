"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  fetchCashFlow,
  type CashFlowRow,
  type ChannelName,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { cn } from "@/lib/utils";

/**
 * BẢNG PHÂN BỔ DÒNG TIỀN THEO GIAN HÀNG
 *
 * Bóc dòng tiền của TỪNG gian hàng theo trạng thái vòng đời (đi đường → chờ đối
 * soát → đã đối soát → đã thu về). Dòng được map ĐỘNG từ danh sách gian hàng API
 * trả về (kết nối thêm gian là tự có thêm dòng); hàng TỔNG CỘNG cộng dồn bằng
 * reduce theo đúng các dòng đang lọc. Cột tiền căn phải, cột chữ căn trái.
 */

/** Thứ tự sàn cố định để dropdown & bảng ổn định. */
const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK", "OFFLINE"];

/** Ô tiền: 0 hiển thị gạch mờ cho đỡ rối; khác 0 hiển thị số. */
function Cash({ value, className }: { value: number; className?: string }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <Money value={value} className={className} />;
}

export function CashFlowTable() {
  const [rows, setRows] = useState<CashFlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [platform, setPlatform] = useState<ChannelName | "">("");

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetchCashFlow();
      setRows(res.rows);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Các sàn THỰC SỰ có trong dữ liệu → dropdown động, không hardcode.
  const platformsPresent = useMemo(
    () =>
      PLATFORM_ORDER.filter((p) => rows.some((r) => r.channelName === p)),
    [rows]
  );

  // Đổi sàn → ẩn các sàn khác ngay lập tức (lọc phía client).
  const shown = platform
    ? rows.filter((r) => r.channelName === platform)
    : rows;

  // Hàng TỔNG CỘNG: reduce động trên đúng các dòng đang hiển thị.
  const totals = shown.reduce(
    (acc, r) => ({
      inTransit: acc.inTransit + r.inTransit,
      pendingSettle: acc.pendingSettle + r.pendingSettle,
      settled: acc.settled + r.settled,
      withdrawn: acc.withdrawn + r.withdrawn,
      total: acc.total + r.total,
    }),
    { inTransit: 0, pendingSettle: 0, settled: 0, withdrawn: 0, total: 0 }
  );

  const COLS = [
    "Tiền đang đi đường",
    "Tiền chờ đối soát",
    "Tiền đã đối soát",
    "Tiền đã thu về",
    "Tổng dòng tiền dự kiến",
  ];

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="size-5 text-slate-400" />
            Phân bổ dòng tiền theo gian hàng
          </CardTitle>
          <CardDescription className="mt-1">
            Ảnh chụp dòng tiền hiện tại — tổng hợp mọi đơn chưa hủy theo từng gian
            hàng.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {/* Bộ lọc theo sàn — góc phải bảng */}
          <NativeSelect
            className="w-44"
            aria-label="Lọc theo sàn"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ChannelName | "")}
          >
            <option value="">Tất cả sàn</option>
            {platformsPresent.map((p) => (
              <option key={p} value={p}>
                {CHANNEL_META[p].label}
              </option>
            ))}
          </NativeSelect>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Làm mới
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading && rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tải dòng tiền…
          </p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Không tải được dữ liệu dòng tiền.
          </p>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Chưa có gian hàng nào để phân bổ dòng tiền.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="border-b-2 border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-medium text-slate-500">
                    Kênh &amp; Gian hàng
                  </th>
                  {COLS.map((c, i) => (
                    <th
                      key={c}
                      className={cn(
                        "border-b-2 border-slate-200 bg-slate-50 px-4 py-3 text-right text-xs font-medium text-slate-500",
                        // Cột cuối: thêm khoảng thở phải để số không dính vách bảng
                        i === COLS.length - 1 && "pr-6 font-semibold text-slate-700"
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {shown.map((r) => {
                  const meta = CHANNEL_META[r.channelName];
                  const cell = "border-t border-slate-100 px-4 py-3";
                  return (
                    <tr
                      key={r.channelId}
                      className="transition-colors hover:bg-primary/[0.04]"
                    >
                      <td className={cn(cell, "text-left")}>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                              meta.className
                            )}
                          >
                            {meta.label}
                          </span>
                          <span className="font-medium text-slate-800">
                            {r.shopName}
                          </span>
                        </span>
                      </td>
                      <td className={cn(cell, "text-right text-slate-700")}>
                        <Cash value={r.inTransit} />
                      </td>
                      <td className={cn(cell, "text-right text-amber-700")}>
                        <Cash value={r.pendingSettle} />
                      </td>
                      <td className={cn(cell, "text-right text-emerald-700")}>
                        <Cash value={r.settled} />
                      </td>
                      <td className={cn(cell, "text-right text-slate-700")}>
                        <Cash value={r.withdrawn} />
                      </td>
                      <td className={cn(cell, "pr-6 text-right font-semibold text-slate-900")}>
                        <Cash value={r.total} className="font-semibold" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {/* HÀNG TỔNG CỘNG — cộng dồn động bằng reduce, nền nhẹ + in đậm */}
                <tr className="bg-slate-100 font-bold text-slate-900">
                  <td className="border-t-2 border-slate-300 px-4 py-3 text-left">
                    TỔNG CỘNG {platform ? `(${CHANNEL_META[platform].label})` : ""}
                  </td>
                  <td className="border-t-2 border-slate-300 px-4 py-3 text-right">
                    <Money value={totals.inTransit} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-4 py-3 text-right">
                    <Money value={totals.pendingSettle} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-4 py-3 text-right">
                    <Money value={totals.settled} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-4 py-3 text-right">
                    <Money value={totals.withdrawn} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-4 py-3 pr-6 text-right">
                    <Money value={totals.total} className="font-bold" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Ghi chú cột giữ chỗ */}
        {!loading && !error && shown.length > 0 && (
          <p className="px-4 py-2.5 text-left text-xs italic text-slate-500">
            Cột “Tiền đã thu về” cần module theo dõi lệnh rút ví về ngân hàng
            (chưa có) nên đang giữ chỗ 0₫.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
