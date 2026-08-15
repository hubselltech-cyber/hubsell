"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Building2,
  CircleHelp,
  ExternalLink,
  FileSignature,
  KeyRound,
  Loader2,
  Lock,
  MonitorSmartphone,
  PenLine,
  PlugZap,
  Radio,
  Save,
  ShieldCheck,
  Store,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { InvoicePlanPurchaseSection } from "@/components/settings/invoice-plan-purchase";
import { InvoiceQuotaMonitorSection } from "@/components/settings/invoice-quota-monitor";
import {
  ApiError,
  fetchInvoiceConfig,
  saveInvoiceChannelKey,
  saveInvoiceConfig,
  testEsignConnection,
  testMeinvoiceConnection,
  testPosConnection,
  type InvoiceChannelKeyDTO,
  type PosMachineDTO,
} from "@/lib/api";
import {
  HUBSELL_PARTNER_CODE,
  INVOICE_FIELD_HINTS,
  INVOICE_PATTERN_RE,
  INVOICE_SERIES_RE,
  INVOICE_VENDORS,
  POS_SERIES_RE,
  POS_VENDORS,
  posVendorMeta,
  SIGN_METHODS,
  TAX_CODE_RE,
  vendorMeta,
} from "@/lib/invoice-vendors";
import { CHANNEL_META } from "@/lib/channel-meta";
import { shopLabel } from "@/components/channel-filter";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRANG HÓA ĐƠN ĐIỆN TỬ & CHỮ KÝ SỐ — layout 2 CỘT 8:4 kiểu Stripe/Shopify
 * Settings (refactor 07/08 trị "visual fatigue" của bản xếp 6 card dọc):
 *
 *   CỘT TRÁI (8/12) — form chính:
 *     · Segmented control 2 tab (Kê khai ↔ Máy tính tiền — NĐ 123/2020).
 *     · MỘT card chính gom Pháp nhân + API (meInvoice hoặc POS theo tab),
 *       phân section bằng tiêu đề icon-badge màu + border-t.
 *     · Card API Key theo gian hàng + thanh Lưu.
 *   CỘT PHẢI (4/12) — sidebar:
 *     · Widget Trạng thái kết nối: badge từng dịch vụ + nút Quick Test
 *       (kết quả test giữ TRONG PHIÊN, không persist) + luồng mặc định.
 *     · Card Chữ ký số MISA eSign — CHỈ hiện ở tab Kê khai (POS miễn ký lẻ).
 *     · Box Hướng dẫn nhanh (tra mã máy tính tiền, dải mã CQT, link MISA).
 *
 * Nghiệp vụ giữ nguyên bản trước: một bản ghi InvoiceConfig cấp shop cho cả
 * 2 tab; validate TT 78 inline (regex mirror backend); secret dạng che, để
 * trống khi lưu = giữ nguyên; nút test POS auto-fill Mã máy/Dải mã/Ký hiệu
 * vào ô trống + dropdown chọn máy khi MISA trả danh mục.
 */

type InvoiceTab = "standard" | "pos";

/** Trạng thái test kết nối TRONG PHIÊN của từng dịch vụ. */
type ConnState = "idle" | "ok" | "fail";

/** Viền focus nổi bật cho input (yêu cầu thiết kế mới) — cộng vào className. */
const INPUT_FOCUS =
  "focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:border-blue-500";

/** Tiêu đề section trong card chính: icon badge màu nhã + title + mô tả. */
function SectionHeading({
  icon,
  tone,
  title,
  desc,
}: {
  icon: ReactNode;
  /** Lớp màu của icon badge, VD "bg-blue-50 text-blue-600". */
  tone: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn("rounded-xl p-2.5", tone)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {desc && <p className={cn(TEXT_SUB, "mt-0.5")}>{desc}</p>}
      </div>
    </div>
  );
}

/** Badge trạng thái kết nối trong widget sidebar. */
function ConnBadge({ state, hasKeys }: { state: ConnState; hasKeys: boolean }) {
  if (state === "ok") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Đã kết nối
      </span>
    );
  }
  if (state === "fail") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
        <span className="size-1.5 rounded-full bg-red-500" />
        Lỗi kết nối
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
      <span className="size-1.5 rounded-full bg-slate-400" />
      {hasKeys ? "Chưa kiểm tra" : "Chưa kết nối"}
    </span>
  );
}

/** Dòng lỗi định dạng inline dưới ô nhập — component TĨNH cấp module (khai báo
 *  trong thân component sẽ bị React coi là tạo mới mỗi render). */
function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-red-500">{msg}</p>;
}

