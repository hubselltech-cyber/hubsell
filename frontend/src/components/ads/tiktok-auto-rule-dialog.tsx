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
// Đổi số sau khi diễn tập (anh Trung chốt 18/09 khuya): KHÔNG bắt diễn tập lại. Bật thật bằng cấu hình khác lượt chấm
// gần nhất thì lúc Lưu hiện cảnh báo nêu từng ô số cũ → số mới, khuyên diễn tập lại; khách không muốn thì tự bấm
// "Bỏ qua" và máy chạy theo số mới. Mọi lần đổi thông số (có bỏ qua hay không) backend ghi một dòng nhật ký ở tab Lịch sử.
// Video còn ĐANG HỌC trên TikTok không bao giờ bị xét; đồng hồ luật tính từ ngày
// TikTok học xong (backend theo dõi hằng ngày).
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, Eye, FlaskConical, Lock, PowerOff, Zap, type LucideIcon } from "lucide-react";
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
  runTiktokAdsAutoRuleNow,
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

/**
 * Ba THẺ CHỌN chế độ (anh Trung 18/09: dải ba nút liền nhau "phẳng quá"): biểu tượng + tên đậm + một dòng chú thích,
 * thẻ đang chọn tô ĐÚNG MÀU của chế độ — trùng màu nút "Tự động loại video" ngoài trang chiến dịch (Tắt xám · Diễn tập
 * tím · Tự loại thật xanh) để khách nhìn màu là biết đang ở chế độ nào.
 */
const MODE_CARD: Record<TiktokAdsAutoMode, { icon: LucideIcon; caption: string; active: string; iconIdle: string }> = {
  off: { icon: PowerOff, caption: "Máy không làm gì", active: "border-slate-700 bg-slate-700 text-white shadow-sm", iconIdle: "text-slate-400" },
  dry_run: { icon: Eye, caption: "Chỉ ghi sổ, báo chuông", active: "border-violet-600 bg-violet-600 text-white shadow-sm", iconIdle: "text-violet-500" },
  live: { icon: Zap, caption: "Loại thật trên TikTok", active: "border-emerald-600 bg-emerald-600 text-white shadow-sm", iconIdle: "text-emerald-600" },
};

