"use client";

// ============================================================
// HỘP "SỬA SẢN PHẨM" Ở TỔNG KHO (18/11/2026, anh Trung: "tạo được sản phẩm kho nhưng không sửa được;
// khách thêm SKU vào sản phẩm thì không thêm được" — docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 12).
//
// Sửa theo MẪU: mở từ bất kỳ phân loại nào cũng tải đủ mọi phân loại của mẫu (bảng Tổng kho có thể
// đang lọc / phân trang chỉ thấy vài dòng). Một lần Lưu = một lần ghi trọn gói: tên áp cho cả mẫu,
// phân loại / mã SKU / giá bán / giá vốn từng dòng, phân loại mới thêm. Là hộp thoại chứ không phải trang riêng
// để lưu xong khách vẫn đứng đúng trang, đúng ô tìm của bảng.
//
// GIÁ VỐN (19/11/2026, anh Trung: "sửa sản phẩm mà không sửa được giá vốn"): ô sửa thẳng trong bảng, chỉ
// người thấy tài chính có cột. Đây là giá MẶC ĐỊNH ở kho — máy chủ ghi qua đúng đường của trang Cấu hình
// Giá vốn: đơn mới dùng giá mới, đơn cũ chưa có giá được tính, đơn cũ đã có giá giữ nguyên. Trước khi
// lưu hỏi lại nếu mã đang là quà tặng mà giá cao (cùng rào với trang Cấu hình Giá vốn).
//
// Không sửa ở đây (có cửa riêng, ghi rõ cuối hộp): tồn kho, mã vạch.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";

import { useGiftCostGuard } from "@/components/finance/gift-cost-guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage, fetchProductGroup, saveProductGroup, type ProductGroupDetail } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { blankRow, buildPayload, costChangesByPrice, firstBlocker, initDraft, isDirty, rowIssues, type GroupDraft, type RowEdit } from "./draft";
import { VariantRows } from "./variant-rows";

/** Sản phẩm đang mở ở hộp sửa: một SKU bất kỳ của mẫu + có tô dòng đó không (mở từ menu ⋯ của một phân loại). */
export interface ProductEditTarget {
  productId: string;
  highlight: boolean;
}

export function ProductEditDialog({
  target,
  onOpenChange,
  onSaved,
}: {
  /** null = đóng. */
  target: ProductEditTarget | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Đang có chữ chưa lưu thì lỡ tay bấm ra ngoài hộp KHÔNG đóng (mất cả bảng vừa gõ) — nút Hủy, X, Esc vẫn đóng.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (target === null) setDirty(false);
  }, [target]);
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange} disablePointerDismissal={dirty}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        {target && (
          <Loader
            key={target.productId}
            productId={target.productId}
            highlight={target.highlight}
            onDirtyChange={setDirty}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BodyProps {
  highlight: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Tải mẫu MỘT LẦN cho mỗi lần mở, không qua bộ đệm truy vấn: form giữ chữ khách đang gõ, một lượt làm
 * tươi nền giữa chừng (đổi tab trình duyệt rồi quay lại) không được đổ lại dữ liệu lên trên.
 */
function Loader({ productId, ...rest }: BodyProps & { productId: string }) {
  const [state, setState] = useState<{ detail: ProductGroupDetail | null; error: string | null }>({ detail: null, error: null });
  const load = useCallback(() => {
    let alive = true;
    setState({ detail: null, error: null });
    fetchProductGroup(productId)
      .then((detail) => alive && setState({ detail, error: null }))
      .catch((err) => alive && setState({ detail: null, error: apiErrorMessage(err, "Không tải được sản phẩm.") }));
    return () => {
      alive = false;
    };
  }, [productId]);
  useEffect(() => load(), [load]);

  if (state.detail) return <EditBody detail={state.detail} {...rest} />;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Sửa sản phẩm</DialogTitle>
        <DialogDescription>
          {state.error ?? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Đang tải các phân loại…
            </span>
          )}
        </DialogDescription>
      </DialogHeader>
      {state.error && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={rest.onClose}>
            Đóng
          </Button>
          <Button onClick={load}>Thử lại</Button>
        </div>
      )}
    </>
  );
}

