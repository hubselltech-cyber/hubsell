"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Loader2,
  MessageCircle,
  PencilLine,
  SendHorizontal,
  Star,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  classifyReviewTag,
  generateReviewReply,
} from "@/components/operations/copilot-engine";
import {
  channelMeta,
  REVIEW_TAG_META,
  type OpsChannel,
  type ReviewTag,
} from "@/components/operations/mock-data";
import {
  loadReviewAutoReplyConfig,
  pickRandomReply,
  type ReplyTemplates,
} from "@/components/operations/reply-templates";
import { humanizeChannelError } from "@/components/operations/channel-error";
import { OperationsFrame } from "@/components/operations/operations-frame";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  fetchOpsReviews,
  replyOpsReview,
  type OpsChannelError,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * PHẢN HỒI ĐÁNH GIÁ — HỢP NHẤT SHOPEE + LAZADA
 *
 * CHẠY 2 CHẾ ĐỘ như Trợ lý Chat:
 *   · real — đánh giá kéo LIVE từ sàn qua /api/operations/reviews; nút "Gửi
 *     ngay" và bulk 5 sao GỬI THẬT lên sàn (Shopee reply_comment / Lazada
 *     reply/add). Câu gợi ý sinh rule-based theo nhãn phân loại (thay bằng
 *     LLM thật sau — hợp đồng giữ nguyên).
 *   · Không có đánh giá → empty state (09/09/2026: bỏ hẳn bộ mock/demo).
 *
 * TỰ ĐỘNG PHẢN HỒI THEO SỐ SAO (cấu hình ở trang Cấu hình tự động hóa):
 *   10/10/2026 chuyển hẳn về máy chủ — worker backend (workers/review-auto-reply)
 *   tự trả lời MỖI NGÀY MỘT LẦN cho mức sao đang bật, không cần mở trang này.
 *   Trang chỉ hiển thị: badge "AI Auto" lấy từ sổ review_auto_replies (cờ
 *   autoReplied của API), bộ mẫu lấy từ cấu hình máy chủ để soạn gợi ý.
 *
 * Bố cục 2 cột: feed đánh giá (trái) + AI Reply Builder sticky (phải).
 */

type PageMode = "loading" | "real";
type ChannelFilter = "ALL" | "SHOPEE" | "LAZADA" | "TIKTOK";
type StarFilter = "ALL" | "1" | "2" | "3" | "4" | "5";
type StatusFilter = "ALL" | "UNREPLIED" | "REPLIED";
/** WITH_COMMENT = có chữ/ảnh; RATING_ONLY = khách chỉ chấm sao. */
type ContentFilter = "ALL" | "WITH_COMMENT" | "RATING_ONLY";

/** Dòng đánh giá cho render. */
interface ReviewRow {
  id: string;
  customer: string;
  channel: OpsChannel;
  /** Khoá lọc gian hàng = channelId. */
  shopKey: string;
  shopLabel: string;
  /** Tên shop trần (không kèm tên sàn) — đổ vào biến {TEN_SHOP} của mẫu câu. */
  shopName: string;
  productName: string;
  rating: number;
  content: string;
  replied: boolean;
  /** true = phản hồi do worker TỰ ĐỘNG gửi (sổ máy chủ) — badge "AI Auto". */
  autoReplied?: boolean;
  createdAt: string;
  tag: ReviewTag;
  aiSuggestion: string;
  /** Chỉ chế độ real — toạ độ để gọi API trả lời. */
  channelId?: string;
  externalId?: string;
}

