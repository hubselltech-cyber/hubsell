"use client";

// ============================================================
// LỊCH THUẾ 2026–2027 (/admin/finance — tab "Lịch thuế"): lịch khai/nộp thuế
// và báo cáo định kỳ của CHÍNH công ty Hubsell, dữ liệu TĨNH biên soạn theo:
//  - NQ 198/2025/QH15: bãi bỏ lệ phí môn bài từ 01/01/2026
//  - NĐ 252/2026/NĐ-CP (hiệu lực 01/07/2026): hạn khai quý = ngày cuối tháng
//    đầu quý sau; quyết toán năm = ngày cuối tháng thứ 3 sau kết thúc năm
// Kịch bản: công ty hoạt động từ ~09/2026, năm tài chính = năm dương lịch,
// năm đầu kê khai GTGT/TNCN theo QUÝ (quyền mặc định của DN mới thành lập).
// Luật thuế đổi thì sửa tay dữ liệu trong file này.
// ============================================================

import { CalendarClock, ClipboardCheck, RefreshCcw } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- Dữ liệu tĩnh ----------

interface TaxEvent {
  /** Hạn thực nộp dạng ISO yyyy-mm-dd (đã lùi khỏi ngày nghỉ nếu trùng) */
  due: string;
  /** Hạn gốc theo luật nếu khác hạn thực (trùng cuối tuần/lễ) */
  statutory?: string;
  /** Hạn thực còn là dự kiến (chờ lịch nghỉ lễ chính thức của năm đó) */
  tentative?: boolean;
  period: string;
  title: string;
  note?: string;
  /** Mốc trọng yếu — tô đậm trong bảng */
  major?: boolean;
}

const TAX_EVENTS: TaxEvent[] = [
  {
    due: "2026-11-02",
    statutory: "2026-10-31",
    period: "Quý 3/2026",
    title: "Tờ khai GTGT + TNCN quý 3/2026 · tạm nộp thuế TNDN quý 3",
    note: "Quý đầu tiên tính từ quý được cấp GPKD. Phải nộp tờ khai kể cả chưa phát sinh doanh thu (tờ khai trắng). TNDN tạm nộp không cần tờ khai riêng.",
  },
  {
    due: "2026-12-05",
    period: "Năm 2026",
    title: "Báo cáo tình hình sử dụng lao động năm 2026",
    note: "Chỉ phát sinh khi đã có lao động; nộp qua Cổng dịch vụ công (NĐ 145/2020).",
  },
  {
    due: "2027-02-01",
    statutory: "2027-01-31",
    period: "Quý 4/2026",
    title: "Tờ khai GTGT + TNCN quý 4/2026 · tạm nộp thuế TNDN quý 4",
    note: "Tổng TNDN tạm nộp 4 quý phải ≥ 80% số phải nộp theo quyết toán năm, thiếu bị tính tiền chậm nộp trên phần chênh.",
  },
  {
    due: "2027-03-31",
    period: "Năm 2026",
    title:
      "Báo cáo tài chính 2026 + Quyết toán thuế TNDN 2026 + Quyết toán thuế TNCN 2026",
    note: "Hạn quan trọng nhất năm. Nộp nốt thuế TNDN còn thiếu theo quyết toán cùng hạn này.",
    major: true,
  },
  {
    due: "2027-05-04",
    statutory: "2027-04-30",
    tentative: true,
    period: "Quý 1/2027",
    title: "Tờ khai GTGT + TNCN quý 1/2027 · tạm nộp thuế TNDN quý 1",
    note: "Hạn gốc trùng dịp lễ 30/04–01/05, lùi sang ngày làm việc kế tiếp.",
  },
  {
    due: "2027-06-05",
    period: "6 tháng đầu 2027",
    title: "Báo cáo tình hình sử dụng lao động 6 tháng đầu năm 2027",
  },
  {
    due: "2027-08-02",
    statutory: "2027-07-31",
    period: "Quý 2/2027",
    title: "Tờ khai GTGT + TNCN quý 2/2027 · tạm nộp thuế TNDN quý 2",
  },
  {
    due: "2027-11-01",
    statutory: "2027-10-31",
    period: "Quý 3/2027",
    title: "Tờ khai GTGT + TNCN quý 3/2027 · tạm nộp thuế TNDN quý 3",
  },
  {
    due: "2027-12-05",
    period: "Năm 2027",
    title: "Báo cáo tình hình sử dụng lao động năm 2027",
  },
  {
    due: "2027-12-31",
    period: "Năm 2027",
    title: "Chốt doanh thu 2027 để xác định kỳ kê khai năm 2028",
    note: "Doanh thu năm dương lịch đủ 12 tháng ≤ 50 tỷ → tiếp tục khai theo quý; > 50 tỷ → chuyển khai theo tháng (hạn ngày 20 tháng sau).",
  },
  {
    due: "2028-01-31",
    period: "Quý 4/2027",
    title: "Tờ khai GTGT + TNCN quý 4/2027 · tạm nộp thuế TNDN quý 4",
  },
  {
    due: "2028-03-31",
    period: "Năm 2027",
    title:
      "Báo cáo tài chính 2027 + Quyết toán thuế TNDN 2027 + Quyết toán thuế TNCN 2027",
    major: true,
  },
];

