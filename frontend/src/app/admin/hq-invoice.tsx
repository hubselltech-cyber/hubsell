"use client";

// ============================================================
// HĐĐT CỦA CHÍNH HUBSELL (tab Sổ quỹ HQ) — 2 dialog:
//  1. HqInvoiceConfigDialog: cấu hình meInvoice công ty (singleton backend,
//     chỉ chủ nền tảng sửa được; mật khẩu để trống = giữ nguyên).
//  2. HqIssueInvoiceDialog: xuất hóa đơn cho một bút toán THU — prefill người
//     mua từ khách hàng gắn bút toán, số tiền = ĐÚNG số trên sổ (không sửa).
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
  PlugZap,
  ReceiptText,
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
import {
  ApiError,
  downloadHqInvoicePdf,
  fetchHqInvoiceConfig,
  issueHqInvoice,
  testHqInvoiceConnection,
  updateHqInvoiceConfig,
  type HqInvoiceConfigResponse,
  type PlatformLedgerEntry,
} from "@/lib/api";
import { formatMoney } from "./shared";

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
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchHqInvoiceConfig()
      .then((r) => {
        setResp(r);
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
      const r = await updateHqInvoiceConfig(form);
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
