"use client";

// ============================================================
// POPUP CẤU HÌNH LOẠI VIDEO TỰ ĐỘNG — theo TỪNG CHIẾN DỊCH GMV Max
//
// Anh Trung 18/09/2026: cấu hình đặt vào từng chiến dịch (mỗi chiến dịch một
// bộ số), dạng popup, phải dễ dùng không rối. Ba tầng:
//   1. Luôn thấy: chế độ Tắt / Diễn tập / Tự loại thật + ROI mục tiêu + cửa sổ ngày.
//   2. "Nâng cao" thu gọn: các ngưỡng còn lại (số mặc định đã hợp lý).
//   3. Dòng CHẠY THỬ: chấm điểm bằng cấu hình đang nhập trên số thật của TikTok
//      (không ghi gì) — khách thấy máy sẽ làm gì trước khi Lưu.
// "Tự loại thật" chỉ bật được khi chiến dịch đã có ít nhất một lượt xét (diễn tập
// hằng ngày hoặc chạy thử tại chỗ) và phải xác nhận lại tóm tắt lượt đó — chốt an
// toàn nằm ở việc khách ĐÃ NHÌN THẤY kết quả, không nằm ở số ngày chờ.
// Video còn ĐANG HỌC trên TikTok không bao giờ bị xét; đồng hồ luật tính từ ngày
// TikTok học xong (backend theo dõi hằng ngày).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, FlaskConical } from "lucide-react";
import { toast } from "sonner";

import { formatRoi } from "@/components/ads/tiktok-ads-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  TIKTOK_AUTO_MODE_LABEL,
  copyTiktokAdsAutoRule,
  fetchTiktokAdsAutoRule,
  previewTiktokAdsAutoRule,
  saveTiktokAdsAutoRule,
  type TiktokAdsAutoConfig,
  type TiktokAdsAutoMode,
  type TiktokAdsAutoPreview,
  type TiktokAdsAutoStatus,
} from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const WINDOW_OPTIONS = [3, 5, 7, 10, 14, 30];

/** Form giữ tiền dạng CHUỖI CHỮ SỐ cho CurrencyInput; số khác giữ chuỗi để gõ thoải mái. */
interface FormState {
  roiTarget: string;
  windowDays: string;
  minSpend: string;
  spendNoOrder: string;
  roiHardPct: string;
  maxCpa: string;
  graceMinOrders: string;
  graceDays: string;
  maxExcludePerDay: string;
  minOrderingVideosKeep: string;
}

function toForm(c: TiktokAdsAutoConfig): FormState {
  return {
    roiTarget: String(c.roiTarget),
    windowDays: String(c.windowDays),
    minSpend: String(Math.round(c.minSpend)),
    spendNoOrder: String(Math.round(c.spendNoOrder)),
    roiHardPct: String(c.roiHardPct),
    maxCpa: c.maxCpa == null ? "" : String(Math.round(c.maxCpa)),
    graceMinOrders: String(c.graceMinOrders),
    graceDays: String(c.graceDays),
    maxExcludePerDay: String(c.maxExcludePerDay),
    minOrderingVideosKeep: String(c.minOrderingVideosKeep),
  };
}

function toConfig(f: FormState): TiktokAdsAutoConfig {
  const n = (s: string, fallback: number) => {
    const v = Number(s.replace(",", "."));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    roiTarget: n(f.roiTarget, 10),
    windowDays: n(f.windowDays, 7),
    minSpend: n(f.minSpend, 50_000),
    spendNoOrder: n(f.spendNoOrder, 200_000),
    roiHardPct: n(f.roiHardPct, 50),
    maxCpa: f.maxCpa.trim() === "" ? null : n(f.maxCpa, 0) || null,
    graceMinOrders: n(f.graceMinOrders, 20),
    graceDays: n(f.graceDays, 2),
    maxExcludePerDay: n(f.maxExcludePerDay, 10),
    minOrderingVideosKeep: n(f.minOrderingVideosKeep, 3),
  };
}

