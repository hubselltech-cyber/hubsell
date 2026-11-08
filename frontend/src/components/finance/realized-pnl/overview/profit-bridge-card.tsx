"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { HintIcon } from "@/components/finance/hint-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import type { PnlProfitBridge } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { moneyTone, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface BridgeRow {
  key: string;
  label: string;
  hint?: React.ReactNode;
  /** Số CÓ DẤU theo tác động lên lợi nhuận: khoản trừ là âm. */
  amount: number;
  kind: "start" | "step" | "end";
}

/**
 * CẦU NỐI "Từ lãi đơn hàng đến lợi nhuận ròng" — trả lời câu khách hay hỏi:
 * vì sao thẻ Lãi/Lỗ khác thẻ Lợi nhuận ròng của Báo cáo dòng tiền. Mỗi dòng
 * một khoản, thanh ngang dài theo tỷ lệ với lãi đơn hàng; số cuối = đúng thẻ
 * Lợi nhuận ròng bên Dòng tiền (cùng bộ tổng, cùng phép tính ở backend).
 * Khoản 0 đồng tự ẩn (trừ Quảng cáo và Chi phí vận hành — khách cần thấy là 0).
 */
export function ProfitBridgeCard({ bridge, className }: { bridge: PnlProfitBridge; className?: string }) {
  const allRows: BridgeRow[] = [
    { key: "order", label: "Lãi đơn hàng", amount: bridge.orderProfit, kind: "start" },
    {
      key: "nonRevenue",
      label: "Bỏ đơn hủy & đang hoàn",
      hint: "Thẻ Lãi đơn hàng ('Tất cả') cộng cả đơn hủy (phí sàn vẫn trừ, thường âm) và đơn đang hoàn; Lợi nhuận ròng chỉ tính đơn có doanh thu nên phải bỏ phần của hai nhóm đó ra. Dấu + nghĩa là hai nhóm đang âm, bỏ ra thì lợi nhuận tăng lại.",
      amount: -bridge.nonRevenueOrdersProfit,
      kind: "step",
    },
    {
      key: "ads",
      label: "Quảng cáo sàn",
      hint: (
        <>
          Tiền quảng cáo đã tiêu trên sàn trong kỳ, hệ thống tự lấy về (Shopee Ads, TikTok GMV Max…).
          {bridge.adsNotes.map((n) => (
            <span key={n} className="block">
              • {n}
            </span>
          ))}
        </>
      ),
      amount: -bridge.adsSpend,
      kind: "step",
    },
    {
      key: "opex",
      label: "Chi phí vận hành",
      hint: "Chi phí cố định + biến đổi bạn nhập ở Thu chi vận hành (mặt bằng, lương, đóng gói…), đã lọc theo gian đang xem.",
      amount: -bridge.operatingExpense,
      kind: "step",
    },
    {
      key: "income",
      label: "Thu nhập khác",
      hint: "Khoản thu ngoài đơn hàng (đền bù, thưởng…) bạn nhập ở Thu chi vận hành.",
      amount: bridge.operatingIncome,
      kind: "step",
    },
    {
      key: "tax",
      label: "Thuế bổ sung dự phòng",
      hint: "Trích theo mức % bạn cài ở Hóa đơn & Thuế → Thuế bổ sung.",
      amount: -bridge.additionalTax,
      kind: "step",
    },
    { key: "net", label: "Lợi nhuận ròng", amount: bridge.netProfit, kind: "end" },
  ];
  const rows = allRows.filter((r) => r.kind !== "step" || r.amount !== 0 || r.key === "ads" || r.key === "opex");

  // Thanh ngang: tỷ lệ so với số lớn nhất trong cột để khoản nhỏ vẫn thấy vạch.
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));

  return (
    <Card className={cn("h-full shadow-sm", className)}>
      <CardHeader>
        <CardTitle>Từ lãi đơn hàng đến lợi nhuận ròng</CardTitle>
        <CardDescription>
          Lãi đơn hàng trừ các khoản ngoài đơn = Lợi nhuận ròng, đúng số của Báo cáo dòng tiền cùng kỳ.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const total = r.kind !== "step";
            const width = `${Math.max(2, (Math.abs(r.amount) / scale) * 100)}%`;
            const barClass =
              r.kind === "start"
                ? "bg-emerald-500"
                : r.kind === "end"
                  ? r.amount >= 0
                    ? "bg-emerald-600"
                    : "bg-red-500"
                  : r.amount < 0
                    ? "bg-rose-300"
                    : "bg-emerald-300";
            return (
              <li key={r.key} className={cn(total && r.kind === "end" && "border-t border-slate-200 pt-2.5")}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className={cn("flex min-w-0 items-center gap-1", total ? "font-semibold text-slate-900" : "text-slate-700")}>
                    {!total && <span className="w-3 shrink-0 text-center text-slate-400">{r.amount < 0 ? "−" : "+"}</span>}
                    <span className="truncate">{r.label}</span>
                    {r.hint && <HintIcon hint={r.hint} />}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      total ? cn("font-semibold", moneyTone(r.amount)) : "text-slate-700"
                    )}
                  >
                    {total ? <Money value={r.amount} /> : formatVND(Math.abs(r.amount))}
                  </span>
                </div>
                <div className={cn("mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100", !total && "ml-4 w-[calc(100%-1rem)]")}>
                  <div className={cn("h-full rounded-full", barClass)} style={{ width }} />
                </div>
              </li>
            );
          })}
        </ul>
        <p className={cn(TEXT_SUB, "mt-4 flex items-center gap-1")}>
          Xem đầy đủ cơ cấu chi phí ở
          <Link href="/finance/analytics" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
            Báo cáo dòng tiền <ArrowRight className="size-3" />
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
