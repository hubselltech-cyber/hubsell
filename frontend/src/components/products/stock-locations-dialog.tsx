"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Sparkles,
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
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  bulkCreateStockLocations,
  createStockLocation,
  deleteStockLocation,
  fetchStockLocationLabelsPdf,
  reorderStockLocations,
  updateStockLocation,
  type StockLocation,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { printPdfBlob } from "@/lib/print-labels";
import { locationLabel, locationTree, parentOptions } from "@/lib/stock-locations";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * HỘP "VỊ TRÍ CHỨA HÀNG" (đợt B 24/09/2026, khung anh Trung chốt 15/09).
 *
 * Kho nhỏ / kệ / ô đều là một thứ, khách tự đặt tên, xếp thành CÂY Kho › Kệ › Tầng
 * (anh Trung 24/09 xem prod: kệ sinh ra phải nằm TRONG kho, không thành kho khác →
 * mọi chỗ tạo có ô "Thuộc", danh sách thụt lề theo cây, mũi tên đổi chỗ trong cùng
 * một cha). Chưa có vị trí nào: một ô tên + một nút — hệ thống tự sinh gốc "Kho chính"
 * giữ toàn bộ tồn hiện có. Xóa hết = tắt tính năng, giao diện về như cũ.
 */
/** Ô chọn cha dùng chung cho thêm / sinh hàng loạt / sửa (module scope — không tạo component trong render). */
function ParentSelect({
  id,
  value,
  onChange,
  locations,
  excludeId,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  locations: StockLocation[];
  excludeId?: string;
  className?: string;
}) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">— Ngang cấp kho (không thuộc kho nào) —</option>
      {locationTree(parentOptions(locations, excludeId)).map(({ loc, depth }) => (
        <option key={loc.id} value={loc.id}>
          {"  ".repeat(depth)}
          {depth > 0 ? "› " : ""}
          {loc.name}
        </option>
      ))}
    </NativeSelect>
  );
}

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
  const [newParent, setNewParent] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [bulkParent, setBulkParent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editParent, setEditParent] = useState("");
  const enabled = locations.length > 0;
  const tree = locationTree(locations);

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
      createStockLocation({ name, code: newCode.trim() || undefined, parentId: newParent || null })
    );
    if (res) {
      setNewName("");
      setNewCode("");
      toast.success(
        res.createdRoot
          ? `Đã bật vị trí chứa hàng: toàn bộ tồn hiện có nằm ở "${res.createdRoot.name}", thêm "${res.created.name}"`
          : `Đã thêm "${res.created.name}"${newParent ? ` trong ${labelOf(newParent)}` : ""}`
      );
    }
  }

  function labelOf(id: string) {
    const l = locations.find((x) => x.id === id);
    return l ? locationLabel(l) : "";
  }

  function startEdit(l: StockLocation) {
    setEditingId(l.id);
    setEditName(l.name);
    setEditCode(l.code ?? "");
    setEditParent(l.parentId ?? "");
  }

  async function saveEdit(l: StockLocation) {
    const name = editName.trim();
    if (!name) return;
    const res = await run(`edit-${l.id}`, () =>
      updateStockLocation(l.id, {
        name,
        code: editCode.trim() || null,
        ...(editParent !== (l.parentId ?? "") ? { parentId: editParent || null } : {}),
      })
    );
    if (res) setEditingId(null);
  }

  /** Đổi chỗ với anh em liền kề (cùng cha), rồi gửi lại toàn bộ thứ tự cây. */
  async function move(l: StockLocation, dir: -1 | 1) {
    const siblings = tree.filter((n) => (n.loc.parentId ?? null) === (l.parentId ?? null)).map((n) => n.loc);
    const i = siblings.findIndex((s) => s.id === l.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    const swapped = siblings.slice();
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    // Dựng lại thứ tự cây với nhóm anh em đã đổi chỗ.
    const order = new Map(swapped.map((s, k) => [s.id, k]));
    const reordered = locations
      .slice()
      .sort((a, b) => {
        const sameGroup = (a.parentId ?? null) === (l.parentId ?? null) && (b.parentId ?? null) === (l.parentId ?? null);
        if (sameGroup) return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
        return a.sortOrder - b.sortOrder;
      });
    const ids = locationTree(reordered.map((x, k) => ({ ...x, sortOrder: k }))).map((n) => n.loc.id);
    await run("order", () => reorderStockLocations(ids));
  }

  async function handleBulk(e: React.FormEvent) {
    e.preventDefault();
    const p = pattern.trim();
    if (!p) return;
    const res = await run("bulk", () => bulkCreateStockLocations({ pattern: p, parentId: bulkParent || null }));
    if (res) {
      setPattern("");
      toast.success(
        `Đã sinh ${formatNumber(res.created)} vị trí${bulkParent ? ` trong ${labelOf(bulkParent)}` : ""}` +
          (res.skipped.length ? ` · bỏ qua ${res.skipped.length} tên đã có` : "") +
          (res.createdRoot ? ` · tồn hiện có nằm ở "${res.createdRoot.name}"` : "")
      );
    }
  }

  async function printLabels() {
    setBusy("print");
    try {
      const blob = await fetchStockLocationLabelsPdf();
      if (!printPdfBlob(blob)) {
        toast.error("Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho trang này rồi bấm lại.");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSellable(l: StockLocation) {
    await run(`sell-${l.id}`, () => updateStockLocation(l.id, { sellable: !l.sellable }));
  }

  async function remove(l: StockLocation) {
    const last = locations.length === 1;
    const ok = window.confirm(
      last
        ? `Xóa "${l.name}" — vị trí cuối cùng — sẽ TẮT tính năng vị trí; tồn tổng giữ nguyên, bảng Hàng hóa về như cũ. Tiếp tục?`
        : `Xóa vị trí "${locationLabel(l)}"?`
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
              ? "Kho › Kệ › Tầng xếp thành cây. Đơn bán trừ hàng theo thứ tự từ trên xuống: vị trí nào đủ cả dòng thì lấy ở đó, không thì trừ lần lượt. Sàn chỉ nhận tổng."
              : "Thuê thêm kho nhỏ, hay muốn biết hàng nằm kệ nào? Thêm một vị trí là đủ: tồn hiện có nằm ở “Kho chính”, vị trí mới bắt đầu từ 0."}
          </DialogDescription>
        </DialogHeader>

        {/* ===== CÂY VỊ TRÍ ===== */}
        {enabled && (
          <div className="max-h-[48vh] overflow-auto rounded-lg border">
            {tree.map(({ loc: l, depth }, i) => {
              const editing = editingId === l.id;
              const siblings = tree.filter((n) => (n.loc.parentId ?? null) === (l.parentId ?? null));
              const si = siblings.findIndex((n) => n.loc.id === l.id);
              return (
                <div
                  key={l.id}
                  className={cn("flex flex-wrap items-center gap-2 py-2 pr-3 text-sm", i > 0 && "border-t")}
                  style={{ paddingLeft: 12 + depth * 22 }}
                >
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      disabled={si <= 0 || busy !== null}
                      aria-label="Ưu tiên lên"
                      onClick={() => move(l, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      disabled={si >= siblings.length - 1 || busy !== null}
                      aria-label="Ưu tiên xuống"
                      onClick={() => move(l, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                  {depth > 0 && <span className="text-muted-foreground">›</span>}

                  {editing ? (
                    <>
                      <Input
                        className="h-8 w-40"
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
                        className="h-8 w-24 font-mono uppercase"
                        placeholder="Mã"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                      />
                      <ParentSelect
                        id={`parent-${l.id}`}
                        value={editParent}
                        onChange={setEditParent}
                        locations={locations}
                        excludeId={l.id}
                        className="h-8 w-48 [&>select]:h-8"
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
                        <span className={cn("font-medium", !l.sellable && "text-slate-500")}>{l.name}</span>
                        {l.code && <span className={cn(TEXT_SUB, "ml-2 font-mono")}>{l.code}</span>}
                        {!l.sellable && (
                          <span
                            className="ml-2 rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                            title="Hàng ở đây không tính vào tồn bán, đơn không trừ ở đây"
                          >
                            không bán
                          </span>
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
                        {!l.isDefault && (
                          <button
                            type="button"
                            className={cn(
                              TEXT_SUB,
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-muted",
                              !l.sellable && "border-slate-400 text-slate-700"
                            )}
                            title={
                              l.sellable
                                ? "Đánh dấu ô KHÔNG BÁN (hàng lỗi / hàng hoàn chờ kiểm): hàng ở đây không tính vào tồn bán"
                                : "Cho bán lại: hàng ở đây tính vào tồn bán"
                            }
                            disabled={busy !== null}
                            onClick={() => toggleSellable(l)}
                          >
                            <Ban className="size-3" />
                            {l.sellable ? "Không bán" : "Cho bán"}
                          </button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          aria-label={`Sửa ${l.name}`}
                          title="Đổi tên, mã, hoặc chuyển vào kho khác"
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

        {/* ===== THÊM MỘT VỊ TRÍ ===== */}
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-[12rem] flex-1 gap-1.5">
            <label htmlFor="loc-name" className="text-sm font-medium">
              {enabled ? "Thêm vị trí" : "Tên vị trí chứa hàng thứ hai"}
            </label>
            <Input
              id="loc-name"
              placeholder={enabled ? "VD: Kho Bình Tân, Kệ A1…" : "VD: Kho 2"}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={60}
            />
          </div>
          {enabled && (
            <div className="grid w-52 gap-1.5">
              <label htmlFor="loc-parent" className={TEXT_SUB}>
                Thuộc
              </label>
              <ParentSelect id="loc-parent" value={newParent} onChange={setNewParent} locations={locations} />
            </div>
          )}
          <div className="grid w-28 gap-1.5">
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

        {/* ===== SINH HÀNG LOẠT + IN TEM ===== */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <button
            type="button"
            className={cn(TEXT_SUB, "inline-flex items-center gap-1 hover:text-foreground")}
            onClick={() => setBulkOpen((v) => !v)}
          >
            <Sparkles className="size-3.5" />
            {bulkOpen ? "Ẩn sinh hàng loạt" : "Sinh nhiều kệ / tầng một lượt"}
          </button>
          {enabled && (
            <button
              type="button"
              className={cn(TEXT_SUB, "ml-auto inline-flex items-center gap-1 hover:text-foreground")}
              disabled={busy !== null}
              onClick={printLabels}
              title="PDF A4, mỗi vị trí một tem có mã vạch theo mã — dán lên kệ / cửa kho"
            >
              {busy === "print" ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />}
              In tem vị trí
            </button>
          )}
        </div>
        {bulkOpen && (
          <form onSubmit={handleBulk} className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-[14rem] flex-1 gap-1.5">
              <label htmlFor="loc-pattern" className="text-sm font-medium">
                Mẫu tên
              </label>
              <Input
                id="loc-pattern"
                placeholder="VD: Kệ A[1-5]  ·  Kệ [A-C][1-3]  ·  Kệ A[1-3] T[1-2]"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                maxLength={80}
              />
            </div>
            {enabled && (
              <div className="grid w-52 gap-1.5">
                <label htmlFor="bulk-parent" className={TEXT_SUB}>
                  Thuộc
                </label>
                <ParentSelect id="bulk-parent" value={bulkParent} onChange={setBulkParent} locations={locations} />
              </div>
            )}
            <Button type="submit" variant="secondary" disabled={!pattern.trim() || busy !== null}>
              {busy === "bulk" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Sinh
            </Button>
            <p className={cn(TEXT_SUB, "basis-full")}>
              [1-5] chạy số, [A-C] chạy chữ, [01-12] giữ số 0 đầu; nhiều dải ghép với nhau. Chọn
              &ldquo;Thuộc&rdquo; = Kho 2 thì kệ sinh ra nằm trong Kho 2. Mã tem tự sinh từ tên
              (KE-A1). Tối đa 200 vị trí một lượt.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
