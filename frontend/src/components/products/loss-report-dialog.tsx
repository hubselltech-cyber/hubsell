"use client";

// ============================================================
// HỘP "HÀNG HỎNG, MẤT & CHÊNH KIỂM KÊ" ở tab Nhật ký kho — kho chuẩn quốc tế lát 4 (20/11/2026,
// docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 16).
//
// Cộng các dòng nhật ký TAY theo lý do trong một kỳ: hỏng, mất, tặng / nội bộ, chênh kiểm kê, sửa số.
// Mỗi nhóm tách phần GIẢM và phần TĂNG (kiểm kê thiếu 5, thừa 3 không tự bù thành 2). Giá trị tính theo
// giá vốn HIỆN TẠI của từng SKU, chỉ hiện cho người thấy tài chính. Không dùng chữ "Hao hụt"
// (anh Trung 13/11) — gọi đúng tên từng loại.
// Chỉ gọi máy chủ khi hộp mở.
// ============================================================

import { useMemo, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { fetchLossReport, type LossReport } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { PRODUCT_NAME_CLAMP, TEXT_CARD_TITLE, TEXT_HERO_NUMBER, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const PERIODS = [
  { days: 30, label: "30 ngày qua" },
  { days: 90, label: "90 ngày qua" },
  { days: 365, label: "12 tháng qua" },
];

export function LossReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [days, setDays] = useState(30);
  // Mốc "đến" chốt theo lúc mở hộp / đổi kỳ — không chạy theo đồng hồ để khóa truy vấn đứng yên.
  const range = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, open]);
  const q = useApiQuery({
    queryKey: qk.lossReport(days, range.to),
    queryFn: () => fetchLossReport(range),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-4 text-slate-500" />
            Hàng hỏng, mất &amp; chênh kiểm kê
          </DialogTitle>
          <DialogDescription>
            Cộng từ Nhật ký kho theo lý do đã chọn lúc nhập / xuất, kiểm kê và sửa số. Không gồm hàng bán cho đơn,
            bán ngoài sàn và nhập hàng.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                days === p.days
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {q.data ? (
          <ReportBody report={q.data} />
        ) : q.error ? (
          <p className="py-6 text-center text-sm text-amber-700">{q.error}</p>
        ) : (
          <p className={cn(TEXT_SUB, "flex items-center justify-center gap-2 py-6")}>
            <Loader2 className="size-4 animate-spin" /> Đang tính…
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, sub, children }: { label: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2.5">
      <div className={TEXT_CARD_TITLE}>{label}</div>
      <div className={cn(TEXT_HERO_NUMBER, "truncate")}>{children}</div>
      {sub && <div className={cn(TEXT_SUB, "truncate")}>{sub}</div>}
    </div>
  );
}

function ReportBody({ report }: { report: LossReport }) {
  const seesCost = !report.costPriceHidden;
  const g = (key: string) => report.groups.find((x) => x.key === key);
  const damagedLost = (g("DAMAGED")?.down ?? 0) + (g("LOST")?.down ?? 0);
  const damagedLostValue = (g("DAMAGED")?.downValue ?? 0) + (g("LOST")?.downValue ?? 0);
  const count = g("STOCKTAKE");
  // Nhóm không có dòng nào trong kỳ thì ẩn — bảng chỉ còn những gì thật sự xảy ra.
  const rows = report.groups.filter((x) => x.lines > 0);
  const noReason = g("EXPORT_NO_REASON");
  const unclassified = g("ADJUST_OLD");

  if (rows.length === 0) {
    return (
      <p className={cn(TEXT_SUB, "py-6 text-center")}>
        Kỳ này chưa có dòng hàng hỏng, mất, kiểm kê hay sửa số nào.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Tile
          label="Hỏng + mất"
          sub={seesCost ? <>≈ <Money value={damagedLostValue} /> theo giá vốn</> : "sản phẩm"}
        >
          {formatNumber(damagedLost)}
        </Tile>
        <Tile label="Kiểm kê thiếu" sub={`trên ${formatNumber(count?.skus ?? 0)} SKU có chênh`}>
          {formatNumber(count?.down ?? 0)}
        </Tile>
        <Tile label="Kiểm kê thừa" sub="đếm được nhiều hơn sổ">
          {formatNumber(count?.up ?? 0)}
        </Tile>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className={TEXT_TABLE_HEAD}>
              <th className="px-3 py-2 text-left font-medium">Lý do</th>
              <th className="px-3 py-2 text-right font-medium">SKU</th>
              <th className="px-3 py-2 text-right font-medium">Giảm</th>
              <th className="px-3 py-2 text-right font-medium">Tăng</th>
              {seesCost && <th className="px-3 py-2 text-right font-medium">Giá trị giảm</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.skus)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", r.down > 0 && "font-semibold text-rose-700")}>
                  {r.down > 0 ? `−${formatNumber(r.down)}` : "—"}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", r.up > 0 && "font-semibold text-emerald-700")}>
                  {r.up > 0 ? `+${formatNumber(r.up)}` : "—"}
                </td>
                {seesCost && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.down > 0 ? <Money value={r.downValue ?? 0} /> : "—"}
                  </td>
                )}
              </tr>
            ))}
            <tr className="bg-muted/40 font-semibold">
              <td className="px-3 py-2">Tổng cộng</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums">−{formatNumber(report.total.down)}</td>
              <td className="px-3 py-2 text-right tabular-nums">+{formatNumber(report.total.up)}</td>
              {seesCost && (
                <td className="px-3 py-2 text-right tabular-nums">
                  <Money value={report.total.downValue ?? 0} />
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {report.top.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className={TEXT_TABLE_HEAD}>
                <th className="px-3 py-2 text-left font-medium">Mã giảm nhiều nhất</th>
                <th className="px-3 py-2 text-right font-medium">Giảm ròng</th>
                {seesCost && <th className="px-3 py-2 text-right font-medium">Giá trị</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.top.map((t) => (
                <tr key={t.productId}>
                  <td className="px-3 py-2">
                    <p className="max-w-[16rem] truncate font-mono text-sm" title={t.skuCode}>
                      {t.skuCode}
                    </p>
                    <p className={cn(TEXT_SUB, PRODUCT_NAME_CLAMP)} title={t.productName}>
                      {t.productName}
                      {t.variantName ? ` · ${t.variantName}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-700">
                    −{formatNumber(t.down - t.up)}
                  </td>
                  {seesCost && (
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Money value={t.netValue ?? 0} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className={cn(TEXT_SUB, "list-disc space-y-1 pl-5")}>
        {seesCost && <li>Giá trị = số lượng × giá vốn hiện tại của SKU; SKU chưa nhập giá vốn tính 0.</li>}
        {(noReason?.down ?? 0) > 0 && (
          <li>
            <b className="text-amber-700">{formatNumber(noReason?.down ?? 0)} sản phẩm xuất tay không ghi lý do</b> —
            chọn lý do lúc xuất kho để lần sau biết là bán ngoài sàn, hỏng hay mất.
          </li>
        )}
        {(unclassified?.lines ?? 0) > 0 && (
          <li>
            &quot;Điều chỉnh chưa phân loại&quot; là các dòng sửa số, kiểm kê ghi trước khi có danh sách lý do.
          </li>
        )}
      </ul>
    </div>
  );
}
