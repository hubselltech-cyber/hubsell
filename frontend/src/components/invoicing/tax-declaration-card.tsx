"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, FileSpreadsheet, Landmark, Loader2 } from "lucide-react";

import { HintIcon } from "@/components/finance/hint-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
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
  fetchTaxDeclaration,
  type TaxDeclarationResponse,
  type TaxDeclarationRowDTO,
} from "@/lib/api";
import { exportTaxDeclarationToExcel } from "@/lib/excel";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_CARD_TITLE,
  TEXT_HERO_NUMBER,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * SỐ LIỆU KÊ KHAI KỲ (07/09) — khối đầu trang Lịch sử & Báo cáo thuế.
 *
 * Trả lời đúng hai con số hộ kinh doanh cần mỗi quý khi lên eTax: doanh thu
 * tính thuế và số sàn đã khấu trừ nộp thay, TÁCH THEO SÀN — thay cho việc
 * vào từng Seller Center tải báo cáo rồi cộng tay. Cố ý KHÔNG ghi "điền vào
 * chỉ tiêu số mấy" (anh Trung chốt: hướng dẫn giữa các bên còn mâu thuẫn,
 * gán sai là khách bị phạt). Deep-link từ chuông nhắc hạn: ?period=2026-Q3.
 */

const CHANNEL_LABEL: Record<TaxDeclarationRowDTO["channelName"], string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
  OFFLINE: "Ngoài sàn",
};

type Quarter = 1 | 2 | 3 | 4 | null;

/** "2026-Q3" → {2026, 3}; "2026" → {2026, null}; rác → null. */
function parsePeriodKey(key: string | null): { year: number; quarter: Quarter } | null {
  if (!key) return null;
  const m = /^(\d{4})(?:-Q([1-4]))?$/.exec(key.trim());
  if (!m) return null;
  return { year: Number(m[1]), quarter: m[2] ? (Number(m[2]) as Quarter) : null };
}

function currentQuarter(): { year: number; quarter: Quarter } {
  const d = new Date();
  return { year: d.getFullYear(), quarter: (Math.floor(d.getMonth() / 3) + 1) as Quarter };
}

