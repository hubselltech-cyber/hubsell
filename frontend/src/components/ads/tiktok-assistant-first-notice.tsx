"use client";

// ============================================================
// HỘP CẢNH BÁO LẦN ĐẦU VÀO CHI TIẾT CHIẾN DỊCH GMV MAX (anh Trung 25/10/2026)
//
// Khách bật Trợ lý tự loại video rồi thấy TỔNG SỐ ĐƠN giảm là hoảng, tắt máy
// hoặc khôi phục video — trong khi đó chính là việc máy phải làm: video lỗ
// (ROI < ROI hòa vốn) vẫn ra đơn, nhưng mỗi đơn ấy tốn tiền ads hơn lãi thu
// về. Hộp này nói trước điều đó MỘT LẦN, ngay khi khách lần đầu mở trang chi
// tiết chiến dịch (nơi đặt Diễn tập / Tự loại thật), để kỳ vọng đúng từ đầu.
//
// Luật:
// - Chỉ CHỦ SHOP thấy (người duy nhất cấu hình được Trợ lý); nhân viên chỉ xem
//   bảng, không cần đọc.
// - Ô tích "Không hiện lại" = thôi hẳn, nhớ theo tài khoản trên trình duyệt này
//   (cùng kiểu MissingCostPrompt; app chưa có chỗ lưu tùy chọn giao diện ở
//   server). KHÔNG tích mà bấm "Đã hiểu" / X / Esc → lần sau mở trang chiến
//   dịch (chiến dịch nào cũng vậy) hộp lại hiện. Anh Trung 25/10 tối: bản đầu
//   có thêm lớp sessionStorage "lượt này thôi hỏi" → bấm X xong sang chiến
//   dịch khác không thấy nữa, anh tưởng hỏng → đã bỏ, chỉ ô tích mới tắt.
// - NOTICE_VERSION: đổi khi nội dung đổi lớn → khách đã tắt bản cũ thấy bản mới.
// - Một nút duy nhất ("Khách cần đơn giản"); số ROI hòa vốn lấy từ chính chiến
//   dịch đang mở để câu chữ gắn với số khách nhìn thấy trên trang.
//
// Giao diện (anh Trung 25/10: "đẹp hơn, chuẩn đời mới hơn"): dải đầu có ô icon
// + tiêu đề lớn; một BIỂU ĐỒ MINH HỌA (SVG tĩnh, không phải số thật — đường
// "Số đơn" võng xuống rồi hồi, đường "Lợi nhuận" đi lên từ đầu, vạch "~1 tháng"
// chia hai giai đoạn) để khách nhìn 2 giây là hiểu; hai thẻ giai đoạn đánh số;
// chân hộp tách nền. Màu chỉ dùng thang chuẩn (slate / emerald-500 / red-500 /
// tint amber) nên giao diện tối tự chạy.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";

import { formatRoi } from "@/components/ads/tiktok-ads-format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getStoredUser, type TiktokAdsBreakeven } from "@/lib/api";
import { cn } from "@/lib/utils";

const NOTICE_VERSION = "2026-10";
const DISMISS_PREFIX = "hubsell_tiktok_assistant_notice_dismissed:";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_PREFIX + (getStoredUser()?.id ?? "")) === NOTICE_VERSION;
  } catch {
    return false;
  }
}

function dismissForGood() {
  try {
    localStorage.setItem(DISMISS_PREFIX + (getStoredUser()?.id ?? ""), NOTICE_VERSION);
  } catch {
    // chế độ riêng tư chặn storage — lần sau hộp lại hiện, chấp nhận
  }
}

/**
 * Biểu đồ MINH HỌA hai giai đoạn — không phải số thật. Đường Số đơn (xám) võng
 * xuống trong vài tuần đầu rồi dần hồi; đường Lợi nhuận (xanh) đi lên ngay từ
 * đầu. Màu lấy qua currentColor của class Tailwind nên tự đổi theo sáng/tối.
 */
function ExpectationChart() {
  return (
    <svg viewBox="0 0 320 100" className="block h-auto w-full md:h-full" aria-hidden>
      <defs>
        <linearGradient id="tiktok-notice-profit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* lưới mờ */}
      <g className="text-slate-200" stroke="currentColor" strokeWidth="1">
        <line x1="8" y1="24" x2="312" y2="24" />
        <line x1="8" y1="50" x2="312" y2="50" />
        <line x1="8" y1="76" x2="312" y2="76" />
      </g>
      {/* vạch chia hai giai đoạn */}
      <g className="text-slate-300">
        <line x1="150" y1="8" x2="150" y2="84" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
      </g>
      <text x="150" y="95" textAnchor="middle" className="fill-current text-slate-500" fontSize="9.5">
        ~1 tháng
      </text>
      {/* vùng dưới đường lợi nhuận */}
      <path
        className="text-emerald-500"
        fill="url(#tiktok-notice-profit)"
        d="M10,70 C40,70 60,53 100,48 S200,34 310,15 L310,84 L10,84 Z"
      />
      {/* số đơn: võng rồi hồi */}
      <path
        className="text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M10,44 C45,44 70,73 110,75 S150,68 172,61 S255,34 310,29"
      />
      {/* lợi nhuận: lên từ đầu */}
      <path
        className="text-emerald-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        d="M10,70 C40,70 60,53 100,48 S200,34 310,15"
      />
      {/* điểm đáy đơn + điểm cuối */}
      <circle cx="110" cy="75" r="3.5" className="fill-current text-red-500" />
      <circle cx="310" cy="29" r="3" className="fill-current text-slate-400" />
      <circle cx="310" cy="15" r="3.5" className="fill-current text-emerald-500" />
    </svg>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      <span className={cn("inline-block h-0.5 w-4 rounded-full", className)} />
      {label}
    </span>
  );
}

