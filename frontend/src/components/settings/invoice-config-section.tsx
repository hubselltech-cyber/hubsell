"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  FileSignature,
  KeyRound,
  Loader2,
  Lock,
  MonitorSmartphone,
  PenLine,
  PlugZap,
  Save,
  ShieldCheck,
  Store,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/lib/api";
import {
  HUBSELL_PARTNER_CODE,
  INVOICE_FIELD_HINTS,
  INVOICE_PATTERN_RE,
  INVOICE_SERIES_RE,
  INVOICE_VENDORS,
  isCustomVendor,
  POS_SERIES_RE,
  SIGN_METHODS,
  TAX_CODE_RE,
} from "@/lib/invoice-vendors";
import { CHANNEL_META } from "@/lib/channel-meta";
import { shopLabel } from "@/components/channel-filter";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRANG HÓA ĐƠN ĐIỆN TỬ & CHỮ KÝ SỐ — 2 TAB theo 2 luồng phát hành của
 * NĐ 123/2020 (một bản ghi InvoiceConfig cấp shop chứa cả hai nhóm cấu hình):
 *
 *   TAB 1 — HĐĐT THÔNG THƯỜNG (kê khai/doanh nghiệp): Pháp nhân & Thuế +
 *           meInvoice API (mẫu số/ký hiệu TT 78) + Chữ ký số MISA eSign ký lẻ
 *           từng hóa đơn. Nút "Kiểm tra kết nối meInvoice" + "… eSign".
 *   TAB 2 — HĐ TỪ MÁY TÍNH TIỀN (HKD/bán lẻ, ký hiệu C26MXX): thông tin
 *           HKD/Shop + API MISA POS + dải mã CQT/mã máy. KHÔNG có cấu hình
 *           eSign — loại này miễn ký số từng đơn, phát hành tức thì bằng dải
 *           mã CQT cấp sẵn. Nút "Kiểm tra kết nối POS" riêng.
 *
 * Validate TT 78 chặn ngay trên UI (MST/mẫu số/ký hiệu — regex mirror backend
 * trong invoice-vendors.ts); khóa bí mật chỉ hiển thị dạng che, để trống khi
 * lưu = giữ nguyên. Nút Lưu dùng chung — lưu trọn bản ghi bất kể đang ở tab nào.
 */

