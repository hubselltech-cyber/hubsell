"use client";

import { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck, SlidersHorizontal } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import {
  fetchShopeeAdsActionLog,
  type ShopeeAdsActionLogRow,
  type ShopeeAdsCampaignRow,
  type ShopeeAssistantConfig,
  type ShopeeAssistantDecision,
  type ShopeeAssistantVerdict,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
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
  const meta = VERDICT_META[a.verdict];
  return <Badge className={cn("whitespace-nowrap", meta.className)}>{meta.label}</Badge>;
}

// ---------- Modal chi tiết + quyết định ----------

const SELLER_CENTER_ADS_URL = "https://banhang.shopee.vn/portal/marketing/pas/index";

export function ShopeeAssistantModal({
  campaign,
  onDecide,
  onClose,
  deciding,
}: {
  campaign: ShopeeAdsCampaignRow | null;
  onDecide: (decision: ShopeeAssistantDecision) => void;
  onClose: () => void;
  deciding: boolean;
}) {
  const a = campaign?.assistant;
  const verdictMeta = a?.verdict ? VERDICT_META[a.verdict] : null;
  const actionable =
    a?.verdict === "spike" || a?.verdict === "pause_now" || a?.verdict === "review" || a?.verdict === "grace";

  return (
    <Dialog open={campaign !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">
              {campaign?.name || `Chiến dịch #${campaign?.campaignId}`}
            </span>
            {verdictMeta && (
              <Badge className={verdictMeta.className}>{verdictMeta.label}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Đánh giá của Trợ lý dựa trên hiệu suất thật + ROAS hòa vốn của chính
            SKU trong chiến dịch. Trợ lý không tự thao tác — anh/chị quyết trên
            Seller Center rồi ghi nhận lại tại đây.
          </DialogDescription>
        </DialogHeader>

        {campaign && a && (
          <div className="space-y-4">
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

            {/* Hành động */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(SELLER_CENTER_ADS_URL, "_blank", "noopener")}
              >
                <ExternalLink className="size-4" />
                Mở Seller Center
              </Button>
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
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-600">{label}</span>
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
}: {
  config: ShopeeAssistantConfig;
  onSave: (config: ShopeeAssistantConfig) => void;
  saving: boolean;
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
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-600">Chế độ</span>
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
              {draft.autoExecute.mode === "live" && (
                <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">
                  ⚠ Chế độ THẬT: Trợ lý sẽ gọi lệnh tạm dừng lên Shopee. Chiến
                  dịch anh/chị đã bấm &quot;Bỏ qua&quot;/&quot;Theo dõi&quot; sẽ
                  không bị đụng. Mọi lệnh đều ghi vào Sổ hành động bên dưới.
                </p>
              )}
            </RuleBlock>
            <RuleBlock
              title="Quy tắc 1 — Loại thẳng"
              hint="Tiêu lớn mà 0 đơn, hoặc ROAS tụt dưới hòa vốn × hệ số → đề xuất tạm dừng ngay."
              enabled={draft.hard.enabled}
              onToggle={(v) => patch("hard", { enabled: v })}
            >
              <NumberField
                label="Tiêu ≥ (7 ngày) mà 0 đơn"
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
};

export function ShopeeActionLogCard({ channelId }: { channelId: string }) {
  const [logs, setLogs] = useState<ShopeeAdsActionLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const res = await fetchShopeeAdsActionLog(channelId);
      setLogs(res.logs);
    } catch {
      // gian chưa có sổ / lỗi mạng — bảng rỗng là đủ thông tin
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Sổ hành động của Trợ lý</CardTitle>
            <CardDescription className="mt-1.5">
              Mọi lần Trợ lý định (diễn tập) hoặc đã (thật) tạm dừng chiến dịch —
              kèm căn cứ tại thời điểm đó. Tối đa 1 hành động/chiến dịch/ngày.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Đang tải…" : "Làm mới"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
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
                {logs.map((l) => {
                  const meta = ACTION_STATUS_META[l.status] ?? {
                    label: l.status,
                    className: "bg-slate-100 text-slate-500",
                  };
                  const verdictMeta =
                    l.verdict in VERDICT_META
                      ? VERDICT_META[l.verdict as keyof typeof VERDICT_META]
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
                      <td className="max-w-56 truncate py-2.5 pr-3 font-medium text-slate-900">
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
                        {l.error && (
                          <p className="mt-1 text-red-600">Lỗi sàn: {l.error}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
