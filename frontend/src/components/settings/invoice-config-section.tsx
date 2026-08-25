"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Building2,
  CircleHelp,
  DownloadCloud,
  ExternalLink,
  FileSignature,
  Loader2,
  Lock,
  Percent,
  PlugZap,
  Radio,
  Save,
  ShieldCheck,
} from "lucide-react";

import { HintIcon } from "@/components/finance/hint-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  fetchInvoiceConfig,
  fetchInvoiceTemplates,
  saveInvoiceConfig,
  testMeinvoiceConnection,
  type InvoiceTemplateDTO,
} from "@/lib/api";
import {
  HUBSELL_PARTNER_CODE,
  INVOICE_FIELD_HINTS,
  INVOICE_SERIES_RE,
  INVOICE_VENDORS,
  TAX_CODE_RE,
  vendorMeta,
} from "@/lib/invoice-vendors";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * KẾT NỐI & XUẤT HÓA ĐƠN — bản TINH GỌN 23/08/2026 (anh Trung chốt sau khảo
 * sát pháp lý NĐ 254/2026 + đối thủ BigSeller/Salework): seller sàn chỉ cần
 * LUỒNG KÊ KHAI, mục tiêu "3 phút xong":
 *
 *   ① Pháp nhân (MST + tên + địa chỉ — luật bắt buộc trên hóa đơn)
 *   ② Tài khoản meInvoice CỦA SHOP (chưa có → link đăng ký affiliate)
 *   ③ Ký hiệu hóa đơn — bấm "Tải ký hiệu" kéo từ meInvoice về CHỌN, không
 *      bắt gõ tay chuỗi TT78; mẫu số tự suy từ ký tự đầu ký hiệu.
 *
 * NHỮNG GÌ ĐÃ GỠ (23/08 — đừng thêm lại khi chưa đổi định hướng):
 *   · Giám sát phôi + mua gói phôi (mock nghiệp vụ ĐẠI LÝ — Hubsell chỉ làm
 *     affiliate, phí hóa đơn khách trả thẳng MISA).
 *   · API Key theo gian hàng (đối soát hoa hồng ISV — cùng lý do).
 *   · Tab Máy tính tiền (POS chưa nối API; seller sàn = kê khai; code POS
 *     backend + cột DB giữ nguyên, chỉ ẩn UI — mở lại ở giai đoạn 2).
 *   · Khối eSign + chọn phương thức ký (SignType 2 HSM meInvoice ký nền
 *     server-side, không cần eSign; USB chưa hỗ trợ) — signMethod luôn lưu
 *     ESIGN_CLOUD.
 *   · Toggle "Kích hoạt module" (không persist, chỉ gây lạc).
 *
 * Vẫn giữ: validate TT 78 inline (mirror backend), secret dạng che (để trống
 * khi lưu = giữ nguyên), test kết nối dùng khóa ĐÃ LƯU.
 */

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

  // (1) Pháp nhân & Thuế (một chủ shop = một MST).
  const [taxCode, setTaxCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");

  // (2) meInvoice API (kê khai)
  const [provider, setProvider] = useState("MISA");
  const [clientId, setClientId] = useState("");
  const [customApiUrl, setCustomApiUrl] = useState("");
  const [invoiceSeries, setInvoiceSeries] = useState("");
  /** Danh sách ký hiệu kéo từ meInvoice — có là ô ký hiệu thành dropdown. */
  const [templates, setTemplates] = useState<InvoiceTemplateDTO[]>([]);
  /** % thuế suất GTGT mặc định — áp cho dòng hàng chưa khai riêng ở SKU kho. */
  const [defaultVatRate, setDefaultVatRate] = useState(0);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [hasSecretKey, setHasSecretKey] = useState(false);
  const [secretMasked, setSecretMasked] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState("");
  // Tài khoản meInvoice CỦA SHOP (multi-tenant 23/08) — mật khẩu theo luồng
  // che/giữ-nguyên-khi-trống như mọi secret khác.
  const [meinvoiceUsername, setMeinvoiceUsername] = useState("");
  const [hasMeinvoicePassword, setHasMeinvoicePassword] = useState(false);
  const [meinvoicePasswordMasked, setMeinvoicePasswordMasked] = useState<string | null>(null);
  const [meinvoicePasswordInput, setMeinvoicePasswordInput] = useState("");

  // (3) Bộ khóa eSign — UI ĐÃ ẨN (HSM không cần eSign), state chỉ để round-trip
  // giá trị cũ khi lưu, không mất dữ liệu shop nào đã lỡ nhập.
  const [esignClientId, setEsignClientId] = useState("");
  const [esignUsername, setEsignUsername] = useState("");
  const [certSerial, setCertSerial] = useState("");
  const [, setHasEsignSecret] = useState(false);
  const [, setEsignSecretMasked] = useState<string | null>(null);
  const [esignSecretInput, setEsignSecretInput] = useState("");
  const [, setHasEsignPassword] = useState(false);
  const [, setEsignPasswordMasked] = useState<string | null>(null);
  const [esignPasswordInput, setEsignPasswordInput] = useState("");

  // (4) Máy tính tiền (POS) — UI ĐÃ ẨN (GĐ2), state chỉ round-trip giá trị cũ.
  const [posProvider, setPosProvider] = useState("MISA");
  const [posClientId, setPosClientId] = useState("");
  const [posCodePrefix, setPosCodePrefix] = useState("");
  const [posMachineId, setPosMachineId] = useState("");
  const [posSeries, setPosSeries] = useState("");
  const [, setHasPosSecret] = useState(false);
  const [, setPosSecretMasked] = useState<string | null>(null);
  const [posSecretInput, setPosSecretInput] = useState("");

  // Lỗi định dạng inline theo trường (validate TT 78 ngay trên UI).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Trạng thái kết nối meInvoice trong phiên (widget sidebar).
  const [connStatus, setConnStatus] = useState<ConnState>("idle");

  const [savingConfig, setSavingConfig] = useState(false);
  const [testingMeinvoice, setTestingMeinvoice] = useState(false);

  useEffect(() => {
    fetchInvoiceConfig()
      .then((r) => {
        setTaxCode(r.config.taxCode);
        setCompanyName(r.config.companyName);
        setCompanyAddress(r.config.companyAddress);
        setProvider(r.config.provider);
        setClientId(r.config.clientId);
        setCustomApiUrl(r.config.customApiUrl);
        setInvoiceSeries(r.config.invoiceSeries);
        setDefaultVatRate(r.config.defaultVatRate ?? 0);
        setHasSecretKey(r.config.hasSecretKey);
        setSecretMasked(r.config.secretKeyMasked);
        setMeinvoiceUsername(r.config.meinvoiceUsername);
        setHasMeinvoicePassword(r.config.hasMeinvoicePassword);
        setMeinvoicePasswordMasked(r.config.meinvoicePasswordMasked);
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

  /** Validate TT 78 các trường ĐÃ nhập — trả map lỗi (rỗng = hợp lệ). */
  function validateFields(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (taxCode.trim() && !TAX_CODE_RE.test(taxCode.trim())) {
      errors.taxCode = INVOICE_FIELD_HINTS.taxCode;
    }
    const series = invoiceSeries.trim().toUpperCase();
    if (series && !INVOICE_SERIES_RE.test(series)) {
      errors.invoiceSeries = INVOICE_FIELD_HINTS.invoiceSeries;
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
        // HSM ký nền server-side — phương thức duy nhất đang hỗ trợ (USB chưa
        // nối, selector đã gỡ khỏi UI 23/08).
        signMethod: "ESIGN_CLOUD",
        // Luôn gửi mã ISV cố định của Hubsell — không lấy từ input (read-only).
        partnerCode: HUBSELL_PARTNER_CODE,
        clientId: clientId.trim(),
        secretKey: secretInput.trim() || undefined,
        meinvoiceUsername: meinvoiceUsername.trim(),
        meinvoicePassword: meinvoicePasswordInput.trim() || undefined,
        customApiUrl: customApiUrl.trim(),
        // Mẫu số = ký tự đầu của ký hiệu (TT 78) — tự suy, không bắt seller nhập.
        invoicePattern: invoiceSeries.trim().charAt(0),
        invoiceSeries: invoiceSeries.trim().toUpperCase(),
        defaultVatRate,
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
        // Tab POS đã ẩn — luồng xuất luôn là Kê khai cho tới khi mở lại GĐ2.
        defaultInvoiceType: "STANDARD",
      });
      setInvoiceSeries(r.config.invoiceSeries);
      setPosSeries(r.config.posSeries);
      setHasSecretKey(r.config.hasSecretKey);
      setSecretMasked(r.config.secretKeyMasked);
      setSecretInput("");
      setHasMeinvoicePassword(r.config.hasMeinvoicePassword);
      setMeinvoicePasswordMasked(r.config.meinvoicePasswordMasked);
      setMeinvoicePasswordInput("");
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

  /** Kéo danh sách ký hiệu từ meInvoice (dùng tài khoản ĐÃ LƯU của shop). */
  async function loadTemplates(silent = false) {
    setLoadingTemplates(true);
    try {
      const r = await fetchInvoiceTemplates();
      setTemplates(r.templates);
      if (!silent) {
        toast.success(
          r.templates.length > 0
            ? `Đã tải ${r.templates.length} ký hiệu từ ${vendor.serviceName} — chọn ở ô Ký hiệu hóa đơn.`
            : `${vendor.serviceName} chưa có ký hiệu nào — đăng ký mẫu hóa đơn với CQT trên ${vendor.serviceName} trước.`,
        );
      }
    } catch (err) {
      if (!silent) {
        toast.error(
          err instanceof ApiError
            ? err.message
            : `Không tải được ký hiệu — kiểm tra tài khoản ${vendor.serviceName} rồi thử lại`,
        );
      }
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function handleTestMeinvoice() {
    setTestingMeinvoice(true);
    try {
      const r = await testMeinvoiceConnection();
      setConnStatus("ok");
      toast.success(r.message ?? "Kết nối OK");
      // Kết nối sống → tiện tay kéo luôn ký hiệu cho seller chọn.
      void loadTemplates(true);
    } catch (err) {
      setConnStatus("fail");
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được — thử lại sau",
      );
    } finally {
      setTestingMeinvoice(false);
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

  const hasMeinvoiceKeys = Boolean(meinvoiceUsername.trim() || hasMeinvoicePassword);

  return (
    <div className="space-y-6">
        {/* ===== GRID 12 CỘT — TRÁI 8 (form) / PHẢI 4 (sidebar) ===== */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* ================== CỘT TRÁI (8/12) ================== */}
          <div className="min-w-0 space-y-6 lg:col-span-8">
            {/* --- CARD CHÍNH: 3 bước — Pháp nhân → Tài khoản meInvoice → Ký hiệu --- */}
            <div className="rounded-2xl border border-slate-200 border-t-4 border-t-blue-600 bg-card p-6 shadow-sm">
              {/* Section 1 — Pháp nhân & Thuế (dùng chung 2 tab) */}
              <div className="space-y-4">
                {/* Các dòng chỉ dẫn/tooltip gom hết về box "Hướng dẫn nhanh"
                    ở sidebar (yêu cầu 07/08) — section chỉ giữ tiêu đề. */}
                <SectionHeading
                  icon={<Building2 className="size-4" />}
                  tone="bg-blue-50 text-blue-600"
                  title="1 · Thông tin Pháp nhân / Hộ kinh doanh"
                  desc="In trên mọi hóa đơn — điền đúng theo đăng ký kinh doanh."
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
                    <Label htmlFor="inv-company">Tên pháp nhân / Hộ kinh doanh</Label>
                    <Input
                      id="inv-company"
                      placeholder="VD: CÔNG TY TNHH ABC hoặc HKD NGUYỄN VĂN A"
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

              {/* Section 2 — Nhà cung cấp + tài khoản meInvoice của shop */}
              {(
                <div className="mt-6 space-y-4 border-t border-slate-100 pt-6">
                  <SectionHeading
                    icon={<FileSignature className="size-4" />}
                    tone="bg-purple-50 text-purple-600"
                    title="2 · Tài khoản Hóa đơn điện tử"
                    desc="Hóa đơn phát hành từ tài khoản của chính shop."
                  />

                  {/* Vendor Selector — 25/08 hiện CẢ NCC "Sắp ra mắt" (anh Trung:
                      khung phải sẵn sàng cho mọi bên, chọn bên nào giao diện
                      nhảy theo bên đó); chỉ Custom còn ẩn cho form gọn. */}
                  <div className="grid gap-1.5">
                    <Label htmlFor="inv-provider">Nhà cung cấp Hóa đơn</Label>
                    <NativeSelect
                      id="inv-provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    >
                      {INVOICE_VENDORS.filter((v) => !v.custom).map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.soon ? `${v.label} (Sắp ra mắt)` : v.label}
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
                          // Hai secret khác cột: mật khẩu meInvoice của shop
                          // và Client Secret của NCC — mỗi ô một luồng che riêng.
                          f.key === "meinvoicePassword" ? (
                            <Input
                              id={`cred-${f.key}`}
                              type="password"
                              placeholder={secretPlaceholder(
                                hasMeinvoicePassword,
                                meinvoicePasswordMasked,
                              )}
                              value={meinvoicePasswordInput}
                              onChange={(e) => setMeinvoicePasswordInput(e.target.value)}
                              className={INPUT_FOCUS}
                            />
                          ) : (
                            <Input
                              id={`cred-${f.key}`}
                              type="password"
                              placeholder={secretPlaceholder(hasSecretKey, secretMasked)}
                              value={secretInput}
                              onChange={(e) => setSecretInput(e.target.value)}
                              className={INPUT_FOCUS}
                            />
                          )
                        ) : (
                          <Input
                            id={`cred-${f.key}`}
                            placeholder={f.placeholder}
                            value={
                              f.key === "customApiUrl"
                                ? customApiUrl
                                : f.key === "meinvoiceUsername"
                                  ? meinvoiceUsername
                                  : clientId
                            }
                            onChange={(e) =>
                              f.key === "customApiUrl"
                                ? setCustomApiUrl(e.target.value)
                                : f.key === "meinvoiceUsername"
                                  ? setMeinvoiceUsername(e.target.value)
                                  : setClientId(e.target.value)
                            }
                            className={INPUT_FOCUS}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {vendor.signupUrl && (
                    <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
                      Hóa đơn phát hành trực tiếp từ{" "}
                      <b>tài khoản {vendor.serviceName} của shop</b> — dữ liệu
                      hóa đơn và nghĩa vụ thuế thuộc quan hệ giữa shop với{" "}
                      {vendor.companyName}, Hubsell chỉ là cầu nối kỹ thuật.
                      Chưa có tài khoản?{" "}
                      <a
                        href={vendor.signupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold underline underline-offset-2"
                      >
                        Đăng ký {vendor.serviceName}
                      </a>{" "}
                      rồi quay lại nhập tài khoản tại đây.
                    </p>
                  )}

                  {vendor.soon && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                      {vendor.label} đang <b>Sắp ra mắt</b> — cấu hình được lưu
                      trước, hệ thống chưa phát hành hóa đơn thật qua NCC này.
                    </p>
                  )}

                  {/* Bước 3 — KÝ HIỆU: ưu tiên CHỌN từ danh sách kéo về từ
                      meInvoice (đúng ký hiệu đã đăng ký CQT, seller không phải
                      thuộc chuỗi TT78); chưa tải được thì vẫn nhập tay. Mẫu số
                      tự suy từ ký tự đầu — không còn ô riêng. */}
                  <div className="grid gap-1.5">
                    <Label htmlFor="inv-series">Ký hiệu hóa đơn</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      {templates.length > 0 ? (
                        <NativeSelect
                          id="inv-series"
                          className="min-w-56 flex-1"
                          value={invoiceSeries}
                          onChange={(e) =>
                            setInvoiceSeries(e.target.value.toUpperCase())
                          }
                        >
                          <option value="">— Chọn ký hiệu đã đăng ký CQT —</option>
                          {templates.map((t) => (
                            <option key={t.invSeries} value={t.invSeries}>
                              {t.invSeries} · {t.templateName}
                            </option>
                          ))}
                          {invoiceSeries !== "" &&
                            !templates.some((t) => t.invSeries === invoiceSeries) && (
                              <option value={invoiceSeries}>
                                {invoiceSeries} (đang lưu)
                              </option>
                            )}
                        </NativeSelect>
                      ) : (
                        <Input
                          id="inv-series"
                          placeholder={
                            vendor.canFetchTemplates
                              ? "Bấm Tải ký hiệu — hoặc nhập tay, VD 1C26TAA"
                              : "Nhập ký hiệu đã đăng ký CQT, VD 1C26TAA"
                          }
                          value={invoiceSeries}
                          onChange={(e) =>
                            setInvoiceSeries(e.target.value.toUpperCase())
                          }
                          aria-invalid={Boolean(fieldErrors.invoiceSeries)}
                          className={cn(
                            "min-w-56 flex-1 font-mono",
                            INPUT_FOCUS,
                            fieldErrors.invoiceSeries && "border-red-400",
                          )}
                        />
                      )}
                      {/* Nút Tải ký hiệu chỉ hiện với NCC có API kéo ký hiệu —
                          NCC khác nhập tay cho tới khi nối API. */}
                      {vendor.canFetchTemplates && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void loadTemplates()}
                          disabled={loadingTemplates}
                        >
                          {loadingTemplates ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <DownloadCloud className="size-4" />
                          )}
                          Tải ký hiệu
                        </Button>
                      )}
                    </div>
                    <FieldError msg={fieldErrors.invoiceSeries} />
                    <p className={TEXT_SUB}>
                      {vendor.canFetchTemplates ? (
                        <>
                          Lưu tài khoản {vendor.serviceName} rồi bấm &quot;Tải ký
                          hiệu&quot; để chọn đúng ký hiệu đã đăng ký với Cơ quan
                          Thuế.
                        </>
                      ) : (
                        <>
                          Nhập đúng ký hiệu đã đăng ký với Cơ quan Thuế trên{" "}
                          {vendor.serviceName}.
                        </>
                      )}
                    </p>
                  </div>

                  {/* Thuế suất GTGT mặc định — HIỆN LẠI 24/08 (anh Trung đảo
                      quyết định ẩn cùng ngày): sàn không trả thuế suất qua
                      API nên seller là DN không liên kết SKU kho sẽ không còn
                      chỗ nào khai 8-10% → mọi hóa đơn ra 0% là sai pháp lý
                      với DN khấu trừ. Dòng hàng chưa khai riêng ở SKU kho lên
                      hóa đơn với mức này. */}
                  {/* Khối NỔI BẬT riêng (anh yêu cầu 24/08 tối) — box emerald
                      tách khỏi các ô thường, chú thích dài chuyển vào tooltip. */}
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                    <span className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600">
                      <Percent className="size-4" />
                    </span>
                    <div className="grid gap-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <Label htmlFor="inv-default-vat">
                          Thuế suất GTGT mặc định
                        </Label>
                        <HintIcon
                          hint={
                            <>
                              Giá bán trên sàn <b>đã gồm thuế</b> — hệ thống tự
                              tách VAT ra, tổng hóa đơn luôn đúng số khách trả.
                              Hộ/cá nhân kinh doanh giữ 0%; doanh nghiệp chọn
                              đúng thuế suất hàng mình bán.
                            </>
                          }
                        />
                      </span>
                      <NativeSelect
                        id="inv-default-vat"
                        className="max-w-64"
                        value={String(defaultVatRate)}
                        onChange={(e) => setDefaultVatRate(Number(e.target.value))}
                      >
                        <option value="0">0% — hộ/cá nhân kinh doanh</option>
                        <option value="5">5% — doanh nghiệp (hàng thiết yếu)</option>
                        <option value="8">8% — doanh nghiệp (mức được giảm)</option>
                        <option value="10">10% — doanh nghiệp (mức phổ thông)</option>
                      </NativeSelect>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* --- THANH LƯU --- */}
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
                Lưu cấu hình
              </Button>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                {readOnlyPreview
                  ? "Beta — đã khóa lưu, chạy Sandbox."
                  : "Mật khẩu để trống khi lưu = giữ nguyên khóa cũ."}
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

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-slate-700">
                    {vendor.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <ConnBadge state={connStatus} hasKeys={hasMeinvoiceKeys} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleTestMeinvoice()}
                      disabled={testingMeinvoice || vendor.soon}
                      title={
                        vendor.soon
                          ? `${vendor.label} sắp ra mắt — chưa test được kết nối`
                          : undefined
                      }
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
                <p className={cn(TEXT_SUB, "mt-3 border-t border-slate-100 pt-3")}>
                  {vendor.signNote}
                </p>
              </div>
            </div>

            {/* --- Box Hướng dẫn nhanh --- */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-5">
              <SectionHeading
                icon={<CircleHelp className="size-4" />}
                tone="bg-teal-50 text-teal-600"
                title="Hướng dẫn nhanh"
              />
              {/* Nội dung nhảy theo NCC đang chọn — thuật ngữ/link đọc từ
                  registry invoice-vendors.ts, không hardcode tên NCC nào. */}
              <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-slate-600">
                <li>
                  <b>3 bước là xong:</b> điền pháp nhân → nhập tài khoản{" "}
                  {vendor.serviceName} → Lưu
                  {vendor.canFetchTemplates
                    ? ", rồi bấm Tải ký hiệu để chọn ký hiệu hóa đơn."
                    : ", rồi nhập ký hiệu hóa đơn đã đăng ký CQT."}
                </li>
                {vendor.signupUrl && (
                  <li>
                    <b>Chưa có tài khoản {vendor.serviceName}?</b> Bấm link Đăng
                    ký ngay trong form — phí hóa đơn trả trực tiếp cho{" "}
                    {vendor.companyName}, Hubsell không thu thêm.
                  </li>
                )}
                <li>
                  <b>Test kết nối</b> dùng thông tin <b>đã lưu</b> — đổi tài
                  khoản xong nhớ bấm Lưu trước khi Test.
                </li>
                <li>
                  Cấu hình xong, sang tab <b>Xuất hóa đơn</b>{" "}để phát hành;
                  tra cứu &amp; tải PDF tại trang <b>Lịch sử &amp; Báo cáo thuế</b>.
                </li>
                {vendor.helpUrl && (
                  <li>
                    <a
                      href={vendor.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
                    >
                      Trung tâm trợ giúp {vendor.label}
                      <ExternalLink className="size-3" />
                    </a>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
    </div>
  );
}
