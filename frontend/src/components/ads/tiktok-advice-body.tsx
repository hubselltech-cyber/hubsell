// Thân ô lý do của một CHẨN ĐOÁN quảng cáo TikTok (backend campaign-advice.ts) — dùng chung cho nhãn kết luận ở trang chiến dịch và
// cột Nhận định của tab Hòa vốn sản phẩm, để hai nơi không bao giờ trình bày lệch nhau.
// Anh Trung 19/09/2026: viết dồn một đoạn trong ô nhỏ rất khó đọc → DỮ KIỆN mỗi ý một dòng, KẾT LUẬN để riêng bên dưới.

import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, XCircle } from "lucide-react";

import { TIKTOK_SELLER_CENTER_ADS_URL } from "@/components/ads/tiktok-ads-format";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TiktokAdsCampaignAdvice, TiktokProductRunAdvice } from "@/lib/api";
import { cn } from "@/lib/utils";

// Anh Trung 08/10/2026: hai phần của ô lý do đặt tên như bên Shopee — CĂN CỨ (dữ kiện) và ĐỀ XUẤT (việc nên làm).
export function TiktokAdviceBody({ advice }: { advice: TiktokAdsCampaignAdvice }) {
  // Backend cũ (frontend lên trước backend lúc deploy) chưa tách points / conclusion → in nguyên đoạn như trước.
  if (!advice.points || advice.conclusion == null) return <p className="text-slate-700">{advice.text}</p>;
  return (
    <>
      {advice.points.length > 0 && (
        <>
          <p className="text-xs font-medium text-slate-500">Căn cứ</p>
          <ul className="space-y-1 text-slate-700">
            {advice.points.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-1 border-t border-slate-200 pt-2">
        <p className="text-xs font-medium text-slate-500">Đề xuất</p>
        <p className="text-slate-900">{advice.conclusion}</p>
      </div>
    </>
  );
}

/** Màu nhãn nhận định — dùng chung cho bảng chiến dịch, trang chiến dịch và tab Hòa vốn sản phẩm. */
export const TIKTOK_ADVICE_TONE: Record<TiktokAdsCampaignAdvice["tone"], string> = {
  warn: "bg-rose-50 text-red-500",
  info: "bg-amber-50 text-amber-700",
  ok: "bg-emerald-50 text-emerald-700",
  muted: "bg-slate-100 text-slate-600",
};

/**
 * Nhãn nhận định + hộp Căn cứ / Đề xuất khi trỏ chuột — một khuôn cho cột Nhận định của bảng chiến dịch và trang chiến dịch
 * (anh Trung 08/10: khách phải xem được nhận định của mọi chiến dịch đang chạy ngay trên bảng). Đặt trong hàng có onRowClick
 * nên chặn click lan ra hàng.
 */
export function TiktokAdviceBadge({ advice, campaignName, align = "end" }: { advice: TiktokAdsCampaignAdvice; campaignName?: string; align?: "start" | "end" }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={80}
        render={<button type="button" className="cursor-pointer rounded-full" aria-label={`Nhận định: ${advice.label}`} onClick={(e) => e.stopPropagation()} />}
      >
        <Badge className={cn(TIKTOK_ADVICE_TONE[advice.tone], "underline decoration-dotted underline-offset-2")}>{advice.label}</Badge>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-96 gap-1.5 p-3 text-left text-sm font-normal" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-slate-900">{advice.label}</p>
        <TiktokAdviceBody advice={advice} />
        {/* Chiến dịch tạo từ Seller Center không sửa được qua API (probe 19/09/2026) → kết luận nào kéo theo việc sửa thì đưa đường tới đó. */}
        {advice.editInSellerCenter && (
          <a
            href={TIKTOK_SELLER_CENTER_ADS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 font-medium text-slate-900 underline decoration-dotted underline-offset-2 hover:decoration-solid"
            title={campaignName ? `Seller Center → Quảng cáo cửa hàng → chiến dịch "${campaignName}"` : undefined}
          >
            <ExternalLink className="size-3.5" />
            Sửa chiến dịch trong Seller Center
          </a>
        )}
      </PopoverContent>
    </Popover>
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
