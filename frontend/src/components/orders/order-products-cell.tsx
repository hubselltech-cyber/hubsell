"use client";

import * as React from "react";
import { ImageIcon } from "lucide-react";

import type { OrderItemLine } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CỤM SẢN PHẨM TRONG MỘT ĐƠN
 *
 * Đơn TMĐT hay có nhiều SKU. Nếu trải hết ra thì một đơn 5 món chiếm nửa màn
 * hình và các đơn 1 món bên cạnh trông lọt thỏm — bảng mất nhịp, rất khó lướt.
 *
 * Cách xử lý: luôn hiện đầy đủ dòng đầu, các dòng sau gấp lại sau một nút
 * "+N sản phẩm khác". Bấm mới xổ ra, nên chiều cao mỗi dòng bảng gần như bằng
 * nhau, mắt lướt dọc không bị vấp.
 */

function Thumb({ line }: { line: OrderItemLine }) {
  const url = line.product?.imageUrl;
  if (!url) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={line.productName}
      className="size-9 shrink-0 rounded-md object-cover ring-1 ring-foreground/10"
    />
  );
}

function Line({ line }: { line: OrderItemLine }) {
  return (
    <div className="flex items-center gap-2.5">
      <Thumb line={line} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{line.productName}</p>
        <p className={cn(TEXT_SUB, "truncate font-mono")}>{line.channelSku}</p>
      </div>
      <span className="shrink-0 font-semibold tabular-nums">×{line.quantity}</span>
    </div>
  );
}

export function OrderProductsCell({ lines }: { lines: OrderItemLine[] }) {
  const [open, setOpen] = React.useState(false);

  if (lines.length === 0) {
    return <span className={TEXT_SUB}>—</span>;
  }

  const hidden = lines.length - 1;

  return (
    <div className="space-y-1.5">
      <Line line={lines[0]} />

      {hidden > 0 && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            TEXT_SUB,
            "ml-11.5 rounded px-1 font-medium underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
          )}
        >
          + {hidden} sản phẩm khác
        </button>
      )}

      {open &&
        lines.slice(1).map((l) => <Line key={l.id} line={l} />)}

      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={cn(
            TEXT_SUB,
            "ml-11.5 rounded px-1 font-medium underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
          )}
        >
          Thu gọn
        </button>
      )}
    </div>
  );
}
