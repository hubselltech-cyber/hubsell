"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, ReceiptText, Scale, Wallet } from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  fetchTaxReport,
  issueInvoice,
  type InvoiceLogStatus,
  type TaxReportResponse,
} from "@/lib/api";
import { defaultRange, rangeToQuery, type DateRange } from "@/lib/date-range";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_CARD_TITLE,
  TEXT_HERO_NUMBER,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * LỊCH SỬ & BÁO CÁO THUẾ — trang đối soát hóa đơn của module Hóa đơn & Thuế.
 *
 * Hai tầng số liệu, cùng một khoảng ngày lọc:
 *   1. TỔNG HỢP THUẾ của kỳ: doanh thu gốc chịu thuế, thuế sàn TMĐT trích hộ
 *      (số THẬT từ đơn đã quyết toán + ước tính cho đơn chưa quyết toán) và
 *      thuế bổ sung theo cấu hình ở trang "Thuế bổ sung".
 *   2. NHẬT KÝ HÓA ĐƠN ĐIỆN TỬ (bảng InvoiceLog): mỗi dòng một lần phát hành/
 *      hủy hóa đơn với NCC — số hóa đơn, trạng thái, tiền thuế đi kèm.
 */

const STATUS_META: Record<
  InvoiceLogStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Chờ phát hành",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  ISSUED: {
    label: "Đã phát hành",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  CANCELLED: {
    label: "Đã hủy",
    className: "border-slate-200 bg-slate-50 text-slate-500",
  },
  FAILED: {
    label: "Lỗi",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

/** "2026-07-26T09:15:00.000Z" → "26/07/2026 16:15" theo giờ máy người xem. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TaxHistoryPage() {
  const [range, setRange] = useState<DateRange>(() => defaultRange());
  const [data, setData] = useState<TaxReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: DateRange) => {
    setLoading(true);
    try {
      setData(await fetchTaxReport(rangeToQuery(r)));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Không tải được báo cáo thuế");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  const s = data?.summary;
  const settings = data?.settings;
  const baseLabel =
    settings?.calculationBase === "REVENUE" ? "doanh thu" : "lợi nhuận";

  // ---- Phát hành hóa đơn theo mã đơn (thí điểm MISA 23/08) ----
  const [issueCode, setIssueCode] = useState("");
  const [issuing, setIssuing] = useState(false);
  const handleIssue = async () => {
    const orderCode = issueCode.trim();
    if (!orderCode || issuing) return;
    setIssuing(true);
    try {
      const res = await issueInvoice(orderCode);
      toast.success(
        `Đã phát hành hóa đơn số ${res.log.invoiceNo ?? "?"} cho đơn ${orderCode}`
      );
      setIssueCode("");
      void load(range);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : "Phát hành hóa đơn thất bại"
      );
      // NCC từ chối vẫn ghi một dòng FAILED vào nhật ký — tải lại để thấy.
      void load(range);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <SettingsShell
      title="Lịch sử & Báo cáo thuế"
      description="Đối soát thuế sàn TMĐT trích hộ và nhật ký hóa đơn điện tử theo kỳ."
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={TEXT_SUB}>
            Số liệu tính trên đơn có doanh thu trong kỳ (loại đơn hủy).
          </p>
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang tải báo cáo thuế…
          </div>
        ) : (
          <>
            {/* ===== TỔNG HỢP THUẾ CỦA KỲ ===== */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <Wallet className="size-3.5" />
                    Doanh thu gốc chịu thuế
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    <Money value={s?.grossRevenue ?? 0} />
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    {s?.orderCount ?? 0} đơn ({s?.settledCount ?? 0} đã quyết
                    toán)
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <ReceiptText className="size-3.5" />
                    Thuế sàn đã trích (thực)
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    <Money value={s?.platformTaxActual ?? 0} />
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    Số sàn ĐÃ khấu trừ trên đơn quyết toán
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <ReceiptText className="size-3.5" />
                    Thuế sàn ước tính thêm
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    <Money value={s?.platformTaxEstimated ?? 0} />
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    {settings?.platformTaxPercent ?? 1.5}% trên đơn chưa quyết
                    toán
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <Scale className="size-3.5" />
                    Thuế bổ sung ước tính
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    <Money value={s?.additionalTax ?? 0} />
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    {settings?.customTaxPercent ?? 0}% trên {baseLabel} kỳ này
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ===== PHÁT HÀNH HÓA ĐƠN (THÍ ĐIỂM) ===== */}
            <Card className="shadow-sm">
              <CardContent className="pt-5">
                <div className="mb-1 flex items-center gap-2">
                  <ReceiptText className="size-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Phát hành hóa đơn cho đơn hàng
                  </h3>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    Thí điểm
                  </span>
                </div>
                <p className={cn(TEXT_SUB, "mb-3")}>
                  Nhập mã đơn hàng để phát hành hóa đơn điện tử qua NCC đã cấu
                  hình ở &quot;Kết nối &amp; Xuất hóa đơn&quot;. Dòng hàng lấy
                  theo đơn, thuế suất theo từng sản phẩm (mặc định 0% nếu chưa
                  khai), đơn giá bán coi là chưa gồm GTGT.
                </p>
                <div className="flex max-w-md gap-2">
                  <Input
                    value={issueCode}
                    onChange={(e) => setIssueCode(e.target.value)}
                    placeholder="Mã đơn hàng, VD 2508230ABCDEF"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleIssue();
                    }}
                  />
                  <Button
                    onClick={() => void handleIssue()}
                    disabled={issuing || issueCode.trim() === ""}
                  >
                    {issuing ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Đang phát hành…
                      </>
                    ) : (
                      "Phát hành hóa đơn"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* ===== NHẬT KÝ HÓA ĐƠN ĐIỆN TỬ ===== */}
            <Card className="shadow-sm">
              <CardContent className="pt-5">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="size-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Nhật ký hóa đơn điện tử
                  </h3>
                  <span className={TEXT_SUB}>
                    {data?.logs.length ?? 0} bản ghi trong kỳ
                  </span>
                </div>

                {(data?.logs.length ?? 0) === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Chưa có hóa đơn nào được phát hành trong kỳ này. Khi module
                    &quot;Kết nối &amp; Xuất hóa đơn&quot; hoạt động thật, mỗi
                    lần phát hành/hủy hóa đơn sẽ ghi một dòng vào đây để đối
                    soát.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className={TABLE_HEAD_EMPHASIS}>
                        <TableRow>
                          <TableHead>Thời gian</TableHead>
                          <TableHead>Mã đơn</TableHead>
                          <TableHead>NCC</TableHead>
                          <TableHead>Số hóa đơn điện tử</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead className="text-right">
                            Tổng tiền
                          </TableHead>
                          <TableHead className="text-right">
                            Thuế GTGT
                          </TableHead>
                          <TableHead className="text-right">
                            Thuế sàn trích hộ
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data!.logs.map((l) => {
                          const meta = STATUS_META[l.status];
                          return (
                            <TableRow key={l.id}>
                              <TableCell className="whitespace-nowrap text-slate-600">
                                {formatDateTime(l.createdAt)}
                              </TableCell>
                              <TableCell className="font-medium">
                                {l.orderCode}
                              </TableCell>
                              <TableCell className="text-slate-600">
                                {l.provider}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {l.invoiceNo ?? "—"}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={cn(
                                    "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                    meta.className
                                  )}
                                  title={l.errorMessage ?? undefined}
                                >
                                  {meta.label}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <Money value={l.totalAmount} />
                              </TableCell>
                              <TableCell className="text-right text-slate-600">
                                <Money value={l.vatAmount} />
                              </TableCell>
                              <TableCell className="text-right text-slate-600">
                                <Money value={l.platformTaxWithheld} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </SettingsShell>
  );
}
