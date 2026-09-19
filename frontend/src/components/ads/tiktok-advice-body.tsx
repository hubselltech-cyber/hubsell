// Thân ô lý do của một CHẨN ĐOÁN quảng cáo TikTok (backend campaign-advice.ts) — dùng chung cho nhãn kết luận ở trang chiến dịch và
// cột Nhận định của tab Hòa vốn sản phẩm, để hai nơi không bao giờ trình bày lệch nhau.
// Anh Trung 19/09/2026: viết dồn một đoạn trong ô nhỏ rất khó đọc → DỮ KIỆN mỗi ý một dòng, KẾT LUẬN để riêng bên dưới.

import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";

import type { TiktokAdsCampaignAdvice, TiktokProductRunAdvice } from "@/lib/api";

export function TiktokAdviceBody({ advice }: { advice: TiktokAdsCampaignAdvice }) {
  // Backend cũ (frontend lên trước backend lúc deploy) chưa tách points / conclusion → in nguyên đoạn như trước.
  if (!advice.points || advice.conclusion == null) return <p className="text-slate-700">{advice.text}</p>;
  return (
    <>
      {advice.points.length > 0 && (
        <ul className="space-y-1 text-slate-700">
          {advice.points.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 border-t border-slate-200 pt-2">
        <p className="text-xs font-medium text-slate-500">Kết luận</p>
        <p className="text-slate-900">{advice.conclusion}</p>
      </div>
    </>
  );
}

const RUN_CHECK_STATUS = {
  pass: { Icon: CheckCircle2, word: "Đạt", className: "text-emerald-600" },
  caution: { Icon: AlertTriangle, word: "Cần dè chừng", className: "text-amber-600" },
  block: { Icon: XCircle, word: "Không đạt", className: "text-red-500" },
  unknown: { Icon: HelpCircle, word: "Chưa có số", className: "text-slate-400" },
} as const;

// Ô lý do của nhận định NÊN CHẠY / CHẠY THỬ / CHƯA NÊN (backend product-run-advice.ts). Anh Trung 19/09/2026: phải rõ căn cứ tại sao
// nên, tại sao chưa nên → mỗi ĐIỀU KIỆN một dòng: đạt hay không + số thật + mốc so sánh, rồi mới tới kết luận.
export function TiktokRunAdviceBody({ advice }: { advice: TiktokProductRunAdvice }) {
  return (
    <>
      <ul className="space-y-1 text-slate-700">
        {advice.points.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {/* Backend cũ chưa có checks → chỉ còn dữ kiện + kết luận. */}
      {(advice.checks?.length ?? 0) > 0 && (
        <div className="mt-1 border-t border-slate-200 pt-2">
          <p className="text-xs font-medium text-slate-500">Căn cứ — 3 điều kiện đã xét</p>
          <ul className="mt-1 space-y-2">
            {advice.checks?.map((c) => {
              const s = RUN_CHECK_STATUS[c.status];
              return (
                <li key={c.key} className="flex gap-2">
                  <s.Icon className={`mt-0.5 size-4 shrink-0 ${s.className}`} aria-hidden />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {c.title} <span className={`font-normal ${s.className}`}>· {s.word}</span>
                    </p>
                    <p className="text-slate-700">{c.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="mt-1 border-t border-slate-200 pt-2">
        <p className="text-xs font-medium text-slate-500">Kết luận</p>
        <p className="text-slate-900">{advice.conclusion}</p>
      </div>
    </>
  );
}
