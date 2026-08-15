"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Eye,
  RotateCcw,
  SlidersHorizontal,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_CARD_TITLE,
  TEXT_NUMBER_STRONG,
  moneyTone,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

import { AssistantRuleFields } from "@/components/ads/tiktok-assistant-rule-fields";
import {
  assessVideo,
  cloneRuleSet,
  videoCpa,
  videoRoas,
  type AssistantConfig,
  type AssistantRuleSet,
  type TiktokAdVideo,
  type TiktokCampaignDetail,
  type VideoDecision,
  type VideoDecisionMap,
  type VideoDisplayStatus,
} from "@/components/ads/tiktok-assistant";

/**
 * MODAL "PHÂN TÍCH KẾ HOẠCH QUẢNG CÁO" — GMV Max tập trung tối ưu video cho
 * sản phẩm chính của chiến dịch, nên modal chỉ còn 2 tầng: Tổng quan chiến
 * dịch (chỉ số + Báo cáo hiệu quả tối ưu) → Mẫu quảng cáo (Video). Tầng video
 * là chỗ ra quyết định: badge cờ của trợ lý + Loại trừ / Giữ lại / Theo dõi
 * thêm từng video, hoặc Áp dụng hàng loạt.
 */

interface TiktokCampaignModalProps {
  open: boolean;
  campaignName: string;
  detail: TiktokCampaignDetail | null;
  config: AssistantConfig;
  /** Bộ luật RIÊNG của chiến dịch — null = kế thừa Cấu hình Mặc định hệ thống */
  override: AssistantRuleSet | null;
  /** Bật/sửa/tắt quy tắc riêng — truyền null để quay về kế thừa mặc định */
  onOverrideChange: (rules: AssistantRuleSet | null) => void;
  decisions: VideoDecisionMap;
  /** decision null = gỡ quyết định (khôi phục về trạng thái trợ lý chấm) */
  onDecide: (videoId: string, decision: VideoDecision | null) => void;
  onBulkExclude: (videoIds: string[]) => void;
  /**
   * Chế độ "Tự động thực thi loại trừ": BẬT = video vi phạm Quy tắc 1 vào
   * hàng chờ + nút Áp dụng hàng loạt (như cũ); TẮT = trợ lý chỉ cảnh báo
   * "Cần loại trừ ngay" (badge vàng), Seller tự tay bấm từng video.
   */
  autoExecute: boolean;
  onAutoExecuteChange: (on: boolean) => void;
  onClose: () => void;
}

/** Badge trạng thái của một video theo kết luận trợ lý + quyết định Seller. */
function VideoStatusBadge({
  status,
  autoExecute,
}: {
  status: VideoDisplayStatus;
  /** Tắt tự động thực thi → cờ vi phạm đổi giọng: cảnh báo vàng giục Seller tự bấm */
  autoExecute: boolean;
}) {
  switch (status) {
    case "auto_exclude":
      return autoExecute ? (
        <Badge variant="destructive">Kém hiệu quả — Chờ loại trừ</Badge>
      ) : (
        <Badge className="bg-amber-100 text-amber-700">Cần loại trừ ngay</Badge>
      );
    case "spike_exclude":
      // Đột biến chi phí là báo động đỏ ở CẢ hai chế độ — tiền đang cháy
      // theo giờ, không có phiên bản "nhẹ nhàng" cho cờ này.
      return (
        <Badge variant="destructive">Loại trừ ngay (Đột biến chi phí)</Badge>
      );
    case "needs_review":
      return (
        <Badge className="bg-amber-100 text-amber-700">
          Chi phí cao — Cần xem xét
        </Badge>
      );
    case "insufficient":
      return <Badge variant="outline">Chưa đủ dữ liệu</Badge>;
    case "watching":
      return (
        <Badge className="bg-violet-100 text-violet-700">Đang theo dõi</Badge>
      );
    case "grace":
      // Tím ĐẶC để phân biệt với "Đang theo dõi" (tím nhạt): đây là trợ lý
      // tự đánh chặn theo Quy tắc 4, không phải Seller chọn.
      return (
        <Badge className="bg-violet-600 text-white">
          Theo dõi — Ân hạn công thần
        </Badge>
      );
    case "excluded":
      return <Badge variant="secondary">Đã loại trừ</Badge>;
    case "kept":
      return (
        <Badge className="bg-emerald-100 text-emerald-700">Đã duyệt giữ lại</Badge>
      );
    case "healthy":
      return <span className="text-xs font-medium text-emerald-600">Hiệu quả</span>;
  }
}

