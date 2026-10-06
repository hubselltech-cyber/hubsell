"use client";

// ============================================================
// HĐĐT CỦA CHÍNH HUBSELL (tab Sổ quỹ HQ) — 2 dialog:
//  1. HqInvoiceConfigDialog: cấu hình meInvoice công ty (singleton backend,
//     chỉ chủ nền tảng sửa được; mật khẩu để trống = giữ nguyên).
//  2. HqIssueInvoiceDialog: xuất hóa đơn cho một bút toán THU — prefill người
//     mua từ khách hàng gắn bút toán, số tiền = ĐÚNG số trên sổ (không sửa).
//  3. (06/10) Nút giám sát luồng TỰ ĐỘNG (eSign ký nền): HqInvoiceAutoRetryButton
//     chạy lại phát hành → lấy số → email; HqInvoiceEmailButton gửi (lại) PDF
//     cho khách, sửa được địa chỉ nhận. Công tắc tự xuất/tự gửi ở dialog 1.
// Chưa có GPKD/tài khoản meInvoice → cả hai vẫn mở được, hiện rõ còn thiếu gì;
// ngày có tài khoản chỉ việc điền là chạy. Chốt MISA_ALLOW_PUBLISH phía server
// vẫn chặn phát hành cho tới khi anh Trung bật env.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Loader2,
  Mail,
  MailCheck,
  PlugZap,
  ReceiptText,
  RefreshCw,
  Settings2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  ApiError,
  downloadHqInvoicePdf,
  fetchHqInvoiceConfig,
  issueHqInvoice,
  retryHqAutoInvoice,
  sendHqInvoiceEmail,
  testHqInvoiceConnection,
  updateHqInvoiceConfig,
  type HqAutoInvoiceResult,
  type HqInvoiceConfigResponse,
  type PlatformLedgerEntry,
} from "@/lib/api";
import { formatMoney } from "./shared";

