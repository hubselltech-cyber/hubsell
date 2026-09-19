// Thân ô lý do của một CHẨN ĐOÁN quảng cáo TikTok (backend campaign-advice.ts) — dùng chung cho nhãn kết luận ở trang chiến dịch và
// cột Nhận định của tab Hòa vốn sản phẩm, để hai nơi không bao giờ trình bày lệch nhau.
// Anh Trung 19/09/2026: viết dồn một đoạn trong ô nhỏ rất khó đọc → DỮ KIỆN mỗi ý một dòng, KẾT LUẬN để riêng bên dưới.

import type { TiktokAdsCampaignAdvice } from "@/lib/api";

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
