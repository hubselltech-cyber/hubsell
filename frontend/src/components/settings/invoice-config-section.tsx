"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FileSignature,
  KeyRound,
  Loader2,
  Lock,
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
import {
  ApiError,
  fetchInvoiceConfig,
  saveInvoiceChannelKey,
  saveInvoiceConfig,
  type InvoiceChannelKeyDTO,
} from "@/lib/api";
import {
  HUBSELL_PARTNER_CODE,
  INVOICE_VENDORS,
  isCustomVendor,
  SIGN_METHODS,
} from "@/lib/invoice-vendors";
import { CHANNEL_META } from "@/lib/channel-meta";
import { shopLabel } from "@/components/channel-filter";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CẤU HÌNH HÓA ĐƠN ĐIỆN TỬ & CHỮ KÝ SỐ (Multi-Vendor Adapter) — đóng gói độc lập.
 *
 * Hai khối: (1) cấu hình chung cấp shop (NCC, phương thức ký, partnerCode, đăng
 * nhập); (2) api_key RIÊNG cho từng gian hàng. Khóa bí mật chỉ hiển thị dạng che;
 * để trống khi lưu = giữ nguyên khóa cũ.
 */
export function InvoiceConfigSection({
  /** Chế độ Beta/xem trước: khóa các nút Lưu để không ghi cấu hình khi module tắt. */
  readOnlyPreview = false,
}: {
  readOnlyPreview?: boolean;
}) {
  const [loading, setLoading] = useState(true);

  // Cấu hình cấp shop
  const [provider, setProvider] = useState("MISA");
  const [signMethod, setSignMethod] = useState("usb");
  // Partner Code KHÔNG cho sửa — luôn là mã ISV cố định của Hubsell (xem bên dưới).
  const [clientId, setClientId] = useState("");
  const [customApiUrl, setCustomApiUrl] = useState("");
  const [hasSecretKey, setHasSecretKey] = useState(false);
  const [secretMasked, setSecretMasked] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState(""); // ô nhập khóa mới (luôn rỗng lúc đầu)
  const [savingConfig, setSavingConfig] = useState(false);

  // api_key theo gian hàng
  const [channelKeys, setChannelKeys] = useState<InvoiceChannelKeyDTO[]>([]);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoiceConfig()
      .then((r) => {
        setProvider(r.config.provider);
        setSignMethod(r.config.signMethod);
        setClientId(r.config.clientId);
        setCustomApiUrl(r.config.customApiUrl);
        setHasSecretKey(r.config.hasSecretKey);
        setSecretMasked(r.config.secretKeyMasked);
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

  function handleTestConnection() {
    toast.info("Tính năng ký số đang cấu hình ở chế độ Sandbox/Giữ chỗ");
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    try {
      const r = await saveInvoiceConfig({
        provider,
        signMethod,
        // Luôn gửi mã ISV cố định của Hubsell — không lấy từ input (read-only).
        partnerCode: HUBSELL_PARTNER_CODE,
        clientId: clientId.trim(),
        secretKey: secretInput.trim() || undefined,
        customApiUrl: customApiUrl.trim(),
      });
      setHasSecretKey(r.config.hasSecretKey);
      setSecretMasked(r.config.secretKeyMasked);
      setSecretInput("");
      toast.success("Đã lưu cấu hình nhà cung cấp hóa đơn");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cấu hình");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSaveChannelKey(channelId: string) {
    setSavingKeyId(channelId);
    try {
      const r = await saveInvoiceChannelKey(
        channelId,
        (keyInputs[channelId] ?? "").trim()
      );
      setChannelKeys((prev) =>
        prev.map((c) =>
          c.channelId === channelId
            ? { ...c, hasApiKey: r.hasApiKey, apiKeyMasked: r.apiKeyMasked }
            : c
        )
      );
      setKeyInputs((prev) => ({ ...prev, [channelId]: "" }));
      toast.success("Đã lưu API Key cho gian hàng");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được API Key");
    } finally {
      setSavingKeyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Đang tải cấu hình…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ===== KHỐI 1: NHÀ CUNG CẤP & CHỮ KÝ SỐ (cấp shop) ===== */}
      <Card className="max-w-2xl shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <FileSignature className="size-5 text-slate-500" />
            Cấu hình Hóa đơn &amp; Chữ ký số
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              Multi-Vendor
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
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
                  </option>
                ))}
              </NativeSelect>
            </div>

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
            </div>
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
            <Label htmlFor="inv-partner">
              Partner Code / Mã đại lý (ISV)
            </Label>
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
              Mã đại lý ISV của Hubsell — <b>cố định, không chỉnh sửa</b>. Nhờ mã
              này mà mọi hóa đơn phát hành qua hệ thống được nhà cung cấp ghi nhận
              thuộc đại lý Hubsell (hưởng hoa hồng ISV).
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
                placeholder={
                  hasSecretKey
                    ? `Đã lưu (${secretMasked ?? "••••"}) — nhập để đổi`
                    : "••••••••"
                }
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
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
            <Button type="button" variant="outline" onClick={handleTestConnection}>
              <PlugZap className="size-4" />
              Kiểm tra kết nối
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              {readOnlyPreview ? "Beta — đã khóa lưu, chạy Sandbox." : "Sandbox — chưa gọi API thật."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ===== KHỐI 2: API KEY THEO GIAN HÀNG ===== */}
      <Card className="max-w-2xl shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-slate-500" />
            API Key hóa đơn theo gian hàng
          </CardTitle>
        </CardHeader>

        <CardContent className="pt-5">
          <p className={cn(TEXT_SUB, "mb-4")}>
            Mỗi gian hàng dùng một API Key riêng để phát hành hóa đơn — phục vụ đối
            soát hoa hồng theo từng shop.
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
    </div>
  );
}