export function InvoiceConfigSection({
  /** Chế độ Beta/xem trước: khóa các nút Lưu để không ghi cấu hình khi module tắt. */
  readOnlyPreview = false,
}: {
  readOnlyPreview?: boolean;
}) {
  const [loading, setLoading] = useState(true);

  // Công tắc tổng của module — mặc định TẮT; khu thương mại luôn mở.
  const [isInvoiceModuleEnabled, setIsInvoiceModuleEnabled] = useState(false);

  const [activeTab, setActiveTab] = useState<InvoiceTab>("standard");

  // (1) Pháp nhân & Thuế — DÙNG CHUNG cho cả 2 tab (một chủ shop = một MST).
  const [taxCode, setTaxCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");

  // (2) meInvoice API (kê khai)
  const [provider, setProvider] = useState("MISA");
  const [clientId, setClientId] = useState("");
  const [customApiUrl, setCustomApiUrl] = useState("");
  const [invoicePattern, setInvoicePattern] = useState("");
  const [invoiceSeries, setInvoiceSeries] = useState("");
  const [hasSecretKey, setHasSecretKey] = useState(false);
  const [secretMasked, setSecretMasked] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState("");

  // (3) Chữ ký số MISA eSign (sidebar, chỉ tab kê khai)
  const [signMethod, setSignMethod] = useState("USB_TOKEN");
  const [esignClientId, setEsignClientId] = useState("");
  const [esignUsername, setEsignUsername] = useState("");
  const [certSerial, setCertSerial] = useState("");
  const [hasEsignSecret, setHasEsignSecret] = useState(false);
  const [esignSecretMasked, setEsignSecretMasked] = useState<string | null>(null);
  const [esignSecretInput, setEsignSecretInput] = useState("");
  const [hasEsignPassword, setHasEsignPassword] = useState(false);
  const [esignPasswordMasked, setEsignPasswordMasked] = useState<string | null>(null);
  const [esignPasswordInput, setEsignPasswordInput] = useState("");

  // (4) Máy tính tiền (POS)
  const [posProvider, setPosProvider] = useState("MISA");
  const [posClientId, setPosClientId] = useState("");
  const [posCodePrefix, setPosCodePrefix] = useState("");
  const [posMachineId, setPosMachineId] = useState("");
  const [posSeries, setPosSeries] = useState("");
  const [hasPosSecret, setHasPosSecret] = useState(false);
  const [posSecretMasked, setPosSecretMasked] = useState<string | null>(null);
  const [posSecretInput, setPosSecretInput] = useState("");
  const [defaultInvoiceType, setDefaultInvoiceType] = useState("STANDARD");
  /** Danh mục máy MISA trả từ lần test gần nhất — nguồn dropdown gợi ý. */
  const [posMachines, setPosMachines] = useState<PosMachineDTO[]>([]);

  // Lỗi định dạng inline theo trường (validate TT 78 ngay trên UI).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Trạng thái kết nối trong phiên (widget sidebar).
  const [connStatus, setConnStatus] = useState<
    Record<"meinvoice" | "esign" | "pos", ConnState>
  >({ meinvoice: "idle", esign: "idle", pos: "idle" });

  const [savingConfig, setSavingConfig] = useState(false);
  const [testingMeinvoice, setTestingMeinvoice] = useState(false);
  const [testingEsign, setTestingEsign] = useState(false);
  const [testingPos, setTestingPos] = useState(false);

  // api_key theo gian hàng
  const [channelKeys, setChannelKeys] = useState<InvoiceChannelKeyDTO[]>([]);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoiceConfig()
      .then((r) => {
        setTaxCode(r.config.taxCode);
        setCompanyName(r.config.companyName);
        setCompanyAddress(r.config.companyAddress);
        setProvider(r.config.provider);
        setClientId(r.config.clientId);
        setCustomApiUrl(r.config.customApiUrl);
        setInvoicePattern(r.config.invoicePattern);
        setInvoiceSeries(r.config.invoiceSeries);
        setHasSecretKey(r.config.hasSecretKey);
        setSecretMasked(r.config.secretKeyMasked);
        setSignMethod(r.config.signMethod);
        setEsignClientId(r.config.esignClientId);
        setEsignUsername(r.config.esignUsername);
        setCertSerial(r.config.certSerial);
        setHasEsignSecret(r.config.hasEsignSecretKey);
        setEsignSecretMasked(r.config.esignSecretKeyMasked);
        setHasEsignPassword(r.config.hasEsignPassword);
        setEsignPasswordMasked(r.config.esignPasswordMasked);
        setPosProvider(r.config.posProvider);
        setPosClientId(r.config.posClientId);
        setPosCodePrefix(r.config.posCodePrefix);
        setPosMachineId(r.config.posMachineId);
        setPosSeries(r.config.posSeries);
        setHasPosSecret(r.config.hasPosSecretKey);
        setPosSecretMasked(r.config.posSecretKeyMasked);
        setDefaultInvoiceType(r.config.defaultInvoiceType);
        // Mở đúng tab theo luồng phát hành đang chọn.
        setActiveTab(r.config.defaultInvoiceType === "POS" ? "pos" : "standard");
        setChannelKeys(r.channelKeys);
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          toast.error("Không tải được cấu hình hóa đơn");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  /** Meta NCC đang chọn — quyết định bộ trường credential (Dynamic Form). */
  const vendor = vendorMeta(provider);
  /** Meta NCC luồng MÁY TÍNH TIỀN (chọn riêng với luồng kê khai). */
  const posVendor = posVendorMeta(posProvider);
  const isEsignCloud = signMethod === "ESIGN_CLOUD";

  /** Validate TT 78 các trường ĐÃ nhập — trả map lỗi (rỗng = hợp lệ). */
  function validateFields(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (taxCode.trim() && !TAX_CODE_RE.test(taxCode.trim())) {
      errors.taxCode = INVOICE_FIELD_HINTS.taxCode;
    }
    if (invoicePattern.trim() && !INVOICE_PATTERN_RE.test(invoicePattern.trim())) {
      errors.invoicePattern = INVOICE_FIELD_HINTS.invoicePattern;
    }
    const series = invoiceSeries.trim().toUpperCase();
    if (series && !INVOICE_SERIES_RE.test(series)) {
      errors.invoiceSeries = INVOICE_FIELD_HINTS.invoiceSeries;
    }
    const pos = posSeries.trim().toUpperCase();
    if (pos && !POS_SERIES_RE.test(pos)) {
      errors.posSeries = INVOICE_FIELD_HINTS.posSeries;
    }
    return errors;
  }

  async function handleSaveConfig() {
    const errors = validateFields();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Dữ liệu chưa đúng định dạng TT 78/2021 — kiểm tra các ô báo đỏ");
      return;
    }
    setSavingConfig(true);
    try {
      const r = await saveInvoiceConfig({
        taxCode: taxCode.trim(),
        companyName: companyName.trim(),
        companyAddress: companyAddress.trim(),
        provider,
        signMethod,
        // Luôn gửi mã ISV cố định của Hubsell — không lấy từ input (read-only).
        partnerCode: HUBSELL_PARTNER_CODE,
        clientId: clientId.trim(),
        secretKey: secretInput.trim() || undefined,
        customApiUrl: customApiUrl.trim(),
        invoicePattern: invoicePattern.trim(),
        invoiceSeries: invoiceSeries.trim().toUpperCase(),
        esignClientId: esignClientId.trim(),
        esignSecretKey: esignSecretInput.trim() || undefined,
        esignUsername: esignUsername.trim(),
        esignPassword: esignPasswordInput.trim() || undefined,
        certSerial: certSerial.trim(),
        posProvider,
        posClientId: posClientId.trim(),
        posSecretKey: posSecretInput.trim() || undefined,
        posCodePrefix: posCodePrefix.trim(),
        posMachineId: posMachineId.trim(),
        posSeries: posSeries.trim().toUpperCase(),
        defaultInvoiceType,
      });
      setInvoiceSeries(r.config.invoiceSeries);
      setPosSeries(r.config.posSeries);
      setHasSecretKey(r.config.hasSecretKey);
      setSecretMasked(r.config.secretKeyMasked);
      setSecretInput("");
      setHasEsignSecret(r.config.hasEsignSecretKey);
      setEsignSecretMasked(r.config.esignSecretKeyMasked);
      setEsignSecretInput("");
      setHasEsignPassword(r.config.hasEsignPassword);
      setEsignPasswordMasked(r.config.esignPasswordMasked);
      setEsignPasswordInput("");
      setHasPosSecret(r.config.hasPosSecretKey);
      setPosSecretMasked(r.config.posSecretKeyMasked);
      setPosSecretInput("");
      toast.success("Đã lưu cấu hình Hóa đơn & Chữ ký số");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không lưu được cấu hình",
      );
    } finally {
      setSavingConfig(false);
    }
  }

  async function runConnectionTest(
    kind: "meinvoice" | "esign",
    setBusy: (v: boolean) => void,
  ) {
    setBusy(true);
    try {
      const r =
        kind === "meinvoice"
          ? await testMeinvoiceConnection()
          : await testEsignConnection();
      setConnStatus((prev) => ({ ...prev, [kind]: "ok" }));
      toast.success(r.message ?? "Kết nối OK");
    } catch (err) {
      setConnStatus((prev) => ({ ...prev, [kind]: "fail" }));
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được — thử lại sau",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Điền thông tin một máy từ danh mục vào form (thao tác CHỌN chủ động —
   * cho phép ghi đè, khác auto-fill sau test chỉ điền ô trống). */
  function applyPosMachine(m: PosMachineDTO) {
    if (m.machineId) setPosMachineId(m.machineId);
    if (m.codePrefix) setPosCodePrefix(m.codePrefix);
    if (m.serial) setPosSeries(m.serial.toUpperCase());
  }

  /**
   * Test POS tách riêng vì có AUTO-FILL: MISA trả được danh mục máy tính tiền
   * thì lưu vào dropdown gợi ý + tự điền Mã máy / Dải mã CQT / Ký hiệu vào các
   * Ô CÒN TRỐNG (không ghi đè giá trị user đã gõ).
   */
  async function handleTestPos() {
    setTestingPos(true);
    try {
      const r = await testPosConnection();
      setConnStatus((prev) => ({ ...prev, pos: "ok" }));
      const machines = r.machines ?? [];
      setPosMachines(machines);
      const machine = machines[0];
      const filled: string[] = [];
      if (machine) {
        if (!posMachineId.trim() && machine.machineId) {
          setPosMachineId(machine.machineId);
          filled.push("Mã máy");
        }
        if (!posCodePrefix.trim() && machine.codePrefix) {
          setPosCodePrefix(machine.codePrefix);
          filled.push("Dải mã CQT");
        }
        if (!posSeries.trim() && machine.serial) {
          setPosSeries(machine.serial.toUpperCase());
          filled.push("Ký hiệu");
        }
      }
      toast.success(
        filled.length > 0
          ? `${r.message ?? "Kết nối POS OK"} Đã tự điền: ${filled.join(", ")} (nhớ bấm Lưu).`
          : (r.message ?? "Kết nối POS OK"),
      );
    } catch (err) {
      setConnStatus((prev) => ({ ...prev, pos: "fail" }));
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được — thử lại sau",
      );
    } finally {
      setTestingPos(false);
    }
  }

  async function handleSaveChannelKey(channelId: string) {
    setSavingKeyId(channelId);
    try {
      const r = await saveInvoiceChannelKey(
        channelId,
        (keyInputs[channelId] ?? "").trim(),
      );
      setChannelKeys((prev) =>
        prev.map((c) =>
          c.channelId === channelId
            ? { ...c, hasApiKey: r.hasApiKey, apiKeyMasked: r.apiKeyMasked }
            : c,
        ),
      );
      setKeyInputs((prev) => ({ ...prev, [channelId]: "" }));
      toast.success("Đã lưu API Key cho gian hàng");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không lưu được API Key",
      );
    } finally {
      setSavingKeyId(null);
    }
  }

  /** Ô nhập secret dạng che dùng chung (placeholder báo đã-lưu). */
  function secretPlaceholder(has: boolean, masked: string | null) {
    return has ? `Đã lưu (${masked ?? "••••"}) — nhập để đổi` : "••••••••";
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Đang tải cấu hình…
      </div>
    );
  }

  const TABS: Array<{ value: InvoiceTab; label: string; sub: string }> = [
    {
      value: "standard",
      label: "Hóa đơn điện tử Thông thường",
      sub: "Kê khai · Doanh nghiệp",
    },
    {
      value: "pos",
      label: "Hóa đơn từ Máy tính tiền",
      sub: "HKD · Bán lẻ · C26MXX",
    },
  ];

  const hasMeinvoiceKeys = Boolean(clientId.trim() || hasSecretKey);
  const hasEsignKeys = Boolean(esignClientId.trim() || hasEsignSecret);
  const hasPosKeys = Boolean(posClientId.trim() || hasPosSecret);

  return (
    <div className="space-y-6">
      {/* ===== BÁO CÁO & GIÁM SÁT PHÔI — LUÔN HIỂN THỊ Ở ĐẦU TRANG ===== */}
      <InvoiceQuotaMonitorSection />

      {/* ===== CÔNG TẮC TỔNG: KÍCH HOẠT MODULE HĐĐT ===== */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-card p-4 shadow-sm">
        <div>
          <Label
            htmlFor="inv-module-toggle"
            className="cursor-pointer text-sm font-semibold"
          >
            Kích hoạt Module Hóa đơn điện tử
          </Label>
          <p className={cn(TEXT_SUB, "mt-0.5")}>
            Bật để cấu hình pháp nhân, nhà cung cấp, chữ ký số và API Key theo
            gian hàng.
          </p>
        </div>
        <Switch
          id="inv-module-toggle"
          checked={isInvoiceModuleEnabled}
          onCheckedChange={setIsInvoiceModuleEnabled}
        />
      </div>

      <fieldset
        disabled={!isInvoiceModuleEnabled}
        className={cn(
          "min-w-0 transition-all duration-300",
          !isInvoiceModuleEnabled &&
            "pointer-events-none opacity-50 select-none",
        )}
      >
        {/* ===== GRID 12 CỘT — TRÁI 8 (form) / PHẢI 4 (sidebar) ===== */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* ================== CỘT TRÁI (8/12) ================== */}
          <div className="min-w-0 space-y-6 lg:col-span-8">
            {/* --- Segmented Control 2 tab --- */}
            {/* Segmented control BẬT TONE theo luồng: active trắng + viền/chữ
                màu accent (blue = Kê khai, emerald = Máy tính tiền) + badge
                tên luồng — nhìn phát biết ngay đang ở đâu. */}
            <div
              role="tablist"
              aria-label="Hình thức hóa đơn"
              className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1.5"
            >
              {TABS.map((t) => {
                const active = activeTab === t.value;
                const isStd = t.value === "standard";
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(t.value)}
                    className={cn(
                      "flex-1 rounded-lg px-4 py-2.5 text-left transition-all",
                      active
                        ? cn(
                            "bg-card font-bold shadow-md",
                            isStd
                              ? "border border-blue-500 text-blue-700"
                              : "border border-emerald-500 text-emerald-700",
                          )
                        : "border border-transparent text-slate-500 hover:text-slate-700",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      {t.label}
                      {active && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            isStd
                              ? "bg-blue-100 text-blue-700"
                              : "bg-emerald-100 text-emerald-700",
                          )}
                        >
                          {isStd ? "Kê khai" : "Máy tính tiền"}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "block text-[11px] font-normal",
                        active ? "text-muted-foreground" : "text-slate-400",
                      )}
                    >
                      {t.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* --- CARD CHÍNH: Pháp nhân + API theo tab. Viền accent mép trên
                đồng bộ màu với tab active — cả khu form thuộc luồng nào là rõ. --- */}
            <div
              className={cn(
                "rounded-2xl border border-slate-200 border-t-4 bg-card p-6 shadow-sm",
                activeTab === "standard"
                  ? "border-t-blue-600"
                  : "border-t-emerald-600",
              )}
            >
              {/* Section 1 — Pháp nhân & Thuế (dùng chung 2 tab) */}
              <div className="space-y-4">
                {/* Các dòng chỉ dẫn/tooltip gom hết về box "Hướng dẫn nhanh"
                    ở sidebar (yêu cầu 07/08) — section chỉ giữ tiêu đề. */}
                <SectionHeading
                  icon={<Building2 className="size-4" />}
                  tone="bg-blue-50 text-blue-600"
                  title={
                    activeTab === "standard"
                      ? "Thông tin Pháp nhân & Thuế"
                      : "Thông tin Hộ kinh doanh / Shop"
                  }
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="inv-taxcode">Mã số thuế (MST)</Label>
                    <Input
                      id="inv-taxcode"
                      placeholder="VD: 0101243150 hoặc 0101243150-001"
                      value={taxCode}
                      onChange={(e) => setTaxCode(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.taxCode)}
                      className={cn(
                        "font-mono",
                        INPUT_FOCUS,
                        fieldErrors.taxCode && "border-red-400",
                      )}
                    />
                    <FieldError msg={fieldErrors.taxCode} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="inv-company">
                      {activeTab === "standard"
                        ? "Tên pháp nhân"
                        : "Tên Hộ kinh doanh/Shop"}
                    </Label>
                    <Input
                      id="inv-company"
                      placeholder={
                        activeTab === "standard"
                          ? "VD: CÔNG TY TNHH ABC"
                          : "VD: HKD NGUYỄN VĂN A"
                      }
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className={INPUT_FOCUS}
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="inv-address">Địa chỉ (theo ĐKKD)</Label>
                  <Input
                    id="inv-address"
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                    className={INPUT_FOCUS}
                  />
                </div>
              </div>

              {/* Section 2 — API theo tab */}
              {activeTab === "standard" ? (
                <div className="mt-6 space-y-4 border-t border-slate-100 pt-6">
                  <SectionHeading
                    icon={<FileSignature className="size-4" />}
                    tone="bg-purple-50 text-purple-600"
                    title="Cấu hình API Nhà cung cấp"
                  />

                  {/* Vendor Selector đứng ĐẦU — quyết định Dynamic Form bên dưới. */}
                  <div className="grid gap-1.5">
                    <Label htmlFor="inv-provider">Nhà cung cấp Hóa đơn</Label>
                    <NativeSelect
                      id="inv-provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    >
                      {INVOICE_VENDORS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                          {v.soon ? " (Sắp ra mắt)" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {/* DYNAMIC FORM theo NCC — preset trường ở invoice-vendors.ts,
                      key map thẳng cột InvoiceConfig (mỗi NCC tối đa MỘT trường
                      secret, đổ vào secretKey). Thêm NCC = thêm preset, không
                      đụng component này. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {vendor.credentialFields.map((f) => (
                      <div
                        key={f.key}
                        className={cn(
                          "grid gap-1.5",
                          f.key === "customApiUrl" && "sm:col-span-2",
                        )}
                      >
                        <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
                        {f.readOnly ? (
                          <div className="relative">
                            <Input
                              id={`cred-${f.key}`}
                              value={HUBSELL_PARTNER_CODE}
                              readOnly
                              aria-readonly
                              tabIndex={-1}
                              className="cursor-not-allowed bg-slate-50 pr-9 font-mono text-slate-600"
                            />
                            <Lock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                          </div>
                        ) : f.secret ? (
                          <Input
                            id={`cred-${f.key}`}
                            type="password"
                            placeholder={secretPlaceholder(hasSecretKey, secretMasked)}
                            value={secretInput}
                            onChange={(e) => setSecretInput(e.target.value)}
                            className={INPUT_FOCUS}
                          />
                        ) : (
                          <Input
                            id={`cred-${f.key}`}
                            placeholder={f.placeholder}
                            value={f.key === "customApiUrl" ? customApiUrl : clientId}
                            onChange={(e) =>
                              f.key === "customApiUrl"
                                ? setCustomApiUrl(e.target.value)
                                : setClientId(e.target.value)
                            }
                            className={INPUT_FOCUS}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {vendor.soon && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                      {vendor.label} đang <b>Sắp ra mắt</b> — cấu hình được lưu
                      trước, hệ thống chưa phát hành hóa đơn thật qua NCC này.
                    </p>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-pattern">Mẫu số hóa đơn (Pattern)</Label>
                      <Input
                        id="inv-pattern"
                        placeholder="VD: 1 (HĐ GTGT)"
                        value={invoicePattern}
                        onChange={(e) => setInvoicePattern(e.target.value)}
                        aria-invalid={Boolean(fieldErrors.invoicePattern)}
                        className={cn(
                          "font-mono",
                          INPUT_FOCUS,
                          fieldErrors.invoicePattern && "border-red-400",
                        )}
                      />
                      <FieldError msg={fieldErrors.invoicePattern} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="inv-series">Ký hiệu hóa đơn (Serial)</Label>
                      <Input
                        id="inv-series"
                        placeholder="VD: C26TAA"
                        value={invoiceSeries}
                        onChange={(e) =>
                          setInvoiceSeries(e.target.value.toUpperCase())
                        }
                        aria-invalid={Boolean(fieldErrors.invoiceSeries)}
                        className={cn(
                          "font-mono",
                          INPUT_FOCUS,
                          fieldErrors.invoiceSeries && "border-red-400",
                        )}
                      />
                      <FieldError msg={fieldErrors.invoiceSeries} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 space-y-4 border-t border-slate-100 pt-6">
                  <SectionHeading
                    icon={<MonitorSmartphone className="size-4" />}
                    tone="bg-emerald-50 text-emerald-600"
                    title="Cấu hình API Nhà cung cấp — Máy tính tiền"
                  />

                  {/* Vendor Selector POS đứng ĐẦU — danh mục RIÊNG với kê khai. */}
                  <div className="grid gap-1.5">
                    <Label htmlFor="pos-provider">Nhà cung cấp Hóa đơn (POS)</Label>
                    <NativeSelect
                      id="pos-provider"
                      value={posProvider}
                      onChange={(e) => setPosProvider(e.target.value)}
                    >
                      {POS_VENDORS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                          {v.soon ? " (Sắp ra mắt)" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {/* DYNAMIC FORM theo NCC POS — preset ở invoice-vendors.ts,
                      key map cặp cột posClientId/posSecretKey. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {posVendor.credentialFields.map((f) => (
                      <div key={f.key} className="grid gap-1.5">
                        <Label htmlFor={`pos-cred-${f.key}`}>{f.label}</Label>
                        {f.secret ? (
                          <Input
                            id={`pos-cred-${f.key}`}
                            type="password"
                            placeholder={secretPlaceholder(
                              hasPosSecret,
                              posSecretMasked,
                            )}
                            value={posSecretInput}
                            onChange={(e) => setPosSecretInput(e.target.value)}
                            className={INPUT_FOCUS}
                          />
                        ) : (
                          <Input
                            id={`pos-cred-${f.key}`}
                            placeholder={f.placeholder}
                            value={posClientId}
                            onChange={(e) => setPosClientId(e.target.value)}
                            className={INPUT_FOCUS}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {posVendor.soon && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                      {posVendor.label} đang <b>Sắp ra mắt</b> — cấu hình được
                      lưu trước, hệ thống chưa phát hành hóa đơn thật qua NCC
                      này.
                    </p>
                  )}

                  {/* Dropdown gợi ý máy từ danh mục MISA (có sau khi Quick Test) */}
                  {posMachines.length > 0 && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="pos-machine-pick">
                        Chọn máy từ danh mục MISA ({posMachines.length} máy)
                      </Label>
                      <NativeSelect
                        id="pos-machine-pick"
                        value=""
                        onChange={(e) => {
                          const m = posMachines[Number(e.target.value)];
                          if (m) applyPosMachine(m);
                        }}
                      >
                        <option value="">— Chọn để tự điền 3 ô dưới —</option>
                        {posMachines.map((m, i) => (
                          <option key={i} value={i}>
                            {m.machineId ?? "(không mã)"}
                            {m.codePrefix ? ` · ${m.codePrefix}` : ""}
                            {m.serial ? ` · ${m.serial}` : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="pos-prefix">Dải mã CQT (Code Prefix)</Label>
                      <Input
                        id="pos-prefix"
                        placeholder="Dải mã CQT cấp cho máy tính tiền"
                        value={posCodePrefix}
                        onChange={(e) => setPosCodePrefix(e.target.value)}
                        className={cn("font-mono", INPUT_FOCUS)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="pos-machine">Mã máy tính tiền</Label>
                      <Input
                        id="pos-machine"
                        placeholder="VD: POS-01 hoặc MTT001"
                        value={posMachineId}
                        onChange={(e) => setPosMachineId(e.target.value)}
                        className={cn("font-mono", INPUT_FOCUS)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="pos-series">Ký hiệu hóa đơn máy tính tiền</Label>
                    <Input
                      id="pos-series"
                      placeholder="VD: C26MAA (ký tự thứ 4 bắt buộc là M)"
                      value={posSeries}
                      onChange={(e) => setPosSeries(e.target.value.toUpperCase())}
                      aria-invalid={Boolean(fieldErrors.posSeries)}
                      className={cn(
                        "font-mono",
                        INPUT_FOCUS,
                        fieldErrors.posSeries && "border-red-400",
                      )}
                    />
                    <FieldError msg={fieldErrors.posSeries} />
                  </div>
                </div>
              )}
            </div>

            {/* --- API KEY THEO GIAN HÀNG --- */}
            <div className="rounded-xl border border-slate-200/80 bg-card p-6 shadow-sm">
              <SectionHeading
                icon={<KeyRound className="size-4" />}
                tone="bg-amber-50 text-amber-600"
                title="API Key hóa đơn theo gian hàng"
                desc="Mỗi gian hàng một API Key riêng — phục vụ đối soát hoa hồng theo từng shop."
              />

              <div className="mt-4">
                {channelKeys.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Shop chưa có gian hàng nào để cấu hình.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {channelKeys.map((c) => {
                      const meta = CHANNEL_META[c.channelName];
                      const saving = savingKeyId === c.channelId;
                      return (
                        <div
                          key={c.channelId}
                          className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-200/80 p-3"
                        >
                          <span className="flex min-w-40 items-center gap-2">
                            <Store className="size-4 shrink-0 text-muted-foreground" />
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                            <span className="truncate text-sm font-medium">
                              {c.shopName}
                            </span>
                          </span>

                          <Input
                            type="password"
                            className={cn("min-w-40 flex-1", INPUT_FOCUS)}
                            aria-label={`API Key ${shopLabel(c.channelName, c.shopName)}`}
                            placeholder={
                              c.hasApiKey
                                ? `Đã lưu (${c.apiKeyMasked ?? "••••"}) — nhập để đổi`
                                : "Chưa cấu hình API Key"
                            }
                            value={keyInputs[c.channelId] ?? ""}
                            onChange={(e) =>
                              setKeyInputs((prev) => ({
                                ...prev,
                                [c.channelId]: e.target.value,
                              }))
                            }
                          />

                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              saving ||
                              readOnlyPreview ||
                              !(keyInputs[c.channelId] ?? "").trim()
                            }
                            title={
                              readOnlyPreview
                                ? "Module đang ở chế độ Beta — khóa lưu"
                                : undefined
                            }
                            onClick={() => handleSaveChannelKey(c.channelId)}
                          >
                            {saving ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Save className="size-4" />
                            )}
                            Lưu
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* --- THANH LƯU (một bản ghi cho cả 2 tab) --- */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleSaveConfig}
                disabled={savingConfig || readOnlyPreview}
                title={
                  readOnlyPreview
                    ? "Module đang ở chế độ Beta — khóa lưu để an toàn dữ liệu"
                    : undefined
                }
              >
                {savingConfig ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Lưu toàn bộ cấu hình
              </Button>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                {readOnlyPreview
                  ? "Beta — đã khóa lưu, chạy Sandbox."
                  : "Lưu cả 2 tab cùng lúc; khóa bí mật để trống = giữ nguyên."}
              </p>
            </div>
          </div>

          {/* ================== CỘT PHẢI (4/12) — SIDEBAR ================== */}
          <div className="min-w-0 space-y-6 lg:col-span-4">
            {/* --- Widget Trạng thái kết nối --- */}
            <div className="rounded-xl border border-slate-200/80 bg-card p-5 shadow-sm">
              <SectionHeading
                icon={<Radio className="size-4" />}
                tone="bg-sky-50 text-sky-600"
                title="Trạng thái kết nối"
                desc="Kết quả kiểm tra trong phiên làm việc này."
              />

              <div className="mt-4 space-y-3">
                {activeTab === "standard" ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-slate-700">
                        {vendor.label}
                      </span>
                      <span className="flex items-center gap-2">
                        <ConnBadge
                          state={connStatus.meinvoice}
                          hasKeys={hasMeinvoiceKeys}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            runConnectionTest("meinvoice", setTestingMeinvoice)
                          }
                          disabled={testingMeinvoice}
                        >
                          {testingMeinvoice ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <PlugZap className="size-3.5" />
                          )}
                          Test
                        </Button>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-slate-700">MISA eSign</span>
                      <span className="flex items-center gap-2">
                        <ConnBadge
                          state={connStatus.esign}
                          hasKeys={hasEsignKeys}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            runConnectionTest("esign", setTestingEsign)
                          }
                          disabled={testingEsign || !isEsignCloud}
                          title={
                            !isEsignCloud
                              ? "Chọn phương thức MISA eSign để kiểm tra"
                              : undefined
                          }
                        >
                          {testingEsign ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <PlugZap className="size-3.5" />
                          )}
                          Test
                        </Button>
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-slate-700">
                      {posVendor.label}
                    </span>
                    <span className="flex items-center gap-2">
                      <ConnBadge state={connStatus.pos} hasKeys={hasPosKeys} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTestPos}
                        disabled={testingPos || posVendor.soon}
                        title={
                          posVendor.soon
                            ? `${posVendor.label} sắp ra mắt — hiện mới test được MISA POS`
                            : undefined
                        }
                      >
                        {testingPos ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <PlugZap className="size-3.5" />
                        )}
                        Test
                      </Button>
                    </span>
                  </div>
                )}

                <div className="border-t border-slate-100 pt-3">
                  <Label htmlFor="inv-default-type" className="text-xs">
                    Luồng áp dụng khi xuất hóa đơn
                  </Label>
                  <NativeSelect
                    id="inv-default-type"
                    value={defaultInvoiceType}
                    onChange={(e) => setDefaultInvoiceType(e.target.value)}
                    className="mt-1.5"
                  >
                    <option value="STANDARD">Hóa đơn thông thường (Kê khai)</option>
                    <option value="POS">Hóa đơn từ Máy tính tiền</option>
                  </NativeSelect>
                </div>
              </div>
            </div>

            {/* --- Card Chữ ký số MISA eSign — CHỈ tab Kê khai --- */}
            {activeTab === "standard" && (
              <div className="rounded-xl border border-slate-200/80 bg-card p-5 shadow-sm">
                <SectionHeading
                  icon={<PenLine className="size-4" />}
                  tone="bg-violet-50 text-violet-600"
                  title="Chữ ký số MISA eSign"
                />

                <div className="mt-4 space-y-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="inv-method">Phương thức ký số</Label>
                    <NativeSelect
                      id="inv-method"
                      value={signMethod}
                      onChange={(e) => setSignMethod(e.target.value)}
                    >
                      {SIGN_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>

                  {isEsignCloud ? (
                    <>
                      <div className="grid gap-1.5">
                        <Label htmlFor="esign-client">eSign Client ID</Label>
                        <Input
                          id="esign-client"
                          placeholder="x-clientId do MISA cấp"
                          value={esignClientId}
                          onChange={(e) => setEsignClientId(e.target.value)}
                          className={INPUT_FOCUS}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="esign-secret">eSign Secret Key</Label>
                        <Input
                          id="esign-secret"
                          type="password"
                          placeholder={secretPlaceholder(
                            hasEsignSecret,
                            esignSecretMasked,
                          )}
                          value={esignSecretInput}
                          onChange={(e) => setEsignSecretInput(e.target.value)}
                          className={INPUT_FOCUS}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="esign-user">Tài khoản eSign</Label>
                        <Input
                          id="esign-user"
                          placeholder="Email/SĐT tài khoản MISA eSign"
                          value={esignUsername}
                          onChange={(e) => setEsignUsername(e.target.value)}
                          className={INPUT_FOCUS}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="esign-pass">Mật khẩu eSign</Label>
                        <Input
                          id="esign-pass"
                          type="password"
                          placeholder={secretPlaceholder(
                            hasEsignPassword,
                            esignPasswordMasked,
                          )}
                          value={esignPasswordInput}
                          onChange={(e) =>
                            setEsignPasswordInput(e.target.value)
                          }
                          className={INPUT_FOCUS}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="esign-serial">Serial chứng thư số</Label>
                        <Input
                          id="esign-serial"
                          placeholder="Để trống = dùng chứng thư đầu tiên"
                          value={certSerial}
                          onChange={(e) => setCertSerial(e.target.value)}
                          className={cn("font-mono", INPUT_FOCUS)}
                        />
                      </div>
                    </>
                  ) : (
                    <p className={TEXT_SUB}>
                      Đang chọn USB Token (ký thủ công). Chuyển sang{" "}
                      <b>MISA eSign</b> để ký nền tự động — không cần cắm USB
                      mỗi lần phát hành.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* --- Box Hướng dẫn nhanh --- */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-5">
              <SectionHeading
                icon={<CircleHelp className="size-4" />}
                tone="bg-teal-50 text-teal-600"
                title="Hướng dẫn nhanh"
              />
              <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-slate-600">
                <li>
                  <b>Thông tin pháp nhân/HKD:</b> NĐ 123/2020 — hóa đơn phải
                  mang MST, tên và địa chỉ người bán; dùng chung cho cả hai
                  luồng.
                </li>
                <li>
                  <b>Nhà cung cấp:</b> chọn NCC trước, bộ trường bên dưới tự
                  đổi theo chuẩn API của từng nhà.
                </li>
                <li>
                  <b>Luồng kê khai:</b> mẫu số + ký hiệu phải khớp đúng ký hiệu
                  đã đăng ký với CQT; mỗi hóa đơn phải ký số trước khi CQT cấp
                  mã (eSign ký nền tự động, không cần USB).
                </li>
                <li>
                  <b>Luồng máy tính tiền:</b> phát hành tức thì bằng dải mã CQT
                  cấp sẵn — không cần ký số từng đơn.
                </li>
                <li>
                  <b>Mã máy tính tiền:</b> mã đã được CQT chấp nhận — xem trên
                  Portal NCC Hóa đơn hoặc Tờ khai Mẫu 01/ĐKTĐ-HĐĐT.
                </li>
                <li>
                  <b>Dải mã CQT:</b> cấp sau khi đăng ký máy tính tiền thành
                  công — nút Test POS sẽ tự điền nếu MISA trả về danh mục.
                </li>
                <li>
                  <b>Ký hiệu hóa đơn:</b> kê khai dạng C26TAA; máy tính tiền
                  bắt buộc chữ thứ 4 là M (C26MAA).
                </li>
                <li>
                  <b>Test kết nối:</b> dùng khóa <b>đã lưu</b> — đổi khóa xong
                  nhớ bấm Lưu trước khi Test.
                </li>
                <li>
                  <a
                    href="https://www.meinvoice.vn/tro-giup/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
                  >
                    Trung tâm trợ giúp MISA meInvoice
                    <ExternalLink className="size-3" />
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </fieldset>

      {/* ===== MUA GÓI PHÔI HÓA ĐƠN — LUÔN MỞ ===== */}
      <InvoicePlanPurchaseSection />
    </div>
  );
}