/** Form giữ tiền dạng CHUỖI CHỮ SỐ cho CurrencyInput; số khác giữ chuỗi để gõ thoải mái. */
interface FormState {
  roiTarget: string;
  windowDays: string;
  hardBasis: "pct" | "breakeven";
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
    hardBasis: c.hardBasis,
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
    hardBasis: f.hardBasis,
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

/** Tên từng ô như khách thấy trong popup — để nói rõ "anh/chị vừa đổi ô nào". */
const FIELD_LABEL: Record<keyof TiktokAdsAutoConfig, string> = {
  roiTarget: "ROI mục tiêu",
  windowDays: "Soi theo số ngày",
  hardBasis: "Mức loại ROI tính theo",
  ruleNoOrderOn: "Luật tiêu tiền mà 0 đơn",
  ruleLowRoiOn: "Luật ROI dưới mức loại",
  ruleCpaOn: "Luật chi phí mỗi đơn",
  graceOn: "Bảo vệ video công thần",
  minSpend: "Mức tiêu tối thiểu để xét",
  spendNoOrder: "Mức tiêu mà 0 đơn",
  roiHardPct: "Mức loại (% ROI mục tiêu)",
  maxCpa: "Trần chi phí mỗi đơn",
  graceMinOrders: "Số đơn công thần",
  graceDays: "Số ngày ân hạn",
  maxExcludePerDay: "Số video loại tối đa mỗi ngày",
  minOrderingVideosKeep: "Số video ra đơn giữ lại",
};

function fieldValueText(k: keyof TiktokAdsAutoConfig, v: TiktokAdsAutoConfig[keyof TiktokAdsAutoConfig] | undefined): string {
  if (v == null) return "chưa đặt";
  if (typeof v === "boolean") return v ? "bật" : "tắt";
  if (k === "hardBasis") return v === "breakeven" ? "ROI hòa vốn" : "% mục tiêu";
  if (k === "minSpend" || k === "spendNoOrder" || k === "maxCpa") return formatVND(Number(v));
  if (k === "roiHardPct") return `${v}%`;
  return typeof v === "number" ? formatRoi(v) : String(v);
}

/** Chép tay luật backend (auto-rules.ts unrehearsedFields): số đi kèm một luật ĐANG TẮT không tính là đổi cấu hình. */
function unrehearsedFields(rehearsed: TiktokAdsAutoConfig | null, next: TiktokAdsAutoConfig): (keyof TiktokAdsAutoConfig)[] {
  const effective = (c: TiktokAdsAutoConfig) => {
    const e: Partial<TiktokAdsAutoConfig> = { ...c };
    if (!c.ruleNoOrderOn) delete e.spendNoOrder;
    if (!c.ruleLowRoiOn) {
      delete e.hardBasis;
      delete e.roiHardPct;
    }
    if (!c.ruleCpaOn) delete e.maxCpa;
    if (!c.graceOn) {
      delete e.graceMinOrders;
      delete e.graceDays;
    }
    return e;
  };
  const b = effective(next);
  if (!rehearsed) return Object.keys(b) as (keyof TiktokAdsAutoConfig)[];
  const a = effective(rehearsed);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof TiktokAdsAutoConfig>;
  return [...keys].filter((k) => a[k] !== b[k]);
}

export function TiktokAutoRuleDialog({
  open,
  onOpenChange,
  campaignRowId,
  campaignName,
  onSaved,
  startRunNow = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignRowId: string;
  campaignName: string;
  /** Mở thẳng vào bước "Loại ngay" (chiến dịch ĐÃ ở Tự loại thật nhưng chưa có lượt loại thật nào — nút trên trang chiến dịch). */
  startRunNow?: boolean;
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
  const [confirmSkip, setConfirmSkip] = useState(false);
  // BƯỚC "LOẠI NGAY" (anh Trung 18/09 đêm: đã diễn tập rồi thì bật thật xong thực thi ngay lượt đầu là hợp lý, chờ tới trưa hôm sau
  // quá dài). null = chưa vào bước này. Máy chấm lại tại chỗ → hiện ĐÚNG danh sách sẽ loại → khách bấm mới gửi lệnh.
  const [runNow, setRunNow] = useState<{ loading: boolean; preview: TiktokAdsAutoPreview | null; error: string | null } | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  // Trước 12h trưa số hôm qua của TikTok chưa ổn định (cùng căn cứ với giờ lượt chấm hằng ngày) → không chấm, chỉ báo giờ.
  const [vnHourAtOpen] = useState(() => new Date(Date.now() + 7 * 3600_000).getUTCHours());
  // Hộp xác nhận nằm cuối popup — khối Nâng cao đang mở thì nó rơi khỏi khung nhìn, bấm Lưu xong tưởng không có gì xảy ra.
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirmLive || confirmSkip) confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [confirmLive, confirmSkip]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyPick, setCopyPick] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);

  // Nạp form từ server mỗi lần mở (không giữ nháp giữa hai lần mở).
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setConfirmLive(false);
      setConfirmSkip(false);
      setRunNow(null);
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
  // B6: cấu hình đang nhập có KHÁC cấu hình lượt chấm gần nhất đã dùng không — khác mà bật thật thì cảnh báo lúc Lưu.
  const changedFields = useMemo(() => (cfg && rule ? unrehearsedFields(rule.rehearsedConfig, cfg) : []), [cfg, rule]);
  const unrehearsed = hadRun && mode === "live" && changedFields.length > 0;
  // DIỄN TẬP QUÁ CŨ (anh Trung 18/09 khuya — chỉ thông báo, khách tự chọn bỏ qua): BẬT thật mà lượt diễn tập gần nhất cách hôm
  // nay lâu hơn chính cửa sổ "Soi theo" → số liệu lượt đó không còn trùng ngày nào với cửa sổ hiện tại. Chép luật backend
  // (auto-rules.ts staleRehearsalDays); ngày tính theo giờ VN như backend.
  const [todayVn] = useState(() => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));
  const staleDays = useMemo(() => {
    const last = rule?.status?.lastRunOn;
    if (!cfg || !last || mode !== "live" || rule?.mode === "live") return null;
    const days = Math.round((Date.parse(`${todayVn}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400_000);
    return days > cfg.windowDays ? days : null;
  }, [cfg, mode, rule?.status?.lastRunOn, rule?.mode, todayVn]);
  const needsSkipAck = unrehearsed || staleDays != null;
  const lastSummary = preview?.summary ?? rule?.status?.lastRunSummary ?? null;
  // ROI hòa vốn (giá vốn + phí sàn thật, đơn đã đối soát) — căn cứ để soát hai ngưỡng ROI đang nhập.
  const breakevenRoi = rule?.breakeven?.roi ?? null;
  // MỨC LOẠI THỰC DÙNG: khách chọn "theo hòa vốn" VÀ hòa vốn đủ tin thì là hòa vốn; không thì % mục tiêu
  // (đúng luật resolveHardLevel ở backend — lượt chấm tự rơi về % khi hòa vốn chưa đủ tin).
  const pctRoi = cfg ? cfg.roiTarget * (cfg.roiHardPct / 100) : 0;
  const byBreakeven = cfg?.hardBasis === "breakeven" && breakevenRoi != null && rule?.breakevenUnusable === "";
  const hardRoi = byBreakeven && breakevenRoi != null ? breakevenRoi : pctRoi;
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

  /** Vào bước Loại ngay: chấm lại bằng cấu hình ĐÃ LƯU trên số mới nhất (đúng phép tính của Chạy thử, không ghi gì). */
  async function beginRunNow(saved: TiktokAdsAutoConfig) {
    if (vnHourAtOpen < 12) {
      setRunNow({ loading: false, preview: null, error: null });
      return;
    }
    setRunNow({ loading: true, preview: null, error: null });
    try {
      setRunNow({ loading: false, preview: await previewTiktokAdsAutoRule(campaignRowId, saved), error: null });
    } catch (err) {
      setRunNow({ loading: false, preview: null, error: err instanceof ApiError ? err.message : "Không chấm lại được" });
    }
  }

  async function executeRunNow() {
    const list = runNow?.preview?.exclude ?? [];
    if (list.length === 0) return;
    setRunningNow(true);
    try {
      const r = await runTiktokAdsAutoRuleNow(campaignRowId, list.map((v) => v.videoId));
      if (r.outcome === "executed") toast.success(r.message);
      else toast.message(r.message);
      if (r.status) onSaved?.(r.status, "live");
      await queryClient.invalidateQueries({ queryKey: qk.tiktokAdsAutoRule(campaignRowId) });
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads-videos", campaignRowId] });
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gửi được lệnh loại");
      // Danh sách vừa đổi (hoặc lỗi khác) → chấm lại để khách thấy danh sách mới trước khi bấm lần nữa.
      if (cfg) void beginRunNow(rule?.config ?? cfg);
    } finally {
      setRunningNow(false);
    }
  }

  // Trang chiến dịch mở thẳng vào bước này khi chiến dịch đã ở Tự loại thật mà chưa có lượt loại thật nào.
  useEffect(() => {
    if (open && startRunNow && rule && rule.mode === "live" && runNow == null) void beginRunNow(rule.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khởi động một lần khi mở + có dữ liệu
  }, [open, startRunNow, rule]);

  /** rehearseAgain: khách nghe lời khuyên ở hộp cảnh báo → lưu bộ số mới ở chế độ Diễn tập thay vì bật thật. */
  async function save(force = false, rehearseAgain = false) {
    if (!cfg || !rule) return;
    const saveMode: TiktokAdsAutoMode = rehearseAgain ? "dry_run" : mode;
    if (needsSkipAck && !force && !rehearseAgain) {
      setConfirmSkip(true);
      return;
    }
    if (saveMode === "live" && rule.mode !== "live" && !force) {
      setConfirmLive(true);
      return;
    }
    setSaving(true);
    try {
      const r = await saveTiktokAdsAutoRule(campaignRowId, { mode: saveMode, ...cfg, ...(needsSkipAck && saveMode === "live" ? { skipRehearsal: true } : {}) });
      const mode = saveMode;
      toast.success(
        mode === "off"
          ? "Đã tắt loại video tự động cho chiến dịch này."
          : mode === "dry_run"
            ? "Đã lưu. Mỗi ngày sau 12h trưa, Trợ lý sẽ chấm điểm và báo chuông — chưa loại video nào."
            : rule.mode !== "live"
              ? "Đã bật Tự loại thật."
              : "Đã lưu. Trợ lý loại video vi phạm ở lượt chấm mỗi ngày (12h–14h)."
      );
      onSaved?.(r.status, r.mode);
      // Vừa CHUYỂN sang Tự loại thật → không đóng popup: sang bước Loại ngay (chấm lại, hiện danh sách, khách bấm mới gửi).
      const turnedLive = saveMode === "live" && rule.mode !== "live";
      await queryClient.invalidateQueries({ queryKey: qk.tiktokAdsAutoRule(campaignRowId) });
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads-videos", campaignRowId] });
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads"] });
      if (turnedLive) void beginRunNow(r.config);
      else onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cấu hình");
    } finally {
      setSaving(false);
      setConfirmLive(false);
      setConfirmSkip(false);
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
    <Dialog open={open} onOpenChange={(o) => !saving && !copying && !runningNow && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tự động loại video</DialogTitle>
          <DialogDescription className="truncate">{campaignName}</DialogDescription>
        </DialogHeader>

        {q.error && <p className="text-sm text-red-500">{q.error}</p>}
        {!form && !q.error && <p className="py-8 text-center text-sm text-muted-foreground">Đang tải cấu hình…</p>}

        {/* ===== BƯỚC LOẠI NGAY — thay cả form: lúc này chỉ còn MỘT quyết định ===== */}
        {runNow && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <Zap className="size-4" /> Chiến dịch đang ở chế độ Tự loại thật
            </p>
            {vnHourAtOpen < 12 ? (
              <p className="text-sm text-slate-700">
                Số hôm qua của TikTok chưa ổn định trước 12h trưa (chi phí video về trễ tới 11 giờ). Lượt loại thật đầu tiên sẽ tự chạy trong khoảng
                12h–14h hôm nay, anh/chị không cần làm gì thêm.
              </p>
            ) : runNow.loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Đang chấm lại bằng số mới nhất của TikTok…</p>
            ) : runNow.error ? (
              <p className="text-sm text-red-500">{runNow.error}. Lượt loại thật sẽ tự chạy ở lượt chấm kế tiếp (12h–14h).</p>
            ) : runNow.preview?.dataProblem ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                Số liệu video của TikTok lúc này không đáng tin: {runNow.preview.dataProblem}. Chưa loại video nào — Trợ lý sẽ chấm lại ở lượt kế tiếp.
              </p>
            ) : runNow.preview && runNow.preview.exclude.length === 0 ? (
              <p className="text-sm text-slate-700">
                Chấm bằng số mới nhất: hiện không có video nào tới mức loại ({runNow.preview.summary}). Trợ lý sẽ chấm lại mỗi ngày trong khoảng 12h–14h.
              </p>
            ) : runNow.preview ? (
              <>
                <p className="text-sm text-slate-700">
                  Anh/chị đã diễn tập trước đó nên có thể cho máy làm ngay lượt đầu tiên, không phải chờ tới trưa mai. Chấm bằng số{" "}
                  {runNow.preview.windowFrom.slice(8, 10)}/{runNow.preview.windowFrom.slice(5, 7)}–{runNow.preview.windowTo.slice(8, 10)}/
                  {runNow.preview.windowTo.slice(5, 7)}, máy sẽ loại <span className="font-semibold">{formatNumber(runNow.preview.exclude.length)} video</span> đang
                  ngốn {formatVND(runNow.preview.excludeSpend)} mà ra {formatNumber(runNow.preview.excludeOrders)} đơn:
                </p>
                <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3 text-xs">
                  {runNow.preview.exclude.map((v) => (
                    <li key={v.videoId}>
                      <span className="tabular-nums font-medium text-slate-900">{v.videoId}</span>
                      <span className="text-slate-500">
                        {" "}
                        · chi {formatVND(v.cost)} · {formatNumber(v.orders)} đơn · ROI {formatRoi(v.roi)}
                      </span>
                      <span className="block text-slate-500">{v.reason}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-slate-500">
                  Lệnh có hiệu lực trên TikTok sau khoảng 20 phút. Loại nhầm thì vào tab Lịch sử bấm “Khôi phục cả lệnh” — máy sẽ không loại lại các
                  video đó trong 30 ngày.
                </p>
              </>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={runningNow}>
                {runNow.preview && runNow.preview.exclude.length > 0 && !runNow.preview.dataProblem ? "Để lượt chấm kế tiếp (12h–14h)" : "Đóng"}
              </Button>
              {runNow.preview && runNow.preview.exclude.length > 0 && !runNow.preview.dataProblem && (
                <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => void executeRunNow()} disabled={runningNow}>
                  {runningNow ? "Đang gửi lên TikTok…" : `Loại ngay ${formatNumber(runNow.preview.exclude.length)} video`}
                </Button>
              )}
            </div>
          </div>
        )}

        {!runNow && form && cfg && rule && (
          <div className="space-y-4">
            {/* ===== TẦNG 1: chế độ ===== */}
            <div>
              <div role="radiogroup" aria-label="Chế độ tự động loại video" className="grid grid-cols-3 gap-2">
                {(["off", "dry_run", "live"] as TiktokAdsAutoMode[]).map((m) => {
                  const disabled = m === "live" && !hadRun;
                  const active = mode === m;
                  const card = MODE_CARD[m];
                  const Icon = disabled ? Lock : card.icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={disabled}
                      onClick={() => setMode(m)}
                      title={disabled ? "Phải diễn tập ít nhất 1 ngày (có lượt chấm sau 12h trưa) rồi mới bật được" : undefined}
                      className={cn(
                        "flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors",
                        active ? card.active : "border-slate-200 bg-card text-slate-900 hover:border-slate-300 hover:bg-muted",
                        disabled && "cursor-not-allowed border-dashed bg-slate-50 text-slate-400 hover:border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      <Icon className={cn("size-5", active ? "text-white" : disabled ? "text-slate-300" : card.iconIdle)} aria-hidden="true" />
                      <span className="text-sm leading-tight font-semibold">{TIKTOK_AUTO_MODE_LABEL[m]}</span>
                      <span className={cn("text-xs leading-tight", active ? "text-white/85" : disabled ? "text-slate-400" : "text-slate-500")}>
                        {disabled ? "Cần diễn tập 1 ngày" : card.caption}
                      </span>
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
                    {/* MỘT DÒNG duy nhất cho luật ROI thấp (anh Trung 18/09: chọn gì thì cả cụm nằm trên cùng một dòng): công tắc ·
                        nhãn · [ô chọn cách tính] [ô % — chỉ khi đang dùng %]. Ô % hiện khi chọn "% mục tiêu", hoặc chọn hòa vốn mà
                        hòa vốn chưa đủ tin (máy đang tạm theo %); chọn hòa vốn và hòa vốn đủ tin thì chỉ còn ô chọn, rộng đúng
                        bằng ô số của các dòng khác. Nhãn lựa chọn cố ý NGẮN để không bị cắt chữ trong ô chọn. */}
                    <RuleRow
                      wide
                      on={form.ruleLowRoiOn}
                      onToggle={toggle("ruleLowRoiOn")}
                      label="Có đơn nhưng ROI dưới mức loại"
                      hint={
                        byBreakeven
                          ? `= ROI dưới ${formatRoi(breakevenRoi)} (hòa vốn hôm nay, lỗ thật). Tự cập nhật mỗi lượt chấm.`
                          : form.hardBasis === "breakeven"
                            ? `Chưa dùng được hòa vốn: ${rule.breakevenUnusable || "chưa tính được"}. Tạm loại theo ${form.roiHardPct}% mục tiêu = ROI dưới ${formatRoi(pctRoi)}.`
                            : `= ROI dưới ${formatRoi(pctRoi)}. Từ mức này tới mục tiêu chỉ gắn cờ.`
                      }
                      unit={byBreakeven ? undefined : "%"}
                    >
                      <NativeSelect
                        className={byBreakeven ? "w-full sm:w-[11rem]" : "w-[8.5rem] shrink-0"}
                        value={form.hardBasis}
                        onChange={(e) => setForm((f) => (f ? { ...f, hardBasis: e.target.value === "breakeven" ? "breakeven" : "pct" } : f))}
                        disabled={!form.ruleLowRoiOn}
                        aria-label="Mức loại ROI tính theo"
                      >
                        <option value="pct">% mục tiêu</option>
                        <option value="breakeven">ROI hòa vốn</option>
                      </NativeSelect>
                      {!byBreakeven && (
                        <Input
                          className="w-16 shrink-0"
                          inputMode="numeric"
                          value={form.roiHardPct}
                          onChange={(e) => set("roiHardPct")(e.target.value)}
                          disabled={!form.ruleLowRoiOn}
                          aria-label="Mức loại bằng bao nhiêu phần trăm ROI mục tiêu"
                        />
                      )}
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
                    <RuleRow gutter="none" label="Chưa xét khi tiêu dưới …" hint="Ít tiền quá thì chưa đủ để phán. Video TikTok còn đang học không bao giờ bị xét.">
                      <CurrencyInput value={form.minSpend} onValueChange={set("minSpend")} />
                    </RuleRow>
                  </RuleGroup>

                  <RuleGroup
                    title="Bảo vệ video công thần"
                    hint="Video từng bán tốt mà vi phạm thì được theo dõi thêm, không loại ngay."
                    on={form.graceOn}
                    onToggle={toggle("graceOn")}
                  >
                    <RuleRow gutter="sub" label="Công thần = từ … đơn trong 30 ngày" dim={!form.graceOn} unit="đơn">
                      <Input inputMode="numeric" value={form.graceMinOrders} onChange={(e) => set("graceMinOrders")(e.target.value)} disabled={!form.graceOn} />
                    </RuleRow>
                    <RuleRow gutter="sub" label="Ân hạn … ngày vi phạm liên tục rồi mới loại" dim={!form.graceOn} unit="ngày">
                      <Input inputMode="numeric" value={form.graceDays} onChange={(e) => set("graceDays")(e.target.value)} disabled={!form.graceOn} />
                    </RuleRow>
                  </RuleGroup>

                  <RuleGroup title="Chốt an toàn mỗi ngày" hint="Video anh/chị đã khôi phục tay thì máy không loại lại trong 30 ngày.">
                    <RuleRow gutter="none" label="Loại tối đa … video mỗi ngày" hint="Tốn tiền nhất loại trước, phần còn lại chờ ngày mai." unit="video">
                      <Input inputMode="numeric" value={form.maxExcludePerDay} onChange={(e) => set("maxExcludePerDay")(e.target.value)} />
                    </RuleRow>
                    <RuleRow gutter="none" label="Luôn giữ lại ít nhất … video đang ra đơn" hint="0 = không giữ." unit="video">
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
                  {preview.dataProblem && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      Số liệu video của TikTok hôm nay không đáng tin: {preview.dataProblem}. Lượt chấm thật sẽ bỏ lượt, không loại video nào.
                    </p>
                  )}
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

            {/* ===== B6 — CẢNH BÁO ĐỔI SỐ SAU DIỄN TẬP (anh Trung 18/09 khuya: chỉ cảnh báo, khách tự bấm bỏ qua) ===== */}
            {confirmSkip && (
              <div ref={confirmRef} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-800">
                  {staleDays != null && !unrehearsed
                    ? `Lượt diễn tập gần nhất đã cách đây ${formatNumber(staleDays)} ngày`
                    : "Anh/chị đã đổi thông số so với lượt diễn tập gần nhất"}
                </p>
                {staleDays != null && (
                  <p className="text-xs text-amber-800">
                    {unrehearsed ? `Lượt diễn tập gần nhất cũng đã cách đây ${formatNumber(staleDays)} ngày — ` : "Đã "}lâu hơn cửa sổ soi{" "}
                    {formatNumber(cfg.windowDays)} ngày, nên kết quả lượt đó không còn nói về các video đang chạy hôm nay.
                  </p>
                )}
                {!unrehearsed ? null : rule.rehearsedConfig ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                    {changedFields.map((k) => (
                      <li key={k}>
                        {FIELD_LABEL[k]}: lượt chấm dùng <span className="font-medium">{fieldValueText(k, rule.rehearsedConfig?.[k])}</span> → nay{" "}
                        <span className="font-medium">{fieldValueText(k, cfg[k])}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-amber-800">Lượt chấm trước chưa ghi lại cấu hình đã dùng nên chưa so được từng ô.</p>
                )}
                <p className="text-amber-800">
                  {unrehearsed ? "Máy chưa chấm điểm bằng bộ số này lần nào. " : ""}Để có kết quả chuẩn xác, anh/chị nên diễn tập lại: lưu ở Diễn tập, sau lượt chấm 12h
                  trưa kế tiếp xem chuông báo đúng ý rồi bật thật. Nếu bỏ qua, từ lượt chấm kế tiếp Trợ lý loại thật theo {unrehearsed ? "bộ số mới" : "bộ số đang lưu"} (tối đa{" "}
                  {formatNumber(cfg.maxExcludePerDay)} video/ngày).
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmSkip(false)} disabled={saving}>
                    Để em xem lại
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void save(true)} disabled={saving}>
                    Bỏ qua, bật thật luôn
                  </Button>
                  <Button size="sm" className="bg-violet-600 text-white hover:bg-violet-700" onClick={() => void save(false, true)} disabled={saving}>
                    {saving ? "Đang lưu…" : "Diễn tập lại"}
                  </Button>
                </div>
              </div>
            )}

            {/* ===== XÁC NHẬN BẬT THẬT ===== */}
            {confirmLive && (
              <div ref={confirmRef} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
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

        {!runNow && (
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
            <Button onClick={() => void save()} disabled={saving || !form || confirmLive || confirmSkip}>
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </DialogFooter>
        )}
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

/**
 * Một dòng luật: [công tắc] nhãn + gợi ý bên trái, ô số rộng cố định bên phải (điện thoại: ô số xuống dòng dưới nhãn).
 * Cột trái (gutter) KHÔNG BAO GIỜ để trống — chỗ trống đúng bằng một công tắc làm người xem tưởng dòng đó thiếu nút
 * bật/tắt (anh Trung 18/09): có onToggle → công tắc; "sub" → nét nối của dòng CON thuộc công tắc phía trên;
 * "none" → không có cột trái (nhóm luôn áp dụng, không có gì để bật/tắt). Ô số bên phải vẫn thẳng hàng ở mọi kiểu.
 */
function RuleRow({
  on,
  onToggle,
  gutter = "sub",
  wide,
  dim,
  label,
  hint,
  unit,
  children,
}: {
  on?: boolean;
  onToggle?: (v: boolean) => void;
  /** Kiểu cột trái khi dòng KHÔNG có công tắc riêng. */
  gutter?: "sub" | "none";
  /** Dòng có NHIỀU ô điều khiển trên một hàng: cột phải co theo nội dung (vẫn căn mép phải với các dòng khác). */
  wide?: boolean;
  /** Làm mờ dòng khi nhóm cha đang tắt. */
  dim?: boolean;
  label: string;
  hint?: string;
  unit?: string;
  children: React.ReactNode;
}) {
  const off = onToggle ? !on : Boolean(dim);
  const flush = !onToggle && gutter === "none";
  return (
    <div
      className={cn(
        "grid items-center gap-x-3 gap-y-2 px-3 py-2.5",
        flush
          ? "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem]"
          : wide
            ? "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            : "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_11rem]",
        off && "opacity-60"
      )}
    >
      {onToggle ? (
        <Switch checked={on} onCheckedChange={(v) => onToggle(v)} aria-label={label} />
      ) : flush ? null : (
        <span className="flex w-9 justify-end self-start pt-0.5" aria-hidden="true">
          <span className="h-3 w-3.5 rounded-bl-md border-b border-l border-slate-300" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm text-slate-900">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      <div className={cn("flex items-center gap-2 sm:col-start-auto", flush ? "col-start-1" : "col-start-2")}>
        <div className={wide ? "flex min-w-0 items-center gap-2" : "min-w-0 flex-1"}>{children}</div>
        {unit && <span className="w-9 shrink-0 text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