export function TaxDeclarationCard() {
  const [period, setPeriod] = useState(currentQuarter);
  const [data, setData] = useState<TaxDeclarationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Đọc ?period= một lần lúc mount (chuông nhắc hạn dẫn tới đúng kỳ). Không
  // dùng useSearchParams để khỏi bọc Suspense cho cả trang.
  useEffect(() => {
    const fromUrl = parsePeriodKey(new URLSearchParams(window.location.search).get("period"));
    if (fromUrl) setPeriod(fromUrl);
  }, []);

  const load = useCallback(async (p: { year: number; quarter: Quarter }) => {
    setLoading(true);
    try {
      setData(await fetchTaxDeclaration(p));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error("Không tải được số liệu kê khai");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];
  const total = data?.total;
  const deadline = data?.period.deadline;
  const daysLeft = deadline?.daysLeft ?? 0;
  const deadlineTone =
    daysLeft < 0 ? "text-slate-500" : daysLeft <= 7 ? "text-red-700" : "text-slate-700";
  const annual = data?.annual;
  const pct = annual?.percentOfThreshold ?? 0;
  const overThreshold = pct > 100;
  const nearThreshold = !overThreshold && pct >= 80;

  return (
    <Card className="border-t-4 border-t-emerald-600 shadow-sm">
      <CardContent className="pt-4 pb-4">
        {/* ===== Tiêu đề + chọn kỳ + hạn nộp ===== */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Landmark className="size-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">Số liệu kê khai kỳ</h3>
            <HintIcon
              hint={
                <>
                  Hai con số cần khi lên eTax mỗi quý: <b>doanh thu tính thuế</b> (tiền hàng −
                  giảm giá người bán − hoàn trả, không trừ phí sàn/ship) và <b>số sàn đã khấu
                  trừ nộp thay</b> (1% GTGT + 0,5% TNCN với hộ/cá nhân kinh doanh). Tách theo
                  từng sàn để bạn không phải tải báo cáo thuế từ từng Seller Center rồi cộng
                  tay. Hubsell không gán chỉ tiêu tờ khai — đối chiếu với mẫu 01/CNKD (hộ)
                  hoặc 01/GTGT (doanh nghiệp) đang dùng.
                </>
              }
            />
            {deadline ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  daysLeft < 0
                    ? "border-slate-200 bg-slate-50"
                    : daysLeft <= 7
                      ? "border-red-200 bg-red-50"
                      : "border-slate-200 bg-slate-50",
                  deadlineTone
                )}
                title={deadline.description}
              >
                <CalendarClock className="size-3" />
                Hạn nộp {deadline.label}
                {daysLeft > 0 ? ` · còn ${daysLeft} ngày` : daysLeft === 0 ? " · hôm nay" : " · đã qua"}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Bề rộng phải chứa được chữ 16px ở màn 2xl — w-28 từng cắt "Năm 2026" thành "Năm 202" (anh Trung soi prod 07/09). */}
            <NativeSelect
              className="w-36"
              value={period.year}
              onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
              aria-label="Năm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  Năm {y}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="w-32"
              value={period.quarter ?? "all"}
              onChange={(e) =>
                setPeriod((p) => ({
                  ...p,
                  quarter: e.target.value === "all" ? null : (Number(e.target.value) as Quarter),
                }))
              }
              aria-label="Kỳ"
            >
              <option value={1}>Quý 1</option>
              <option value={2}>Quý 2</option>
              <option value={3}>Quý 3</option>
              <option value={4}>Quý 4</option>
              <option value="all">Cả năm</option>
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              disabled={!data || loading || data.rows.length === 0}
              onClick={() => data && exportTaxDeclarationToExcel(data)}
              title="Xuất bảng số liệu kê khai (Excel) — mỗi sàn một dòng + tổng"
            >
              <FileSpreadsheet className="size-3.5" />
              Xuất Excel
            </Button>
          </div>
        </div>

        {loading && !data ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang gom số theo sàn…
          </div>
        ) : data ? (
          <>
            {/* ===== 3 số chính ===== */}
            <div className={cn("mt-4 grid gap-4 sm:grid-cols-3", loading && "opacity-60")}>
              <div>
                <p className={TEXT_CARD_TITLE}>Doanh thu tính thuế {data.period.label}</p>
                <p className={cn(TEXT_HERO_NUMBER, "mt-1")}>
                  <Money value={total?.taxableRevenue ?? 0} />
                </p>
                <p className={TEXT_SUB}>
                  {total?.orderCount ?? 0} đơn · tiền hàng <Money value={total?.grossRevenue ?? 0} /> − giảm
                  giá <Money value={total?.sellerVoucher ?? 0} /> − hoàn{" "}
                  <Money value={total?.refundedAmount ?? 0} />
                </p>
              </div>
              <div>
                <p className={TEXT_CARD_TITLE}>Sàn đã khấu trừ nộp thay</p>
                <p className={cn(TEXT_HERO_NUMBER, "mt-1")}>
                  <Money value={total?.taxWithheldActual ?? 0} />
                </p>
                <p className={TEXT_SUB}>
                  ≈ GTGT <Money value={total?.withheldSplit.vat ?? 0} /> + TNCN{" "}
                  <Money value={total?.withheldSplit.pit ?? 0} />
                  <HintIcon
                    className="ml-1 align-middle"
                    hint="Số thật từ đơn ĐÃ đối soát. Tách GTGT/TNCN theo tỷ lệ luật 1% : 0,5% (ước chia) — chứng từ khấu trừ sàn cấp là số chính thức. Doanh nghiệp không bị sàn khấu trừ; nếu ô này vẫn có số thì hồ sơ thuế trên Seller Center đang khai sai loại hình."
                  />
                </p>
              </div>
              <div>
                <p className={TEXT_CARD_TITLE}>Chưa đối soát (số chưa chốt)</p>
                <p
                  className={cn(
                    TEXT_HERO_NUMBER,
                    "mt-1",
                    (total?.unsettledCount ?? 0) > 0 ? "text-amber-700" : ""
                  )}
                >
                  <Money value={total?.unsettledTaxableRevenue ?? 0} />
                </p>
                <p className={TEXT_SUB}>
                  {total?.unsettledCount ?? 0} đơn sàn chưa quyết toán · sàn ước khấu trừ{" "}
                  <Money value={total?.taxWithheldEstimated ?? 0} />
                </p>
              </div>
            </div>

            {/* ===== Bảng theo sàn ===== */}
            {data.rows.length === 0 ? (
              <p className={cn(TEXT_SUB, "mt-4")}>Kỳ này chưa có đơn nào (đã loại đơn hủy).</p>
            ) : (
              <div className={cn("mt-4 overflow-x-auto rounded-lg border", loading && "opacity-60")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={TABLE_HEAD_EMPHASIS}>Sàn</TableHead>
                      <TableHead className={cn(TABLE_HEAD_EMPHASIS, "text-right")}>Đơn</TableHead>
                      <TableHead className={cn(TABLE_HEAD_EMPHASIS, "text-right")}>Tiền hàng</TableHead>
                      <TableHead className={cn(TABLE_HEAD_EMPHASIS, "text-right")}>Giảm giá NB</TableHead>
                      <TableHead className={cn(TABLE_HEAD_EMPHASIS, "text-right")}>Hoàn trả</TableHead>
                      <TableHead className={cn(TABLE_HEAD_EMPHASIS, "text-right")}>Doanh thu tính thuế</TableHead>
                      <TableHead className={cn(TABLE_HEAD_EMPHASIS, "text-right")}>Sàn đã khấu trừ</TableHead>
                      <TableHead className={cn(TABLE_HEAD_EMPHASIS, "text-right")}>Chưa đối soát</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.channelName}>
                        <TableCell className="font-medium">{CHANNEL_LABEL[r.channelName]}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.orderCount}</TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={r.grossRevenue} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={r.sellerVoucher} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={r.refundedAmount} /></TableCell>
                        <TableCell className="text-right font-semibold tabular-nums"><Money value={r.taxableRevenue} /></TableCell>
                        <TableCell className="text-right font-semibold tabular-nums"><Money value={r.taxWithheldActual} /></TableCell>
                        <TableCell className={cn("text-right tabular-nums", r.unsettledCount > 0 && "text-amber-700")}>
                          {r.unsettledCount > 0 ? (
                            <>
                              {r.unsettledCount} đơn · <Money value={r.unsettledTaxableRevenue} />
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.rows.length > 1 && total ? (
                      <TableRow className="bg-slate-50/70 font-semibold">
                        <TableCell>Tổng</TableCell>
                        <TableCell className="text-right tabular-nums">{total.orderCount}</TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={total.grossRevenue} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={total.sellerVoucher} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={total.refundedAmount} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={total.taxableRevenue} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={total.taxWithheldActual} /></TableCell>
                        <TableCell className="text-right tabular-nums">
                          {total.unsettledCount > 0 ? (
                            <>
                              {total.unsettledCount} đơn · <Money value={total.unsettledTaxableRevenue} />
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            )}

            {data.truncated ? (
              <p className={cn(TEXT_SUB, "mt-2 flex items-center gap-1 text-amber-700")}>
                <AlertTriangle className="size-3.5" />
                Kỳ này vượt 20.000 đơn — số trên là cận dưới, chọn từng quý để lấy đủ.
              </p>
            ) : null}

            {/* ===== Ngưỡng 1 tỷ — lũy kế năm toàn shop ===== */}
            {annual ? (
              <div
                className={cn(
                  "mt-4 rounded-lg border px-4 py-3",
                  overThreshold
                    ? "border-amber-300 bg-amber-50/70"
                    : nearThreshold
                      ? "border-amber-200 bg-amber-50/40"
                      : "border-slate-200 bg-slate-50/60"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate-900">
                    Doanh thu tính thuế năm {annual.year} qua Hubsell:{" "}
                    <b className="tabular-nums">
                      <Money value={annual.taxableRevenueToDate} />
                    </b>{" "}
                    <span className={TEXT_SUB}>
                      / ngưỡng <Money value={annual.threshold} /> ({pct}%)
                    </span>
                    <HintIcon
                      className="ml-1 align-middle"
                      hint="Ngưỡng 1 tỷ/năm theo NĐ 68/2026 (sửa bởi NĐ 141/2026): hộ/cá nhân kinh doanh dưới mức này được miễn GTGT + TNCN và không bắt buộc hóa đơn điện tử. Số ở đây chỉ gồm đơn qua Hubsell — bán thêm ngoài sàn thì tự cộng vào. Doanh nghiệp bỏ qua khối này."
                    />
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      overThreshold
                        ? "bg-amber-200/70 text-amber-900"
                        : "bg-white text-slate-600 ring-1 ring-slate-200"
                    )}
                  >
                    {annual.tier.label}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      overThreshold ? "bg-amber-500" : nearThreshold ? "bg-amber-400" : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <p className={cn(TEXT_SUB, "mt-1.5")}>
                  {overThreshold
                    ? `Đã vượt 1 tỷ — ${annual.tier.obligation} Chưa có hóa đơn điện tử thì phải đăng ký trong 30 ngày kể từ khi vượt ngưỡng.`
                    : nearThreshold
                      ? `Sắp chạm ngưỡng 1 tỷ. Khi vượt: ${annual.tier.obligation.replace(/^Miễn.*?\. /, "")} — nên chuẩn bị kết nối hóa đơn điện tử từ bây giờ.`
                      : annual.tier.obligation}
                  {annual.truncated ? " (Số lũy kế là cận dưới vì năm vượt 20.000 đơn.)" : ""}
                </p>
              </div>
            ) : null}

            <p className={cn(TEXT_SUB, "mt-3")}>
              Kỳ cắt theo <b>ngày tạo đơn</b> giờ Việt Nam, cùng nguồn số với Báo cáo dòng tiền (báo cáo thuế
              của sàn cắt theo ngày hoàn thành nên có thể lệch vài đơn ở mép kỳ). Số sàn khấu trừ thật chỉ có ở
              đơn đã đối soát — kê khai sát hạn để đơn cuối kỳ kịp quyết toán. Nộp tờ khai trên eTax Mobile hoặc
              thuedientu.gdt.gov.vn.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