export function TiktokAutoRuleDialog({
  open,
  onOpenChange,
  campaignRowId,
  campaignName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignRowId: string;
  campaignName: string;
  onSaved?: (status: TiktokAdsAutoStatus, mode: TiktokAdsAutoMode) => void;
}) {
  const queryClient = useQueryClient();
  const q = useApiQuery({
    queryKey: qk.tiktokAdsAutoRule(campaignRowId),
    queryFn: () => fetchTiktokAdsAutoRule(campaignRowId),
    enabled: open && campaignRowId !== "",
    staleTime: 0,
  });
  const rule = q.data;

  const [mode, setMode] = useState<TiktokAdsAutoMode>("off");
  const [form, setForm] = useState<FormState | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [preview, setPreview] = useState<TiktokAdsAutoPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showPreviewList, setShowPreviewList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyPick, setCopyPick] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);

  // Nạp form từ server mỗi lần mở (không giữ nháp giữa hai lần mở).
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setConfirmLive(false);
      setCopyOpen(false);
      setCopyPick(new Set());
      setForm(null);
      return;
    }
    if (rule && !form) {
      setMode(rule.mode);
      setForm(toForm(rule.config));
      setAdvanced(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ nạp khi mở + có dữ liệu
  }, [open, rule]);

  const cfg = useMemo(() => (form ? toConfig(form) : null), [form]);
  const set = (k: keyof FormState) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const hadRun = Boolean(rule?.status?.lastRunOn) || preview != null;
  const lastSummary = preview?.summary ?? rule?.status?.lastRunSummary ?? null;
  const hardRoi = cfg ? cfg.roiTarget * (cfg.roiHardPct / 100) : 0;

  async function runPreview() {
    if (!cfg) return;
    setPreviewing(true);
    try {
      const r = await previewTiktokAdsAutoRule(campaignRowId, cfg);
      setPreview(r);
      setShowPreviewList(r.exclude.length > 0 && r.exclude.length <= 5);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không chạy thử được");
    } finally {
      setPreviewing(false);
    }
  }

  async function save(force = false) {
    if (!cfg || !rule) return;
    if (mode === "live" && rule.mode !== "live" && !force) {
      setConfirmLive(true);
      return;
    }
    setSaving(true);
    try {
      const r = await saveTiktokAdsAutoRule(campaignRowId, { mode, ...cfg });
      toast.success(
        mode === "off"
          ? "Đã tắt loại video tự động cho chiến dịch này."
          : mode === "dry_run"
            ? "Đã lưu. Mỗi ngày sau 12h trưa, Trợ lý sẽ chấm điểm và báo chuông — chưa loại video nào."
            : "Đã bật Tự loại thật. Từ lượt xét kế tiếp (sau 12h trưa) Trợ lý sẽ loại video vi phạm."
      );
      onSaved?.(r.status, r.mode);
      await queryClient.invalidateQueries({ queryKey: qk.tiktokAdsAutoRule(campaignRowId) });
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads-videos", campaignRowId] });
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cấu hình");
    } finally {
      setSaving(false);
      setConfirmLive(false);
    }
  }

  async function runCopy() {
    if (copyPick.size === 0) return;
    setCopying(true);
    try {
      const r = await copyTiktokAdsAutoRule(campaignRowId, [...copyPick]);
      toast.success(r.message);
      setCopyOpen(false);
      setCopyPick(new Set());
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không sao chép được");
    } finally {
      setCopying(false);
    }
  }

  const modeHint: Record<TiktokAdsAutoMode, string> = {
    off: "Trợ lý không chấm điểm video của chiến dịch này.",
    dry_run: "Mỗi ngày sau 12h trưa: chấm điểm, ghi sổ và báo chuông video SẼ bị loại — chưa loại video nào.",
    live: "Mỗi ngày sau 12h trưa: loại thật các video vi phạm (tối đa số video/ngày đã đặt), báo chuông kèm căn cứ.",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !copying && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tự động loại video</DialogTitle>
          <DialogDescription className="truncate">{campaignName}</DialogDescription>
        </DialogHeader>

        {q.error && <p className="text-sm text-red-500">{q.error}</p>}
        {!form && !q.error && <p className="py-8 text-center text-sm text-muted-foreground">Đang tải cấu hình…</p>}

        {form && cfg && rule && (
          <div className="space-y-4">
            {/* ===== TẦNG 1: chế độ ===== */}
            <div>
              <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-slate-200">
                {(["off", "dry_run", "live"] as TiktokAdsAutoMode[]).map((m) => {
                  const disabled = m === "live" && !hadRun;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(m)}
                      title={disabled ? "Chạy thử hoặc đợi lượt diễn tập đầu tiên rồi mới bật được" : undefined}
                      className={cn(
                        "px-3 py-2 text-sm transition-colors not-last:border-r not-last:border-slate-200",
                        mode === m ? "bg-slate-900 font-medium text-white" : "bg-card text-slate-600 hover:bg-muted",
                        disabled && "cursor-not-allowed text-slate-300 hover:bg-card"
                      )}
                    >
                      {TIKTOK_AUTO_MODE_LABEL[m]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {modeHint[mode]}
                {!hadRun && mode !== "live" && " Tự loại thật mở sau khi có ít nhất một lượt chấm (bấm Chạy thử bên dưới)."}
              </p>
            </div>

            {/* ===== TẦNG 1: hai số chính (điện thoại xếp dọc, từ sm hai cột) ===== */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">ROI mục tiêu</span>
                <Input inputMode="decimal" value={form.roiTarget} onChange={(e) => set("roiTarget")(e.target.value)} />
                {rule.roasTarget != null && (
                  <span className="block text-xs text-slate-400">TikTok đang đặt {formatRoi(rule.roasTarget)} cho chiến dịch này.</span>
                )}
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Soi theo</span>
                <NativeSelect className="w-full" value={form.windowDays} onChange={(e) => set("windowDays")(e.target.value)}>
                  {WINDOW_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} ngày gần nhất
                    </option>
                  ))}
                </NativeSelect>
                <span className="block text-xs text-slate-400">Tính tới hôm qua; video vừa học xong chỉ tính từ ngày học xong.</span>
              </label>
            </div>

            {/* ===== TẦNG 2: nâng cao ===== */}
            <div className="border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-left text-sm text-slate-600 hover:text-slate-900"
              >
                {advanced ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                <span className="whitespace-nowrap">Nâng cao</span>
                {!advanced && (
                  <span className="basis-full pl-5 text-xs text-slate-400 sm:basis-auto sm:pl-0">
                    · loại khi tiêu ≥ {formatVND(cfg.spendNoOrder)} mà 0 đơn, hoặc ROI &lt; {formatRoi(hardRoi)}
                    {cfg.maxCpa != null && `, hoặc chi phí/đơn > ${formatVND(cfg.maxCpa)}`}
                  </span>
                )}
              </button>
              {advanced && (
                <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-3 text-sm sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-slate-600">Tiêu từ … mà 0 đơn thì loại</span>
                    <CurrencyInput value={form.spendNoOrder} onValueChange={set("spendNoOrder")} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600">ROI dưới … % mục tiêu thì loại</span>
                    <Input inputMode="numeric" value={form.roiHardPct} onChange={(e) => set("roiHardPct")(e.target.value)} />
                    <span className="block text-xs text-slate-400">= ROI dưới {formatRoi(hardRoi)}; giữa mức này và mục tiêu chỉ gắn cờ.</span>
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600">Trần chi phí / đơn (để trống = không dùng)</span>
                    <CurrencyInput value={form.maxCpa} onValueChange={set("maxCpa")} placeholder="Không dùng" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600">Chưa xét khi tiêu dưới</span>
                    <CurrencyInput value={form.minSpend} onValueChange={set("minSpend")} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600">Video công thần: từ … đơn / 30 ngày</span>
                    <Input inputMode="numeric" value={form.graceMinOrders} onChange={(e) => set("graceMinOrders")(e.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600">… được ân hạn (ngày vi phạm liên tục)</span>
                    <Input inputMode="numeric" value={form.graceDays} onChange={(e) => set("graceDays")(e.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600">Loại tối đa mỗi ngày (video)</span>
                    <Input inputMode="numeric" value={form.maxExcludePerDay} onChange={(e) => set("maxExcludePerDay")(e.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-600">Luôn giữ lại ít nhất … video đang ra đơn</span>
                    <Input inputMode="numeric" value={form.minOrderingVideosKeep} onChange={(e) => set("minOrderingVideosKeep")(e.target.value)} />
                  </label>
                  <p className="text-xs text-slate-400 sm:col-span-2">
                    Video TikTok còn đang học không bao giờ bị xét. Video anh/chị đã khôi phục tay thì máy không loại lại trong 30 ngày.
                  </p>
                </div>
              )}
            </div>

            {/* ===== TẦNG 3: chạy thử ===== */}
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void runPreview()} disabled={previewing}>
                  <FlaskConical className="size-4" />
                  {previewing ? "Đang đọc số từ TikTok…" : preview ? "Chạy thử lại" : "Chạy thử với cấu hình này"}
                </Button>
                {!preview && rule.status?.lastRunOn && (
                  <span className="text-xs text-slate-500">
                    Lượt gần nhất {rule.status.lastRunOn.slice(8, 10)}/{rule.status.lastRunOn.slice(5, 7)}: {rule.status.lastRunSummary}
                  </span>
                )}
              </div>
              {preview && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-slate-900">
                    <span className="font-medium">Nếu áp hôm nay</span> ({preview.windowFrom.slice(8, 10)}/{preview.windowFrom.slice(5, 7)}–
                    {preview.windowTo.slice(8, 10)}/{preview.windowTo.slice(5, 7)}): {preview.summary}.
                  </p>
                  {preview.exclude.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowPreviewList((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
                    >
                      {showPreviewList ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      {showPreviewList ? "Ẩn danh sách" : `Xem ${formatNumber(preview.exclude.length)} video sẽ loại`}
                    </button>
                  )}
                  {showPreviewList && (
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                      {preview.exclude.map((v) => (
                        <li key={v.videoId} className="flex flex-wrap gap-x-2">
                          <span className="tabular-nums text-slate-900">{v.videoId}</span>
                          <span className="text-slate-500">
                            chi {formatVND(v.cost)} · {formatNumber(v.orders)} đơn · {v.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.tracking.relearning > 0 && (
                    <p className="text-xs text-amber-600">TikTok vừa đưa {preview.tracking.relearning} video quay lại giai đoạn học — máy đặt lại đồng hồ cho các video đó.</p>
                  )}
                </div>
              )}
            </div>

            {/* ===== XÁC NHẬN BẬT THẬT ===== */}
            {confirmLive && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-800">Bật Tự loại thật cho chiến dịch này?</p>
                <p className="text-amber-800">
                  Lượt chấm gần nhất: {lastSummary ?? "chưa có"}. Từ lượt xét kế tiếp (sau 12h trưa mỗi ngày) Trợ lý sẽ gửi lệnh loại
                  thật lên TikTok, tối đa {formatNumber(cfg.maxExcludePerDay)} video/ngày. Anh/chị khôi phục được bất cứ lúc nào ở mục Đã loại.
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfirmLive(false)} disabled={saving}>
                    Để em xem lại
                  </Button>
                  <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" onClick={() => void save(true)} disabled={saving}>
                    {saving ? "Đang lưu…" : "Bật thật"}
                  </Button>
                </div>
              </div>
            )}

            {/* ===== SAO CHÉP ===== */}
            {copyOpen && (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-900">Sao chép cấu hình sang chiến dịch</p>
                {rule.others.length === 0 ? (
                  <p className="text-xs text-slate-500">Gian này không có chiến dịch nào khác.</p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {rule.others.map((o) => (
                      <li key={o.id}>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="size-4 accent-slate-900"
                            checked={copyPick.has(o.id)}
                            onChange={() =>
                              setCopyPick((prev) => {
                                const next = new Set(prev);
                                if (next.has(o.id)) next.delete(o.id);
                                else next.add(o.id);
                                return next;
                              })
                            }
                          />
                          <span className="truncate text-slate-900">{o.name}</span>
                          <Badge className={cn("ml-auto", o.mode === "off" ? "bg-slate-100 text-slate-500" : "bg-violet-50 text-violet-700")}>
                            {TIKTOK_AUTO_MODE_LABEL[o.mode]}
                          </Badge>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-slate-400">Chiến dịch đích nhận Diễn tập nếu chiến dịch này đang Tự loại thật — bật thật phải quyết riêng.</p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setCopyOpen(false)} disabled={copying}>
                    Đóng
                  </Button>
                  <Button size="sm" onClick={() => void runCopy()} disabled={copying || copyPick.size === 0}>
                    {copying ? "Đang sao chép…" : `Sao chép (${copyPick.size})`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {rule?.configured && !copyOpen ? (
            <Button variant="ghost" size="sm" onClick={() => setCopyOpen(true)} disabled={saving}>
              <Copy className="size-4" />
              Sao chép sang chiến dịch khác
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={() => void save()} disabled={saving || !form || confirmLive}>
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
