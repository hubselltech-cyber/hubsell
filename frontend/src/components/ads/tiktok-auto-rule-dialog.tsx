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
// "Tự loại thật" chỉ bật được khi chiến dịch đã DIỄN TẬP ít nhất 1 ngày (có lượt chấm
// hằng ngày thật lúc 12h trưa; Chạy thử tại chỗ KHÔNG tính — anh Trung chốt 18/09: khách
// bật thật ngay, mất tiền rồi đổ oan cho Hubsell) và phải xác nhận lại tóm tắt lượt đó.
// Backend cũng từ chối bật live khi chưa có lượt nào — nút mờ chỉ là lớp ngoài.
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
import { Switch } from "@/components/ui/switch";
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
  ruleNoOrderOn: boolean;
  ruleLowRoiOn: boolean;
  ruleCpaOn: boolean;
  graceOn: boolean;
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
    ruleNoOrderOn: c.ruleNoOrderOn,
    ruleLowRoiOn: c.ruleLowRoiOn,
    ruleCpaOn: c.ruleCpaOn,
    graceOn: c.graceOn,
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
    ruleNoOrderOn: f.ruleNoOrderOn,
    ruleLowRoiOn: f.ruleLowRoiOn,
    ruleCpaOn: f.ruleCpaOn,
    graceOn: f.graceOn,
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
  const toggle = (k: "ruleNoOrderOn" | "ruleLowRoiOn" | "ruleCpaOn" | "graceOn") => (v: boolean) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  // Chỉ lượt chấm hằng ngày thật mới mở được Tự loại thật (Chạy thử không tính).
  const hadRun = Boolean(rule?.status?.lastRunOn);
  const lastSummary = preview?.summary ?? rule?.status?.lastRunSummary ?? null;
  const hardRoi = cfg ? cfg.roiTarget * (cfg.roiHardPct / 100) : 0;
  // ROI hòa vốn (giá vốn + phí sàn thật 30 ngày) — căn cứ để soát hai ngưỡng ROI đang nhập.
  const breakevenRoi = rule?.breakeven?.roi ?? null;
  const breakevenWarnings: string[] = [];
  if (cfg && rule?.breakeven?.negativeMargin) {
    breakevenWarnings.push("Sản phẩm của chiến dịch đang lỗ trước cả quảng cáo — ROI nào cũng lỗ, xem lại giá bán và giá vốn trước");
  } else if (cfg && breakevenRoi != null) {
    if (cfg.roiTarget < breakevenRoi) {
      breakevenWarnings.push(`ROI mục tiêu ${formatRoi(cfg.roiTarget)} đang thấp hơn hòa vốn ${formatRoi(breakevenRoi)} — đạt mục tiêu vẫn lỗ`);
    }
    if (cfg.ruleLowRoiOn && hardRoi < breakevenRoi) {
      breakevenWarnings.push(
        `Mức loại ${formatRoi(hardRoi)} thấp hơn hòa vốn ${formatRoi(breakevenRoi)} — video có ROI từ ${formatRoi(hardRoi)} đến ${formatRoi(breakevenRoi)} đang lỗ mà máy không loại`
      );
    }
  }
  const activeRuleSummary: string[] = cfg
    ? [
        cfg.ruleNoOrderOn ? `tiêu ≥ ${formatVND(cfg.spendNoOrder)} mà 0 đơn` : "",
        cfg.ruleLowRoiOn ? `ROI < ${formatRoi(hardRoi)}` : "",
        cfg.ruleCpaOn && cfg.maxCpa != null ? `chi phí/đơn > ${formatVND(cfg.maxCpa)}` : "",
      ].filter(Boolean)
    : [];

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
                      title={disabled ? "Phải diễn tập ít nhất 1 ngày (có lượt chấm sau 12h trưa) rồi mới bật được" : undefined}
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
                {!hadRun && mode !== "live" && " Tự loại thật chỉ mở sau khi đã diễn tập ít nhất 1 ngày — lưu ở chế độ Diễn tập, đợi lượt chấm sau 12h trưa, xem chuông báo đúng rồi mới bật."}
              </p>
            </div>

            {/* Ngưỡng đặt DƯỚI hòa vốn = máy để yên video đang lỗ. Chỉ NHẮC, không tự sửa số của khách. */}
            {breakevenWarnings.length > 0 && (
              <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-2.5 pr-3 pl-7 text-xs text-amber-800">
                {breakevenWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            {/* ===== TẦNG 1: hai số chính (điện thoại xếp dọc, từ sm hai cột) ===== */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">ROI mục tiêu</span>
                <Input inputMode="decimal" value={form.roiTarget} onChange={(e) => set("roiTarget")(e.target.value)} />
                {rule.roasTarget != null && (
                  <span className="block text-xs text-slate-400">TikTok đang đặt {formatRoi(rule.roasTarget)} cho chiến dịch này.</span>
                )}
                {breakevenRoi != null && (
                  <span className="block text-xs text-slate-400">Hòa vốn của chiến dịch: {formatRoi(breakevenRoi)}.</span>
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
                    {activeRuleSummary.length > 0 ? `· loại khi ${activeRuleSummary.join(", hoặc ")}` : "· chưa bật luật loại nào — máy chỉ gắn cờ"}
                  </span>
                )}
              </button>
              {advanced && (
                <div className="mt-3 space-y-3">
                  {/* Mỗi nhóm một khung; mỗi dòng = công tắc + nhãn bên trái, ô số cố định bên phải → luôn thẳng hàng
                      dù nhãn dài ngắn khác nhau (anh Trung 18/09: "thẳng hàng, đỡ phẳng"; luật nào không dùng thì tắt). */}
                  <RuleGroup title="Loại thẳng tay" hint="Video vi phạm một trong các luật đang bật sẽ bị loại.">
                    <RuleRow on={form.ruleNoOrderOn} onToggle={toggle("ruleNoOrderOn")} label="Tiêu từ … mà 0 đơn" hint="Tính trong cửa sổ đang soi.">
                      <CurrencyInput value={form.spendNoOrder} onValueChange={set("spendNoOrder")} disabled={!form.ruleNoOrderOn} />
                    </RuleRow>
                    <RuleRow
                      on={form.ruleLowRoiOn}
                      onToggle={toggle("ruleLowRoiOn")}
                      label="ROI dưới … % mục tiêu"
                      hint={`= ROI dưới ${formatRoi(hardRoi)}. Giữa mức này và mục tiêu chỉ gắn cờ.`}
                      unit="%"
                    >
                      <Input inputMode="numeric" value={form.roiHardPct} onChange={(e) => set("roiHardPct")(e.target.value)} disabled={!form.ruleLowRoiOn} />
                    </RuleRow>
                    <RuleRow
                      on={form.ruleCpaOn}
                      onToggle={toggle("ruleCpaOn")}
                      label="Chi phí mỗi đơn vượt …"
                      hint={form.ruleCpaOn && form.maxCpa.trim() === "" ? "Nhập trần chi phí/đơn để luật có hiệu lực." : "Đặt theo biên lãi của sản phẩm."}
                    >
                      <CurrencyInput value={form.maxCpa} onValueChange={set("maxCpa")} placeholder="80.000" disabled={!form.ruleCpaOn} />
                    </RuleRow>
                  </RuleGroup>

                  <RuleGroup title="Sàn dữ liệu">
                    <RuleRow label="Chưa xét khi tiêu dưới …" hint="Ít tiền quá thì chưa đủ để phán. Video TikTok còn đang học không bao giờ bị xét.">
                      <CurrencyInput value={form.minSpend} onValueChange={set("minSpend")} />
                    </RuleRow>
                  </RuleGroup>

                  <RuleGroup
                    title="Bảo vệ video công thần"
                    hint="Video từng bán tốt mà vi phạm thì được theo dõi thêm, không loại ngay."
                    on={form.graceOn}
                    onToggle={toggle("graceOn")}
                  >
                    <RuleRow label="Công thần = từ … đơn trong 30 ngày" dim={!form.graceOn} unit="đơn">
                      <Input inputMode="numeric" value={form.graceMinOrders} onChange={(e) => set("graceMinOrders")(e.target.value)} disabled={!form.graceOn} />
                    </RuleRow>
                    <RuleRow label="Ân hạn … ngày vi phạm liên tục rồi mới loại" dim={!form.graceOn} unit="ngày">
                      <Input inputMode="numeric" value={form.graceDays} onChange={(e) => set("graceDays")(e.target.value)} disabled={!form.graceOn} />
                    </RuleRow>
                  </RuleGroup>

                  <RuleGroup title="Chốt an toàn mỗi ngày" hint="Video anh/chị đã khôi phục tay thì máy không loại lại trong 30 ngày.">
                    <RuleRow label="Loại tối đa … video mỗi ngày" hint="Tốn tiền nhất loại trước, phần còn lại chờ ngày mai." unit="video">
                      <Input inputMode="numeric" value={form.maxExcludePerDay} onChange={(e) => set("maxExcludePerDay")(e.target.value)} />
                    </RuleRow>
                    <RuleRow label="Luôn giữ lại ít nhất … video đang ra đơn" hint="0 = không giữ." unit="video">
                      <Input inputMode="numeric" value={form.minOrderingVideosKeep} onChange={(e) => set("minOrderingVideosKeep")(e.target.value)} />
                    </RuleRow>
                  </RuleGroup>
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

/** Một khung nhóm luật: tiêu đề (có thể kèm công tắc cả nhóm) + các dòng luật. */
function RuleGroup({
  title,
  hint,
  on,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  on?: boolean;
  onToggle?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200">
      <header className="flex items-start gap-3 bg-slate-50 px-3 py-2">
        {onToggle && <Switch checked={on} onCheckedChange={(v) => onToggle(v)} aria-label={title} className="mt-0.5" />}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{title}</p>
          {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
      </header>
      <div className="divide-y divide-slate-200/80">{children}</div>
    </section>
  );
}

/** Một dòng luật: [công tắc] nhãn + gợi ý bên trái, ô số rộng cố định bên phải (điện thoại: ô số xuống dòng dưới nhãn). */
function RuleRow({
  on,
  onToggle,
  dim,
  label,
  hint,
  unit,
  children,
}: {
  on?: boolean;
  onToggle?: (v: boolean) => void;
  /** Làm mờ dòng khi nhóm cha đang tắt. */
  dim?: boolean;
  label: string;
  hint?: string;
  unit?: string;
  children: React.ReactNode;
}) {
  const off = onToggle ? !on : Boolean(dim);
  return (
    <div className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_11rem]", off && "opacity-60")}>
      {onToggle ? <Switch checked={on} onCheckedChange={(v) => onToggle(v)} aria-label={label} /> : <span className="w-9" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="text-sm text-slate-900">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      <div className="col-start-2 flex items-center gap-2 sm:col-start-auto">
        <div className="min-w-0 flex-1">{children}</div>
        {unit && <span className="w-9 shrink-0 text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
