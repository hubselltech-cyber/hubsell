"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Loader2,
  ReceiptText,
  Scale,
  Undo2,
  Wallet,
} from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  adjustInvoice,
  ApiError,
  downloadInvoiceLogPdf,
  fetchInvoiceRegister,
  fetchTaxReport,
  type CqtStatus,
  type InvoiceLogStatus,
  type TaxReportResponse,
} from "@/lib/api";
import {
  defaultRange,
  formatRangeLabel,
  rangeToQuery,
  type DateRange,
} from "@/lib/date-range";
import { exportInvoiceRegisterToExcel } from "@/lib/excel";
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

/**
 * Badge trạng thái phía CƠ QUAN THUẾ (03/09) — worker kéo từ NCC theo nhịp;
 * "Đã cấp mã" cho ký hiệu C, "CQT tiếp nhận" cho ký hiệu K (không mã).
 */
const CQT_META: Record<CqtStatus, { label: (withCode: boolean) => string; className: string }> = {
  ACCEPTED: {
    label: (withCode) => (withCode ? "Đã cấp mã" : "CQT tiếp nhận"),
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  WAITING: {
    label: (withCode) => (withCode ? "Chờ cấp mã" : "Chờ CQT"),
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  SEND_ERROR: {
    label: () => "Gửi CQT lỗi",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  REJECTED: {
    label: () => "CQT từ chối",
    className: "border-red-300 bg-red-50 font-semibold text-red-700",
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
  const inv = data?.invoiceSummary;
  const settings = data?.settings;
  const baseLabel =
    settings?.calculationBase === "REVENUE" ? "doanh thu" : "lợi nhuận";

  // ---- Bộ lọc bảng nhật ký (24/08 khuya — anh Trung yêu cầu): lọc client-side
  // trên các dòng đã tải của kỳ (server đã lọc theo khoảng ngày). ----
  const [logFilter, setLogFilter] = useState<
    "all" | "needs" | "cqt" | "issued" | "adjustment" | "problem"
  >("all");
  const [logSearch, setLogSearch] = useState("");
  const isCqtProblem = (l: { status: InvoiceLogStatus; cqtStatus: CqtStatus | null }) =>
    l.status === "ISSUED" && (l.cqtStatus === "REJECTED" || l.cqtStatus === "SEND_ERROR");
  const filteredLogs = (data?.logs ?? [])
    .filter((l) => {
      if (logFilter === "needs" && !l.needsAdjustment) return false;
      if (logFilter === "cqt" && !isCqtProblem(l)) return false;
      if (logFilter === "issued" && !(l.status === "ISSUED" && !l.adjustmentForLogId)) return false;
      if (logFilter === "adjustment" && !l.adjustmentForLogId) return false;
      if (logFilter === "problem" && l.status !== "FAILED" && l.status !== "CANCELLED") return false;
      const q = logSearch.trim().toLowerCase();
      if (q && !l.orderCode.toLowerCase().includes(q) && !(l.invoiceNo ?? "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    })
    // Ghim việc PHẢI XỬ LÝ lên đầu: cần điều chỉnh → CQT từ chối → còn lại
    // giữ thứ tự server (mới nhất trước).
    .sort(
      (a, b) =>
        Number(b.needsAdjustment) - Number(a.needsAdjustment) ||
        Number(isCqtProblem(b)) - Number(isCqtProblem(a))
    );
  const needsCount = inv?.needsAdjustmentCount ?? 0;
  const cqtRejected = inv?.cqtRejectedCount ?? 0;
  const FILTER_TABS = [
    { key: "all", label: "Tất cả" },
    { key: "needs", label: needsCount > 0 ? `Cần điều chỉnh (${needsCount})` : "Cần điều chỉnh" },
    { key: "cqt", label: cqtRejected > 0 ? `CQT từ chối (${cqtRejected})` : "CQT từ chối / lỗi" },
    { key: "issued", label: "Hóa đơn bán" },
    { key: "adjustment", label: "Điều chỉnh" },
    { key: "problem", label: "Lỗi / Đã hủy" },
  ] as const;

  // ---- Xuất BẢNG KÊ BÁN RA (Excel) của kỳ — dữ liệu lấy riêng từ
  // /invoices/register (đủ mọi tờ theo ngày lập, không dính trần 200 dòng). ----
  const [exporting, setExporting] = useState(false);
  const handleExportRegister = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const r = await fetchInvoiceRegister(rangeToQuery(range));
      if (r.rows.length === 0) {
        toast.info("Kỳ này chưa có hóa đơn nào đã lập để đưa vào bảng kê.");
        return;
      }
      exportInvoiceRegisterToExcel(r.rows, formatRangeLabel(range));
      toast.success(
        `Đã xuất bảng kê ${r.rows.length} hóa đơn${r.truncated ? " (chạm trần 5.000 dòng — thu hẹp kỳ để lấy đủ)" : ""}.`
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message ? err.message : "Không xuất được bảng kê — thử lại sau"
      );
    } finally {
      setExporting(false);
    }
  };

  // ---- Lập HÓA ĐƠN ĐIỀU CHỈNH giảm toàn bộ (khách trả hàng — 24/08) ----
  // Xác nhận bằng Dialog của hệ thống — window.confirm bị trình duyệt nhúng
  // chặn im lặng (anh Trung bấm không thấy gì, 24/08 khuya).
  const [adjustTarget, setAdjustTarget] = useState<{
    id: string;
    invoiceNo: string | null;
    returnInfo: { platformStatus: string; refundAmount: number; returnedItems: number } | null;
  } | null>(null);
  // Phạm vi điều chỉnh: PLATFORM = theo dữ liệu hoàn sàn báo (một phần chính
  // xác), FULL = giảm toàn bộ — mặc định theo sàn khi có dữ liệu.
  const [adjustMode, setAdjustMode] = useState<"PLATFORM" | "FULL">("FULL");
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const openAdjustDialog = (l: {
    id: string;
    invoiceNo: string | null;
    returnInfo: { platformStatus: string; refundAmount: number; returnedItems: number } | null;
  }) => {
    setAdjustMode(l.returnInfo ? "PLATFORM" : "FULL");
    setAdjustTarget({ id: l.id, invoiceNo: l.invoiceNo, returnInfo: l.returnInfo });
  };
  const performAdjust = async () => {
    if (!adjustTarget || adjustingId) return;
    const { id, invoiceNo } = adjustTarget;
    setAdjustTarget(null);
    setAdjustingId(id);
    try {
      const r = await adjustInvoice(id, adjustMode, "Khách trả hàng hoàn tiền");
      toast.success(
        `Đã lập hóa đơn điều chỉnh số ${r.log?.invoiceNo ?? "?"} cho hóa đơn ${invoiceNo ?? ""}.`
      );
      void load(range);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : "Không lập được hóa đơn điều chỉnh — thử lại sau"
      );
    } finally {
      setAdjustingId(null);
    }
  };

  // ---- Tải PDF bản thể hiện (đã ký) của hóa đơn ĐÃ PHÁT HÀNH ----
  // Hộp PHÁT HÀNH đã chuyển sang trang Kết nối & Xuất hóa đơn (anh Trung chốt
  // 23/08) — trang này chỉ còn tra cứu + tải về.
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const handleDownloadPdf = async (logId: string) => {
    if (downloadingId) return;
    setDownloadingId(logId);
    try {
      const r = await downloadInvoiceLogPdf(logId);
      // base64 → blob → click ẩn: tải file ngay trong app, không mở tab mới.
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = r.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : "Không tải được PDF — thử lại sau"
      );
    } finally {
      setDownloadingId(null);
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
            Kỳ tính theo <b>ngày lập hóa đơn</b>; số liệu nền tính trên đơn có doanh thu trong kỳ (loại đơn hủy).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleExportRegister()}
              disabled={exporting || loading}
              title="Bảng kê hóa đơn bán ra của kỳ (Excel) — đối chiếu với cổng hoadondientu.gdt.gov.vn trước khi kê khai"
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-3.5" />
              )}
              Xuất bảng kê
            </Button>
            <DateRangePicker value={range} onChange={setRange} />
          </div>
        </div>

        {loading && !data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang tải báo cáo thuế…
          </div>
        ) : (
          <>
            {/* ===== TỔNG HỢP HÓA ĐƠN CỦA KỲ (làm lại 24/08 khuya — anh Trung:
                thẻ phải xoay quanh HÓA ĐƠN; thuế sàn/thuế bổ sung gộp về dải
                phụ bên dưới). Số RÒNG = hóa đơn điều chỉnh mang tiền âm tự trừ. ===== */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <FileText className="size-3.5" />
                    Hóa đơn đã phát hành
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    {inv?.issuedCount ?? 0}
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    {inv?.adjustmentCount ? `${inv.adjustmentCount} điều chỉnh` : "Chưa có điều chỉnh"}
                    {inv?.failedCount ? ` · ${inv.failedCount} lỗi` : ""}
                    {needsCount > 0 && (
                      <>
                        {" "}·{" "}
                        <button
                          type="button"
                          onClick={() => setLogFilter("needs")}
                          className="font-semibold text-red-600 hover:underline"
                        >
                          {needsCount} cần điều chỉnh
                        </button>
                      </>
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <Wallet className="size-3.5" />
                    Giá trị hóa đơn (ròng)
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    <Money value={inv?.invoicedAmount ?? 0} />
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    {inv?.adjustedAmount ? (
                      <>
                        Đã trừ <Money value={inv.adjustedAmount} /> hoàn trả
                      </>
                    ) : (
                      "Tổng tiền trên hóa đơn của kỳ"
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <ReceiptText className="size-3.5" />
                    Thuế GTGT đầu ra
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    <Money value={inv?.invoicedVat ?? 0} />
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    Bóc ngược từ giá bán, đã trừ điều chỉnh
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="pt-5">
                  <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1.5")}>
                    <Scale className="size-3.5" />
                    Thuế sàn trích hộ
                  </p>
                  <p className={cn(TEXT_HERO_NUMBER, "mt-1.5")}>
                    <Money value={s?.platformTaxTotal ?? 0} />
                  </p>
                  <p className={cn(TEXT_SUB, "mt-1")}>
                    Thực <Money value={s?.platformTaxActual ?? 0} /> + ước tính{" "}
                    <Money value={s?.platformTaxEstimated ?? 0} />
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ===== ĐỐI CHIẾU SÓT + CƠ QUAN THUẾ (03/09) — trả lời 3 câu của kế
                toán: kỳ này giao bao nhiêu đơn / đã lập bao nhiêu tờ / sót & quá
                hạn bao nhiêu; và CQT đã cấp mã hay từ chối tờ nào. ===== */}
            {(() => {
              const cov = data?.coverage;
              const overdue = cov?.overdueCount ?? 0;
              const missing = cov?.missingCount ?? 0;
              const rejected = inv?.cqtRejectedCount ?? 0;
              const waiting = inv?.cqtWaitingCount ?? 0;
              const unchecked = inv?.cqtUncheckedCount ?? 0;
              const cancelled = inv?.cancelledCount ?? 0;
              const healthy = overdue === 0 && rejected === 0;
              return (
                <Card
                  className={cn(
                    "shadow-sm",
                    !healthy && "border-red-200 bg-red-50/40"
                  )}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {healthy ? (
                        <Landmark className="size-4 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="size-4 text-red-600" />
                      )}
                      <h3 className="text-sm font-semibold text-slate-900">
                        Đối chiếu kỳ
                      </h3>
                      <span className={TEXT_SUB}>
                        {healthy
                          ? "Không có đơn quá hạn, không có tờ bị Cơ quan Thuế từ chối."
                          : "Có việc phải xử lý trước khi kê khai."}
                      </span>
                    </div>
                    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                      <div>
                        <p className={TEXT_CARD_TITLE}>Đơn giao trong kỳ</p>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums">
                          {cov?.deliveredCount ?? 0}
                        </p>
                        <p className={TEXT_SUB}>theo ngày giao thành công</p>
                      </div>
                      <div>
                        <p className={TEXT_CARD_TITLE}>Đã có hóa đơn</p>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-700">
                          {cov?.invoicedCount ?? 0}
                        </p>
                        <p className={TEXT_SUB}>đang chờ NCC hoặc đã phát hành</p>
                      </div>
                      <div>
                        <p className={TEXT_CARD_TITLE}>Chưa xuất</p>
                        <p
                          className={cn(
                            "mt-0.5 text-lg font-semibold tabular-nums",
                            missing > 0 ? "text-amber-700" : ""
                          )}
                        >
                          {missing}
                        </p>
                        <p className={TEXT_SUB}>
                          {missing > 0 ? (
                            <Link href="/invoicing/connect" className="text-primary hover:underline">
                              mở hàng chờ xuất
                            </Link>
                          ) : (
                            "không sót đơn nào"
                          )}
                        </p>
                      </div>
                      <div>
                        <p className={TEXT_CARD_TITLE}>Quá hạn lập</p>
                        <p
                          className={cn(
                            "mt-0.5 text-lg font-semibold tabular-nums",
                            overdue > 0 ? "text-red-700" : ""
                          )}
                        >
                          {overdue}
                        </p>
                        <p className={TEXT_SUB}>
                          giao xong quá {cov?.overdueHours ?? 48}h chưa có hóa đơn
                        </p>
                      </div>
                      <div>
                        <p className={TEXT_CARD_TITLE}>CQT từ chối</p>
                        <p
                          className={cn(
                            "mt-0.5 text-lg font-semibold tabular-nums",
                            rejected > 0 ? "text-red-700" : ""
                          )}
                        >
                          {rejected}
                        </p>
                        <p className={TEXT_SUB}>
                          {rejected > 0 ? (
                            <button
                              type="button"
                              onClick={() => setLogFilter("cqt")}
                              className="text-primary hover:underline"
                            >
                              xem tờ bị từ chối
                            </button>
                          ) : (
                            "đã loại khỏi tổng VAT nếu có"
                          )}
                        </p>
                      </div>
                      <div>
                        <p className={TEXT_CARD_TITLE}>Chờ CQT / chưa kiểm</p>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums">
                          {waiting}
                          <span className="text-sm font-normal text-slate-500"> / {unchecked}</span>
                        </p>
                        <p className={TEXT_SUB}>
                          {cancelled > 0 ? `${cancelled} tờ đã hủy trong kỳ` : "đối chiếu với NCC mỗi 12 giờ"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Dải phụ: số liệu nền tính từ ĐƠN HÀNG (không phải hóa đơn) —
                giữ để đối chiếu nhưng không chiếm thẻ to. */}
            <p className={cn(TEXT_SUB, "px-1")}>
              Nền kỳ này: doanh thu chịu thuế <Money value={s?.grossRevenue ?? 0} />{" "}
              trên {s?.orderCount ?? 0} đơn ({s?.settledCount ?? 0} đã quyết toán)
              {(s?.additionalTax ?? 0) > 0 && (
                <>
                  {" "}· thuế bổ sung ước tính <Money value={s?.additionalTax ?? 0} /> (
                  {settings?.customTaxPercent ?? 0}% trên {baseLabel})
                </>
              )}
            </p>

            {/* ===== NHẬT KÝ HÓA ĐƠN ĐIỆN TỬ ===== */}
            <Card className="shadow-sm">
              <CardContent className="pt-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <FileText className="size-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Nhật ký hóa đơn điện tử
                  </h3>
                  <span className={TEXT_SUB}>
                    {filteredLogs.length}/{data?.logs.length ?? 0} bản ghi trong kỳ
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {FILTER_TABS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setLogFilter(t.key)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                          logFilter === t.key
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                    <Input
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      placeholder="Tìm mã đơn / số hóa đơn…"
                      className="h-8 w-52 text-xs"
                    />
                  </div>
                </div>

                {filteredLogs.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {(data?.logs.length ?? 0) === 0
                      ? "Chưa có hóa đơn nào trong kỳ này. Phát hành hóa đơn cho đơn hàng tại trang “Kết nối & Xuất hóa đơn” — mỗi lần phát hành/hủy sẽ ghi một dòng vào đây để đối soát và tải PDF."
                      : "Không có bản ghi nào khớp bộ lọc — đổi tab lọc hoặc xóa từ khóa tìm."}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className={TABLE_HEAD_EMPHASIS}>
                        <TableRow>
                          <TableHead>Ngày lập</TableHead>
                          <TableHead>Mã đơn · Người mua</TableHead>
                          <TableHead>NCC</TableHead>
                          <TableHead>Số hóa đơn điện tử</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead>Cơ quan Thuế</TableHead>
                          <TableHead className="text-right">
                            Tổng tiền
                          </TableHead>
                          <TableHead className="text-right">
                            Thuế GTGT
                          </TableHead>
                          <TableHead className="text-right">
                            Thuế sàn trích hộ
                          </TableHead>
                          <TableHead className="text-right">Bản PDF</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLogs.map((l) => {
                          const meta = STATUS_META[l.status];
                          const withCode = l.invoiceSeries?.charAt(1) === "C";
                          const cqt = l.cqtStatus ? CQT_META[l.cqtStatus] : null;
                          return (
                            <TableRow
                              key={l.id}
                              className={cn(l.cqtStatus === "REJECTED" && "bg-red-50/40")}
                            >
                              <TableCell className="whitespace-nowrap text-slate-600">
                                {/* Kỳ kê khai theo NGÀY LẬP; tờ chưa lập (lỗi/chờ) hiện ngày tạo. */}
                                {formatDateTime(l.issuedAt ?? l.createdAt)}
                              </TableCell>
                              <TableCell>
                                {l.orderCode}
                                {l.buyerName && (
                                  <p
                                    className="max-w-[220px] truncate text-xs font-normal text-slate-500"
                                    title={[l.buyerName, l.buyerTaxCode ? `MST ${l.buyerTaxCode}` : null].filter(Boolean).join(" · ")}
                                  >
                                    {l.buyerName}
                                    {l.buyerTaxCode ? ` · ${l.buyerTaxCode}` : ""}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="text-slate-600">
                                {l.provider}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                <span className="inline-flex items-center gap-1.5">
                                  {l.invoiceNo ?? "—"}
                                  {/* Hóa đơn ĐIỀU CHỈNH (tiền âm — khách trả
                                      hàng) đánh dấu rõ để không nhầm hóa đơn bán. */}
                                  {l.adjustmentForLogId && (
                                    <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-sans text-[10px] font-medium text-violet-700">
                                      Điều chỉnh
                                    </span>
                                  )}
                                  {/* Sàn đã chốt hoàn mà chưa điều chỉnh — dòng
                                      này được GHIM đầu bảng, seller phải xử lý. */}
                                  {l.needsAdjustment && (
                                    <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-red-700">
                                      Cần điều chỉnh
                                    </span>
                                  )}
                                </span>
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
                              <TableCell>
                                {l.status === "ISSUED" ? (
                                  cqt ? (
                                    <span
                                      className={cn(
                                        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                        cqt.className
                                      )}
                                      title={
                                        l.cqtStatus === "REJECTED"
                                          ? "Cơ quan Thuế từ chối — sửa và gửi lại trên meInvoice; tờ này đã loại khỏi tổng VAT của kỳ"
                                          : l.cqtCheckedAt
                                            ? `Kiểm lần cuối ${formatDateTime(l.cqtCheckedAt)}`
                                            : undefined
                                      }
                                    >
                                      {cqt.label(withCode)}
                                    </span>
                                  ) : (
                                    <span
                                      className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                                      title="Hubsell đối chiếu trạng thái với NCC mỗi 12 giờ"
                                    >
                                      Chưa kiểm
                                    </span>
                                  )
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
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
                              <TableCell className="text-right">
                                <span className="inline-flex items-center gap-1.5">
                                  {l.status === "ISSUED" && l.transactionId ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => void handleDownloadPdf(l.id)}
                                      disabled={downloadingId !== null}
                                      title={`Mã tra cứu: ${l.transactionId} — tra công khai tại meinvoice.vn/tra-cuu`}
                                    >
                                      {downloadingId === l.id ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                      ) : (
                                        <Download className="size-3.5" />
                                      )}
                                      Tải
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                  {/* Khách trả hàng hoàn tiền → lập HĐ điều chỉnh
                                      GIẢM TOÀN BỘ (TT 91/2026); chỉ hiện trên hóa
                                      đơn bán ĐÃ phát hành chưa có điều chỉnh. */}
                                  {l.status === "ISSUED" &&
                                    !l.adjustmentForLogId &&
                                    !l.hasAdjustment && (
                                      <Button
                                        size="sm"
                                        variant={l.needsAdjustment ? "default" : "outline"}
                                        onClick={() => openAdjustDialog(l)}
                                        disabled={adjustingId !== null}
                                        title="Khách trả hàng hoàn tiền — lập hóa đơn điều chỉnh giảm"
                                      >
                                        {adjustingId === l.id ? (
                                          <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                          <Undo2 className="size-3.5" />
                                        )}
                                        Điều chỉnh
                                      </Button>
                                    )}
                                </span>
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

      {/* Hộp xác nhận lập HÓA ĐƠN ĐIỀU CHỈNH — Dialog hệ thống thay
          window.confirm (bị trình duyệt nhúng nuốt im lặng). */}
      <Dialog
        open={adjustTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAdjustTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="size-5 text-slate-500" />
              Lập hóa đơn điều chỉnh giảm
            </DialogTitle>
            <DialogDescription>
              Cho hóa đơn số <b>{adjustTarget?.invoiceNo ?? "?"}</b> — khách trả
              hàng hoàn tiền. Hóa đơn điều chỉnh ghi số âm, tham chiếu hóa đơn
              gốc, được ký số và gửi Cơ quan Thuế như hóa đơn thường.
            </DialogDescription>
          </DialogHeader>

          {/* Chọn PHẠM VI điều chỉnh (25/08 — anh Trung: hoàn một phần phải xử
              lý được): theo dữ liệu sàn (một phần chính xác) hoặc toàn bộ. */}
          <div className="grid gap-2">
            <button
              type="button"
              disabled={!adjustTarget?.returnInfo}
              onClick={() => setAdjustMode("PLATFORM")}
              className={cn(
                "rounded-lg border p-3 text-left text-sm transition-colors",
                adjustMode === "PLATFORM"
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 hover:border-slate-300",
                !adjustTarget?.returnInfo && "cursor-not-allowed opacity-50"
              )}
            >
              <p className="font-semibold">Theo dữ liệu hoàn của sàn</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {adjustTarget?.returnInfo
                  ? adjustTarget.returnInfo.returnedItems > 0
                    ? `Sàn báo khách trả ${adjustTarget.returnInfo.returnedItems} sản phẩm — điều chỉnh đúng dòng hàng trả (một phần hay toàn bộ theo số sàn).`
                    : `Khách giữ hàng, sàn hoàn ${adjustTarget.returnInfo.refundAmount.toLocaleString("vi-VN")}đ — giảm giá trị tương ứng.`
                  : "Sàn chưa báo dữ liệu hoàn cho đơn này."}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setAdjustMode("FULL")}
              className={cn(
                "rounded-lg border p-3 text-left text-sm transition-colors",
                adjustMode === "FULL"
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 hover:border-slate-300"
              )}
            >
              <p className="font-semibold">Giảm toàn bộ hóa đơn</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Âm nguyên giá trị hóa đơn — dùng khi khách trả toàn bộ đơn hoặc
                sàn không có dữ liệu chi tiết.
              </p>
            </button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              Hủy
            </Button>
            <Button onClick={() => void performAdjust()}>
              <Undo2 className="size-4" />
              Lập hóa đơn điều chỉnh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