function EditBody({ detail, highlight, onDirtyChange, onClose, onSaved }: BodyProps & { detail: ProductGroupDetail }) {
  const [draft, setDraft] = useState<GroupDraft>(() => initDraft(detail));
  const [saving, setSaving] = useState(false);
  const { confirmGiftCost, giftCostDialog } = useGiftCostGuard();
  const tableRef = useRef<HTMLDivElement>(null);
  /** Dòng vừa thêm — đưa con trỏ vào ô Phân loại của nó sau khi vẽ. */
  const focusKey = useRef<string | null>(null);

  const issues = useMemo(() => rowIssues(draft), [draft]);
  const blocker = firstBlocker(draft, issues);
  const dirty = useMemo(() => isDirty(draft, detail), [draft, detail]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const seesCost = !detail.costPriceHidden;
  const existingCount = detail.variants.length;
  const addedCount = draft.rows.length - existingCount;
  const canAdd = addedCount < detail.addMax;

  // Mở từ một phân loại giữa mẫu dài → cuộn tới đúng dòng đó.
  useEffect(() => {
    if (!highlight || existingCount < 2) return;
    tableRef.current?.querySelector(`[data-row-key="${CSS.escape(detail.anchorId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [detail.anchorId, existingCount, highlight]);
  useEffect(() => {
    if (!focusKey.current) return;
    const row = tableRef.current?.querySelector(`[data-row-key="${CSS.escape(focusKey.current)}"]`);
    focusKey.current = null;
    row?.scrollIntoView({ block: "nearest" });
    row?.querySelector("input")?.focus();
  });

  function editRow(key: string, patch: RowEdit) {
    setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  }
  function addRow() {
    const row = blankRow(draft);
    focusKey.current = row.key;
    setDraft((d) => ({ ...d, rows: [...d.rows, row] }));
  }
  function removeRow(key: string) {
    setDraft((d) => ({ ...d, rows: d.rows.filter((r) => r.key !== key) }));
  }

  async function save() {
    if (blocker || !dirty) return;
    setSaving(true);
    try {
      const payload = buildPayload(draft);
      for (const [cost, ids] of costChangesByPrice(payload)) {
        if (!(await confirmGiftCost(ids, cost))) {
          setSaving(false);
          return;
        }
      }
      const saved = await saveProductGroup(detail.anchorId, payload);
      toast.success(
        (payload.added.length > 0
          ? `Đã lưu ${saved.productName} — thêm ${formatNumber(payload.added.length)} phân loại, nay có ${formatNumber(saved.variants.length)} SKU`
          : `Đã lưu ${saved.productName}`) +
          (saved.backfilledOrderLines > 0 ? ` · tính lại ${formatNumber(saved.backfilledOrderLines)} dòng đơn cũ chưa có giá vốn` : "")
      );
      onSaved();
      onClose();
    } catch (err) {
      // Máy chủ trả lý do đích danh (trùng mã trong Tổng kho, trùng tên sản phẩm khác…) — giữ hộp để sửa tiếp.
      toast.error(apiErrorMessage(err, "Không lưu được sản phẩm."), { duration: 8000 });
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Pencil className="size-4 text-slate-500" />
          Sửa sản phẩm
        </DialogTitle>
        <DialogDescription>
          Sửa tên, phân loại, mã SKU, giá bán{seesCost ? ", giá vốn" : ""} và thêm phân loại mới. Các gian đang nối giữ nguyên liên kết.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="product-edit-name">Tên sản phẩm</Label>
        <Input
          id="product-edit-name"
          value={draft.productName}
          maxLength={255}
          aria-invalid={!draft.productName.trim()}
          onChange={(e) => setDraft((d) => ({ ...d, productName: e.target.value }))}
        />
        {existingCount > 1 && <p className={TEXT_SUB}>Đổi tên là đổi cho cả {formatNumber(existingCount)} phân loại của sản phẩm này.</p>}
      </div>

      <div ref={tableRef} className="space-y-2">
        <VariantRows
          rows={draft.rows}
          issues={issues}
          seesCost={seesCost}
          anchorKey={highlight ? detail.anchorId : null}
          onEdit={editRow}
          onRemove={removeRow}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="outline" size="sm" onClick={addRow} disabled={!canAdd || saving}>
            <Plus data-icon="inline-start" /> Thêm phân loại
          </Button>
          <span className={TEXT_SUB}>
            {canAdd
              ? "Mỗi phân loại là một SKU kho riêng, hệ thống tự sinh mã vạch. Muốn tự khớp với sàn thì đặt mã SKU giống mã trên gian."
              : `Mỗi lần lưu thêm tối đa ${formatNumber(detail.addMax)} phân loại — lưu rồi thêm tiếp.`}
          </span>
        </div>
      </div>

      <p className={TEXT_SUB}>
        Tồn kho sửa bằng nút Nhập · Xuất trên bảng.{" "}
        {seesCost && (
          <>
            Giá vốn ở đây là giá mặc định của kho: đơn mới tính theo giá mới, đơn cũ đã có giá vốn giữ nguyên; gian đặt giá
            vốn riêng thì sửa ở{" "}
            <Link href="/finance/cost-prices" className="underline underline-offset-2 hover:text-foreground">
              Cấu hình Giá vốn
            </Link>
            .{" "}
          </>
        )}
        Mã vạch đổi ở ⋯ › Mã vạch, cảnh báo &amp; tồn an toàn.
      </p>

      {/* Dính đáy hộp: mẫu vài chục phân loại thì hộp cuộn dọc, nút Lưu + dòng báo lỗi vẫn luôn trong tầm mắt.
          Nền đặc (bg-muted, không /50) để dòng bảng cuộn phía dưới không lộ qua. */}
      <DialogFooter className="sticky -bottom-4 z-10 bg-muted sm:items-center">
        <span className={cn(TEXT_SUB, "sm:mr-auto", blocker && "text-red-500")}>
          {blocker ? `Chưa lưu được — ${blocker}` : dirty ? "Có thay đổi chưa lưu" : "Chưa có thay đổi"}
        </span>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Hủy
        </Button>
        <Button onClick={() => void save()} disabled={saving || !dirty || blocker !== null}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Lưu thay đổi
        </Button>
      </DialogFooter>
      {giftCostDialog}
    </>
  );
}
