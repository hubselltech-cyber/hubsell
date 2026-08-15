"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Link2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SkuCombobox } from "@/components/finance/sku-combobox";
import {
  ApiError,
  linkChannelProducts,
  type ChannelProduct,
  type Product,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface LinkOneDialogProps {
  /** Sản phẩm sàn đang cần nối. null = đóng hộp thoại. */
  item: ChannelProduct | null;
  products: Product[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

// Hộp thoại nối NHANH một sản phẩm sàn về SKU gốc — mở từ nút "Chưa liên kết"
// ngay trên dòng, khỏi phải tick chọn rồi dùng thanh liên kết hàng loạt.
export function LinkOneDialog({
  item,
  products,
  onOpenChange,
  onDone,
}: LinkOneDialogProps) {
  const [internalSku, setInternalSku] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Mỗi lần mở cho một sản phẩm khác thì bỏ lựa chọn SKU của lần trước
  useEffect(() => setInternalSku(""), [item?.id]);

  const target = products.find((p) => p.skuCode === internalSku) ?? null;

  async function handleSaveMapping(shopeeItem: ChannelProduct, sku: string) {
    const product = products.find((p) => p.skuCode === sku);
    if (!product) {
      toast.error("Chọn mã SKU gốc để nối về");
      return;
    }
    setSubmitting(true);
    try {
      const res = await linkChannelProducts([shopeeItem.id], product.id);
      toast.success(
        `Đã nối ${shopeeItem.channelSku} về ${res.product.skuCode} — ${res.product.productName}` +
          (res.seededStock != null
            ? `. Tồn ban đầu lấy theo sàn: ${formatNumber(res.seededStock)}.`
            : ""),
        { duration: 6000 }
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không nối được");
    } finally {
      setSubmitting(false);
    }
  }

  if (!item) return null;
  const meta = CHANNEL_META[item.channel.channelName];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-5 text-primary" />
            Liên kết SP vào kho vật lý
          </DialogTitle>
          <DialogDescription>
            Chọn SKU gốc trong kho để đơn hàng của sản phẩm sàn này trừ đúng tồn
            kho.
          </DialogDescription>
        </DialogHeader>

        {/* Sản phẩm sàn đang chọn */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.productName}
              className="size-11 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ImageIcon className="size-5" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{item.productName}</p>
            <p className={cn(TEXT_SUB, "font-mono")}>{item.channelSku}</p>
            <p className={TEXT_SUB}>
              {meta.label} · {item.channel.shopName}
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveMapping(item, internalSku);
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <Label>Nối về SKU gốc</Label>
            <SkuCombobox
              products={products}
              value={internalSku}
              onChange={setInternalSku}
              inlineList
            />
            {target && (
              <p className={TEXT_SUB}>
                Tồn kho hiện tại của {target.skuCode}:{" "}
                <span className="font-semibold text-foreground">
                  {formatNumber(target.quantityInStock)}
                </span>
                {target.quantityInStock === 0 &&
                  " — khi liên kết sẽ tự lấy tồn theo số đang có trên sàn."}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Huỷ bỏ
            </Button>
            <Button
              type="submit"
              disabled={submitting || !internalSku}
              title={!internalSku ? "Chọn mã SKU gốc trước" : undefined}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Xác nhận liên kết
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