/** Thủ tục MỘT LẦN sau khi có GPKD — mốc tính theo ngày cấp nên chỉ ghi tương đối */
const ONE_TIME_STEPS: { when: string; title: string; note?: string }[] = [
  {
    when: "Ngay khi có GPKD",
    title: "Khắc dấu, treo biển hiệu, mua chữ ký số",
    note: "Chữ ký số là điều kiện để khai thuế điện tử và ký hóa đơn.",
  },
  {
    when: "Trong 10 ngày",
    title: "Hồ sơ khai thuế ban đầu tại cơ quan thuế quản lý",
    note: "Đăng ký hình thức kế toán, phương pháp khấu hao TSCĐ, tài khoản thuedientu.gdt.gov.vn.",
  },
  {
    when: "Trước hóa đơn đầu tiên",
    title: "Đăng ký sử dụng hóa đơn điện tử (Mẫu 01/ĐKTĐ-HĐĐT)",
    note: "Được cơ quan thuế chấp thuận mới xuất được hóa đơn.",
  },
  {
    when: "Trong 90 ngày",
    title: "Góp đủ vốn điều lệ đã đăng ký",
    note: "Góp thiếu ảnh hưởng trần chi phí lãi vay được trừ khi tính thuế TNDN.",
  },
  {
    when: "Khi có nhân viên",
    title: "Khai trình sử dụng lao động + đăng ký BHXH trong 30 ngày kể từ ký HĐLĐ",
  },
];

// ---------- Helpers ----------

const DATE_FMT = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDue(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return DATE_FMT.format(new Date(y, m - 1, d));
}

type DueStatus = "past" | "soon" | "future";

function dueStatus(iso: string, today: string): DueStatus {
  if (iso < today) return "past";
  const [y, m, d] = iso.split("-").map(Number);
  const diffDays =
    (new Date(y, m - 1, d).getTime() - new Date(`${today}T00:00:00`).getTime()) /
    86_400_000;
  return diffDays <= 30 ? "soon" : "future";
}

const STATUS_META: Record<DueStatus, { label: string; cls: string }> = {
  past: { label: "Đã qua", cls: "border-slate-200 bg-slate-50 text-slate-500" },
  soon: { label: "≤ 30 ngày", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  future: { label: "Sắp tới", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

// ---------- Component ----------

export function TaxCalendarSection() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const next = TAX_EVENTS.find((e) => e.due >= today);

  return (
    <div className="space-y-6">
      {/* Bối cảnh + mốc kế tiếp */}
      <Card size="sm">
        <CardContent className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            Lịch thủ tục thuế 2026–2027 của công ty Hubsell
          </p>
          <p className="text-xs text-muted-foreground">
            Kịch bản: hoạt động từ ~09/2026, năm tài chính theo năm dương lịch,
            năm đầu kê khai GTGT/TNCN theo <b>quý</b> (quyền mặc định của doanh
            nghiệp mới). Lệ phí môn bài đã <b>bãi bỏ từ 01/01/2026</b> (NQ
            198/2025/QH15) — không phải khai, không phải nộp. Thời hạn theo NĐ
            252/2026/NĐ-CP; hạn trùng ngày nghỉ tự lùi sang ngày làm việc kế
            tiếp.
          </p>
          {next && (
            <p className="text-xs">
              <span className="font-semibold text-amber-700">Mốc kế tiếp:</span>{" "}
              {formatDue(next.due)} — {next.title}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Thủ tục một lần sau GPKD */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          Thủ tục một lần sau khi có GPKD
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {ONE_TIME_STEPS.map((s) => (
            <Card key={s.title} size="sm">
              <CardContent className="space-y-1">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {s.when}
                </span>
                <p className="text-sm font-medium">{s.title}</p>
                {s.note && (
                  <p className="text-xs text-muted-foreground">{s.note}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Lịch mốc cố định */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Mốc khai &amp; nộp cố định (2026 → quyết toán 2027)
        </p>
        <Card size="sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Hạn chót</TableHead>
                  <TableHead className="w-32">Kỳ</TableHead>
                  <TableHead>Việc phải làm</TableHead>
                  <TableHead className="w-28">Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TAX_EVENTS.map((e) => {
                  const st = dueStatus(e.due, today);
                  return (
                    <TableRow
                      key={`${e.due}-${e.title}`}
                      className={cn(st === "past" && "opacity-60")}
                    >
                      <TableCell className="align-top">
                        <p
                          className={cn(
                            "text-sm tabular-nums",
                            e.major ? "font-bold" : "font-semibold"
                          )}
                        >
                          {formatDue(e.due)}
                          {e.tentative && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              (dự kiến)
                            </span>
                          )}
                        </p>
                        {e.statutory && (
                          <p className="text-xs text-muted-foreground">
                            hạn gốc {formatDue(e.statutory)} trùng ngày nghỉ
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm text-slate-600">
                        {e.period}
                      </TableCell>
                      <TableCell className="align-top">
                        <p
                          className={cn(
                            "text-sm",
                            e.major && "font-semibold"
                          )}
                        >
                          {e.title}
                        </p>
                        {e.note && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {e.note}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATUS_META[st].cls
                          )}
                        >
                          {STATUS_META[st].label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Nghĩa vụ lặp hằng tháng */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <RefreshCcw className="h-4 w-4 text-muted-foreground" />
          Nghĩa vụ lặp hằng tháng (khi có lao động)
        </p>
        <Card size="sm">
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>
                Đóng BHXH, BHYT, BHTN: chậm nhất <b>ngày cuối cùng của tháng</b>.
              </li>
              <li>
                Kinh phí công đoàn 2% quỹ lương đóng BHXH: cùng hạn với BHXH
                (phải đóng kể cả chưa có công đoàn cơ sở).
              </li>
              <li>
                Hóa đơn điện tử có mã: dữ liệu gửi cơ quan thuế tự động —{" "}
                <b>không</b> còn báo cáo tình hình sử dụng hóa đơn định kỳ.
              </li>
              <li>
                Năm đầu không có nghĩa vụ khai thuế theo tháng (đã chọn kỳ quý);
                chỉ chuyển sang tháng nếu doanh thu năm dương lịch đủ 12 tháng
                vượt 50 tỷ.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
