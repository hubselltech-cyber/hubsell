"use client";

import { CircleSlash, RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
import { formatNumber, formatVND } from "@/lib/format";
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
  type VideoDecisionMap,
  type VideoDisplayStatus,
} from "@/components/ads/tiktok-assistant";

/**
 * MODAL "PHÂN TÍCH KẾ HOẠCH QUẢNG CÁO" — mô phỏng đúng luồng 3 tầng của
 * TikTok Ads Manager: Chiến dịch GMV Max → Sản phẩm → Mẫu quảng cáo (Video).
 * Tầng 3 là chỗ ra quyết định: badge cờ của trợ lý + nút Loại trừ/Giữ lại
 * từng video hoặc Áp dụng hàng loạt.
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
  onDecide: (videoId: string, decision: "EXCLUDED" | "KEPT" | null) => void;
  onBulkExclude: (videoIds: string[]) => void;
  onClose: () => void;
}

/** Badge trạng thái của một video theo kết luận trợ lý + quyết định Seller. */
function VideoStatusBadge({ status }: { status: VideoDisplayStatus }) {
  switch (status) {
    case "auto_exclude":
      return <Badge variant="destructive">Kém hiệu quả — Chờ loại trừ</Badge>;
    case "needs_review":
      return (
        <Badge className="bg-amber-100 text-amber-700">
          Chi phí cao — Cần xem xét
        </Badge>
      );
    case "insufficient":
      return <Badge variant="outline">Chưa đủ dữ liệu</Badge>;
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
}: {
  label: string;
  value: React.ReactNode;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className={TEXT_CARD_TITLE}>{label}</p>
      <p
        className={cn(
          "mt-1 text-base font-semibold tracking-tight",
          tone === "positive" && "text-emerald-500",
          tone === "negative" && "text-red-500",
          !tone && "text-slate-900"
        )}
      >
        {value}
      </p>
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
  onClose,
}: TiktokCampaignModalProps) {
  if (!detail) return null;

  // Bộ luật HIỆU LỰC của chiến dịch: quy tắc riêng thắng, không có thì kế
  // thừa Cấu hình Mặc định hệ thống (mỗi SP một biên lãi — không áp chung).
  const custom = override !== null;
  const rules: AssistantRuleSet = override ?? config;

  // Tầng 1 tính từ tổng video (nguồn chân lý của mock) để 3 tầng luôn khớp nhau
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
    .filter((a) => a.status === "auto_exclude")
    .map((a) => a.video.id);

  function renderActions(video: TiktokAdVideo, status: VideoDisplayStatus) {
    if (status === "excluded" || status === "kept") {
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
        {status === "needs_review" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDecide(video.id, "KEPT")}
          >
            Giữ lại
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="text-red-500 hover:text-red-600"
          onClick={() => onDecide(video.id, "EXCLUDED")}
        >
          <CircleSlash className="size-3.5" />
          Loại trừ
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Phân tích kế hoạch quảng cáo — {campaignName}</DialogTitle>
          <DialogDescription>
            Dữ liệu 3 tầng theo đúng cấu trúc TikTok: Chiến dịch → Sản phẩm →
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
            <MiniStat label="Chi phí mỗi đơn" value={<Money value={cpa} />} />
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
          <div className="h-48 w-full rounded-lg border bg-card p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={detail.series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} tickLine={false} />
                <YAxis
                  fontSize={10}
                  tickLine={false}
                  width={90}
                  tickFormatter={(v: number) => formatVND(v)}
                />
                <Tooltip
                  formatter={(value, name) => [
                    formatVND(Number(value)),
                    name === "revenue" ? "Doanh thu gộp" : "Chi phí",
                  ]}
                />
                <Legend
                  formatter={(value) =>
                    value === "revenue" ? "Doanh thu gộp" : "Chi phí"
                  }
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#f87171"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ===== TẦNG 2: SẢN PHẨM ===== */}
        <section className="min-w-0">
          <p className="mb-2 text-sm font-semibold text-slate-900">Sản phẩm</p>
          <Table>
            <TableHeader className={TABLE_HEAD_EMPHASIS}>
              <TableRow>
                <TableHead>Tên sản phẩm</TableHead>
                <TableHead>Chế độ tối ưu</TableHead>
                <TableHead className="text-right">Chi phí</TableHead>
                <TableHead className="text-right">Lượt đơn</TableHead>
                <TableHead className="text-right">Chi phí/đơn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-slate-900">
                    {p.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.optimizationMode}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={p.spend} className="text-slate-700" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(p.orders)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money
                      value={p.orders > 0 ? p.spend / p.orders : 0}
                      className="text-slate-700"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        {/* ===== QUY TẮC RIÊNG CHO CHIẾN DỊCH (Override cấu hình mặc định) ===== */}
        <section className="min-w-0 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
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

        {/* ===== TẦNG 3: MẪU QUẢNG CÁO (VIDEO) ===== */}
        <section className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">
              Mẫu quảng cáo (Video)
            </p>
            {pendingExcludeIds.length > 0 && (
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
              {assessed.map(({ video, status, reasons }) => {
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
                      {reasons.length > 0 && (
                        <p
                          className={cn(
                            "mt-0.5 max-w-xs text-xs",
                            status === "auto_exclude"
                              ? "text-red-500"
                              : status === "needs_review"
                                ? "text-amber-600"
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
                      <VideoStatusBadge status={status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {renderActions(video, status)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Khi nối API thật, &quot;Loại trừ&quot; sẽ gọi endpoint exclude video
            của GMV Max. Mọi hành động đều có lý do đi kèm và khôi phục được.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