/** ISO → "yyyy-mm-dd" theo lịch Việt Nam (UTC+7). */
function vnDateInput(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** "yyyy-mm-dd" → ISO của 0h ngày đó giờ Việt Nam. */
function vnMidnightIso(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}

const VAT_MODE_LABEL: Record<string, string> = {
  KCT: "Không chịu thuế (dịch vụ phần mềm)",
  "0": "0%",
  "5": "5%",
  "8": "8%",
  "10": "10%",
};

/** Tải PDF hóa đơn về máy từ base64 backend trả (cùng cơ chế module thuế tenant). */
export async function saveHqInvoicePdf(entryId: string) {
  const { fileName, base64 } = await downloadHqInvoicePdf(entryId);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Dialog cấu hình meInvoice ----------

export function HqInvoiceConfigDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [resp, setResp] = useState<HqInvoiceConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  // Công tắc tự động (06/10) — tách khỏi form chuỗi để gửi đúng kiểu boolean.
  const [auto, setAuto] = useState({ autoIssueEnabled: false, autoEmailEnabled: true });
  // Ngày "áp dụng cho khoản thu phát sinh từ" (yyyy-mm-dd, lịch VN) — gửi lên
  // thành 0h VN ngày đó. Lùi về sáng nay = xuất luôn cho khách vừa mua.
  const [autoFrom, setAutoFrom] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchHqInvoiceConfig()
      .then((r) => {
        setResp(r);
        setAuto({
          autoIssueEnabled: r.config.autoIssueEnabled,
          autoEmailEnabled: r.config.autoEmailEnabled,
        });
        setAutoFrom(vnDateInput(r.config.autoIssueEnabledAt ?? new Date().toISOString()));
        setForm({
          taxCode: r.config.taxCode ?? "",
          companyName: r.config.companyName ?? "",
          companyAddress: r.config.companyAddress ?? "",
          invoicePattern: r.config.invoicePattern ?? "1",
          invoiceSeries: r.config.invoiceSeries ?? "",
          meinvoiceUsername: r.config.meinvoiceUsername ?? "",
          meinvoicePassword: "",
          signMethod: r.config.signMethod,
          vatMode: r.config.vatMode,
        });
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Không tải được cấu hình")
      );
  }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    setSaving(true);
    try {
      const r = await updateHqInvoiceConfig({
        ...form,
        ...auto,
        autoIssueFrom:
          auto.autoIssueEnabled && autoFrom ? vnMidnightIso(autoFrom) : undefined,
      });
      setResp(r);
      setForm((f) => ({ ...f, meinvoicePassword: "" }));
      toast.success(
        r.missing.length === 0
          ? "Đã lưu — cấu hình đủ để phát hành"
          : `Đã lưu — còn thiếu: ${r.missing.join(", ")}`
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cấu hình");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      await testHqInvoiceConnection();
      toast.success("Kết nối meInvoice OK — lấy được token");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Kết nối thất bại");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-5" />
            Cấu hình meInvoice của Hubsell
          </DialogTitle>
          <DialogDescription>
            Tài khoản meInvoice CỦA CÔNG TY Hubsell — quyết định pháp nhân trên
            hóa đơn bán gói. Chưa có GPKD thì để trống, có hợp đồng MISA rồi
            điền vào là xuất được ngay.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-rose-600">{loadError}</p>
        ) : !resp ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Đang tải…</p>
        ) : (
          <>
            {resp.missing.length > 0 ? (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Còn thiếu để phát hành: {resp.missing.join(", ")}.
                </span>
              </div>
            ) : (
              <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Cấu hình đủ.{" "}
                  {resp.publishAllowed
                    ? "Chốt phát hành server ĐÃ bật — bấm xuất là ra hóa đơn thật."
                    : "Chốt an toàn server (MISA_ALLOW_PUBLISH) đang TẮT — cần bật env trên Render mới phát hành được."}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Mã số thuế</Label>
                <Input placeholder="MST công ty" value={form.taxCode} onChange={set("taxCode")} />
              </div>
              <div className="grid gap-2">
                <Label>Tên pháp nhân</Label>
                <Input placeholder="CÔNG TY TNHH HUBSELL" value={form.companyName} onChange={set("companyName")} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Địa chỉ trụ sở</Label>
              <Input placeholder="Theo GPKD" value={form.companyAddress} onChange={set("companyAddress")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Mẫu số</Label>
                <NativeSelect value={form.invoicePattern} onChange={set("invoicePattern")}>
                  <option value="1">1 — Hóa đơn GTGT</option>
                  <option value="2">2 — Hóa đơn bán hàng</option>
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Ký hiệu (7 ký tự)</Label>
                <Input placeholder="vd: 1C26THB" value={form.invoiceSeries} onChange={set("invoiceSeries")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Tài khoản meInvoice</Label>
                <Input placeholder="Email/SĐT đăng nhập" value={form.meinvoiceUsername} onChange={set("meinvoiceUsername")} />
              </div>
              <div className="grid gap-2">
                <Label>Mật khẩu meInvoice</Label>
                <Input
                  type="password"
                  placeholder={resp.config.hasMeinvoicePassword ? "•••••• (để trống = giữ cũ)" : "Chưa lưu"}
                  value={form.meinvoicePassword}
                  onChange={set("meinvoicePassword")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Phương thức ký</Label>
                <NativeSelect value={form.signMethod} onChange={set("signMethod")}>
                  <option value="ESIGN_CLOUD">Ký nền HSM (khuyên dùng)</option>
                  <option value="USB_TOKEN">USB token</option>
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Thuế suất dòng dịch vụ</Label>
                <NativeSelect value={form.vatMode} onChange={set("vatMode")}>
                  {Object.entries(VAT_MODE_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Bán gói Hubsell là dịch vụ phần mềm — mặc định KHÔNG chịu thuế
              GTGT. Xác nhận lại với kế toán dịch vụ trước hóa đơn đầu tiên.
            </p>

            {/* Tự động hóa (06/10 — anh Trung chốt đầu tư eSign ký nền) */}
            <div className="space-y-3 rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Tự xuất hóa đơn khi khách thanh toán</p>
                  <p className="text-xs text-muted-foreground">
                    payOS báo tiền về hoặc kế toán ghi nhận chuyển khoản → phát hành
                    ngay, không ai phải bấm. Chỉ áp cho khoản thu phát sinh từ lúc bật
                    {resp.config.autoIssueEnabledAt
                      ? ` (đang bật từ ${new Date(resp.config.autoIssueEnabledAt).toLocaleString("vi-VN")})`
                      : ""}
                    . Cần phương thức ký nền HSM / eSign — USB token không tự ký được.
                  </p>
                </div>
                <Switch
                  checked={auto.autoIssueEnabled}
                  onCheckedChange={(v) => setAuto((a) => ({ ...a, autoIssueEnabled: v }))}
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Tự gửi email PDF hóa đơn cho khách</p>
                  <p className="text-xs text-muted-foreground">
                    Có số hóa đơn là gửi bản PDF đã ký từ billing@ tới email nhận hóa đơn
                    của khách (hồ sơ xuất hóa đơn → email đăng nhập). Tắt thì HQ bấm
                    Gửi tay từng tờ.
                  </p>
                </div>
                <Switch
                  checked={auto.autoEmailEnabled}
                  onCheckedChange={(v) => setAuto((a) => ({ ...a, autoEmailEnabled: v }))}
                />
              </div>
              {auto.autoIssueEnabled && (
                <div className="grid gap-1.5">
                  <Label className="text-xs">Áp dụng cho khoản thu phát sinh từ ngày</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      className="h-8 w-44"
                      value={autoFrom}
                      max={vnDateInput(new Date().toISOString())}
                      onChange={(e) => setAutoFrom(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">
                      Khoản thu từ 0h ngày này mà chưa có hóa đơn sẽ được máy xuất
                      (lưới quét 30&apos; hoặc bấm Thử lại). Khoản cũ hơn giữ nguyên.
                    </span>
                  </div>
                </div>
              )}
              {auto.autoIssueEnabled && form.signMethod === "USB_TOKEN" && (
                <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Đang chọn USB token: máy không tự ký được, lệnh tự xuất sẽ lỗi.
                    Chuyển sang Ký nền HSM (MISA eSign) để tự động chạy.
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                Kiểm tra kết nối
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Lưu cấu hình
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dialog xuất hóa đơn cho một bút toán THU ----------

export function HqIssueInvoiceDialog({
  entry,
  onClose,
  onIssued,
}: {
  entry: PlatformLedgerEntry;
  onClose: () => void;
  onIssued: () => void;
}) {
  const [resp, setResp] = useState<HqInvoiceConfigResponse | null>(null);
  const [buyerName, setBuyerName] = useState(entry.customer?.fullName ?? "");
  const [buyerTaxCode, setBuyerTaxCode] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerEmail, setBuyerEmail] = useState(entry.customer?.email ?? "");
  const [itemName, setItemName] = useState(
    entry.note ?? "Phí dịch vụ phần mềm Hubsell"
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchHqInvoiceConfig()
      .then(setResp)
      .catch(() => setResp(null));
  }, []);

  const blocked = !resp || resp.missing.length > 0 || !resp.publishAllowed;

  async function handleIssue() {
    if (!buyerName.trim() || !itemName.trim()) {
      toast.error("Cần tên người mua và nội dung dòng hóa đơn");
      return;
    }
    setSubmitting(true);
    try {
      const result = await issueHqInvoice(entry.id, {
        buyerName: buyerName.trim(),
        buyerTaxCode: buyerTaxCode.trim() || undefined,
        buyerAddress: buyerAddress.trim() || undefined,
        buyerEmail: buyerEmail.trim() || undefined,
        itemName: itemName.trim(),
      });
      if (result.pendingNumber) {
        toast.info(
          "meInvoice đã nhận lệnh nhưng chưa cấp số — tra trên meInvoice rồi điền số hóa đơn vào bút toán."
        );
      } else {
        toast.success(`Đã phát hành hóa đơn số ${result.invoiceNo}`);
      }
      onClose();
      onIssued();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Phát hành thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="size-5" />
            Xuất hóa đơn điện tử
          </DialogTitle>
          <DialogDescription>
            Phát hành HĐĐT qua meInvoice cho khoản thu này — số tiền hóa đơn
            đúng bằng số trên sổ quỹ, không sửa được tại đây.
          </DialogDescription>
        </DialogHeader>

        {resp && resp.missing.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Chưa cấu hình xong meInvoice (thiếu: {resp.missing.join(", ")}) —
              chủ nền tảng vào nút &ldquo;meInvoice&rdquo; trên đầu Sổ quỹ để điền.
            </span>
          </div>
        )}
        {resp && resp.missing.length === 0 && !resp.publishAllowed && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Chốt an toàn server (MISA_ALLOW_PUBLISH) đang TẮT — hóa đơn chưa
              phát hành được cho tới khi bật env trên Render.
            </span>
          </div>
        )}

        {/* Tóm tắt khoản thu + bên bán */}
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2.5 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Tổng tiền hóa đơn</span>
            <span className="text-base font-bold tabular-nums text-emerald-600">
              {formatMoney(entry.amount)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground">
            <span>
              Thuế suất: {resp ? VAT_MODE_LABEL[resp.config.vatMode] ?? resp.config.vatMode : "…"}
            </span>
            <span>
              Ký hiệu: {resp?.config.invoiceSeries ?? "chưa cấu hình"}
            </span>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Tên người mua / đơn vị</Label>
          <Input
            placeholder="Tên khách hoặc tên công ty trên hóa đơn"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>MST người mua (nếu có)</Label>
            <Input
              placeholder="Trống = khách lẻ"
              value={buyerTaxCode}
              onChange={(e) => setBuyerTaxCode(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Email nhận hóa đơn</Label>
            <Input
              type="email"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Địa chỉ người mua</Label>
          <Input
            placeholder="Bắt buộc khi xuất theo đơn vị (có MST)"
            value={buyerAddress}
            onChange={(e) => setBuyerAddress(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label>Nội dung dòng hóa đơn</Label>
          <Input
            placeholder="vd: Phí dịch vụ phần mềm Hubsell — gói Growth 12 tháng"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={handleIssue} disabled={submitting || blocked}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Phát hành hóa đơn
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Nút tải PDF (dùng trong bảng sổ quỹ) ----------

export function HqInvoicePdfButton({ entry }: { entry: PlatformLedgerEntry }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="icon-sm"
      title="Tải PDF hóa đơn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await saveHqInvoicePdf(entry.id);
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Không tải được PDF");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
    </Button>
  );
}

// ---------- Nút giám sát luồng TỰ ĐỘNG (06/10) ----------

/** Lời nhắn ngắn cho toast từ kết quả một lượt luồng tự động. */
export function describeAutoResult(r: HqAutoInvoiceResult): { ok: boolean; text: string } {
  switch (r.step) {
    case "emailed":
      return {
        ok: true,
        text: `Đã gửi hóa đơn${r.invoiceNo ? ` số ${r.invoiceNo}` : ""} tới ${r.emailedTo ?? "khách"}`,
      };
    case "issued":
      return { ok: true, text: `Đã phát hành hóa đơn số ${r.invoiceNo ?? "?"}` };
    case "number-pending":
      return {
        ok: true,
        text: "meInvoice đã nhận lệnh nhưng chưa cấp số — máy sẽ hỏi lại sau, hoặc bấm Thử lại.",
      };
    case "nothing":
      return { ok: true, text: "Không còn việc gì để làm cho khoản thu này." };
    case "locked":
      return { ok: false, text: "Khoản thu này đang được một lượt khác xử lý — thử lại sau ít phút." };
    case "not-eligible":
      return { ok: false, text: "Khoản thu không thuộc diện tự xuất (công tắc tắt hoặc cũ hơn mốc bật)." };
    default:
      return { ok: false, text: r.error ?? "Thất bại" };
  }
}

/** Chạy lại luồng tự động (phát hành → lấy số → email) cho một bút toán. */
export function HqInvoiceAutoRetryButton({
  entry,
  onDone,
}: {
  entry: PlatformLedgerEntry;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const waitingNumber = Boolean(entry.einvoiceTransactionId) && !entry.invoiceNo;
  return (
    <Button
      variant="outline"
      size="icon-sm"
      title={
        waitingNumber
          ? "Hỏi meInvoice số hóa đơn rồi gửi email"
          : entry.einvoiceAutoError
            ? `Thử lại tự xuất — lỗi gần nhất: ${entry.einvoiceAutoError}`
            : "Chạy luồng tự xuất hóa đơn cho khoản thu này"
      }
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { result } = await retryHqAutoInvoice(entry.id);
          const d = describeAutoResult(result);
          if (d.ok) toast.success(d.text);
          else toast.error(d.text);
          onDone();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Không chạy được");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
    </Button>
  );
}

/** Gửi (lại) email PDF hóa đơn — mở hộp nhỏ để sửa địa chỉ nhận. */
export function HqInvoiceEmailButton({
  entry,
  onDone,
}: {
  entry: PlatformLedgerEntry;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(entry.invoiceEmailTo ?? entry.customer?.email ?? "");
  const [busy, setBusy] = useState(false);
  const sent = Boolean(entry.invoiceEmailSentAt);

  async function handleSend() {
    setBusy(true);
    try {
      const { result } = await sendHqInvoiceEmail(entry.id, to.trim() || undefined);
      const d = describeAutoResult(result);
      if (d.ok) toast.success(d.text);
      else toast.error(d.text);
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gửi được email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon-sm"
        className={sent ? "text-emerald-700" : undefined}
        title={
          sent
            ? `Đã gửi tới ${entry.invoiceEmailTo ?? "khách"} lúc ${new Date(entry.invoiceEmailSentAt!).toLocaleString("vi-VN")}${entry.invoiceEmailError ? ` · ${entry.invoiceEmailError}` : ""} — bấm để gửi lại`
            : entry.invoiceEmailError
              ? `Chưa gửi được: ${entry.invoiceEmailError}`
              : "Gửi email PDF hóa đơn cho khách"
        }
        onClick={() => {
          setTo(entry.invoiceEmailTo ?? entry.customer?.email ?? "");
          setOpen(true);
        }}
      >
        {sent ? <MailCheck className="size-4" /> : <Mail className="size-4" />}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="size-5" />
                {sent ? "Gửi lại email hóa đơn" : "Gửi email hóa đơn"}
              </DialogTitle>
              <DialogDescription>
                Thư từ billing@ kèm bản PDF đã ký của hóa đơn
                {entry.invoiceNo ? ` số ${entry.invoiceNo}` : ""}.
                {sent && entry.invoiceEmailSentAt
                  ? ` Lần gửi trước: ${new Date(entry.invoiceEmailSentAt).toLocaleString("vi-VN")}.`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label>Email nhận</Label>
              <Input
                type="email"
                placeholder="khach@example.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Huỷ
              </Button>
              <Button onClick={handleSend} disabled={busy || !to.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Gửi
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