/** Ô chỉ số nhỏ ở Tầng 1 — gọn hơn StatCard để 5 ô nằm vừa trong modal. */
function MiniStat({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "positive" | "negative";
  /** Ô KPI trọng tâm (CPA) — cùng nền sáng với dàn card, nổi bật bằng viền
      amber + số đậm hơn để không bị "cô lập" về màu sắc */
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        emphasis && "border-amber-300 shadow-sm ring-1 ring-amber-200/60"
      )}
    >
      <p className={TEXT_CARD_TITLE}>{label}</p>
      <p
        className={cn(
          "mt-1 text-base tracking-tight",
          emphasis ? "font-bold" : "font-semibold",
          tone === "positive" && "text-emerald-500",
          tone === "negative" && "text-red-500",
          !tone && (emphasis ? "text-amber-600" : "text-slate-900")
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Một ô đếm trong Khối báo cáo hiệu quả tối ưu (thay vị trí biểu đồ cũ). */
function OptimizeStat({
  icon: Icon,
  count,
  label,
  hint,
  iconClass,
}: {
  icon: typeof Activity;
  count: number;
  label: string;
  hint: string;
  iconClass: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          iconClass
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
          {formatNumber(count)}
        </p>
        <p className="truncate text-xs font-medium text-slate-700">{label}</p>
        <p className="truncate text-[11px] text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

export function TiktokCampaignModal({
  open,
  campaignName,
  detail,
  config,
  override,
  onOverrideChange,
  decisions,
  onDecide,
  onBulkExclude,
  autoExecute,
  onAutoExecuteChange,
  onClose,
}: TiktokCampaignModalProps) {
  // ----- Phân trang bảng video (hooks phải đứng TRƯỚC early-return) -----
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const campaignId = detail?.campaignId;
  // Đổi chiến dịch là về trang đầu — trang 3 của chiến dịch cũ vô nghĩa
  useEffect(() => {
    setPage(0);
  }, [campaignId]);

  if (!detail) return null;

  // Bộ luật HIỆU LỰC của chiến dịch: quy tắc riêng thắng, không có thì kế
  // thừa Cấu hình Mặc định hệ thống (mỗi SP một biên lãi — không áp chung).
  const custom = override !== null;
  const rules: AssistantRuleSet = override ?? config;

  // Tầng 1 tính từ tổng video (nguồn chân lý của mock) để các tầng luôn khớp
  const spend = detail.videos.reduce((s, v) => s + v.spend, 0);
  const orders = detail.videos.reduce((s, v) => s + v.orders, 0);
  const revenue = detail.videos.reduce((s, v) => s + v.revenue, 0);
  const cpa = orders > 0 ? spend / orders : 0;
  const roi = spend > 0 ? revenue / spend : 0;

  const assessed = detail.videos.map((video) => ({
    video,
    ...assessVideo(video, rules, config.enabled, decisions),
  }));
  const pendingExcludeIds = assessed
    .filter((a) => a.status === "auto_exclude" || a.status === "spike_exclude")
    .map((a) => a.video.id);

  // ----- Báo cáo hiệu quả tối ưu: gom 3 nhóm trạng thái cốt lõi. Đếm từ
  // `assessed` (đã trộn quy tắc hiệu lực + quyết định Seller) nên gạt switch
  // quy tắc riêng hay bấm nút hành động là số nhảy theo ngay. -----
  const activeCount = assessed.filter(
    (a) => a.status === "healthy" || a.status === "kept"
  ).length;
  const watchingCount = assessed.filter(
    (a) =>
      a.status === "insufficient" ||
      a.status === "watching" ||
      a.status === "grace"
  ).length;
  const excludedCount = assessed.filter((a) => a.status === "excluded").length;
  const flaggedCount = assessed.filter(
    (a) =>
      a.status === "auto_exclude" ||
      a.status === "spike_exclude" ||
      a.status === "needs_review"
  ).length;

  // Lát video của trang hiện tại — các bộ đếm/bulk phía trên vẫn tính trên
  // TOÀN BỘ danh sách, chỉ phần bảng hiển thị là cắt trang.
  const totalPages = Math.max(1, Math.ceil(assessed.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = assessed.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  function renderActions(video: TiktokAdVideo, status: VideoDisplayStatus) {
    // Đã có quyết định của Seller (loại / giữ / theo dõi) → chỉ còn đường lui
    if (status === "excluded" || status === "kept" || status === "watching") {
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDecide(video.id, null)}
        >
          <RotateCcw className="size-3.5" />
          Khôi phục
        </Button>
      );
    }
    return (
      <div className="flex justify-end gap-1.5">
        {(status === "needs_review" || status === "insufficient") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDecide(video.id, "WATCHING")}
          >
            <Eye className="size-3.5" />
            Theo dõi thêm
          </Button>
        )}
        {(status === "needs_review" || status === "grace") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDecide(video.id, "KEPT")}
          >
            Giữ lại
          </Button>
        )}
        {status === "spike_exclude" ||
        (!autoExecute && status === "auto_exclude") ? (
          // Chế độ thủ công: video vi phạm cần Seller tự tay chém → nút đỏ đặc
          <Button
            size="sm"
            className="bg-red-500 text-white hover:bg-red-600"
            onClick={() => onDecide(video.id, "EXCLUDED")}
          >
            <CircleSlash className="size-3.5" />
            Loại trừ ngay
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="text-red-500 hover:text-red-600"
            onClick={() => onDecide(video.id, "EXCLUDED")}
          >
            <CircleSlash className="size-3.5" />
            Loại trừ
          </Button>
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* min(): laptop hẹp hơn 6xl (1152px) vẫn giữ lề 2 bên thay vì bung sát mép */}
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[min(72rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Phân tích kế hoạch quảng cáo — {campaignName}</DialogTitle>
          <DialogDescription>
            GMV Max tối ưu video cho sản phẩm chính của chiến dịch: Chiến dịch →
            Mẫu quảng cáo (video). Bản xem trước với số liệu mẫu.
          </DialogDescription>
        </DialogHeader>

        {/* ===== TẦNG 1: TỔNG QUAN CHIẾN DỊCH ===== */}
        {/* min-w-0: DialogContent là grid — không kẹp thì bảng rộng ép min-content
            của track vượt khung dialog, cả modal mọc thanh cuộn ngang. */}
        <section className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MiniStat label="Chi phí" value={<Money value={spend} />} tone="negative" />
            <MiniStat label="Đơn hàng SKU" value={formatNumber(orders)} />
            <MiniStat
              label="Chi phí mỗi đơn (CPA)"
              value={<Money value={cpa} />}
              emphasis
            />
            <MiniStat
              label="Doanh thu gộp"
              value={<Money value={revenue} />}
              tone="positive"
            />
            <MiniStat
              label="ROI (ROAS)"
              value={
                <span className={moneyTone(roi >= rules.hard.minRoas ? 1 : -1)}>
                  {roi.toFixed(2)}x
                </span>
              }
            />
          </div>

          {/* ===== KHỐI BÁO CÁO HIỆU QUẢ TỐI ƯU (thay biểu đồ Tổng quan cũ) ===== */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Báo cáo hiệu quả tối ưu
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Trạng thái {formatNumber(detail.videos.length)} video trong
                  chiến dịch — số đếm cập nhật ngay khi đổi quy tắc hoặc ra
                  quyết định ở bảng dưới.
                </p>
              </div>
              {flaggedCount > 0 && (
                <Badge className="bg-amber-100 text-amber-700">
                  {formatNumber(flaggedCount)} video bị gắn cờ — chờ quyết định
                </Badge>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <OptimizeStat
                icon={Activity}
                count={activeCount}
                label="Đang hoạt động"
                hint="Hiệu quả / đang chạy tốt"
                iconClass="bg-emerald-100 text-emerald-700"
              />
              <OptimizeStat
                icon={Eye}
                count={watchingCount}
                label="Đang theo dõi"
                hint="Chưa đủ dữ liệu · Seller giữ lại quan sát"
                iconClass="bg-violet-100 text-violet-700"
              />
              <OptimizeStat
                icon={CircleSlash}
                count={excludedCount}
                label="Đã loại trừ"
                hint="Đã tắt/chặn do vi phạm luật"
                iconClass="bg-red-100 text-red-600"
              />
            </div>
          </div>
        </section>

        {/* ===== KHU VỰC QUY TẮC TRỢ LÝ — nơi làm việc chính của Seller =====
            Viền đậm hơn + nền ambient + bóng nhẹ để tách hẳn khối này khỏi nền
            modal, mắt bám vào đây ngay khi mở. */}
        <section className="min-w-0 rounded-lg border-2 border-slate-300 bg-slate-50/60 p-4 shadow-sm">
          {/* --- Switch 1: Tự động thực thi loại trừ (chế độ vận hành) --- */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <Zap className="size-4.5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Tự động thực thi loại trừ
                </p>
                <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                  {autoExecute
                    ? "Video vi phạm Quy tắc 1 được gom vào hàng chờ, loại trừ hàng loạt bằng một nút Áp dụng ở bảng dưới."
                    : "Hệ thống KHÔNG tự chém — video vi phạm chỉ hiện cảnh báo vàng “Cần loại trừ ngay” ở bảng dưới, Seller tự tay bấm từng video."}
                </p>
              </div>
            </div>
            <Switch
              checked={autoExecute}
              onCheckedChange={onAutoExecuteChange}
              aria-label="Bật/tắt tự động thực thi loại trừ"
            />
          </div>

          {/* --- Switch 2: Quy tắc riêng cho chiến dịch (Override mặc định) --- */}
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-slate-200 pt-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <SlidersHorizontal className="size-4.5" />
              </div>
              <div>
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  Tùy chỉnh Quy tắc Trợ lý riêng cho chiến dịch này
                  {custom && (
                    <Badge className="bg-violet-100 text-violet-700">
                      Đang dùng quy tắc riêng
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                  {custom
                    ? "Bộ luật dưới đây CHỈ áp cho chiến dịch này và ưu tiên hơn Cấu hình Mặc định hệ thống. Tắt switch để quay về kế thừa mặc định."
                    : "Đang kế thừa Cấu hình Mặc định hệ thống. Sản phẩm giá trị cao chịu được CPA cao hơn — bật lên để đặt ngưỡng riêng theo giá bán/biên lãi, tránh trợ lý giết nhầm video đang có lãi."}
                </p>
              </div>
            </div>
            <Switch
              checked={custom}
              onCheckedChange={(on) =>
                // Bật: seed từ bộ luật mặc định để Seller sửa tiếp thay vì gõ
                // lại từ đầu. Tắt: xoá override → kế thừa mặc định trở lại.
                onOverrideChange(on ? cloneRuleSet(config) : null)
              }
              aria-label="Bật quy tắc riêng cho chiến dịch này"
            />
          </div>
          {custom && override && (
            <div className="mt-4 border-t pt-4">
              <AssistantRuleFields
                rules={override}
                onChange={onOverrideChange}
                disabled={!config.enabled}
              />
            </div>
          )}
        </section>

        {/* ===== TẦNG 2: MẪU QUẢNG CÁO (VIDEO) ===== */}
        <section className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">
              Mẫu quảng cáo (Video)
            </p>
            {autoExecute && pendingExcludeIds.length > 0 && (
              <Button
                size="sm"
                onClick={() => onBulkExclude(pendingExcludeIds)}
              >
                Áp dụng — loại trừ {formatNumber(pendingExcludeIds.length)} video
                bị gắn cờ
              </Button>
            )}
          </div>
          <Table>
            <TableHeader className={TABLE_HEAD_EMPHASIS}>
              <TableRow>
                <TableHead>Video / ID bài đăng</TableHead>
                <TableHead className="text-right">Chi phí</TableHead>
                <TableHead className="text-right">Đơn</TableHead>
                <TableHead className="text-right">CPA</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Hành động</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(({ video, status, reasons, grace }) => {
                const vCpa = videoCpa(video);
                const vRoas = videoRoas(video);
                const dimmed = status === "excluded";
                return (
                  <TableRow key={video.id} className={cn(dimmed && "opacity-55")}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{video.title}</p>
                      <p className="text-xs text-slate-500">
                        ID bài đăng: {video.postId}
                      </p>
                      {/* Video đã loại trừ: lý do chuyển sang cột Trạng thái */}
                      {status !== "excluded" && reasons.length > 0 && (
                        <p
                          className={cn(
                            "mt-0.5 max-w-xs text-xs",
                            status === "spike_exclude"
                              ? "text-red-500"
                              : status === "auto_exclude"
                                ? autoExecute
                                  ? "text-red-500"
                                  : "text-amber-600"
                                : status === "needs_review"
                                  ? "text-amber-600"
                                  : status === "grace"
                                    ? "text-violet-600"
                                    : "text-slate-500"
                          )}
                        >
                          {reasons.join("; ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={video.spend} className="text-slate-700" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(video.orders)}
                    </TableCell>
                    <TableCell className="text-right">
                      {video.orders > 0 ? (
                        <Money value={vCpa} className="text-slate-700" />
                      ) : (
                        <span className="text-slate-400">∞</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right",
                        TEXT_NUMBER_STRONG,
                        moneyTone(vRoas >= rules.hard.minRoas ? 1 : -1)
                      )}
                    >
                      {vRoas.toFixed(2)}x
                    </TableCell>
                    <TableCell>
                      <VideoStatusBadge status={status} autoExecute={autoExecute} />
                      {status === "excluded" && reasons.length > 0 && (
                        <p className="mt-1 max-w-48 text-xs text-slate-500">
                          {reasons.join("; ")}
                        </p>
                      )}
                      {status === "grace" && grace && (
                        <p className="mt-1 text-xs font-medium text-violet-600">
                          Còn {formatNumber(grace.hoursLeft)}h · còn{" "}
                          <Money
                            value={grace.spendLeft}
                            className="text-violet-600"
                          />{" "}
                          ân hạn
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {renderActions(video, status)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* ===== PHÂN TRANG BẢNG VIDEO ===== */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <label className="flex items-center gap-2">
              Hiển thị
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                aria-label="Số mẫu quảng cáo mỗi trang"
                className="h-7 rounded-lg border border-input bg-card px-1.5 text-xs text-slate-700 outline-none focus-visible:border-ring"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              mẫu quảng cáo / trang
            </label>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                Trang {formatNumber(safePage + 1)}/{formatNumber(totalPages)} ·{" "}
                {formatNumber(assessed.length)} video
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                aria-label="Trang trước"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
                aria-label="Trang sau"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Khi nối API thật, &quot;Loại trừ&quot; sẽ gọi endpoint exclude video
            của GMV Max; &quot;Theo dõi thêm&quot; tạm ẩn cờ cảnh báo một thời
            gian để trợ lý thu thêm số liệu. Mọi hành động đều có lý do đi kèm
            và khôi phục được.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
