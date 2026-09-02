"use client";

// ============================================================
// LỊCH THUẾ 2026–2027 (/admin/finance — tab "Lịch thuế"): bàn làm việc thuế
// của CHÍNH công ty Hubsell. Danh mục mốc là dữ liệu TĨNH trong file này
// (luật đổi thì sửa tay); trạng thái "đã xử lý" lưu BACKEND
// (/api/admin/finance/tax-checklist) để mọi người trong HQ cùng thấy.
// Căn cứ pháp lý:
//  - NQ 198/2025/QH15: bãi bỏ lệ phí môn bài từ 01/01/2026
//  - NĐ 252/2026/NĐ-CP (hiệu lực 01/07/2026): hạn khai quý = ngày cuối tháng
//    đầu quý sau; quyết toán năm = ngày cuối tháng thứ 3 sau kết thúc năm
//  - NĐ 125/2020/NĐ-CP: khung phạt chậm nộp tờ khai
// Kịch bản: hoạt động từ ~09/2026, năm tài chính = năm dương lịch, năm đầu
// kê khai GTGT/TNCN theo QUÝ (quyền mặc định của DN mới thành lập).
// Thuế NHÀ THẦU (trả Anthropic/Render/Supabase... hàng tháng) không có mốc
// ngày cố định trong năm đầu (10 ngày kể từ từng lần trả / ngày 20 tháng sau
// nếu đăng ký khai tháng) → nằm ở card riêng cuối trang + thủ tục một lần.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardCheck,
  RefreshCcw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import {
  fetchTaxChecklist,
  setTaxCheckItem,
  type TaxCheckItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { StatCard } from "./shared";

// ---------- Dữ liệu tĩnh ----------

/** Nhãn + màu chip phân loại nghĩa vụ (dark mode ăn theo remap thang slate). */
const KIND_META = {
  GTGT: { label: "GTGT", cls: "border-sky-200 bg-sky-50 text-sky-700" },
  TNCN: { label: "TNCN", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  TNDN: { label: "TNDN", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  BCTC: { label: "BCTC", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  LAODONG: { label: "Lao động", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  NOIBO: { label: "Nội bộ", cls: "border-slate-200 bg-slate-50 text-slate-600" },
} as const;

type Kind = keyof typeof KIND_META;

interface TaxEvent {
  /** Khóa lưu trạng thái backend — ĐỪNG đổi khi đã có dấu tick trên production */
  key: string;
  /** Hạn thực nộp dạng ISO yyyy-mm-dd (đã lùi khỏi ngày nghỉ nếu trùng) */
  due: string;
  /** Hạn gốc theo luật nếu khác hạn thực (trùng cuối tuần/lễ) */
  statutory?: string;
  /** Hạn thực còn là dự kiến (chờ lịch nghỉ lễ chính thức của năm đó) */
  tentative?: boolean;
  period: string;
  title: string;
  kinds: Kind[];
  note?: string;
  /** Hướng dẫn của kế toán trưởng: từng dòng = một gạch đầu dòng */
  guide: string[];
  /** Mốc trọng yếu — tô đậm */
  major?: boolean;
}

const QUARTER_GUIDE = [
  "Nộp trên thuedientu.gdt.gov.vn (đăng nhập bằng chữ ký số của công ty).",
  "Tờ khai GTGT mẫu 01/GTGT — kê đủ hóa đơn bán ra (Shopee/Lazada xuất cho khách) và mua vào của quý. Chưa có doanh thu vẫn phải nộp tờ khai trắng.",
  "Tờ khai TNCN mẫu 05/KK-TNCN — chỉ khi trong quý có trả lương và phát sinh khấu trừ; không trả lương thì không phải nộp tờ khai này.",
  "Thuế TNDN: TỰ TÍNH số tạm nộp rồi nộp tiền qua eTax, KHÔNG có tờ khai quý. Lãi thì tạm nộp ~20% lợi nhuận ước tính, lỗ thì thôi.",
  "Chuẩn bị trước ~1 tuần: chốt sổ hóa đơn, bảng lương, số liệu doanh thu từ Hubsell (Báo cáo dòng tiền + sổ quỹ HQ).",
];

const LABOR_GUIDE = [
  "Mẫu 01/PLI (NĐ 145/2020) — nộp online qua Cổng Dịch vụ công (dichvucong.gov.vn).",
  "Chỉ phát sinh khi công ty ĐÃ có lao động ký HĐLĐ; chưa thuê ai thì đánh dấu đã xử lý kèm ghi nhớ 'chưa có lao động'.",
];

const TAX_EVENTS: TaxEvent[] = [
  {
    key: "q3-2026",
    due: "2026-11-02",
    statutory: "2026-10-31",
    period: "Quý 3/2026",
    title: "Khai GTGT + TNCN quý 3/2026 · tạm nộp thuế TNDN quý 3",
    kinds: ["GTGT", "TNCN", "TNDN"],
    note: "Quý ĐẦU TIÊN của công ty (tính từ quý được cấp GPKD). Phải nộp tờ khai kể cả chưa phát sinh doanh thu.",
    guide: QUARTER_GUIDE,
  },
  {
    key: "lao-dong-2026",
    due: "2026-12-05",
    period: "Năm 2026",
    title: "Báo cáo tình hình sử dụng lao động năm 2026",
    kinds: ["LAODONG"],
    guide: LABOR_GUIDE,
  },
  {
    key: "q4-2026",
    due: "2027-02-01",
    statutory: "2027-01-31",
    period: "Quý 4/2026",
    title: "Khai GTGT + TNCN quý 4/2026 · tạm nộp thuế TNDN quý 4",
    kinds: ["GTGT", "TNCN", "TNDN"],
    note: "Tổng TNDN tạm nộp 4 quý phải ≥ 80% số phải nộp theo quyết toán năm — thiếu bị tính tiền chậm nộp trên phần chênh.",
    guide: QUARTER_GUIDE,
  },
  {
    key: "quyet-toan-2026",
    due: "2027-03-31",
    period: "Năm 2026",
    title: "BCTC 2026 + Quyết toán thuế TNDN 2026 + Quyết toán thuế TNCN 2026",
    kinds: ["BCTC", "TNDN", "TNCN"],
    note: "Hạn quan trọng nhất năm. Nộp nốt thuế TNDN còn thiếu theo quyết toán cùng hạn này.",
    major: true,
    guide: [
      "Bộ BCTC theo Thông tư 133 (DN nhỏ và vừa): Báo cáo tình hình tài chính, Kết quả kinh doanh, Thuyết minh — nộp qua thuedientu cùng hồ sơ quyết toán.",
      "Quyết toán TNDN mẫu 03/TNDN + phụ lục kết quả kinh doanh 03-1A.",
      "Quyết toán TNCN mẫu 05/QTT-TNCN + phụ lục từng người (05-1BK, 05-2BK) — kể cả chỉ trả lương vài tháng.",
      "Đây là việc NÊN THUÊ kế toán dịch vụ làm trọn gói năm đầu (~1-3tr) — em nhắc anh chốt đơn vị từ tháng 1/2027, đừng để sát hạn.",
      "Số liệu đầu vào: sổ quỹ HQ + Excel xuất từ tab Sổ quỹ + báo cáo P&L trong Hubsell.",
    ],
  },
  {
    key: "q1-2027",
    due: "2027-05-04",
    statutory: "2027-04-30",
    tentative: true,
    period: "Quý 1/2027",
    title: "Khai GTGT + TNCN quý 1/2027 · tạm nộp thuế TNDN quý 1",
    kinds: ["GTGT", "TNCN", "TNDN"],
    note: "Hạn gốc trùng dịp lễ 30/04–01/05, lùi sang ngày làm việc kế tiếp.",
    guide: QUARTER_GUIDE,
  },
  {
    key: "lao-dong-6t-2027",
    due: "2027-06-05",
    period: "6 tháng đầu 2027",
    title: "Báo cáo tình hình sử dụng lao động 6 tháng đầu năm 2027",
    kinds: ["LAODONG"],
    guide: LABOR_GUIDE,
  },
  {
    key: "q2-2027",
    due: "2027-08-02",
    statutory: "2027-07-31",
    period: "Quý 2/2027",
    title: "Khai GTGT + TNCN quý 2/2027 · tạm nộp thuế TNDN quý 2",
    kinds: ["GTGT", "TNCN", "TNDN"],
    guide: QUARTER_GUIDE,
  },
  {
    key: "q3-2027",
    due: "2027-11-01",
    statutory: "2027-10-31",
    period: "Quý 3/2027",
    title: "Khai GTGT + TNCN quý 3/2027 · tạm nộp thuế TNDN quý 3",
    kinds: ["GTGT", "TNCN", "TNDN"],
    guide: QUARTER_GUIDE,
  },
  {
    key: "lao-dong-2027",
    due: "2027-12-05",
    period: "Năm 2027",
    title: "Báo cáo tình hình sử dụng lao động năm 2027",
    kinds: ["LAODONG"],
    guide: LABOR_GUIDE,
  },
  {
    key: "chot-doanh-thu-2027",
    due: "2027-12-31",
    period: "Năm 2027",
    title: "Chốt doanh thu 2027 → xác định kỳ kê khai năm 2028",
    kinds: ["NOIBO"],
    note: "Doanh thu năm dương lịch đủ 12 tháng ≤ 50 tỷ → tiếp tục khai theo quý; > 50 tỷ → chuyển khai theo tháng (hạn ngày 20 tháng sau).",
    guide: [
      "Việc nội bộ, không phải nộp gì cho cơ quan thuế — chỉ cần chốt số và ghi nhớ kỳ kê khai 2028.",
      "Lấy doanh thu từ chỉ tiêu trên tờ khai GTGT cả năm (không phải GMV sàn).",
    ],
  },
  {
    key: "q4-2027",
    due: "2028-01-31",
    period: "Quý 4/2027",
    title: "Khai GTGT + TNCN quý 4/2027 · tạm nộp thuế TNDN quý 4",
    kinds: ["GTGT", "TNCN", "TNDN"],
    guide: QUARTER_GUIDE,
  },
  {
    key: "quyet-toan-2027",
    due: "2028-03-31",
    period: "Năm 2027",
    title: "BCTC 2027 + Quyết toán thuế TNDN 2027 + Quyết toán thuế TNCN 2027",
    kinds: ["BCTC", "TNDN", "TNCN"],
    major: true,
    guide: [
      "Bộ hồ sơ giống quyết toán 2026 — đến đây công ty đã có tròn 1 năm số liệu, làm sớm từ tháng 1-2/2028.",
    ],
  },
];

/** Thủ tục MỘT LẦN sau khi có GPKD — mốc tính theo ngày cấp nên ghi tương đối. */
const ONE_TIME_STEPS: {
  key: string;
  when: string;
  title: string;
  note?: string;
}[] = [
  {
    key: "gpkd-dau-bien-cks",
    when: "Ngay khi có GPKD",
    title: "Khắc dấu, treo biển hiệu, mua chữ ký số",
    note: "Chữ ký số là điều kiện để khai thuế điện tử và ký hóa đơn — mua trước, mọi bước sau đều cần.",
  },
  {
    key: "gpkd-khai-thue-ban-dau",
    when: "Trong 10 ngày",
    title: "Hồ sơ khai thuế ban đầu tại cơ quan thuế quản lý",
    note: "Đăng ký hình thức kế toán (TT133), phương pháp khấu hao TSCĐ, tài khoản thuedientu.gdt.gov.vn.",
  },
  {
    key: "gpkd-hddt",
    when: "Trước hóa đơn đầu tiên",
    title: "Đăng ký sử dụng hóa đơn điện tử (Mẫu 01/ĐKTĐ-HĐĐT)",
    note: "Đăng ký qua meInvoice/NCC hóa đơn, cơ quan thuế chấp thuận mới xuất được hóa đơn.",
  },
  {
    key: "gpkd-gop-von",
    when: "Trong 90 ngày",
    title: "Góp đủ vốn điều lệ đã đăng ký",
    note: "Chuyển khoản từ tài khoản cá nhân vào TK công ty, ghi rõ nội dung góp vốn. Góp thiếu ảnh hưởng trần chi phí lãi vay được trừ.",
  },
  {
    key: "gpkd-lao-dong-bhxh",
    when: "Khi có nhân viên",
    title: "Khai trình sử dụng lao động + đăng ký BHXH trong 30 ngày kể từ ký HĐLĐ",
    note: "Từ đó phát sinh nghĩa vụ hằng tháng: BHXH + kinh phí công đoàn 2%.",
  },
  {
    key: "gpkd-nha-thau-lan-dau",
    when: "Lần đầu trả tiền NCC nước ngoài",
    title: "Khai thuế nhà thầu lần đầu (Anthropic, Render, Supabase, Vercel…)",
    note: "Tờ khai 01/NTNN trên eTax trong 10 NGÀY kể từ ngày thanh toán. Trả đều hàng tháng → nhân dịp này đăng ký khai THEO THÁNG cho đỡ vụn (chi tiết ở card Thuế nhà thầu cuối trang).",
  },
  {
    key: "gpkd-billing-mst",
    when: "Trước kỳ thanh toán tới",
    title: "Sửa billing các NCC ngoại về tên công ty + MST + thẻ công ty",
    note: "Invoice Stripe/Anthropic đứng tên cá nhân là chi phí bị loại khi quyết toán — sửa trong trang Billing của từng dịch vụ, một lần là xong.",
  },
];

// ---------- Helpers ----------

const WEEKDAY = ["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDue(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function formatDoneAt(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function daysUntil(iso: string, todayIso: string): number {
  return Math.round(
    (parseIso(iso).getTime() - parseIso(todayIso).getTime()) / 86_400_000
  );
}

type DueStatus = "done" | "overdue" | "soon" | "future";

const STATUS_META: Record<
  DueStatus,
  { chipCls: string; dotCls: string }
> = {
  done: {
    chipCls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dotCls: "border-emerald-500 bg-emerald-500",
  },
  overdue: {
    chipCls: "border-rose-200 bg-rose-50 text-rose-700",
    dotCls: "border-rose-500 bg-rose-500",
  },
  soon: {
    chipCls: "border-amber-200 bg-amber-50 text-amber-700",
    dotCls: "border-amber-500 bg-amber-100",
  },
  future: {
    chipCls: "border-slate-200 bg-slate-50 text-slate-500",
    dotCls: "border-slate-300 bg-card",
  },
};

function eventStatus(due: string, done: boolean, todayIso: string): DueStatus {
  if (done) return "done";
  const diff = daysUntil(due, todayIso);
  if (diff < 0) return "overdue";
  return diff <= 30 ? "soon" : "future";
}

function statusLabel(st: DueStatus, due: string, todayIso: string): string {
  if (st === "done") return "✓ Đã xử lý";
  if (st === "overdue") return "QUÁ HẠN";
  const diff = daysUntil(due, todayIso);
  if (diff === 0) return "HẠN HÔM NAY";
  if (st === "soon") return `Cận hạn · còn ${diff} ngày`;
  return `Sắp tới · còn ${diff} ngày`;
}

// ---------- Component ----------

export function TaxCalendarSection() {
  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  // Trạng thái checklist từ backend: Map itemKey → {doneAt, doneByName}
  const [checks, setChecks] = useState<Map<string, TaxCheckItem>>(new Map());
  const [checksReady, setChecksReady] = useState(false);
  const [checksError, setChecksError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchTaxChecklist()
      .then((res) => {
        if (!alive) return;
        setChecks(new Map(res.items.map((i) => [i.itemKey, i])));
        setChecksReady(true);
      })
      .catch(() => {
        if (alive) setChecksError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(
    async (itemKey: string) => {
      const wasDone = checks.has(itemKey);
      setSaving(itemKey);
      try {
        const res = await setTaxCheckItem(itemKey, !wasDone);
        setChecks((prev) => {
          const next = new Map(prev);
          if (res.item) next.set(itemKey, res.item);
          else next.delete(itemKey);
          return next;
        });
      } catch {
        toast.error("Không lưu được trạng thái — thử lại sau");
      } finally {
        setSaving(null);
      }
    },
    [checks]
  );

  // Số liệu tổng quan
  const next = TAX_EVENTS.find((e) => !checks.has(e.key) && e.due >= todayIso);
  const doneEvents = TAX_EVENTS.filter((e) => checks.has(e.key)).length;
  const overdueCount = TAX_EVENTS.filter(
    (e) => !checks.has(e.key) && e.due < todayIso
  ).length;
  const doneSteps = ONE_TIME_STEPS.filter((s) => checks.has(s.key)).length;

  // Gom mốc theo năm để vẽ timeline
  const byYear = useMemo(() => {
    const groups = new Map<string, TaxEvent[]>();
    for (const e of TAX_EVENTS) {
      const y = e.due.slice(0, 4);
      const arr = groups.get(y) ?? [];
      arr.push(e);
      groups.set(y, arr);
    }
    return [...groups.entries()];
  }, []);

  const interactable = checksReady && !checksError;

  return (
    <div className="space-y-8">
      {checksError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Không tải được trạng thái checklist — lịch vẫn xem được, nút đánh dấu
          tạm khóa. Bấm tải lại trang để thử lại.
        </div>
      )}

      {/* ===== Hàng KPI ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Mốc kế tiếp"
          value={next ? formatDue(next.due) : "Đã xong 2026–2027"}
          hint={
            next
              ? `Còn ${daysUntil(next.due, todayIso)} ngày — ${next.period}`
              : "Toàn bộ mốc đã được đánh dấu xử lý"
          }
        />
        <StatCard
          label="Mốc cố định đã xử lý"
          value={`${doneEvents}/${TAX_EVENTS.length}`}
          hint="Khai quý, quyết toán năm, báo cáo lao động"
        />
        <StatCard
          label="Quá hạn chưa xử lý"
          value={String(overdueCount)}
          hint={
            overdueCount > 0
              ? "Xử lý ngay — phạt chậm tờ khai tới 25tr"
              : "Không có mốc nào bị bỏ lỡ"
          }
        />
        <StatCard
          label="Thủ tục sau GPKD"
          value={`${doneSteps}/${ONE_TIME_STEPS.length}`}
          hint="Việc một lần khi công ty bắt đầu hoạt động"
        />
      </div>

      {/* ===== Bối cảnh pháp lý ===== */}
      <Card size="sm">
        <CardContent className="flex gap-3">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">
              Kịch bản áp dụng:
            </span>{" "}
            công ty hoạt động từ ~09/2026, năm tài chính theo năm dương lịch,
            năm đầu kê khai GTGT/TNCN theo <b>quý</b> (quyền mặc định của doanh
            nghiệp mới). Lệ phí môn bài đã <b>bãi bỏ từ 01/01/2026</b> (NQ
            198/2025/QH15) — không phải khai, không phải nộp. Thời hạn theo NĐ
            252/2026/NĐ-CP; hạn trùng ngày nghỉ tự lùi sang ngày làm việc kế
            tiếp. Riêng <b>thuế nhà thầu</b> (trả Anthropic/Render/Supabase…
            hàng tháng) không có ngày cố định — hạn bám theo từng lần thanh
            toán, xem card cuối trang. Dấu tick lưu chung cho cả HQ — ai xử lý
            xong thì đánh dấu, người khác nhìn vào biết ngay.
          </p>
        </CardContent>
      </Card>

      {/* ===== Thủ tục một lần sau GPKD ===== */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          Thủ tục một lần sau khi có GPKD
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
            {doneSteps}/{ONE_TIME_STEPS.length}
          </span>
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          {ONE_TIME_STEPS.map((s) => {
            const check = checks.get(s.key);
            return (
              <Card
                key={s.key}
                size="sm"
                className={cn(
                  check && "border-emerald-200/80 bg-emerald-50/40"
                )}
              >
                <CardContent className="flex items-start gap-3">
                  <button
                    type="button"
                    disabled={!interactable || saving === s.key}
                    onClick={() => toggle(s.key)}
                    title={check ? "Bỏ đánh dấu" : "Đánh dấu đã xử lý"}
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      check
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-slate-300 bg-card text-transparent hover:border-emerald-400",
                      (!interactable || saving === s.key) &&
                        "cursor-not-allowed opacity-50"
                    )}
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {s.when}
                      </span>
                      {check && (
                        <span className="text-[11px] text-emerald-700">
                          ✓ {check.doneByName} · {formatDoneAt(check.doneAt)}
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-sm font-medium",
                        check && "text-muted-foreground line-through decoration-emerald-400/60"
                      )}
                    >
                      {s.title}
                    </p>
                    {s.note && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {s.note}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ===== Timeline mốc cố định theo năm ===== */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Mốc khai &amp; nộp cố định
          <span className="text-xs font-normal text-muted-foreground">
            2026 → quyết toán năm 2027
          </span>
        </h3>

        <div className="space-y-6">
          {byYear.map(([year, events]) => (
            <div key={year}>
              <div className="mb-3 flex items-center gap-3">
                <span className="rounded-lg bg-primary px-2.5 py-1 text-sm font-bold tabular-nums text-primary-foreground shadow-sm">
                  {year}
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <div className="relative ml-3 space-y-3 border-l-2 border-slate-200 pl-6">
                {events.map((e) => {
                  const check = checks.get(e.key);
                  const st = eventStatus(e.due, Boolean(check), todayIso);
                  const meta = STATUS_META[st];
                  const isOpen = expanded === e.key;
                  return (
                    <div key={e.key} className="relative">
                      {/* chấm timeline */}
                      <span
                        className={cn(
                          "absolute -left-[31px] top-5 h-3 w-3 rounded-full border-2",
                          meta.dotCls
                        )}
                      />
                      <Card
                        className={cn(
                          st === "overdue" && "border-rose-300/80",
                          st === "done" && "border-emerald-200/80 bg-emerald-50/30",
                          e.major && st !== "done" && "border-slate-300"
                        )}
                      >
                        <CardContent className="space-y-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            {/* Ngày + kỳ */}
                            <div className="min-w-32">
                              <p
                                className={cn(
                                  "text-lg font-bold tabular-nums tracking-tight",
                                  st === "overdue" && "text-rose-600"
                                )}
                              >
                                {formatDue(e.due)}
                                {e.tentative && (
                                  <span className="ml-1 align-middle text-[11px] font-normal text-muted-foreground">
                                    (dự kiến)
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {WEEKDAY[parseIso(e.due).getDay()]} · {e.period}
                                {e.statutory &&
                                  ` · hạn gốc ${formatDue(e.statutory)}`}
                              </p>
                            </div>

                            {/* Trạng thái + nút hành động */}
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                  meta.chipCls
                                )}
                              >
                                {statusLabel(st, e.due, todayIso)}
                              </span>
                              <button
                                type="button"
                                disabled={!interactable || saving === e.key}
                                onClick={() => toggle(e.key)}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                                  check
                                    ? "border-slate-200 bg-card text-slate-500 hover:bg-slate-50"
                                    : "border-slate-200 bg-card text-slate-600 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700",
                                  (!interactable || saving === e.key) &&
                                    "cursor-not-allowed opacity-50"
                                )}
                              >
                                {check ? (
                                  <>
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Hoàn tác
                                  </>
                                ) : (
                                  <>
                                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                    Đánh dấu đã xử lý
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Tiêu đề + chip loại */}
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {e.kinds.map((k) => (
                                <span
                                  key={k}
                                  className={cn(
                                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
                                    KIND_META[k].cls
                                  )}
                                >
                                  {KIND_META[k].label}
                                </span>
                              ))}
                            </div>
                            <p
                              className={cn(
                                "mt-1.5 text-sm",
                                e.major ? "font-semibold" : "font-medium",
                                st === "done" && "text-muted-foreground"
                              )}
                            >
                              {e.title}
                            </p>
                            {e.note && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {e.note}
                              </p>
                            )}
                            {check && (
                              <p className="mt-1 text-xs text-emerald-700">
                                ✓ {check.doneByName} đánh dấu ngày{" "}
                                {formatDoneAt(check.doneAt)}
                              </p>
                            )}
                          </div>

                          {/* Hướng dẫn của kế toán trưởng */}
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded(isOpen ? null : e.key)
                              }
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                            >
                              <BookOpenText className="h-3.5 w-3.5" />
                              Hướng dẫn thực hiện
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5 transition-transform",
                                  isOpen && "rotate-180"
                                )}
                              />
                            </button>
                            {isOpen && (
                              <ul className="mt-2 list-disc space-y-1 rounded-lg border border-slate-200/80 bg-slate-50/60 py-2.5 pl-7 pr-3 text-xs leading-relaxed text-slate-600">
                                {e.guide.map((g) => (
                                  <li key={g}>{g}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Thuế nhà thầu — nghĩa vụ tháng nào cũng phát sinh ===== */}
      <Card size="sm" className="border-sky-200/80">
        <CardContent>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <RefreshCcw className="h-4 w-4 text-sky-600" />
            Thuế nhà thầu — nộp thay NCC nước ngoài (Claude, Render, Supabase…)
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-slate-600">
            <li>
              Phát sinh <b>mỗi lần công ty trả tiền dịch vụ cho NCC nước ngoài</b>{" "}
              — với Hubsell là hàng tháng (AI, server, domain). Đây là nghĩa vụ
              lặp lớn nhất KHÔNG có mốc cố định trên timeline ở trên.
            </li>
            <li>
              Mức kê phổ biến cho SaaS: <b>5% GTGT + 5% TNDN</b> theo diện dịch
              vụ. Mình chịu thuế thay (NCC nhận đủ tiền) nên phải gross-up:{" "}
              <b>doanh thu tính thuế = số tiền đã trả ÷ 0,95 ÷ 0,95</b>. Ví dụ
              trả 2.600.000₫ (gói Max $100) → nộp thay ≈ <b>288.000₫</b> (144k
              GTGT + 144k TNDN).
            </li>
            <li>
              Hạn nộp tờ khai 01/NTNN + tiền thuế: <b>10 ngày</b> kể từ ngày
              thanh toán (khai từng lần). Trả đều hàng tháng → đăng ký khai{" "}
              <b>theo tháng</b>, hạn <b>ngày 20 tháng sau</b> — gom mọi NCC vào
              một tờ khai.
            </li>
            <li>
              Doanh thu bán gói Hubsell thuộc diện không chịu GTGT → phần GTGT
              nộp thay <b>không được khấu trừ</b>, hạch toán hết vào chi phí.
            </li>
            <li>
              Bộ chứng từ mỗi tháng: invoice PDF của NCC + chứng từ chuyển tiền
              + giấy nộp thuế eTax — lưu cùng thư mục với phiếu chi khoản mục
              &ldquo;Phần mềm &amp; hạ tầng&rdquo; bên tab Sổ quỹ.
            </li>
            <li className="text-slate-500">
              ⚠️ Có trường phái coi phí bản quyền phần mềm là 10% TNDN + miễn
              GTGT — số tiền nhỏ nên chênh lệch không đáng kể; khi thuê kế toán
              dịch vụ nhờ họ chốt lại một lần.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* ===== Nghĩa vụ lặp + lời dặn ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardContent>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <RefreshCcw className="h-4 w-4 text-muted-foreground" />
              Nghĩa vụ lặp hằng tháng
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-slate-600">
              <li>
                Thuế nhà thầu (nếu đã đăng ký khai theo tháng): tờ khai + tiền
                chậm nhất <b>ngày 20 tháng sau</b> — xem card phía trên.
              </li>
              <li>
                Khi có lao động — đóng BHXH, BHYT, BHTN: chậm nhất{" "}
                <b>ngày cuối cùng của tháng</b>.
              </li>
              <li>
                Kinh phí công đoàn 2% quỹ lương đóng BHXH: cùng hạn với BHXH —
                phải đóng kể cả chưa có công đoàn cơ sở.
              </li>
              <li>
                Hóa đơn điện tử có mã: dữ liệu tự gửi cơ quan thuế —{" "}
                <b>không</b> còn báo cáo tình hình sử dụng hóa đơn định kỳ.
              </li>
              <li>
                Năm đầu không có nghĩa vụ khai GTGT/TNCN theo tháng (đã chọn kỳ
                quý).
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Trễ hạn mất bao nhiêu tiền? (NĐ 125/2020)
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-slate-600">
              <li>
                Chậm nộp tờ khai 1–30 ngày: phạt <b>2–5 triệu</b>; 31–60 ngày:
                5–8 triệu; trên 90 ngày: tới <b>15–25 triệu</b>.
              </li>
              <li>
                Chậm nộp tiền thuế: <b>0,03%/ngày</b> trên số tiền chậm — tính
                từng ngày, không có ân hạn.
              </li>
              <li>
                Nguyên tắc của em: chuẩn bị hồ sơ trước hạn <b>1 tuần</b>, nộp
                trước hạn 2–3 ngày để còn đường sửa nếu eTax báo lỗi.
              </li>
              <li>
                Năm đầu nên thuê kế toán dịch vụ làm quyết toán; anh chỉ cần giữ
                nếp: mỗi khoản thu xuất hóa đơn + cuối tháng xuất Excel sổ quỹ.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
