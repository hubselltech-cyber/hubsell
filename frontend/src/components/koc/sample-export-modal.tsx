"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { toast } from "sonner";

import { kocPlatformMeta } from "@/components/koc/koc-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  createKocSample,
  fetchProducts,
  type KocPartnerRow,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { formatNumber } from "@/lib/format";

/**
 * MODAL XUẤT HÀNG MẪU (số thật) — POST /api/koc/samples.
 *
 * Hai nguồn mẫu:
 *   · KHO VẬT LÝ: tìm SKU (fetchProducts) → giá vốn chốt tại thời điểm xuất,
 *     mặc định TRỪ TỒN + ghi InventoryLog (backend lo trong 1 transaction).
 *   · NGOÀI KHO: nhập tay tên + giá trị (mẫu mua ngoài, hàng NCC gửi thẳng).
 * Mỗi phiếu có HẠN LÊN BÀI (mặc định 14 ngày — chuẩn Sample Integrity):
 * quá hạn là phiếu tự nhảy "Quá hạn chưa đăng" + chuông cảnh báo bùng mẫu.
 */
export function SampleExportModal({
  open,
  onOpenChange,
  partners,
  initialKocId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  partners: KocPartnerRow[];
  /** Chọn sẵn KOC khi mở từ nút thao tác nhanh trên bảng Hiệu quả. */
  initialKocId?: string;
  onDone: () => void;
}) {
  // KOC danh sách đen bị backend chặn — ẩn luôn khỏi select cho đỡ bấm hụt.
  const selectable = partners.filter((p) => p.status !== "BLACKLISTED");
  const [kocId, setKocId] = useState("");
  const [mode, setMode] = useState<"stock" | "external">("stock");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [productId, setProductId] = useState("");
  const [externalName, setExternalName] = useState("");
  const [externalCostRaw, setExternalCostRaw] = useState("");
  const [qty, setQty] = useState(1);
  const [deadlineDays, setDeadlineDays] = useState(14);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setKocId(initialKocId ?? selectable[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKocId]);

  // Debounce ô tìm SKU — gõ xong 300ms mới bắn query.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const productsQ = useQuery({
    queryKey: qk.products({ page: 1, pageSize: 20, search: debounced }),
    queryFn: () => fetchProducts({ page: 1, pageSize: 20, search: debounced }),
    enabled: open && mode === "stock",
    staleTime: 30_000,
  });
  const products = productsQ.data?.items ?? [];
  const picked = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );

  const externalCost = Number(externalCostRaw.replace(/\D/g, ""));
  const unitCost =
    mode === "stock" ? Number(picked?.costPrice ?? 0) : externalCost;
  const stockEnough =
    mode !== "stock" || (picked !== undefined && picked.quantityInStock >= qty);
  const valid =
    kocId !== "" &&
    qty >= 1 &&
    deadlineDays >= 1 &&
    (mode === "stock" ? picked !== undefined && stockEnough : externalName.trim() !== "");
  const cost = unitCost * qty;

  async function handleExport() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await createKocSample({
        kocId,
        qty,
        deadlineDays,
        ...(mode === "stock"
          ? { productId }
          : { productName: externalName.trim(), unitCost: externalCost }),
      });
      toast.success("Đã tạo phiếu hàng mẫu — hệ thống sẽ canh hạn lên bài");
      onOpenChange(false);
      setQty(1);
      setProductId("");
      setExternalName("");
      setExternalCostRaw("");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tạo được phiếu mẫu");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="size-5 text-violet-600" />
            Gửi hàng mẫu cho KOC
          </DialogTitle>
          <DialogDescription>
            Giá trị mẫu tính theo giá vốn, cộng vào chi phí Net-ROI của KOC.
            Quá hạn lên bài là phiếu tự cảnh báo — không ai phải nhớ hộ.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sample-koc">KOC nhận mẫu</Label>
            <NativeSelect
              id="sample-koc"
              value={kocId}
              onChange={(e) => setKocId(e.target.value)}
            >
              {selectable.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} — {kocPlatformMeta(k.platform).label}
                </option>
              ))}
            </NativeSelect>
            {selectable.length === 0 && (
              <p className="text-xs text-red-500">
                Chưa có KOC nào — thêm KOC ở bảng Hiệu quả trước.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sample-mode">Nguồn hàng mẫu</Label>
            <NativeSelect
              id="sample-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as "stock" | "external")}
            >
              <option value="stock">Từ Kho vật lý (trừ tồn + chốt giá vốn)</option>
              <option value="external">Ngoài kho (nhập tay giá trị)</option>
            </NativeSelect>
          </div>

          {mode === "stock" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="sample-search">Tìm SKU trong kho</Label>
                <Input
                  id="sample-search"
                  placeholder="Gõ mã SKU hoặc tên sản phẩm…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <NativeSelect
                  aria-label="Chọn SKU hàng mẫu"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">— Chọn SKU —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.quantityInStock === 0}>
                      {p.skuCode} — {p.productName} (tồn {formatNumber(p.quantityInStock)})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="sample-ext-name">Tên sản phẩm mẫu</Label>
                <Input
                  id="sample-ext-name"
                  placeholder="VD: Set quà tặng mini"
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sample-ext-cost">Giá trị / đơn vị</Label>
                <div className="relative">
                  <Input
                    id="sample-ext-cost"
                    inputMode="numeric"
                    placeholder="VD: 62.000"
                    value={externalCostRaw ? formatNumber(externalCost) : ""}
                    onChange={(e) => setExternalCostRaw(e.target.value)}
                    className="pr-8 text-right tabular-nums"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                    ₫
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sample-qty">Số lượng</Label>
              <Input
                id="sample-qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                aria-invalid={!stockEnough}
              />
              {!stockEnough && picked && (
                <p className="text-xs text-red-500">
                  Kho chỉ còn {formatNumber(picked.quantityInStock)}.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sample-deadline">Hạn lên bài (ngày)</Label>
              <Input
                id="sample-deadline"
                type="number"
                min={1}
                max={90}
                value={deadlineDays}
                onChange={(e) =>
                  setDeadlineDays(Math.min(90, Math.max(1, Number(e.target.value))))
                }
              />
            </div>
          </div>

          {/* Cho chủ shop thấy trước con số chảy vào Net-ROI — không có bất ngờ */}
          <div className="flex items-center justify-between rounded-lg border bg-slate-50 px-3 py-2.5 text-sm">
            <span className="text-slate-500">Chi phí mẫu ghi nhận (giá vốn)</span>
            <Money value={cost} className="font-semibold text-red-500" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleExport} disabled={!valid || submitting}>
            {submitting ? "Đang tạo…" : "Tạo phiếu mẫu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