function Phase({
  n,
  title,
  tone,
  children,
}: {
  n: number;
  title: string;
  tone: "amber" | "emerald";
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-xl border border-slate-200/80 bg-card p-3.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
          )}
        >
          {n}
        </span>
        <p className="font-medium text-slate-900">{title}</p>
      </div>
      <ul className="mt-2.5 space-y-2 text-sm">{children}</ul>
    </li>
  );
}

function Trend({ down, label, children }: { down: boolean; label: string; children: React.ReactNode }) {
  const Icon = down ? TrendingDown : TrendingUp;
  const color = down ? "text-red-500" : "text-emerald-500";
  return (
    <li className="flex gap-2">
      <Icon className={cn("mt-0.5 size-4 shrink-0", color)} aria-hidden />
      <span className="text-slate-500">
        <span className={cn("font-medium", color)}>{label}</span> {children}
      </span>
    </li>
  );
}

export function TiktokAssistantFirstNotice({
  owner,
  breakeven,
  /** Đang mở sẵn popup cấu hình (link mở thẳng) → nhường, không chồng hai hộp. */
  suspended = false,
}: {
  owner: boolean;
  breakeven: TiktokAdsBreakeven | null;
  suspended?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || !owner || suspended) return;
    if (isDismissed()) return;
    asked.current = true;
    setOpen(true);
  }, [owner, suspended]);

  function close() {
    if (dontShow) dismissForGood();
    setOpen(false);
  }

  // Chỉ nêu số khi chiến dịch đã có ROI hòa vốn tin được; không thì nói chung.
  const roi = breakeven && !breakeven.negativeMargin ? breakeven.roi : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[min(36rem,calc(100%-2rem))] md:max-w-[min(46rem,calc(100%-2rem))]">
        {/* ===== DẢI ĐẦU ===== */}
        <div className="bg-linear-to-br from-amber-50 via-card to-card px-6 pt-6 pb-4">
          <div className="flex items-start gap-3 pr-6">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200">
              <TriangleAlert className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-700">Đọc trước khi bật Trợ lý</p>
              <DialogTitle className="mt-0.5 text-lg leading-snug font-semibold text-slate-900">
                Số đơn giảm trước, lợi nhuận tăng sau
              </DialogTitle>
            </div>
          </div>
          <DialogDescription className="mt-3 text-sm leading-relaxed text-slate-900">
            Khi bật <span className="font-medium">Tự loại thật</span>, Trợ lý quảng cáo sẽ loại dần những video đang{" "}
            <span className="font-medium text-red-500">lỗ</span>, tức ROI thấp hơn ROI hòa vốn
            {roi != null ? ` (${formatRoi(roi)} của chiến dịch này)` : ""}. Các video đó vẫn mang về đơn, nhưng mỗi đơn như vậy
            tốn tiền quảng cáo nhiều hơn số lãi thu được.
          </DialogDescription>
        </div>

        {/* ===== BIỂU ĐỒ + HAI GIAI ĐOẠN — màn ngang (≥768px) xếp cạnh nhau để hộp thấp, vừa laptop 1366×768 (trình duyệt
            chỉ còn ~650px cao); điện thoại xếp dọc. ===== */}
        <div className="px-6 md:grid md:grid-cols-[1.1fr_1fr] md:gap-3.5">
          <div className="flex flex-col rounded-xl border border-slate-200/80 bg-card p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-xs text-slate-500">Điều sẽ xảy ra, minh họa</p>
              <div className="flex items-center gap-4">
                <Legend className="bg-slate-400" label="Số đơn" />
                <Legend className="bg-emerald-500" label="Lợi nhuận" />
              </div>
            </div>
            <div className="mt-2 flex min-h-0 flex-1 items-center">
              <ExpectationChart />
            </div>
          </div>
          <ul className="mt-3.5 grid gap-3 sm:grid-cols-2 md:mt-0 md:grid-cols-1">
            <Phase n={1} title="Vài tuần đầu" tone="amber">
              <Trend down label="Tổng số đơn giảm">vì đơn từ các video lỗ không còn nữa.</Trend>
              <Trend down={false} label="Lợi nhuận tăng">vì tiền quảng cáo đốt vào các video đó dừng lại.</Trend>
            </Phase>
            <Phase n={2} title="Sau khoảng một tháng" tone="emerald">
              <Trend down={false} label="Số đơn dần trở lại">khi TikTok dồn ngân sách cho các video có lãi còn lại.</Trend>
              <Trend down={false} label="Lợi nhuận tăng tiếp">theo đà đó.</Trend>
            </Phase>
          </ul>
        </div>

        <p className="px-6 pt-3.5 text-sm leading-relaxed text-slate-900">
          Nếu thấy số đơn giảm trong những tuần đầu, đừng vội tắt Trợ lý hay khôi phục video.{" "}
          <span className="font-semibold">Hãy nhìn vào lợi nhuận, không nhìn số đơn.</span>{" "}
          <span className="text-slate-500">Chế độ Diễn tập chỉ ghi sổ video sẽ loại, chưa loại video nào.</span>
        </p>

        {/* ===== CHÂN HỘP ===== */}
        <div className="mt-4 flex flex-col-reverse gap-3 border-t bg-muted/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500 select-none">
            <input
              type="checkbox"
              className="size-4 accent-slate-900"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            Không hiện lại thông báo này
          </label>
          <Button onClick={close} className="sm:min-w-28">
            Đã hiểu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
