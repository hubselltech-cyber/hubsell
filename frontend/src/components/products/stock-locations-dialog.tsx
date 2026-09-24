"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  X,
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
import {
  ApiError,
  createStockLocation,
  deleteStockLocation,
  reorderStockLocations,
  updateStockLocation,
  type StockLocation,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * HỘP "VỊ TRÍ CHỨA HÀNG" (đợt B 24/09/2026, khung anh Trung chốt 15/09).
 *
 * Kho nhỏ / kệ / ô đều là một thứ, khách tự đặt tên. Chưa có vị trí nào: chỉ
 * một ô "Tên vị trí" + nút Thêm — bấm là hệ thống tự sinh gốc "Kho chính" giữ
 * toàn bộ tồn hiện có, rồi tạo vị trí vừa nhập. Có rồi: danh sách theo THỨ TỰ
 * ƯU TIÊN trừ hàng (mũi tên lên/xuống), đổi tên, mã, đặt Mặc định / Nhận hoàn,
 * xóa (chặn khi còn hàng). Xóa hết = tắt tính năng, giao diện về như cũ.
 */
export function StockLocationsDialog({
  open,
  onOpenChange,
  locations,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: StockLocation[];
  onChanged: (next: StockLocation[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const enabled = locations.length > 0;

  async function run<T extends { items: StockLocation[] }>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      const res = await fn();
      onChanged(res.items);
      return res;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ", {
        duration: 7000,
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const res = await run("add", () =>
      createStockLocation({ name, code: newCode.trim() || undefined })
    );
    if (res) {
      setNewName("");
      setNewCode("");
      toast.success(
        res.createdRoot
          ? `Đã bật vị trí chứa hàng: toàn bộ tồn hiện có nằm ở "${res.createdRoot.name}", thêm "${res.created.name}"`
          : `Đã thêm "${res.created.name}"`
      );
    }
  }

  function startEdit(l: StockLocation) {
    setEditingId(l.id);
    setEditName(l.name);
    setEditCode(l.code ?? "");
  }

  async function saveEdit(l: StockLocation) {
    const name = editName.trim();
    if (!name) return;
    const res = await run(`edit-${l.id}`, () =>
      updateStockLocation(l.id, { name, code: editCode.trim() || null })
    );
    if (res) setEditingId(null);
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = locations.map((l) => l.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await run("order", () => reorderStockLocations(ids));
  }

  async function remove(l: StockLocation) {
    const last = locations.length === 1;
    const ok = window.confirm(
      last
        ? `Xóa "${l.name}" — vị trí cuối cùng — sẽ TẮT tính năng vị trí; tồn tổng giữ nguyên, bảng Hàng hóa về như cũ. Tiếp tục?`
        : `Xóa vị trí "${l.name}"?`
    );
    if (!ok) return;
    const res = await run(`del-${l.id}`, () => deleteStockLocation(l.id));
    if (res) toast.success(last ? "Đã tắt vị trí chứa hàng" : `Đã xóa "${l.name}"`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-5 text-slate-600" />
            Vị trí chứa hàng
          </DialogTitle>
          <DialogDescription>
            {enabled
              ? "Đơn bán trừ hàng theo thứ tự ưu tiên từ trên xuống: vị trí nào đủ cả dòng thì lấy ở đó, không thì trừ lần lượt. Sàn chỉ nhận tổng."
              : "Thuê thêm kho nhỏ, hay muốn biết hàng nằm kệ nào? Thêm một vị trí là đủ: tồn hiện có nằm ở “Kho chính”, vị trí mới bắt đầu từ 0."}
          </DialogDescription>
        </DialogHeader>

        {/* ===== DANH SÁCH ===== */}
        {enabled && (
          <div className="overflow-hidden rounded-lg border">
            {locations.map((l, i) => {
              const editing = editingId === l.id;
              return (
                <div
                  key={l.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 px-3 py-2 text-sm",
                    i > 0 && "border-t"
                  )}
                >
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      disabled={i === 0 || busy !== null}
                      aria-label="Ưu tiên lên"
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      disabled={i === locations.length - 1 || busy !== null}
                      aria-label="Ưu tiên xuống"
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                  <span className={cn(TEXT_SUB, "w-5 shrink-0 tabular-nums")}>{i + 1}.</span>

                  {editing ? (
                    <>
                      <Input
                        className="h-8 w-48"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveEdit(l);
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Input
                        className="h-8 w-28 font-mono uppercase"
                        placeholder="Mã (tuỳ chọn)"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                      />
                      <Button size="sm" className="h-8" onClick={() => saveEdit(l)} disabled={busy !== null}>
                        <Check className="size-3.5" />
                        Lưu
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>
                        <X className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{l.name}</span>
                        {l.code && (
                          <span className={cn(TEXT_SUB, "ml-2 font-mono")}>{l.code}</span>
                        )}
                        <span className={cn(TEXT_SUB, "ml-2 tabular-nums")}>
                          {formatNumber(l.skuCount)} SKU · {formatNumber(l.totalQuantity)} chiếc
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {l.isDefault ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            Mặc định
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={cn(TEXT_SUB, "rounded-full border px-2 py-0.5 hover:bg-muted")}
                            title="Hàng nhập không chỉ định sẽ vào đây"
                            disabled={busy !== null}
                            onClick={() => run(`def-${l.id}`, () => updateStockLocation(l.id, { isDefault: true }))}
                          >
                            Đặt mặc định
                          </button>
                        )}
                        {l.isReturnDefault ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
                            title="Hàng hoàn về đây — bấm để bỏ"
                            disabled={busy !== null}
                            onClick={() => run(`ret-${l.id}`, () => updateStockLocation(l.id, { isReturnDefault: false }))}
                          >
                            <Undo2 className="size-3" />
                            Nhận hoàn
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={cn(TEXT_SUB, "rounded-full border px-2 py-0.5 hover:bg-muted")}
                            title="Hàng hoàn về đây để kiểm trước khi trộn vào kho bán (không đặt = về đúng chỗ đã trừ)"
                            disabled={busy !== null}
                            onClick={() => run(`ret-${l.id}`, () => updateStockLocation(l.id, { isReturnDefault: true }))}
                          >
                            Nhận hoàn
                          </button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          aria-label={`Sửa ${l.name}`}
                          onClick={() => startEdit(l)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-700"
                          aria-label={`Xóa ${l.name}`}
                          disabled={busy !== null}
                          onClick={() => remove(l)}
                        >
                          {busy === `del-${l.id}` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ===== THÊM ===== */}
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <label htmlFor="loc-name" className="text-sm font-medium">
              {enabled ? "Thêm vị trí" : "Tên vị trí chứa hàng thứ hai"}
            </label>
            <Input
              id="loc-name"
              placeholder={enabled ? "VD: Kệ A1, Kho Bình Tân…" : "VD: Kho 2"}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div className="grid w-32 gap-1.5">
            <label htmlFor="loc-code" className={TEXT_SUB}>
              Mã (tuỳ chọn)
            </label>
            <Input
              id="loc-code"
              className="font-mono uppercase"
              placeholder="K2"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              maxLength={30}
            />
          </div>
          <Button type="submit" disabled={!newName.trim() || busy !== null}>
            {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {enabled ? "Thêm" : "Thêm vị trí chứa hàng"}
          </Button>
        </form>
        {!enabled && (
          <p className={TEXT_SUB}>
            Không giới hạn số vị trí ở mọi gói. Mapping SKU sàn ↔ SKU kho không đổi, sàn không
            biết hàng nằm ở đâu.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