function fmtDate(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Dãy sao vàng — sao rỗng tô slate nhạt để giữ nguyên bề rộng hàng. */
function StarRow({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} sao`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "size-3.5",
            i <= rating ? "fill-amber-400 text-amber-400" : "text-slate-200"
          )}
        />
      ))}
    </span>
  );
}

export function OperationsReviewsPage() {
  const [mode, setMode] = useState<PageMode>("loading");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [channelErrors, setChannelErrors] = useState<OpsChannelError[]>([]);

  // ── Bộ lọc đa cấp: Sàn → Gian hàng → Số sao → Nội dung → Trạng thái ──
  // Lọc HOÀN TOÀN phía client trên rows đã tải MỘT lần lúc vào trang — đổi
  // filter không refetch nên không có chuyện lặp request lên sàn.
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("ALL");
  const [shopFilter, setShopFilter] = useState("ALL");
  const [starFilter, setStarFilter] = useState<StarFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  // Bộ mẫu câu của shop (máy chủ) — null khi chưa nạp/lỗi thì dùng câu engine.
  const [templates, setTemplates] = useState<ReplyTemplates | null>(null);
  useEffect(() => {
    loadReviewAutoReplyConfig()
      .then((c) => setTemplates(c.templates))
      .catch(() => {});
  }, []);

  // ── Nạp đánh giá thật: lần đầu khi vào trang, sau đó làm mới 5 phút/lần
  // khi trang đang mở. Lượt sau lỗi/trống thì GIỮ dữ liệu đang có. ──
  const loadingRef = useRef(false);
  const loadReviews = useCallback(async (initial: boolean) => {
    if (loadingRef.current) return; // lượt trước chưa xong thì bỏ qua nhịp này
    loadingRef.current = true;
    try {
      const r = await fetchOpsReviews();
      setChannelErrors(r.errors);
      if (r.reviews.length > 0) {
        // Review có trong sổ tự trả lời coi như ĐÃ trả lời kể cả khi sàn
        // trả dữ liệu trễ (reply rỗng ở lượt quét ngay sau khi gửi).
        setRows(
          r.reviews.map((rv) => {
            const tag = classifyReviewTag(rv.rating, rv.content);
            return {
              id: rv.id,
              customer: rv.customer,
              channel: rv.channelName as OpsChannel,
              shopKey: rv.channelId,
              shopLabel: `${channelMeta(rv.channelName).label} — ${rv.shopName}`,
              shopName: rv.shopName,
              productName: rv.productName,
              rating: rv.rating,
              content: rv.content,
              replied: (rv.reply != null && rv.reply !== "") || !!rv.autoReplied,
              autoReplied: !!rv.autoReplied,
              createdAt: fmtDate(rv.createdAt),
              tag,
              aiSuggestion: generateReviewReply({
                customer: rv.customer,
                rating: rv.rating,
                productName: rv.productName,
                tag,
              }),
              channelId: rv.channelId,
              externalId: rv.externalId,
            };
          })
        );
        setMode("real");
      } else if (initial) {
        setMode("real");
      }
    } catch (err) {
      if (initial) {
        if (err instanceof ApiError && err.status !== 401) {
          setChannelErrors([{ channelId: "", shopName: "Hệ thống", message: err.message }]);
        }
        setMode("real");
      } // lượt quét định kỳ lỗi → im lặng, giữ dữ liệu cũ chờ nhịp sau
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadReviews(true);
    const timer = setInterval(() => loadReviews(false), 5 * 60_000);
    return () => clearInterval(timer);
  }, [loadReviews]);


  // Tuỳ chọn lọc gian hàng dựng từ chính dữ liệu đang hiển thị, THU HẸP theo
  // sàn đang chọn (chọn Shopee thì dropdown shop chỉ còn shop Shopee)
  const shopOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (channelFilter !== "ALL" && r.channel !== channelFilter) continue;
      if (!seen.has(r.shopKey)) seen.set(r.shopKey, r.shopLabel);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows, channelFilter]);

  /** Đổi sàn thì reset chọn shop — shop cũ có thể không thuộc sàn mới. */
  function changeChannelFilter(next: ChannelFilter) {
    setChannelFilter(next);
    setShopFilter("ALL");
  }

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (channelFilter === "ALL" || r.channel === channelFilter) &&
          (shopFilter === "ALL" || r.shopKey === shopFilter) &&
          (starFilter === "ALL" || r.rating === Number(starFilter)) &&
          (statusFilter === "ALL" ||
            (statusFilter === "REPLIED" ? r.replied : !r.replied)) &&
          (contentFilter === "ALL" ||
            (contentFilter === "WITH_COMMENT"
              ? r.content.trim() !== ""
              : r.content.trim() === ""))
      ),
    [rows, channelFilter, shopFilter, starFilter, statusFilter, contentFilter]
  );

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // ── Chỉ số thẻ tổng quan — suy trực tiếp từ danh sách để luôn khớp feed ──
  const fiveStarRate =
    rows.length > 0
      ? (rows.filter((r) => r.rating === 5).length / rows.length) * 100
      : 0;
  const unreplied = rows.filter((r) => !r.replied);
  const urgentBad = unreplied.filter((r) => r.rating <= 3);
  const bulkTargets = unreplied.filter((r) => r.rating === 5);

  /** Câu trả lời cho một đánh giá: RANDOM từ 5 mẫu của mức sao tương ứng
   *  (chống sàn phạt trùng nội dung); user xoá hết mẫu thì rơi về câu engine. */
  function suggestionFor(r: ReviewRow): string {
    return (
      pickRandomReply(templates, r.rating, {
        customer: r.customer,
        shopName: r.shopName,
        productName: r.productName,
      }) ?? r.aiSuggestion
    );
  }

  function selectReview(id: string) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    setSelectedId(id);
    setDraft(suggestionFor(r));
    setEditing(false);
  }

  function markReplied(ids: Set<string>) {
    setRows((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, replied: true } : r)));
  }

  async function sendReply() {
    if (!selected || sendingReply) return;
    setSendingReply(true);
    try {
      await replyOpsReview({
        channelId: selected.channelId!,
        reviewId: selected.externalId!,
        content: draft.trim(),
      });
      markReplied(new Set([selected.id]));
      setSelectedId(null);
      setDraft("");
      toast.success(`Đã gửi phản hồi lên ${channelMeta(selected.channel).label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gửi phản hồi thất bại");
    } finally {
      setSendingReply(false);
    }
  }

  async function bulkAutoReply() {
    if (bulkTargets.length === 0 || bulkRunning) return;
    // GỬI THẬT lên sàn — chạy TUẦN TỰ cho nhẹ rate limit; gom kết quả cuối.
    setBulkRunning(true);
    let ok = 0;
    const done = new Set<string>();
    let firstError = "";
    for (const r of bulkTargets) {
      try {
        await replyOpsReview({
          channelId: r.channelId!,
          reviewId: r.externalId!,
          // Mỗi đánh giá bốc một mẫu NGẪU NHIÊN khác nhau — chống spam trùng
          content: suggestionFor(r),
        });
        done.add(r.id);
        ok++;
      } catch (err) {
        if (!firstError) firstError = err instanceof Error ? err.message : "lỗi không rõ";
      }
    }
    markReplied(done);
    setBulkRunning(false);
    if (ok > 0) toast.success(`AI đã trả lời ${formatNumber(ok)} đánh giá 5 sao lên sàn.`);
    if (ok < bulkTargets.length)
      toast.error(
        `${formatNumber(bulkTargets.length - ok)} đánh giá gửi thất bại${firstError ? ` — ${firstError}` : ""}`
      );
  }

  if (mode === "loading") {
    return (
      <OperationsFrame>
        <Card className="flex min-h-[420px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang tải đánh giá từ các gian hàng…
          </div>
        </Card>
      </OperationsFrame>
    );
  }

  return (
    <OperationsFrame>
      {/* ===== NHÃN NGUỒN DỮ LIỆU + LỖI TỪNG GIAN ===== */}
      <div className="flex flex-wrap items-center gap-2">
        {channelErrors.map((e) => {
          const h = humanizeChannelError(e, "reviews");
          return (
            <span
              key={`${e.channelId}-${e.message}`}
              className={cn(TEXT_SUB, "text-amber-700")}
              title={h.detail}
            >
              {h.text}
            </span>
          );
        })}
      </div>

      {/* ===== THẺ THỐNG KÊ TỔNG QUAN ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tỷ lệ đánh giá 5 sao"
          value={`${fiveStarRate.toFixed(1).replace(".", ",")}%`}
          icon={Star}
          tone="positive"
          subtitle="Trên dữ liệu đã tải"
        />
        <StatCard
          label="Chưa trả lời"
          value={formatNumber(unreplied.length)}
          icon={MessageCircle}
          subtitle="Trên các gian đã nối"
        />
        <StatCard
          label="Đánh giá xấu cần xử lý gấp"
          value={formatNumber(urgentBad.length)}
          icon={TriangleAlert}
          tone="negative"
          colorValue
          featured
          subtitle="1–3 sao chưa phản hồi"
        />
        <StatCard
          label="Đã trả lời"
          value={formatNumber(rows.filter((r) => r.replied).length)}
          icon={Bot}
          subtitle="Gồm cả trả lời tay trên sàn"
        />
      </div>

      {/* ===== BỘ LỌC ĐA CẤP: Sàn → Gian hàng → Số sao → Nội dung → Trạng thái ===== */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <NativeSelect
            className="w-full sm:w-44"
            value={channelFilter}
            onChange={(e) => changeChannelFilter(e.target.value as ChannelFilter)}
            aria-label="Lọc theo sàn"
          >
            <option value="ALL">Tất cả sàn</option>
            <option value="SHOPEE">Shopee</option>
            <option value="LAZADA">Lazada</option>
            <option value="TIKTOK" disabled>
              TikTok Shop (sắp có)
            </option>
          </NativeSelect>
          <NativeSelect
            className="w-full sm:w-60"
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            aria-label="Chọn gian hàng"
          >
            <option value="ALL">Tất cả gian hàng</option>
            {shopOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="w-full sm:w-36"
            value={starFilter}
            onChange={(e) => setStarFilter(e.target.value as StarFilter)}
            aria-label="Lọc theo số sao"
          >
            <option value="ALL">Tất cả số sao</option>
            {[5, 4, 3, 2, 1].map((s) => (
              <option key={s} value={String(s)}>
                {s} sao
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="w-full sm:w-60"
            value={contentFilter}
            onChange={(e) => setContentFilter(e.target.value as ContentFilter)}
            aria-label="Lọc theo nội dung đánh giá"
          >
            <option value="ALL">Mọi nội dung</option>
            <option value="WITH_COMMENT">💬 Có bình luận chữ/hình ảnh</option>
            <option value="RATING_ONLY">⭐ Chỉ có sao (không bình luận)</option>
          </NativeSelect>
          <NativeSelect
            className="w-full sm:w-40"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Lọc theo trạng thái"
          >
            <option value="ALL">Mọi trạng thái</option>
            <option value="UNREPLIED">Chưa trả lời</option>
            <option value="REPLIED">Đã trả lời</option>
          </NativeSelect>
          <p className={cn(TEXT_SUB, "ml-auto")}>
            {formatNumber(filtered.length)} / {formatNumber(rows.length)} đánh giá
          </p>
        </CardContent>
      </Card>

      {/* ===== 2 CỘT: FEED ĐÁNH GIÁ + AI REPLY BUILDER ===== */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ----- CỘT TRÁI: DANH SÁCH ĐÁNH GIÁ ----- */}
        <div className="space-y-3">
          {filtered.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Không có đánh giá nào khớp bộ lọc.
              </CardContent>
            </Card>
          )}
          {filtered.map((r) => {
            const active = r.id === selectedId;
            return (
              <Card
                key={r.id}
                className={cn(
                  "cursor-pointer transition-colors",
                  active ? "border-primary/60 ring-2 ring-primary/20" : "hover:border-slate-300"
                )}
                onClick={() => selectReview(r.id)}
              >
                <CardContent className="space-y-2.5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-slate-600">
                      {(r.customer || "?").charAt(0)}
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{r.customer}</span>
                    <StarRow rating={r.rating} />
                    <span className={cn(TEXT_SUB, "ml-auto shrink-0")}>{r.createdAt}</span>
                  </div>

                  {r.content ? (
                    <p className="text-sm text-slate-900">{r.content}</p>
                  ) : (
                    <p className="text-sm italic text-slate-400">
                      (Khách chấm sao, không viết nội dung)
                    </p>
                  )}
                  <p className={TEXT_SUB}>{r.productName}</p>

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <Badge variant="outline" className={channelMeta(r.channel).badgeClass}>
                      {channelMeta(r.channel).label}
                    </Badge>
                    <Badge variant="outline" className={REVIEW_TAG_META[r.tag].badgeClass}>
                      AI: {REVIEW_TAG_META[r.tag].label}
                    </Badge>
                    {r.autoReplied && (
                      <Badge
                        variant="outline"
                        className="border-violet-200 bg-violet-50 text-violet-700"
                      >
                        🤖 AI Auto
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={cn(
                        "ml-auto",
                        r.replied
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      )}
                    >
                      {r.replied ? "Đã trả lời" : "Chưa trả lời"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ----- CỘT PHẢI: AI REPLY BUILDER (sticky) ----- */}
        <div className="space-y-4 lg:sticky lg:top-20">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4.5 text-violet-600" />
                Soạn phản hồi
              </CardTitle>
              <CardDescription>
                Chọn một đánh giá bên trái — AI soạn sẵn câu trả lời CSKH, bạn sửa
                lại hoặc gửi thẳng lên sàn.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selected ? (
                <>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {selected.customer}
                      </span>
                      <StarRow rating={selected.rating} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                      {selected.content || "(không có nội dung)"}
                    </p>
                  </div>

                  {editing ? (
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={7}
                      className="w-full rounded-lg border border-input bg-background p-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label="Sửa câu trả lời"
                    />
                  ) : (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm text-slate-900">
                      {draft}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditing((v) => !v)}
                    >
                      <PencilLine className="size-4" />
                      {editing ? "Xong" : "Sửa"}
                    </Button>
                    <Button size="sm" className="flex-1" onClick={sendReply} disabled={sendingReply}>
                      {sendingReply ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <SendHorizontal className="size-4" />
                      )}
                      Gửi ngay
                    </Button>
                  </div>
                </>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Chưa chọn đánh giá nào.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Nút bulk tách khỏi builder: thao tác trên CẢ danh sách */}
          <Card className="border-violet-200">
            <CardContent className="space-y-2 py-4">
              <Button
                className="w-full bg-violet-600 text-white hover:bg-violet-700"
                disabled={bulkTargets.length === 0 || bulkRunning}
                onClick={bulkAutoReply}
              >
                {bulkRunning && <Loader2 className="size-4 animate-spin" />}
                Tự động trả lời hàng loạt {formatNumber(bulkTargets.length)} đánh giá 5 sao
              </Button>
              <p className={cn(TEXT_SUB, "text-center")}>
                Nút này chỉ áp dụng cho đánh giá 5 sao chưa trả lời — gửi thẳng
                lên sàn. Muốn hệ thống tự gửi mỗi ngày theo từng mức sao, bật công
                tắc ở trang Cấu hình tự động hóa.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </OperationsFrame>
  );
}
