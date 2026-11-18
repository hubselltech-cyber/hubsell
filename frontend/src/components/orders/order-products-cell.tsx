"use client";

import * as React from "react";
import { ImageIcon, Link2 } from "lucide-react";

import type { OrderItemLine } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { groupOrderLines, lineText, type LineText } from "@/lib/order-lines";
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
 *
 * 19/11/2026 — chữ mỗi dòng theo MỘT luật (lib/order-lines.ts): tên sản phẩm / PHÂN LOẠI /
 * SKU người bán; mã máy của sàn không in ra (khách không đặt SKU trước đây thấy dãy id).
 * Khi xổ ra, các phân loại CÙNG sản phẩm gom dưới một tên: đơn 20 phân loại đo ở 1280 cao
 * 1.593px khi lặp tên 20 lần — gom lại thì tên in một lần, mỗi phân loại một dòng ngắn.
 */

function Thumb({ line, small }: { line: OrderItemLine; small?: boolean }) {
  // 08/09: đọc ảnh PHẲNG backend đã chọn (listing sàn / payload đơn / kho gốc).
  // Trước đó chỉ đọc product.imageUrl nên SKU chưa nối kho luôn hiện icon rỗng
  // dù backend đã có ảnh sàn — mobile đọc đúng, web thì sót (anh Trung soi 08/09).
  const url = line.imageUrl ?? line.product?.imageUrl;
  const size = small ? "size-7" : "size-9";
  if (!url) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", size)}>
        <ImageIcon className={small ? "size-3.5" : "size-4"} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={line.productName}
      loading="lazy"
      className={cn("shrink-0 rounded-md object-cover ring-1 ring-foreground/10", size)}
    />
  );
}

/**
 * Dòng mã SKU người bán + nút NỐI NGAY TRÊN ĐƠN (05/11/2026, docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md
 * mục 6.5): dòng chưa nối SKU kho (productId null) → nút nhỏ mở ngăn kéo nối. Chỉ hiện khi trang
 * truyền onLink (chủ shop). Không có mã người bán và không cần nối thì không chiếm chỗ.
 */
function SkuRow({
  line,
  text,
  onLink,
}: {
  line: OrderItemLine;
  text: LineText;
  onLink?: (line: OrderItemLine) => void;
}) {
  const unlinked = onLink && line.productId === null;
  if (!text.sellerSku && !unlinked) return null;
  return (
    <p className={cn(TEXT_SUB, "flex items-center gap-1.5 truncate font-mono")}>
      {text.sellerSku && <span className="truncate">{text.sellerSku}</span>}
      {unlinked && (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px font-sans text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100"
          title="Dòng này chưa nối SKU kho — đơn không trừ tồn. Bấm để nối."
          onClick={(e) => {
            e.stopPropagation();
            onLink(line);
          }}
        >
          <Link2 className="size-3" /> Nối kho
        </button>
      )}
    </p>
  );
}

function Line({ line, onLink }: { line: OrderItemLine; onLink?: (line: OrderItemLine) => void }) {
  const text = lineText(line);
  return (
    <div className="flex items-center gap-2.5">
      <Thumb line={line} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words" title={line.productName}>
          {text.baseName}
        </p>
        {text.variantName && <p className="break-words font-medium">{text.variantName}</p>}
        <SkuRow line={line} text={text} onLink={onLink} />
      </div>
      <span className="shrink-0 font-semibold tabular-nums">×{line.quantity}</span>
    </div>
  );
}

/** Danh sách đã xổ: phân loại cùng sản phẩm gom dưới một tên. */
function GroupedLines({ lines, onLink }: { lines: OrderItemLine[]; onLink?: (line: OrderItemLine) => void }) {
  return (
    <>
      {groupOrderLines(lines).map((g) =>
        g.lines.length === 1 ? (
          <Line key={g.key} line={g.lines[0]} onLink={onLink} />
        ) : (
          <div key={g.key} className="space-y-1">
            <p className="line-clamp-2 break-words" title={g.baseName}>
              {g.baseName}
            </p>
            <p className={TEXT_SUB}>
              {formatNumber(g.lines.length)} phân loại · {formatNumber(g.qty)} món
            </p>
            {g.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <Thumb line={l} small />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{l.text.variantName}</p>
                  <SkuRow line={l} text={l.text} onLink={onLink} />
                </div>
                <span className="shrink-0 font-semibold tabular-nums">×{l.quantity}</span>
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}

export function OrderProductsCell({ lines, onLink }: { lines: OrderItemLine[]; onLink?: (line: OrderItemLine) => void }) {
  const [open, setOpen] = React.useState(false);

  if (lines.length === 0) {
    return <span className={TEXT_SUB}>—</span>;
  }

  const hidden = lines.length - 1;

  return (
    <div className="space-y-1.5">
      {open ? <GroupedLines lines={lines} onLink={onLink} /> : <Line line={lines[0]} onLink={onLink} />}

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
