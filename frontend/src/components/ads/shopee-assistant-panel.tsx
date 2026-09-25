"use client";

import { useEffect, useState } from "react";
import { ExternalLink, PauseCircle, PlayCircle, ShieldCheck, SlidersHorizontal, Target, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HintIcon } from "@/components/finance/hint-icon";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import {
  fetchLazadaCampaignLiveDetail,
  fetchShopeeAdsActionLog,
  fetchShopeeKeywordSuggestions,
  type AdsAssistantScorecard,
  type AdsScorecardRow,
  type DeliveryCheck,
  type LazadaCampaignLiveDetail,
  type ShopeeAdsActionLogRow,
  type ShopeeAdsCampaignRow,
  type ShopeeAssistantConfig,
  type ShopeeAssistantDecision,
  type ShopeeAssistantVerdict,
  type ShopeeKeywordSuggestionsResponse,
} from "@/lib/api";
import { capitalizePhrase, formatRangePhrase, type DateRange } from "@/lib/date-range";
import { formatNumber, formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * TRỢ LÝ QUẢNG CÁO SHOPEE — GĐ2: badge verdict + modal quyết định + panel luật.
 *
 * Trợ lý CHỈ ĐỀ XUẤT: mọi verdict đi kèm reasons số liệu thật, chủ shop tự
 * thao tác trên Seller Center rồi ghi nhận lại ("Đã xử lý"/"Theo dõi"/"Bỏ qua").
 * Không có nút nào gọi lệnh ghi lên sàn — autoExecute là chuyện GĐ3.
 */

// ---------- Badge verdict ----------

export const VERDICT_META: Record<
  Exclude<ShopeeAssistantVerdict, null>,
  { label: string; className: string }
> = {
  spike: { label: "Vọt chi hôm nay", className: "bg-red-600 text-white" },
  pause_now: { label: "Đề xuất tạm dừng", className: "bg-red-500 text-white" },
  grace: { label: "Công thần — theo dõi sát", className: "bg-violet-600 text-white" },
  review: { label: "Cần duyệt", className: "bg-amber-500 text-white" },
  healthy: { label: "Ổn", className: "bg-emerald-50 text-emerald-600 border border-emerald-200" },
  insufficient_data: {
    label: "Thiếu dữ liệu",
    className: "bg-slate-100 text-slate-500",
  },
};

const DECISION_LABEL: Record<Exclude<ShopeeAssistantDecision, "">, string> = {
  HANDLED: "Đã xử lý",
  WATCHING: "Đang theo dõi",
  IGNORED: "Đã bỏ qua",
};

export function AssistantVerdictBadge({ c }: { c: ShopeeAdsCampaignRow }) {
  const a = c.assistant;
  if (a.verdict == null) return <span className="text-xs text-slate-400">—</span>;
  // Đã quyết và verdict chưa đổi loại → hiện trạng thái quyết định thay cảnh báo.
  if (a.decisionActive && a.decision !== "") {
    return (
      <Badge variant="outline" className="border-slate-300 text-slate-500">
        {DECISION_LABEL[a.decision]}
      </Badge>
    );
  }
  // Đợt E: đang lãi (healthy) mà bị chặn phân phối → nhãn xanh "có thể thêm đơn"
  // thay cho "Ổn" — cùng ý với nhãn "Ngân sách đang chặn" của trang TikTok.
  if (a.verdict === "healthy" && c.delivery) {
    return (
      <Badge className={cn("whitespace-nowrap", DELIVERY_META[c.delivery.status].className)}>
        {DELIVERY_META[c.delivery.status].label}
      </Badge>
    );
  }
  const meta = VERDICT_META[a.verdict];
  return <Badge className={cn("whitespace-nowrap", meta.className)}>{meta.label}</Badge>;
}

/** Nhãn + lời khuyên cho rổ "đang lãi nhưng bị chặn" (đợt E). */
export const DELIVERY_META: Record<
  DeliveryCheck["status"],
  { label: string; title: string; className: string }
> = {
  budget_capped: {
    label: "Ngân sách đang chặn",
    title: "Ngân sách đang chặn đơn",
    className: "bg-sky-50 text-sky-700 border border-sky-200",
  },
  target_binding: {
    label: "Mục tiêu đang bó",
    title: "Mục tiêu ROAS đang bó phân phối",
    className: "bg-sky-50 text-sky-700 border border-sky-200",
  },
};

/** Câu chữ của khối gợi ý đợt E trong modal — dữ kiện từng dòng rồi mới kết luận (khẩu vị anh Trung 19/09). */
export function deliveryAdviceText(
  d: DeliveryCheck,
  platformLabel: string
): { points: string[]; conclusion: string } {
  const x = (v: number) => `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
  const points = [
    `ROAS ${d.fullDays} ngày trọn gần nhất (bỏ hôm nay) ${x(d.roas)} · hòa vốn ${x(d.breakevenRoas)} — đang lãi.`,
  ];
  if (d.status === "budget_capped") {
    points.push(
      `Mỗi ngày tiêu khoảng ${d.budgetUsedPct}% ngân sách ngày (${formatVND(d.avgDailySpend)} / ${formatVND(d.budget)}).`
    );
    return {
      points,
      conclusion: `Ngân sách ngày đang là thứ chặn đơn: ${platformLabel} ngừng hiển thị khi tiêu hết ngân sách. Nâng ngân sách ngày trên Seller Center thì có thêm đơn ở cùng mức lãi. Hubsell không tự tăng ngân sách.`,
    };
  }
  points.push(
    `Mục tiêu ROAS đang đặt ${x(d.roasTarget ?? 0)} — cao hơn ROAS thực, chưa đạt.`,
    d.budget > 0
      ? `Ngân sách ngày ${formatVND(d.budget)}, mới dùng khoảng ${d.budgetUsedPct}%.`
      : "Ngân sách không giới hạn — không phải thứ chặn."
  );
  return {
    points,
    conclusion: `${platformLabel} chỉ đấu thầu tới mức đạt mục tiêu nên đang phân phối dè dặt. Muốn thêm đơn thì hạ mục tiêu ROAS trên Seller Center, nhưng đừng xuống dưới ${x(d.safeTarget)} (hòa vốn × hệ số an toàn) — lãi mỗi đơn sẽ mỏng đi. Hubsell không tự hạ mục tiêu.`,
  };
}

// ---------- Modal chi tiết + quyết định ----------

/** Trang quản lý quảng cáo trên Seller Center từng sàn — nút "Mở Seller Center".
 *  Lazada không có URL sâu ổn định công khai cho Sponsored Solutions → về trang
 *  chủ Seller Center, chủ shop vào mục Tiếp thị (đừng đoán deep-link — bài học MISA). */
const PLATFORM_LABEL: Record<"shopee" | "lazada", string> = {
  shopee: "Shopee",
  lazada: "Lazada",
};

const SELLER_CENTER_ADS_URLS: Record<"shopee" | "lazada", string> = {
  shopee: "https://banhang.shopee.vn/portal/marketing/pas/index",
  lazada: "https://sellercenter.lazada.vn/",
};

/** Màu ROAS so hòa vốn — bản mini cho hai bảng soi sống trong modal Lazada. */
function liveRoasTone(roas: number | null, breakeven: number | null): string {
  if (roas == null) return "text-slate-400";
  if (breakeven == null) return "text-slate-700";
  if (roas < breakeven) return "text-red-600";
  if (roas < breakeven * 1.1) return "text-amber-600";
  return "text-emerald-600";
}

function liveRoasText(v: number | null): string {
  return v == null
    ? "—"
    : `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
}

export function ShopeeAssistantModal({
  campaign,
  onDecide,
  onResume,
  onPause,
  onRestoreBudget,
  onSetTarget,
  onClose,
  deciding,
  platform = "shopee",
  range,
}: {
  campaign: ShopeeAdsCampaignRow | null;
  onDecide: (decision: ShopeeAssistantDecision) => void;
  /** Bật lại ngay campaign đã tạm dừng — Trợ lý hoặc người dừng (lệnh thật lên sàn). */
  onResume?: () => void;
  /** 25/09: chủ shop tạm dừng campaign đang chạy ngay trong Hubsell (lệnh thật, modal hỏi xác nhận trước). */
  onPause?: () => void;
  /** Đợt B: trả lại ngân sách gốc cho campaign Trợ lý đã hạ (lệnh thật, chỉ Shopee). */
  onRestoreBudget?: () => void;
  /** Đợt A: nâng mục tiêu ROAS trên sàn lên `target` (lệnh thật, chỉ Shopee). */
  onSetTarget?: (target: number) => void;
  onClose: () => void;
  deciding: boolean;
  platform?: "shopee" | "lazada";
  /** Khoảng ngày đang xem trên trang — phần soi sống Lazada dùng cùng khoảng. */
  range: DateRange;
}) {
  // ---- ĐỢT C: từ khóa Shopee gợi ý (gọi khi bấm nút, backend cache 24h) ----
  const [kw, setKw] = useState<ShopeeKeywordSuggestionsResponse | null>(null);
  const [kwLoading, setKwLoading] = useState(false);
  const [kwError, setKwError] = useState<string | null>(null);
  // Tạm dừng: hỏi lại một lần ngay trong modal (nêu tên + số đang chạy) rồi mới gửi lệnh.
  const [confirmPause, setConfirmPause] = useState(false);
  useEffect(() => {
    setKw(null);
    setKwError(null);
    setConfirmPause(false);
  }, [campaign?.id]);
  async function loadKeywordSuggestions() {
    if (!campaign || kwLoading) return;
    setKwLoading(true);
    setKwError(null);
    try {
      setKw(await fetchShopeeKeywordSuggestions(campaign.id));
    } catch (err) {
      setKwError(`Không hỏi được từ khóa gợi ý: ${(err as Error).message}`);
    } finally {
      setKwLoading(false);
    }
  }

  // ---- Soi sống SP & từ khóa (CHỈ Lazada — Shopee không có API keyword) ----
  const [live, setLive] = useState<LazadaCampaignLiveDetail | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  useEffect(() => {
    setLive(null);
    setLiveError(null);
    if (platform !== "lazada" || !campaign) return;
    let cancelled = false;
    setLiveLoading(true);
    fetchLazadaCampaignLiveDetail(campaign.id, range)
      .then((res) => {
        if (!cancelled) setLive(res);
      })
      .catch((err) => {
        if (!cancelled) setLiveError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, campaign, range]);

  const a = campaign?.assistant;
  // Nhãn trên tiêu đề modal khớp nhãn ở bảng: healthy mà bị chặn phân phối → nhãn đợt E.
  const verdictMeta =
    a?.verdict === "healthy" && campaign?.delivery
      ? DELIVERY_META[campaign.delivery.status]
      : a?.verdict
        ? VERDICT_META[a.verdict]
        : null;
  const actionable =
    a?.verdict === "spike" || a?.verdict === "pause_now" || a?.verdict === "review" || a?.verdict === "grace";

  return (
    <Dialog open={campaign !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          // Base của DialogContent có sm:max-w-sm (variant breakpoint) — phải
          // ghi đè bằng đúng variant sm: mới thắng ở màn ≥640px (max-w-xl trần
          // bị sm:max-w-sm đè, popup teo còn 384px với tên chiến dịch dài).
          // KHÔNG truyền max-w-* trần: nó đè mất max-w-[calc(100%-2rem)] của
          // base làm cửa sổ <640px mất lề an toàn 2 bên. max-h[85vh]: màn thấp
          // (laptop 768px) danh sách Căn cứ dài không trôi nút ra ngoài.
          "sm:max-w-xl max-h-[85vh] overflow-y-auto",
          // Lazada rộng hơn (chứa 2 bảng soi sống SP & từ khóa) — kẹp min()
          // để cửa sổ 640–800px vẫn giữ lề thay vì bung sát mép.
          platform === "lazada" && "sm:max-w-[min(48rem,calc(100%-2rem))]"
        )}
      >
        {/* min-w-0: chặn min-content của tên chiến dịch nowrap lan lên grid
            của DialogContent làm nội dung phình rộng hơn khung (cùng họ bệnh
            dialog nối nhanh 801f19c) */}
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 truncate">
              {campaign?.name || `Chiến dịch #${campaign?.campaignId}`}
            </span>
            {verdictMeta && (
              <Badge className={verdictMeta.className}>{verdictMeta.label}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Đánh giá của Trợ lý dựa trên hiệu suất thật + ROAS hòa vốn của chính
            SKU trong chiến dịch. Mọi lệnh Hubsell gửi lên sàn đều ghi vào Sổ hành
            động; việc khác anh/chị làm trên Seller Center rồi ghi nhận lại tại đây.
          </DialogDescription>
        </DialogHeader>

        {campaign && a && (
          <div className="min-w-0 space-y-4">
            {/* Số chính trong kỳ đang xem */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Chi phí</p>
                <Money value={campaign.spend} className="font-semibold" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">GMV</p>
                <Money value={campaign.broadGmv} className="font-semibold" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ROAS</p>
                <p className="font-semibold tabular-nums">
                  {campaign.roasBroad != null
                    ? `${campaign.roasBroad.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hòa vốn</p>
                <p className="font-semibold tabular-nums">
                  {campaign.breakevenRoas != null
                    ? `${campaign.breakevenRoas.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`
                    : "—"}
                </p>
              </div>
            </div>

            {/* Căn cứ của Trợ lý */}
            {a.reasons.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-900">Căn cứ</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {a.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Đợt B: Trợ lý đã hạ ngân sách ngày — nói rõ số gốc và cách trả lại */}
            {campaign.hubsellBudgetCut && (
              <div className="flex flex-wrap items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
                <SlidersHorizontal className="mt-0.5 size-5 shrink-0 text-violet-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Trợ lý đã hạ ngân sách ngày</p>
                  <p className="mt-0.5">
                    Lúc{" "}
                    {new Date(campaign.hubsellBudgetCut.at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                    : {campaign.hubsellBudgetCut.before > 0 ? formatVND(campaign.hubsellBudgetCut.before) : "không giới hạn"} →{" "}
                    <b>{formatVND(campaign.hubsellBudgetCut.cut)}</b> vì chiến dịch đang lỗ. Ngày sau vẫn lỗ Trợ lý mới tạm dừng;
                    bật lại (máy hoặc anh/chị) sẽ trả số cũ. Tự đổi ngân sách trên Seller Center thì Trợ lý thôi giữ số gốc.
                  </p>
                </div>
              </div>
            )}

            {/* Đợt E: đang lãi nhưng bị ngân sách chặn / mục tiêu bó — chỉ gợi ý */}
            {campaign.delivery && campaign.assistant.verdict === "healthy" && (
              <div className="flex flex-wrap items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                <TrendingUp className="mt-0.5 size-5 shrink-0 text-sky-600" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">{DELIVERY_META[campaign.delivery.status].title}</p>
                  {deliveryAdviceText(campaign.delivery, PLATFORM_LABEL[platform]).points.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  <p className="font-medium">
                    {deliveryAdviceText(campaign.delivery, PLATFORM_LABEL[platform]).conclusion}
                  </p>
                </div>
              </div>
            )}

            {/* Đợt A: mục tiêu ROAS trên sàn so với hòa vốn thật */}
            {campaign.roasTargetCheck && campaign.roasTargetCheck.status !== "ok" && (
              <div
                className={cn(
                  "flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm",
                  campaign.roasTargetCheck.status === "below"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                )}
              >
                <Target className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {campaign.roasTargetCheck.status === "below"
                      ? "Mục tiêu ROAS đang đặt thấp hơn hòa vốn"
                      : "Mục tiêu ROAS chưa tới vùng an toàn"}
                  </p>
                  <p className="mt-0.5">
                    Trên sàn đang đặt <b>{liveRoasText(campaign.roasTargetCheck.target)}</b>, hòa vốn
                    của SKU trong chiến dịch là <b>{liveRoasText(campaign.roasTargetCheck.breakevenRoas)}</b>.{" "}
                    {campaign.roasTargetCheck.status === "below"
                      ? "Sàn tối ưu về đúng mục tiêu nên đạt mục tiêu vẫn mất tiền."
                      : "Đạt mục tiêu chỉ vừa đủ hòa vốn, chưa có lãi thật."}{" "}
                    Nên đặt từ <b>{liveRoasText(campaign.roasTargetCheck.safeTarget)}</b>.
                  </p>
                </div>
                {platform === "shopee" && onSetTarget && (
                  <Button
                    size="sm"
                    disabled={deciding}
                    onClick={() => onSetTarget(campaign.roasTargetCheck?.safeTarget ?? 0)}
                    title="Gửi lệnh đổi mục tiêu ROAS thật lên Shopee ngay — ghi vào Sổ hành động."
                    className={
                      campaign.roasTargetCheck.status === "below"
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-amber-600 text-white hover:bg-amber-700"
                    }
                  >
                    <Target className="size-4" />
                    Nâng lên {liveRoasText(campaign.roasTargetCheck.safeTarget)}
                  </Button>
                )}
              </div>
            )}

            {/* ĐỢT C: từ khóa Shopee — chỉ cấu hình (sàn không cấp hiệu suất từng từ khóa qua API) +
                nút hỏi từ khóa Shopee gợi ý để đối chiếu: chưa có trong campaign / đang trả giá hớ. */}
            {/* Mọi campaign Shopee có SP đều xem được từ khóa Shopee gợi ý (anh Trung 24/09 không thấy
                nút vì hai campaign ANO đang chạy đều đấu thầu tự động — điều kiện cũ chỉ mở cho thủ công). */}
            {platform === "shopee" && campaign.itemCount > 0 && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    Từ khóa trong chiến dịch
                    {campaign.keywords && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        ({formatNumber(campaign.keywords.selected.filter((k) => k.status !== "deleted").length)} từ khóa
                        {campaign.keywords.enhancedCpc ? " · Enhanced CPC" : ""})
                      </span>
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={kwLoading}
                    onClick={() => void loadKeywordSuggestions()}
                    title="Hỏi Shopee từ khóa gợi ý cho sản phẩm của chiến dịch (lượt tìm 30 ngày, điểm chất lượng, giá thầu gợi ý) rồi đối chiếu với từ khóa đang chọn. Cache 24 giờ."
                  >
                    {kwLoading ? "Đang hỏi Shopee…" : kw ? "Hỏi lại Shopee" : "Từ khóa Shopee gợi ý"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Shopee KHÔNG cấp hiệu suất (chi phí, click, đơn) từng từ khóa qua API — bảng này chỉ là cấu hình
                  đang đặt trên sàn. Muốn xem từ khóa nào ra đơn, mở Seller Center. Sửa từ khóa/giá thầu cũng làm trên
                  Seller Center.
                </p>
                {!campaign.keywords && campaign.biddingMethod === "auto" && (
                  <p className="text-sm text-muted-foreground">
                    Chiến dịch đấu thầu tự động — Shopee tự chọn từ khóa, không có danh sách để xem. Vẫn hỏi được
                    từ khóa Shopee gợi ý cho sản phẩm này (nút bên trên) để cân nhắc khi lập chiến dịch thủ công.
                  </p>
                )}
                {!campaign.keywords && campaign.biddingMethod !== "auto" && (
                  <p className="text-sm text-muted-foreground">
                    Chưa có cấu hình từ khóa từ sàn — xung kế tiếp sẽ kéo (30 phút), hoặc bấm Làm mới.
                  </p>
                )}
                {campaign.keywords && campaign.keywords.selected.length > 0 && (
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Từ khóa</th>
                          <th className="py-1.5 pr-3 font-medium">Khớp</th>
                          <th className="py-1.5 pr-3 text-right font-medium">Giá thầu</th>
                          {kw && <th className="py-1.5 pr-3 text-right font-medium">Shopee gợi ý</th>}
                          <th className="py-1.5 text-right font-medium">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaign.keywords.selected
                          .filter((k) => k.status !== "deleted")
                          .slice(0, 30)
                          .map((k, i) => {
                            const sug = kw?.rows.find((r) => r.keyword.toLowerCase() === k.keyword.toLowerCase()) ?? null;
                            return (
                              <tr
                                key={`${k.keyword}-${i}`}
                                className={cn("border-b last:border-0", sug?.overpaid && "bg-amber-50/70")}
                              >
                                <td className="max-w-56 py-1.5 pr-3">
                                  <span className="block truncate text-slate-900">{k.keyword}</span>
                                </td>
                                <td className="py-1.5 pr-3 text-xs text-slate-600">
                                  {k.matchType === "exact" ? "Chính xác" : k.matchType === "broad" ? "Mở rộng" : k.matchType || "—"}
                                </td>
                                <td className={cn("py-1.5 pr-3 text-right tabular-nums", sug?.overpaid && "font-semibold text-amber-700")}>
                                  {formatVND(k.bid)}
                                </td>
                                {kw && (
                                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">
                                    {sug?.suggestedBid != null ? formatVND(sug.suggestedBid) : "—"}
                                    {sug?.overpaid && (
                                      <span className="ml-1 text-xs text-amber-700">
                                        (hớ {Math.round(((k.bid - sug.suggestedBid!) / sug.suggestedBid!) * 100)}%)
                                      </span>
                                    )}
                                  </td>
                                )}
                                <td className="py-1.5 text-right text-xs text-slate-500">
                                  {k.status === "normal" ? "Đang chạy" : k.status === "reserved" ? "Chờ duyệt" : k.status === "blacklist" ? "Sàn chặn" : k.status || "—"}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                    {campaign.keywords.selected.filter((k) => k.status !== "deleted").length > 30 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        +{formatNumber(campaign.keywords.selected.filter((k) => k.status !== "deleted").length - 30)} từ khóa khác — xem đủ trên Seller Center.
                      </p>
                    )}
                  </div>
                )}
                {campaign.keywords && campaign.keywords.discovery.length > 0 && (
                  <p className="text-xs text-slate-600">
                    Vị trí Khám phá:{" "}
                    {campaign.keywords.discovery
                      .map(
                        (d) =>
                          `${d.location === "daily_discover" ? "Khám phá hằng ngày" : d.location === "you_may_also_like" ? "Có thể bạn cũng thích" : d.location} ${d.active ? "bật" : "tắt"} · bid ${formatVND(d.bid)}`
                      )
                      .join(" — ")}
                  </p>
                )}
                {kwError && <p className="text-sm text-amber-700">{kwError}</p>}
                {kw && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Shopee gợi ý cho sản phẩm này{kw.inputKeyword ? ` (hỏi theo "${kw.inputKeyword}")` : ""} —{" "}
                      {kw.fromCache ? "số đã hỏi trong 24 giờ" : "vừa hỏi sàn"}. Vàng = đang trả giá cao hơn gợi ý quá{" "}
                      {Math.round((kw.overpayFactor - 1) * 100)}%; xanh = chưa có trong chiến dịch.
                    </p>
                    {kw.rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Shopee không trả từ khóa gợi ý nào cho sản phẩm này (kể cả khi hỏi theo tên sản phẩm).
                      </p>
                    ) : (
                      <div className="min-w-0 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                              <th className="py-1.5 pr-3 font-medium">Từ khóa gợi ý</th>
                              <th className="py-1.5 pr-3 text-right font-medium">Lượt tìm 30 ngày</th>
                              <th className="py-1.5 pr-3 text-right font-medium">Điểm CL</th>
                              <th className="py-1.5 pr-3 text-right font-medium">Bid gợi ý</th>
                              <th className="py-1.5 text-right font-medium">Trong chiến dịch</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kw.rows.slice(0, 20).map((r) => (
                              <tr
                                key={r.keyword}
                                className={cn(
                                  "border-b last:border-0",
                                  r.overpaid ? "bg-amber-50/70" : !r.inCampaign ? "bg-emerald-50/50" : ""
                                )}
                              >
                                <td className="max-w-56 py-1.5 pr-3">
                                  <span className="block truncate text-slate-900">{r.keyword}</span>
                                </td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">
                                  {r.searchVolume != null ? formatNumber(r.searchVolume) : "—"}
                                </td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">{r.qualityScore ?? "—"}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">
                                  {r.suggestedBid != null ? formatVND(r.suggestedBid) : "—"}
                                </td>
                                <td className="py-1.5 text-right text-xs">
                                  {r.inCampaign ? (
                                    <span className={r.overpaid ? "font-semibold text-amber-700" : "text-slate-600"}>
                                      Có · bid {formatVND(r.currentBid ?? 0)}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-700">Chưa có</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {kw.rows.length > 20 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            +{formatNumber(kw.rows.length - 20)} từ khóa gợi ý khác.
                          </p>
                        )}
                      </div>
                    )}
                    {kw.selectedWithoutSuggestion.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(kw.selectedWithoutSuggestion.length)} từ khóa đang chạy Shopee không gợi ý (không có số để so):{" "}
                        {kw.selectedWithoutSuggestion.slice(0, 8).map((k) => k.keyword).join(", ")}
                        {kw.selectedWithoutSuggestion.length > 8 ? "…" : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Soi sống SP & từ khóa — đặc sản Lazada (Shopee không có API keyword) */}
            {platform === "lazada" && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-semibold text-slate-900">
                  Soi trong chiến dịch ({formatRangePhrase(range)}, lấy thẳng từ Lazada)
                </p>
                {liveLoading && (
                  <p className="text-sm text-muted-foreground">
                    Đang hỏi Lazada từng sản phẩm và từ khóa…
                  </p>
                )}
                {liveError && (
                  <p className="text-sm text-amber-700">
                    Không tải được chi tiết sống từ Lazada: {liveError}
                  </p>
                )}
                {live && live.adgroups.length === 0 && live.keywords.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Chiến dịch chưa có dữ liệu sản phẩm/từ khóa trong cửa sổ này.
                  </p>
                )}
                {live && live.adgroups.length > 0 && (
                  <div className="min-w-0 overflow-x-auto">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Sản phẩm trong chiến dịch
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Sản phẩm</th>
                          <th className="py-1.5 pr-3 text-right font-medium">Chi phí</th>
                          <th className="py-1.5 pr-3 text-right font-medium">Đơn</th>
                          <th className="py-1.5 pr-3 text-right font-medium">GMV</th>
                          <th className="py-1.5 pr-3 text-right font-medium">ROAS</th>
                          <th className="py-1.5 text-right font-medium">Hòa vốn</th>
                        </tr>
                      </thead>
                      <tbody>
                        {live.adgroups.slice(0, 10).map((g) => (
                          <tr key={g.adgroupId} className="border-b last:border-0">
                            <td className="max-w-56 py-1.5 pr-3">
                              <span className="block truncate text-slate-900">
                                {g.name || `#${g.itemId}`}
                              </span>
                              <span className="text-xs text-slate-500">
                                {!g.adSwitchOn && "đã tắt · "}bid {formatVND(g.bidPrice)}
                                {g.lossBeforeAds && (
                                  <span className="text-red-600"> · lỗ trước ads</span>
                                )}
                              </span>
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {formatVND(g.spend)}
                            </td>
                            <td
                              className={cn(
                                "py-1.5 pr-3 text-right tabular-nums",
                                g.spend > 0 && g.storeOrders === 0 && "font-semibold text-red-600"
                              )}
                            >
                              {formatNumber(g.storeOrders)}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {formatVND(g.storeRevenue)}
                            </td>
                            <td
                              className={cn(
                                "py-1.5 pr-3 text-right font-semibold tabular-nums",
                                liveRoasTone(g.roas, g.breakevenRoas)
                              )}
                            >
                              {liveRoasText(g.roas)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-slate-600">
                              {liveRoasText(g.breakevenRoas)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {live.adgroups.length > 10 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        +{formatNumber(live.adgroups.length - 10)} sản phẩm khác — xem đủ trên Seller Center.
                      </p>
                    )}
                  </div>
                )}
                {live && live.keywords.length > 0 && (
                  <div className="min-w-0 overflow-x-auto">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Từ khóa (tiêu nhiều xếp trước) — từ khóa đỏ đang đốt tiền
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Từ khóa</th>
                          <th className="py-1.5 pr-3 text-right font-medium">Chi phí</th>
                          <th className="py-1.5 pr-3 text-right font-medium">Click</th>
                          <th className="py-1.5 pr-3 text-right font-medium">Đơn</th>
                          <th className="py-1.5 pr-3 text-right font-medium">ROAS</th>
                          <th className="py-1.5 text-right font-medium">Bid tối đa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {live.keywords.slice(0, 12).map((k, i) => {
                          const wasteful =
                            k.spend > 0 &&
                            (k.storeOrders === 0 ||
                              (k.roas != null &&
                                k.breakevenRoas != null &&
                                k.roas < k.breakevenRoas));
                          return (
                            <tr
                              key={`${k.keyword}-${i}`}
                              className={cn(
                                "border-b last:border-0",
                                wasteful && "bg-red-50/60"
                              )}
                            >
                              <td className="max-w-52 py-1.5 pr-3">
                                <span className="block truncate text-slate-900">
                                  {k.keyword}
                                </span>
                                <span className="block truncate text-xs text-slate-500">
                                  {k.adgroupName}
                                </span>
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">
                                {formatVND(k.spend)}
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">
                                {formatNumber(k.clicks)}
                              </td>
                              <td
                                className={cn(
                                  "py-1.5 pr-3 text-right tabular-nums",
                                  k.spend > 0 && k.storeOrders === 0 && "font-semibold text-red-600"
                                )}
                              >
                                {formatNumber(k.storeOrders)}
                              </td>
                              <td
                                className={cn(
                                  "py-1.5 pr-3 text-right font-semibold tabular-nums",
                                  liveRoasTone(k.roas, k.breakevenRoas)
                                )}
                              >
                                {liveRoasText(k.roas)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums text-slate-600">
                                {formatVND(k.maxBid)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {live.keywords.length > 12 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        +{formatNumber(live.keywords.length - 12)} từ khóa khác — xem đủ trên Seller Center.
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Lazada chưa có API chỉnh/tắt từ khóa — thấy từ khóa đốt tiền
                      thì chỉnh bid hoặc tắt trên Seller Center.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Xác nhận tạm dừng (25/09): nêu rõ đang tắt gì, số đang chạy; hai nút Tạm dừng / Bỏ qua. */}
            {confirmPause && campaign.status === "ongoing" && onPause && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
                <p className="font-semibold">Tạm dừng chiến dịch này trên {platform === "lazada" ? "Lazada" : "Shopee"}?</p>
                <p className="mt-1">
                  “{campaign.name || `#${campaign.campaignId}`}” sẽ ngừng hiển thị ngay. Trong kỳ đang xem chiến dịch tiêu{" "}
                  <b>{formatVND(campaign.spend)}</b>, ra <b>{formatNumber(campaign.broadOrder)}</b> đơn, ROAS{" "}
                  <b>{liveRoasText(campaign.roasBroad)}</b>
                  {campaign.breakevenRoas != null && <> (hòa vốn {liveRoasText(campaign.breakevenRoas)})</>}. Bật lại được
                  bất cứ lúc nào ngay tại đây; Trợ lý sẽ không tự bật lại chiến dịch do anh/chị dừng.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" variant="destructive" disabled={deciding} onClick={onPause}>
                    <PauseCircle className="size-4" />
                    {deciding ? "Đang gửi lên sàn…" : "Tạm dừng chiến dịch"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={deciding} onClick={() => setConfirmPause(false)}>
                    Bỏ qua
                  </Button>
                </div>
              </div>
            )}

            {/* Hành động */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(SELLER_CENTER_ADS_URLS[platform], "_blank", "noopener")
                }
              >
                <ExternalLink className="size-4" />
                Mở Seller Center
              </Button>
              {campaign.status === "ongoing" && onPause && !confirmPause && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300 text-amber-800 hover:bg-amber-50"
                  disabled={deciding}
                  onClick={() => setConfirmPause(true)}
                  title="Tạm dừng chiến dịch ngay trong Hubsell — sẽ hỏi lại trước khi gửi lệnh lên sàn."
                >
                  <PauseCircle className="size-4" />
                  Tạm dừng
                </Button>
              )}
              {(campaign.hubsellPause || campaign.status === "paused") && onResume && (
                <Button
                  size="sm"
                  className="bg-violet-600 text-white hover:bg-violet-700"
                  disabled={deciding}
                  onClick={onResume}
                  title="Gửi lệnh bật lại thật lên sàn ngay — Trợ lý coi đây là quyết định của anh/chị."
                >
                  <PlayCircle className="size-4" />
                  Bật lại ngay
                </Button>
              )}
              {/* Đợt B: campaign vẫn chạy với ngân sách Trợ lý đã hạ — trả số gốc ngay tại đây. */}
              {campaign.hubsellBudgetCut && !campaign.hubsellPause && onRestoreBudget && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-violet-300 text-violet-700 hover:bg-violet-50"
                  disabled={deciding}
                  onClick={onRestoreBudget}
                  title={`Trả ngân sách ngày về ${campaign.hubsellBudgetCut.before > 0 ? formatVND(campaign.hubsellBudgetCut.before) : "không giới hạn"} (số trước khi Trợ lý hạ) — lệnh thật lên sàn.`}
                >
                  Trả lại ngân sách
                </Button>
              )}
              {actionable && !a.decisionActive && (
                <>
                  <Button
                    size="sm"
                    disabled={deciding}
                    onClick={() => onDecide("HANDLED")}
                  >
                    Đã xử lý trên Seller Center
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={deciding}
                    onClick={() => onDecide("WATCHING")}
                  >
                    Theo dõi thêm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-slate-500"
                    disabled={deciding}
                    onClick={() => onDecide("IGNORED")}
                  >
                    Bỏ qua cảnh báo
                  </Button>
                </>
              )}
              {a.decisionActive && a.decision !== "" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deciding}
                  onClick={() => onDecide("")}
                >
                  Gỡ quyết định &quot;{DECISION_LABEL[a.decision]}&quot;
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Panel cấu hình luật ----------

function NumberField({
  label,
  value,
  onChange,
  suffix,
  step,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  disabled?: boolean;
}) {
  return (
    // Nhãn đậm màu chữ chính + hàng có nền nhạt để ô nhập nổi khỏi dòng mô tả (anh Trung 24/09:
    // "hơi chìm, khó quan sát để nhập liệu").
    <label className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
      <span className="font-medium text-slate-800">{label}</span>
      <span className="relative w-32 shrink-0">
        <Input
          type="number"
          inputMode="decimal"
          step={step ?? 1}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className={cn("text-right tabular-nums", suffix && "pr-8")}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

function RuleBlock({
  title,
  hint,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  hint: string;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        {onToggle && (
          <Switch checked={enabled ?? false} onCheckedChange={onToggle} aria-label={title} />
        )}
      </div>
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}

export function ShopeeAssistantConfigCard({
  config,
  onSave,
  saving,
  platformLabel = "Shopee",
}: {
  config: ShopeeAssistantConfig;
  onSave: (config: ShopeeAssistantConfig) => void;
  saving: boolean;
  /** Tên sàn cho câu cảnh báo mode live — executor GĐ3 chạy chung 2 sàn. */
  platformLabel?: string;
}) {
  const [draft, setDraft] = useState<ShopeeAssistantConfig>(config);
  // Server trả config mới (đổi gian / sau khi lưu) → đồng bộ lại bản nháp.
  useEffect(() => setDraft(config), [config]);

  function patch<K extends keyof ShopeeAssistantConfig>(
    key: K,
    value: Partial<ShopeeAssistantConfig[K]>
  ) {
    setDraft((prev) => ({
      ...prev,
      [key]:
        typeof prev[key] === "object"
          ? { ...(prev[key] as object), ...(value as object) }
          : value,
    }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="size-4.5 text-slate-500" />
          Cấu hình Trợ lý Tự động
        </CardTitle>
        <CardDescription>
          Luật riêng của gian đang chọn — mọi ngưỡng lãi/lỗ neo theo ROAS hòa vốn
          thật của từng chiến dịch, không phải con số đoán.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
          <RuleBlock
            title="Bật Trợ lý cho gian này"
            hint="Tắt là toàn bộ cột Trợ lý và cảnh báo biến mất — dữ liệu dashboard vẫn sync bình thường."
            enabled={draft.enabled}
            onToggle={(v) => setDraft((p) => ({ ...p, enabled: v }))}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <RuleBlock
              title="Sàn dữ liệu"
              hint="Chưa đủ chi tiêu/click thì Trợ lý không phán xét (ngưỡng chuẩn 7 ngày, cửa sổ ngắn tự hạ tương ứng)."
            >
              <NumberField
                label="Chi tiêu tối thiểu (7 ngày)"
                value={draft.floor.minSpend7d}
                onChange={(v) => patch("floor", { minSpend7d: v })}
                suffix="₫"
                step={10000}
                disabled={!draft.enabled}
              />
              <NumberField
                label="Click tối thiểu (7 ngày)"
                value={draft.floor.minClicks7d}
                onChange={(v) => patch("floor", { minClicks7d: v })}
                disabled={!draft.enabled}
              />
            </RuleBlock>
            <RuleBlock
              title="Tự thực thi (GĐ3)"
              hint="Trợ lý TỰ TẠM DỪNG chiến dịch dính 'Đề xuất tạm dừng' / 'Vọt chi'. Diễn tập = chỉ ghi sổ để anh/chị xem Trợ lý ĐỊNH làm gì; Thực thi thật chỉ nên bật sau khi đã tin bản diễn tập."
            >
              <label className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                <span className="font-medium text-slate-800">Chế độ</span>
                <select
                  value={draft.autoExecute.mode}
                  onChange={(e) =>
                    patch("autoExecute", {
                      mode: e.target.value as "off" | "dry_run" | "live",
                    })
                  }
                  disabled={!draft.enabled}
                  className="h-9 w-32 rounded-lg border border-input bg-background px-2 text-sm"
                  aria-label="Chế độ tự thực thi"
                >
                  <option value="off">Tắt</option>
                  <option value="dry_run">Diễn tập</option>
                  <option value="live">Thực thi thật</option>
                </select>
              </label>
              <NumberField
                label="Tối đa hành động/ngày"
                value={draft.autoExecute.maxActionsPerDay}
                onChange={(v) => patch("autoExecute", { maxActionsPerDay: v })}
                disabled={!draft.enabled || draft.autoExecute.mode === "off"}
              />
              {/* Đợt B (24/09): nấc hạ ngân sách trước khi tắt — chỉ Shopee có lệnh đổi ngân sách. */}
              {platformLabel === "Shopee" && (
                <label className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                  <span className="font-medium text-slate-800">
                    Hạ ngân sách trước, tắt sau
                    <HintIcon hint="Chiến dịch lỗ (Đề xuất tạm dừng) thì lần đầu Trợ lý chỉ HẠ ngân sách ngày về max(50% ngân sách, 70% chi tiêu trung bình ngày) để giữ chiến dịch sống, không mất học máy; ngày sau vẫn lỗ mới tạm dừng. Bật lại thì trả ngân sách cũ. Vọt chi vẫn tắt ngay. Tắt cờ này = tắt ngay như trước." />
                  </span>
                  <Switch
                    checked={draft.autoExecute.cutBudgetFirst}
                    onCheckedChange={(v) => patch("autoExecute", { cutBudgetFirst: v })}
                    disabled={!draft.enabled || draft.autoExecute.mode === "off"}
                    aria-label="Hạ ngân sách trước, tắt sau"
                  />
                </label>
              )}
              {draft.autoExecute.mode === "live" && (
                <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">
                  ⚠ Chế độ THẬT: Trợ lý sẽ gọi lệnh tạm dừng lên {platformLabel}.
                  Chiến dịch anh/chị đã bấm &quot;Bỏ qua&quot;/&quot;Theo
                  dõi&quot; sẽ không bị đụng. Mọi lệnh đều ghi vào Sổ hành động
                  bên dưới.
                </p>
              )}
            </RuleBlock>
            <RuleBlock
              title="Quy tắc 1 — Loại thẳng"
              hint="Tiêu quá mức cho phép mà 0 đơn, hoặc ROAS tụt dưới hòa vốn × hệ số → đề xuất tạm dừng ngay. Trong ngày, đơn từ quảng cáo về trễ vài giờ nên máy chỉ kết luận khi đã tiêu đủ mức này."
              enabled={draft.hard.enabled}
              onToggle={(v) => patch("hard", { enabled: v })}
            >
              <NumberField
                label="Mức tiêu tối đa cho phép thử (0 đơn hoặc ROAS dưới hòa vốn)"
                value={draft.hard.zeroOrderSpend7d}
                onChange={(v) => patch("hard", { zeroOrderSpend7d: v })}
                suffix="₫"
                step={10000}
                disabled={!draft.enabled || !draft.hard.enabled}
              />
              <NumberField
                label="Hệ số nguy hiểm (× hòa vốn)"
                value={draft.hard.breakevenFactor}
                onChange={(v) => patch("hard", { breakevenFactor: v })}
                step={0.05}
                disabled={!draft.enabled || !draft.hard.enabled}
              />
            </RuleBlock>
            <RuleBlock
              title="Quy tắc 2 — Vùng vàng chờ duyệt"
              hint="ROAS trên hòa vốn nhưng chưa vượt vùng an toàn — lãi mỏng, cần người quyết."
              enabled={draft.review.enabled}
              onToggle={(v) => patch("review", { enabled: v })}
            >
              <NumberField
                label="Vùng an toàn (× hòa vốn)"
                value={draft.review.dangerFactor}
                onChange={(v) => patch("review", { dangerFactor: v })}
                step={0.05}
                disabled={!draft.enabled || !draft.review.enabled}
              />
            </RuleBlock>
            <RuleBlock
              title="Quy tắc 3 — Vọt chi trong ngày"
              hint="Hôm nay tiêu gấp nhiều lần trung bình ngày mà ROAS dưới hòa vốn → báo ngay, không chờ đủ mẫu."
              enabled={draft.spike.enabled}
              onToggle={(v) => patch("spike", { enabled: v })}
            >
              <NumberField
                label="Gấp bao nhiêu lần trung bình"
                value={draft.spike.dayMultiple}
                onChange={(v) => patch("spike", { dayMultiple: v })}
                step={0.5}
                disabled={!draft.enabled || !draft.spike.enabled}
              />
              <NumberField
                label="Chi tiêu hôm nay tối thiểu"
                value={draft.spike.minTodaySpend}
                onChange={(v) => patch("spike", { minTodaySpend: v })}
                suffix="₫"
                step={10000}
                disabled={!draft.enabled || !draft.spike.enabled}
              />
            </RuleBlock>
            <RuleBlock
              title="Quy tắc 4 — Bảo vệ công thần"
              hint="Chiến dịch nhiều đơn vi phạm Q1/Q2 chỉ bị hạ xuống 'theo dõi sát', không đề xuất cắt ngay."
              enabled={draft.grace.enabled}
              onToggle={(v) => patch("grace", { enabled: v })}
            >
              <NumberField
                label="Ngưỡng công thần (đơn/7 ngày)"
                value={draft.grace.minOrders7d}
                onChange={(v) => patch("grace", { minOrders7d: v })}
                disabled={!draft.enabled || !draft.grace.enabled}
              />
            </RuleBlock>
          </div>
          <div className="flex items-center justify-end gap-3 border-t pt-3">
            <p className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-emerald-500" />
              Trợ lý chỉ đề xuất — không tự thao tác lên sàn.
            </p>
            <Button size="sm" onClick={() => onSave(draft)} disabled={saving}>
              {saving ? "Đang lưu…" : "Lưu cấu hình"}
            </Button>
          </div>
        </CardContent>
    </Card>
  );
}

// ---------- Sổ hành động (GĐ3) ----------

const ACTION_STATUS_META: Record<string, { label: string; className: string }> = {
  PLANNED: { label: "Diễn tập", className: "bg-sky-100 text-sky-700" },
  PENDING: { label: "Đang gửi", className: "bg-slate-100 text-slate-500" },
  SUCCESS: { label: "Đã tạm dừng", className: "bg-emerald-500 text-white" },
  FAILED: { label: "Sàn từ chối", className: "bg-red-100 text-red-700" },
  /** Seller bật lại trên Seller Center sau khi Hubsell dừng → ván mới (14/09). */
  OVERRIDDEN: { label: "Seller đã bật lại", className: "bg-violet-100 text-violet-700" },
};

/** Nhãn trạng thái theo LOẠI hành động — lệnh bật lại có cùng status nhưng nghĩa khác. */
function actionStatusMeta(l: ShopeeAdsActionLogRow): { label: string; className: string } {
  // Thao tác NGOÀI Hubsell nhìn thấy khi đồng bộ (anh Trung 14/09: ghi để sổ là
  // dòng thời gian đầy đủ, khách "tự nhiên tắt" là thấy ngay ai tắt).
  if (l.mode === "marketplace") {
    return l.action === "resume"
      ? { label: "Bật trên sàn", className: "bg-slate-200 text-slate-700" }
      : { label: "Tắt trên sàn", className: "bg-slate-200 text-slate-700" };
  }
  if (l.action === "resume") {
    if (l.status === "SUCCESS")
      return {
        label: l.mode === "manual" ? "Seller bật lại (Hubsell)" : "Máy đã bật lại",
        className: "bg-emerald-500 text-white",
      };
    if (l.status === "PLANNED") return { label: "Diễn tập bật lại", className: "bg-sky-100 text-sky-700" };
  }
  // Đợt B: hạ / trả ngân sách — cùng status nhưng nghĩa khác lệnh tạm dừng.
  if (l.action === "cut_budget") {
    if (l.status === "SUCCESS") return { label: "Máy đã hạ ngân sách", className: "bg-violet-600 text-white" };
    if (l.status === "PLANNED") return { label: "Diễn tập hạ ngân sách", className: "bg-sky-100 text-sky-700" };
    if (l.status === "OVERRIDDEN") return { label: "Seller đã đổi ngân sách", className: "bg-violet-100 text-violet-700" };
  }
  if (l.action === "restore_budget") {
    if (l.status === "SUCCESS")
      return {
        label: l.mode === "manual" ? "Seller trả ngân sách (Hubsell)" : "Máy đã trả ngân sách",
        className: "bg-emerald-500 text-white",
      };
  }
  return ACTION_STATUS_META[l.status] ?? { label: l.status, className: "bg-slate-100 text-slate-500" };
}

/** Kết luận nhìn từ những ngày SAU lần máy định dừng (bảng điểm, bước 6 14/09). */
const SCORECARD_OUTCOME: Record<
  AdsScorecardRow["outcome"],
  { label: string; className: string }
> = {
  right: { label: "Máy đúng — vẫn lỗ", className: "bg-emerald-500 text-white" },
  wrong: { label: "Máy sai — ROAS đã đạt, chạy thật sẽ tự bật lại", className: "bg-amber-100 text-amber-700" },
  pending: { label: "Chưa đủ số", className: "bg-slate-100 text-slate-500" },
};

export function ShopeeActionLogCard({
  channelId,
  platform = "shopee",
  scorecard = null,
  rangePhrase,
}: {
  channelId: string;
  platform?: "shopee" | "lazada";
  /** Bảng điểm theo khoảng đang xem (anh Trung 14/09: gộp vào Sổ hành động, không tách card riêng ở Tổng quan). */
  scorecard?: AdsAssistantScorecard | null;
  /** Cụm từ khoảng đang xem của trang ("7 ngày qua", "từ … đến …") cho câu bảng điểm. */
  rangePhrase?: string;
}) {
  const [logs, setLogs] = useState<ShopeeAdsActionLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Phân trang 20 dòng/trang (anh Trung 14/09) — sổ nạp tối đa 100 dòng gần nhất.
  const LOG_PAGE_SIZE = 20;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(logs.length / LOG_PAGE_SIZE));
  const pagedLogs = logs.slice(page * LOG_PAGE_SIZE, (page + 1) * LOG_PAGE_SIZE);
  const outcomeByCampaign = new Map(
    (scorecard?.planned.rows ?? []).map((r) => [r.campaignRowId, r] as const)
  );
  const liveTotal = scorecard
    ? scorecard.live.paused + scorecard.live.resumed + scorecard.live.resumedByOwner + scorecard.live.failed
    : 0;
  const showSummary = !!scorecard && (scorecard.planned.count > 0 || liveTotal > 0);

  const load = async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const res = await fetchShopeeAdsActionLog(channelId, 100, platform);
      setLogs(res.logs);
      setPage(0);
    } catch {
      // gian chưa có sổ / lỗi mạng — bảng rỗng là đủ thông tin
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, platform]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Sổ hành động &amp; bảng điểm Trợ lý</CardTitle>
            <CardDescription className="mt-1.5">
              Mọi lần Trợ lý định (diễn tập) hoặc đã (thật) tạm dừng / bật lại
              chiến dịch — kèm căn cứ lúc đó và kết luận nhìn từ những ngày sau:
              vẫn lỗ là máy đúng, ROAS đạt là máy sai (chạy thật máy tự bật lại).
              Thao tác tắt/bật trên Seller Center cũng được ghi (&quot;Tắt trên sàn&quot;,
              &quot;Bật trên sàn&quot;) để dòng thời gian đầy đủ — Hubsell không can
              thiệp các dòng đó. Anh/chị bật lại trên Seller Center thì Trợ lý coi là ván mới.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Đang tải…" : "Làm mới"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showSummary && scorecard && (
          <div className="space-y-3 rounded-lg border bg-slate-50 p-3.5">
            {scorecard.planned.count > 0 && (
              <p className="text-sm text-slate-700">
                {capitalizePhrase(rangePhrase ?? `${scorecard.days} ngày qua`)}, nếu bật chế độ Thật thì Hubsell đã tạm dừng{" "}
                <b>{formatNumber(scorecard.planned.count)}</b> chiến dịch. Máy đúng{" "}
                <b className="text-emerald-600">{formatNumber(scorecard.planned.right)}</b>, sai{" "}
                <b className="text-amber-600">{formatNumber(scorecard.planned.wrong)}</b>, chưa đủ
                số {formatNumber(scorecard.planned.pending)}. Tiền lẽ ra tiết kiệm được:{" "}
                <b className="tabular-nums">{formatVND(scorecard.planned.savingsIfLive)}</b>.
                {scorecard.mode === "dry_run" && scorecard.planned.right > 0 && (
                  <span className="text-slate-500">
                    {" "}
                    Thấy máy phán đúng thì gạt sang chế độ Thật ở khối Tự thực thi phía trên.
                  </span>
                )}
              </p>
            )}
            {liveTotal > 0 && (
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "Máy đã tạm dừng", value: scorecard.live.paused, tone: "text-red-600" },
                  { label: "Máy tự bật lại", value: scorecard.live.resumed, tone: "text-emerald-600" },
                  {
                    label: "Anh/chị bật lại",
                    value: scorecard.live.resumedByOwner + scorecard.live.overridden,
                    tone: "text-violet-600",
                  },
                  { label: "Sàn từ chối", value: scorecard.live.failed, tone: "text-amber-600" },
                ].map((t) => (
                  <div key={t.label} className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-muted-foreground">{t.label}</p>
                    <p className={cn("text-2xl font-semibold tabular-nums", t.tone)}>
                      {formatNumber(t.value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có hành động nào. Bật chế độ &quot;Diễn tập&quot; ở trên để xem
            Trợ lý định làm gì với các chiến dịch đang bị gắn cờ.
          </p>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Thời gian</th>
                  <th className="py-2 pr-3 font-medium">Chiến dịch</th>
                  <th className="py-2 pr-3 font-medium">Trạng thái</th>
                  <th className="py-2 font-medium">Căn cứ</th>
                </tr>
              </thead>
              <tbody>
                {pagedLogs.map((l) => {
                  const meta = actionStatusMeta(l);
                  const verdictMeta =
                    l.verdict in VERDICT_META
                      ? VERDICT_META[l.verdict as keyof typeof VERDICT_META]
                      : l.verdict === "roas_recovered"
                        ? { label: "ROAS đã đạt lại", className: "" }
                        : null;
                  return (
                    <tr key={l.id} className="border-b last:border-0 align-top">
                      <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-slate-600">
                        {new Date(l.createdAt).toLocaleString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </td>
                      {/* Tên cắt ngắn + tooltip tên đầy đủ khi rê chuột (anh Trung 14/09) */}
                      <td
                        className="max-w-44 truncate py-2.5 pr-3 text-slate-900"
                        title={l.campaignName}
                      >
                        {l.campaignName}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge className={meta.className}>{meta.label}</Badge>
                          {verdictMeta && (
                            <span className="text-xs text-slate-500">
                              vì: {verdictMeta.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-xs text-slate-600">
                        {l.reasons.map((r, i) => (
                          <p key={i}>• {r}</p>
                        ))}
                        {(() => {
                          // Kết luận nhìn từ những ngày SAU — chỉ với lần máy ĐỊNH dừng (diễn tập).
                          const oc =
                            l.action === "pause" && l.status === "PLANNED"
                              ? outcomeByCampaign.get(l.adsCampaignId)
                              : undefined;
                          if (!oc) return null;
                          const meta = SCORECARD_OUTCOME[oc.outcome];
                          return (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <Badge className={meta.className}>{meta.label}</Badge>
                              <span className="tabular-nums text-slate-500">
                                Sau đó: tiêu thêm {formatVND(oc.spendAfter)} ({formatNumber(oc.ordersAfter)} đơn),
                                ROAS {oc.roasAfter != null ? `${oc.roasAfter.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x` : "—"} / hòa vốn{" "}
                                {oc.breakevenRoas != null ? `${oc.breakevenRoas.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x` : "—"}
                              </span>
                            </div>
                          );
                        })()}
                        {l.error && (
                          <p className="mt-1 text-red-600">Lỗi sàn: {l.error}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pageCount > 1 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Trang {page + 1}/{pageCount} · {formatNumber(logs.length)} dòng gần nhất
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Trang trước
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  >
                    Trang sau
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Dòng tóm tắt số cảnh báo cho banner. */
export function assistantBannerText(counts: {
  spike: number;
  pauseNow: number;
  grace: number;
  review: number;
}): string {
  const parts: string[] = [];
  if (counts.spike > 0) parts.push(`${formatNumber(counts.spike)} vọt chi hôm nay`);
  if (counts.pauseNow > 0)
    parts.push(`${formatNumber(counts.pauseNow)} đề xuất tạm dừng`);
  if (counts.review > 0) parts.push(`${formatNumber(counts.review)} cần duyệt`);
  if (counts.grace > 0) parts.push(`${formatNumber(counts.grace)} công thần theo dõi sát`);
  return parts.join(" · ");
}
