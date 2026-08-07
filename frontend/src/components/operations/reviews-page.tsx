"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  MessageCircle,
  PencilLine,
  SendHorizontal,
  Star,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { CHANNEL_META, MOCK_REVIEWS, MOCK_SHOPS, REVIEW_TAG_META } from "@/components/operations/mock-data";
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
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * PHẢN HỒI ĐÁNH GIÁ — MÀN HÌNH MOCKUP (PREVIEW)
 *
 * Bố cục 2 cột chuẩn SaaS: trái là FEED đánh giá (không dùng bảng — nội dung
 * đánh giá dài ngắn thất thường, feed đọc nhanh hơn và giống ngữ cảnh CSKH
 * quen thuộc trên Seller Center), phải là khối AI Reply Builder ghim sticky.
 *
 * Toàn bộ số liệu suy ra từ MOCK_REVIEWS phía client — logic lọc/gửi/bulk là
 * thật, chỉ nguồn dữ liệu là mock. Khi nối API đánh giá của sàn, thay mock
 * bằng fetch + mutation là khung này chạy được ngay.
 */

type StarFilter = "ALL" | "1" | "2" | "3" | "4" | "5";
type StatusFilter = "ALL" | "UNREPLIED" | "REPLIED";

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
  const [reviews, setReviews] = useState(MOCK_REVIEWS);
  const [shopFilter, setShopFilter] = useState("ALL");
  const [starFilter, setStarFilter] = useState<StarFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bản nháp đang sửa trong builder — gieo từ gợi ý AI khi chọn đánh giá
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const filtered = useMemo(
    () =>
      reviews.filter(
        (r) =>
          (shopFilter === "ALL" || r.shopId === shopFilter) &&
          (starFilter === "ALL" || r.rating === Number(starFilter)) &&
          (statusFilter === "ALL" ||
            (statusFilter === "REPLIED" ? r.replied : !r.replied))
      ),
    [reviews, shopFilter, starFilter, statusFilter]
  );

  const selected = reviews.find((r) => r.id === selectedId) ?? null;

  // ── Chỉ số thẻ tổng quan — suy trực tiếp từ danh sách để luôn khớp feed ──
  const fiveStarRate =
    (reviews.filter((r) => r.rating === 5).length / reviews.length) * 100;
  const unreplied = reviews.filter((r) => !r.replied);
  // "Xấu cần xử lý gấp" = 1–3 sao chưa trả lời: để lâu là sàn trừ điểm shop
  const urgentBad = unreplied.filter((r) => r.rating <= 3);
  // Ứng viên bulk: 5 sao chưa trả lời — AI trả lời hàng loạt an toàn vì khen
  // thì cảm ơn là đủ, không cần người duyệt từng câu như đánh giá xấu
  const bulkTargets = unreplied.filter((r) => r.rating === 5);

  function selectReview(id: string) {
    const r = reviews.find((x) => x.id === id);
    if (!r) return;
    setSelectedId(id);
    setDraft(r.aiSuggestion);
    setEditing(false);
  }

  function sendReply() {
    if (!selected) return;
    setReviews((prev) =>
      prev.map((r) => (r.id === selected.id ? { ...r, replied: true } : r))
    );
    setSelectedId(null);
    setDraft("");
    toast.success(`Đã gửi phản hồi tới ${selected.customer} (preview).`);
  }

  function bulkAutoReply() {
    if (bulkTargets.length === 0) return;
    const ids = new Set(bulkTargets.map((r) => r.id));
    setReviews((prev) =>
      prev.map((r) => (ids.has(r.id) ? { ...r, replied: true } : r))
    );
    toast.success(
      `AI đã tự động trả lời ${formatNumber(bulkTargets.length)} đánh giá 5 sao (preview).`
    );
  }

  return (
    <OperationsFrame>
      {/* ===== THẺ THỐNG KÊ TỔNG QUAN ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tỷ lệ đánh giá 5 sao"
          value={`${fiveStarRate.toFixed(1).replace(".", ",")}%`}
          icon={Star}
          tone="positive"
          subtitle="30 ngày gần nhất"
        />
        <StatCard
          label="Chưa trả lời"
          value={formatNumber(unreplied.length)}
          icon={MessageCircle}
          subtitle="Trên cả 3 sàn"
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
          label="AI trả lời tự động"
          value={formatNumber(reviews.filter((r) => r.replied).length)}
          icon={Bot}
          subtitle="Trong kỳ (demo)"
        />
      </div>

      {/* ===== BỘ LỌC ===== */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <NativeSelect
            className="w-full sm:w-56"
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            aria-label="Chọn gian hàng"
          >
            <option value="ALL">Tất cả gian hàng</option>
            {MOCK_SHOPS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            className="w-full sm:w-40"
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
            className="w-full sm:w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Lọc theo trạng thái"
          >
            <option value="ALL">Mọi trạng thái</option>
            <option value="UNREPLIED">Chưa trả lời</option>
            <option value="REPLIED">Đã trả lời</option>
          </NativeSelect>
          <p className={cn(TEXT_SUB, "ml-auto")}>
            {formatNumber(filtered.length)} / {formatNumber(reviews.length)} đánh giá
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
                  active
                    ? "border-primary/60 ring-2 ring-primary/20"
                    : "hover:border-slate-300"
                )}
                onClick={() => selectReview(r.id)}
              >
                <CardContent className="space-y-2.5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-slate-600">
                      {r.customer.charAt(0)}
                    </div>
                    <span className="text-sm font-semibold text-slate-900">
                      {r.customer}
                    </span>
                    <StarRow rating={r.rating} />
                    <span className={cn(TEXT_SUB, "ml-auto shrink-0")}>
                      {r.createdAt}
                    </span>
                  </div>

                  <p className="text-sm text-slate-900">{r.content}</p>
                  <p className={TEXT_SUB}>{r.product}</p>

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <Badge
                      variant="outline"
                      className={CHANNEL_META[r.channel].badgeClass}
                    >
                      {CHANNEL_META[r.channel].label}
                    </Badge>
                    {/* Badge phân loại lỗi do AI gắn — lọc nhanh nguyên nhân */}
                    <Badge
                      variant="outline"
                      className={REVIEW_TAG_META[r.tag].badgeClass}
                    >
                      AI: {REVIEW_TAG_META[r.tag].label}
                    </Badge>
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
                AI Reply Builder
              </CardTitle>
              <CardDescription>
                Chọn một đánh giá bên trái — AI soạn sẵn câu trả lời CSKH, bạn
                sửa lại hoặc gửi thẳng.
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
                      {selected.content}
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
                    <Button size="sm" className="flex-1" onClick={sendReply}>
                      <SendHorizontal className="size-4" />
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

          {/* Nút bulk tách khỏi builder: đây là thao tác trên CẢ danh sách,
              không phụ thuộc đánh giá đang chọn */}
          <Card className="border-violet-200">
            <CardContent className="space-y-2 py-4">
              <Button
                className="w-full bg-violet-600 text-white hover:bg-violet-700"
                disabled={bulkTargets.length === 0}
                onClick={bulkAutoReply}
              >
                🤖 Tự động trả lời hàng loạt {formatNumber(bulkTargets.length)}{" "}
                đánh giá 5 sao
              </Button>
              <p className={cn(TEXT_SUB, "text-center")}>
                Chỉ áp dụng cho đánh giá 5 sao chưa trả lời. Đánh giá 1–3 sao
                luôn cần người duyệt từng câu.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </OperationsFrame>
  );
}