type InvoiceTab = "standard" | "pos";

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

  // (3) Chữ ký số MISA eSign (chỉ tab kê khai)
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
  const [posClientId, setPosClientId] = useState("");
  const [posCodePrefix, setPosCodePrefix] = useState("");
  const [posMachineId, setPosMachineId] = useState("");
  const [posSeries, setPosSeries] = useState("");
  const [hasPosSecret, setHasPosSecret] = useState(false);
  const [posSecretMasked, setPosSecretMasked] = useState<string | null>(null);
  const [posSecretInput, setPosSecretInput] = useState("");
  const [defaultInvoiceType, setDefaultInvoiceType] = useState("STANDARD");

  // Lỗi định dạng inline theo trường (validate TT 78 ngay trên UI).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  const isCustom = isCustomVendor(provider);
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
    kind: "meinvoice" | "esign" | "pos",
    setBusy: (v: boolean) => void,
  ) {
    setBusy(true);
    try {
      const r =
        kind === "meinvoice"
          ? await testMeinvoiceConnection()
          : kind === "esign"
            ? await testEsignConnection()
            : await testPosConnection();
      toast.success(r.message ?? "Kết nối OK");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được — thử lại sau",
      );
    } finally {
      setBusy(false);
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

  /** Dòng lỗi định dạng inline dưới ô nhập. */
  function FieldError({ name }: { name: string }) {
    const msg = fieldErrors[name];
    if (!msg) return null;
    return <p className="text-xs text-red-500">{msg}</p>;
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

  return (
    <div className="space-y-6">
      {/* ===== BÁO CÁO & GIÁM SÁT PHÔI — LUÔN HIỂN THỊ Ở ĐẦU TRANG ===== */}
      <InvoiceQuotaMonitorSection />

      {/* ===== CÔNG TẮC TỔNG: KÍCH HOẠT MODULE HĐĐT ===== */}
      <div className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border bg-card p-4 shadow-sm">
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
          "min-w-0 space-y-6 transition-all duration-300",
          !isInvoiceModuleEnabled &&
            "pointer-events-none opacity-50 select-none",
        )}
      >
        {/* ===== TAB BAR: 2 LUỒNG PHÁT HÀNH ===== */}
        <div
          role="tablist"
          aria-label="Luồng phát hành hóa đơn"
          className="flex max-w-2xl gap-1 rounded-lg border bg-muted/40 p-1"
        >
          {TABS.map((t) => {
            const active = activeTab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(t.value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-left transition-colors",
                  active
                    ? "bg-card shadow-sm"
                    : "hover:bg-card/60 text-muted-foreground",
                )}
              >
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t.sub}
                </span>
              </button>
            );
          })}
        </div>

        {/* ================= TAB 1 — KÊ KHAI (DOANH NGHIỆP) ================= */}
        {activeTab === "standard" && (
          <div className="space-y-6">
            {/* --- Nhóm 1: Pháp nhân & Thuế --- */}
            <Card className="max-w-2xl shadow-sm">
              <CardHeader className="border-b pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Building2 className="size-5 text-slate-500" />
                  Thông tin Pháp nhân &amp; Thuế
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <p className={TEXT_SUB}>
                  Theo Nghị định 123/2020/NĐ-CP, hóa đơn điện tử bắt buộc mang{" "}
                  <b>MST, tên và địa chỉ người bán</b> đúng đăng ký kinh doanh —
                  thông tin dưới đây in lên mọi hóa đơn phát hành qua Hubsell
                  (dùng chung cho cả hai luồng).
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="inv-taxcode">Mã số thuế (MST)</Label>
                    <Input
                      id="inv-taxcode"
                      placeholder="VD: 0101243150 hoặc 0101243150-001"
                      value={taxCode}
                      onChange={(e) => setTaxCode(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.taxCode)}
                      className={cn(
                        "font-mono",
                        fieldErrors.taxCode && "border-red-400",
                      )}
                    />
                    <FieldError name="taxCode" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="inv-company">Tên pháp nhân</Label>
                    <Input
                      id="inv-company"
                      placeholder="VD: CÔNG TY TNHH ABC"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="inv-address">Địa chỉ trụ sở (theo ĐKKD)</Label>
                  <Input
                    id="inv-address"
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* --- Nhóm 2: meInvoice API --- */}
            <Card className="max-w-2xl shadow-sm">
              <CardHeader className="border-b pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <FileSignature className="size-5 text-slate-500" />
                  Cấu hình meInvoice API
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    Multi-Vendor
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <div className="grid gap-2">
                  <Label htmlFor="inv-provider">Nhà cung cấp hóa đơn</Label>
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

                {isCustom && (
                  <div className="grid gap-2">
                    <Label htmlFor="inv-custom-url">Endpoint API (Custom)</Label>
                    <Input
                      id="inv-custom-url"
                      placeholder="https://api.nhacungcap.vn/invoice"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                    />
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="inv-partner">Mã đại lý ISV (Partner Code)</Label>
                  <div className="relative">
                    <Input
                      id="inv-partner"
                      value={HUBSELL_PARTNER_CODE}
                      readOnly
                      aria-readonly
                      tabIndex={-1}
                      className="cursor-not-allowed bg-slate-50 pr-9 font-mono text-slate-600"
                    />
                    <Lock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  </div>
                  <p className={TEXT_SUB}>
                    Mã đại lý ISV của Hubsell — <b>cố định, không chỉnh sửa</b>.
                    Nhờ mã này mà hóa đơn phát hành qua hệ thống được nhà cung
                    cấp ghi nhận thuộc đại lý Hubsell.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="inv-client">Mã định danh (Client ID)</Label>
                    <Input
                      id="inv-client"
                      placeholder="Client ID do NCC cấp"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="inv-secret">Khóa bảo mật (Secret Key)</Label>
                    <Input
                      id="inv-secret"
                      type="password"
                      placeholder={secretPlaceholder(hasSecretKey, secretMasked)}
                      value={secretInput}
                      onChange={(e) => setSecretInput(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="inv-pattern">Mẫu số hóa đơn (Pattern)</Label>
                    <Input
                      id="inv-pattern"
                      placeholder="VD: 1 (HĐ GTGT)"
                      value={invoicePattern}
                      onChange={(e) => setInvoicePattern(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.invoicePattern)}
                      className={cn(
                        "font-mono",
                        fieldErrors.invoicePattern && "border-red-400",
                      )}
                    />
                    <FieldError name="invoicePattern" />
                  </div>
                  <div className="grid gap-2">
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
                        fieldErrors.invoiceSeries && "border-red-400",
                      )}
                    />
                    <FieldError name="invoiceSeries" />
                  </div>
                </div>
                <p className={TEXT_SUB}>
                  Mẫu số + ký hiệu theo Thông tư 78/2021/TT-BTC, phải khớp{" "}
                  <b>đúng ký hiệu đã đăng ký với Cơ quan Thuế</b> trên meInvoice
                  — sai/thiếu là nhà cung cấp từ chối cấp số hóa đơn.
                </p>

                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      runConnectionTest("meinvoice", setTestingMeinvoice)
                    }
                    disabled={testingMeinvoice}
                  >
                    {testingMeinvoice ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <PlugZap className="size-4" />
                    )}
                    Kiểm tra kết nối meInvoice
                  </Button>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5" />
                    Đăng nhập thử bằng khóa đã lưu — không phát sinh hóa đơn.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* --- Nhóm 3: Chữ ký số MISA eSign (chỉ luồng kê khai) --- */}
            <Card className="max-w-2xl shadow-sm">
              <CardHeader className="border-b pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <PenLine className="size-5 text-slate-500" />
                  Chữ ký số MISA eSign
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <div className="grid gap-2">
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
                  <p className={TEXT_SUB}>
                    Luồng kê khai phải <b>ký số từng hóa đơn</b> trước khi gửi
                    Cơ quan Thuế cấp mã. Chọn <b>MISA eSign</b> để ký nền tự
                    động — không cần cắm USB Token mỗi lần phát hành.
                  </p>
                </div>

                {isEsignCloud && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="esign-client">eSign Client ID</Label>
                        <Input
                          id="esign-client"
                          placeholder="x-clientId do MISA cấp"
                          value={esignClientId}
                          onChange={(e) => setEsignClientId(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
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
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="esign-user">Tài khoản eSign</Label>
                        <Input
                          id="esign-user"
                          placeholder="Email/SĐT tài khoản MISA eSign"
                          value={esignUsername}
                          onChange={(e) => setEsignUsername(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
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
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="esign-serial">
                        Serial chứng thư số (Cert Serial)
                      </Label>
                      <Input
                        id="esign-serial"
                        placeholder="Để trống = dùng chứng thư đầu tiên của tài khoản"
                        value={certSerial}
                        onChange={(e) => setCertSerial(e.target.value)}
                        className="font-mono"
                      />
                    </div>
                  </>
                )}

                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => runConnectionTest("esign", setTestingEsign)}
                    disabled={testingEsign || !isEsignCloud}
                    title={
                      !isEsignCloud
                        ? "Chọn phương thức MISA eSign để kiểm tra kết nối"
                        : undefined
                    }
                  >
                    {testingEsign ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <PlugZap className="size-4" />
                    )}
                    Kiểm tra kết nối eSign
                  </Button>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5" />
                    Đăng nhập thử eSign — chưa ký bất kỳ tài liệu nào.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ================= TAB 2 — MÁY TÍNH TIỀN (HKD/BÁN LẺ) ================= */}
        {activeTab === "pos" && (
          <div className="space-y-6">
            {/* --- Thông tin Hộ kinh doanh / Shop (dùng chung cột pháp nhân) --- */}
            <Card className="max-w-2xl shadow-sm">
              <CardHeader className="border-b pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Building2 className="size-5 text-slate-500" />
                  Thông tin Hộ kinh doanh / Shop
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <p className={TEXT_SUB}>
                  Hóa đơn máy tính tiền vẫn phải mang <b>MST và tên</b> của Hộ
                  kinh doanh/Shop (NĐ 123/2020). Thông tin này dùng chung với
                  tab Hóa đơn thông thường — sửa ở đâu cũng là một.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="pos-taxcode">Mã số thuế (MST)</Label>
                    <Input
                      id="pos-taxcode"
                      placeholder="VD: 0101243150"
                      value={taxCode}
                      onChange={(e) => setTaxCode(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.taxCode)}
                      className={cn(
                        "font-mono",
                        fieldErrors.taxCode && "border-red-400",
                      )}
                    />
                    <FieldError name="taxCode" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pos-company">Tên Hộ kinh doanh/Shop</Label>
                    <Input
                      id="pos-company"
                      placeholder="VD: HKD NGUYỄN VĂN A"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pos-address">Địa chỉ kinh doanh</Label>
                  <Input
                    id="pos-address"
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* --- API MISA POS + dải mã CQT (KHÔNG có eSign — miễn ký lẻ) --- */}
            <Card className="max-w-2xl shadow-sm">
              <CardHeader className="border-b pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <MonitorSmartphone className="size-5 text-slate-500" />
                  Cấu hình MISA POS — Máy tính tiền
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                    Không cần ký số từng đơn
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <p className={TEXT_SUB}>
                  Hóa đơn khởi tạo từ máy tính tiền dùng <b>dải mã do Cơ quan
                  Thuế cấp sẵn</b> cho máy đã đăng ký — phát hành <b>tức thì</b>{" "}
                  tại quầy, không có vòng ký số/chờ cấp mã theo từng hóa đơn như
                  luồng kê khai.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="pos-client">POS Client ID</Label>
                    <Input
                      id="pos-client"
                      placeholder="Client ID luồng POS do MISA cấp"
                      value={posClientId}
                      onChange={(e) => setPosClientId(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pos-secret">POS Secret Key</Label>
                    <Input
                      id="pos-secret"
                      type="password"
                      placeholder={secretPlaceholder(
                        hasPosSecret,
                        posSecretMasked,
                      )}
                      value={posSecretInput}
                      onChange={(e) => setPosSecretInput(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="pos-prefix">Dải mã CQT (Code Prefix)</Label>
                    <Input
                      id="pos-prefix"
                      placeholder="Dải mã CQT cấp cho máy tính tiền"
                      value={posCodePrefix}
                      onChange={(e) => setPosCodePrefix(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pos-machine">Mã máy tính tiền</Label>
                    <Input
                      id="pos-machine"
                      placeholder="Mã máy đã đăng ký với CQT"
                      value={posMachineId}
                      onChange={(e) => setPosMachineId(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="pos-series">
                    Ký hiệu hóa đơn máy tính tiền
                  </Label>
                  <Input
                    id="pos-series"
                    placeholder="VD: C26MAA (ký tự thứ 4 bắt buộc là M)"
                    value={posSeries}
                    onChange={(e) => setPosSeries(e.target.value.toUpperCase())}
                    aria-invalid={Boolean(fieldErrors.posSeries)}
                    className={cn(
                      "font-mono",
                      fieldErrors.posSeries && "border-red-400",
                    )}
                  />
                  <FieldError name="posSeries" />
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => runConnectionTest("pos", setTestingPos)}
                    disabled={testingPos}
                  >
                    {testingPos ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <PlugZap className="size-4" />
                    )}
                    Kiểm tra kết nối POS
                  </Button>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5" />
                    Đăng nhập thử bằng khóa POS — không phát sinh hóa đơn.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===== LUỒNG MẶC ĐỊNH + NÚT LƯU CHUNG (một bản ghi cho cả 2 tab) ===== */}
        <div className="flex max-w-2xl flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="inv-default-type">Luồng phát hành mặc định</Label>
            <NativeSelect
              id="inv-default-type"
              value={defaultInvoiceType}
              onChange={(e) => setDefaultInvoiceType(e.target.value)}
              className="w-64"
            >
              <option value="STANDARD">Hóa đơn thông thường (Kê khai)</option>
              <option value="POS">Hóa đơn từ Máy tính tiền</option>
            </NativeSelect>
          </div>
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
          <p className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            {readOnlyPreview
              ? "Beta — đã khóa lưu, chạy Sandbox."
              : "Lưu cả 2 tab cùng lúc; khóa bí mật để trống = giữ nguyên."}
          </p>
        </div>

        {/* ===== API KEY THEO GIAN HÀNG ===== */}
        <Card className="max-w-2xl shadow-sm">
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-slate-500" />
              API Key hóa đơn theo gian hàng
            </CardTitle>
          </CardHeader>

          <CardContent className="pt-5">
            <p className={cn(TEXT_SUB, "mb-4")}>
              Mỗi gian hàng dùng một API Key riêng để phát hành hóa đơn — phục
              vụ đối soát hoa hồng theo từng shop.
            </p>

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
                      className="flex flex-wrap items-center gap-2.5 rounded-lg border p-3"
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
                        className="min-w-40 flex-1"
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
          </CardContent>
        </Card>
      </fieldset>

      {/* ===== MUA GÓI PHÔI HÓA ĐƠN — LUÔN MỞ ===== */}
      <InvoicePlanPurchaseSection />
    </div>
  );
}
