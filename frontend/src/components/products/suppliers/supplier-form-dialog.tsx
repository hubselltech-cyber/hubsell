"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, createSupplier, updateSupplier, type SupplierRow } from "@/lib/api";

/**
 * Thêm / sửa NHÀ CUNG CẤP (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5). Danh bạ gọn: tên là đủ,
 * còn lại không bắt buộc. Không có công nợ / đơn đặt hàng. "Ngừng dùng" chỉ ẩn khỏi ô chọn trên phiếu
 * nhập — phiếu cũ và số liệu giữ nguyên.
 */
export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = thêm mới. */
  supplier: SupplierRow | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <FormBody key={supplier?.id ?? "new"} supplier={supplier} onClose={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function FormBody({ supplier, onClose, onSaved }: { supplier: SupplierRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [taxCode, setTaxCode] = useState(supplier?.taxCode ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [note, setNote] = useState(supplier?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const data = { name: name.trim(), phone: phone.trim() || null, taxCode: taxCode.trim() || null, address: address.trim() || null, note: note.trim() || null };
    if (!data.name) {
      toast.error("Nhập tên nhà cung cấp");
      return;
    }
    void run(() => (supplier ? updateSupplier(supplier.id, data) : createSupplier(data)), supplier ? "Đã lưu nhà cung cấp" : `Đã thêm ${data.name}`);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{supplier ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}</DialogTitle>
        <DialogDescription>Chỉ cần tên. Các ô còn lại để đối chiếu và hiện trên bản in phiếu nhập.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="sup-name">Tên nhà cung cấp</Label>
          <Input id="sup-name" autoFocus value={name} maxLength={120} placeholder="Xưởng may Minh Long" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sup-phone">Số điện thoại</Label>
            <Input id="sup-phone" value={phone} maxLength={30} placeholder="0901 234 567" onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sup-tax">Mã số thuế</Label>
            <Input id="sup-tax" value={taxCode} maxLength={20} placeholder="0312345678" onChange={(e) => setTaxCode(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sup-address">Địa chỉ</Label>
          <Input id="sup-address" value={address} maxLength={255} placeholder="12 Tân Kỳ Tân Quý, Tân Phú, TP.HCM" onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sup-note">Ghi chú</Label>
          <Input id="sup-note" value={note} maxLength={500} placeholder="Giao thứ 3 và thứ 6, đặt trước 2 ngày" onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <DialogFooter className="sm:justify-between">
        {supplier ? (
          <Button
            variant="ghost"
            disabled={busy}
            title={supplier.isActive ? "Ẩn khỏi ô chọn trên phiếu nhập; phiếu cũ và số liệu giữ nguyên" : "Hiện lại trong ô chọn trên phiếu nhập"}
            onClick={() =>
              void run(
                () => updateSupplier(supplier.id, { isActive: !supplier.isActive }),
                supplier.isActive ? `Đã ngừng dùng ${supplier.name}` : `Đã dùng lại ${supplier.name}`
              )
            }
          >
            {supplier.isActive ? "Ngừng dùng" : "Dùng lại"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {supplier ? "Lưu" : "Thêm nhà cung cấp"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
