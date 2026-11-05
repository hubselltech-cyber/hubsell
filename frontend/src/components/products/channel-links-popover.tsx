"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ChannelStockState, Product } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

type ChannelLink = NonNullable<Product["channelLinks"]>[number];

/** Xấu nhất thắng: màu chip của một sàn lấy theo gian tệ nhất trong nhóm. */
const RANK: Record<string, number> = {
  alert: 5,
  mismatch: 4,
  pending: 3,
  off: 2,
  unknown: 1,
  match: 0,
};
const ORDER = ["SHOPEE", "LAZADA", "TIKTOK"];

function chipTone(worst: string): string {
  if (worst === "match") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (worst === "mismatch" || worst === "alert") return "border-red-200 bg-red-50 text-red-700";
  if (worst === "pending") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function stateHint(st: ChannelStockState | "unknown", available: number): { text: string; className: string } {
  switch (st) {
    case "match":
      return { text: "khớp", className: "text-emerald-700" };
    case "mismatch":
      return { text: `lệch, kho muốn ${formatNumber(available)}`, className: "font-medium text-red-700" };
    case "alert":
      return { text: "đẩy thất bại, xem cảnh báo phía trên bảng", className: "font-medium text-red-700" };
    case "pending":
      return { text: "đang đẩy", className: "text-amber-700" };
    case "off":
      return { text: "chưa bật đồng bộ", className: "text-slate-500" };
    default:
      return { text: "sàn chưa trả số", className: "text-slate-500" };
  }
}

/**
 * Cột "Bán trên" của Tổng kho: mỗi sàn một chip "Shopee ×3" (màu = trạng thái xấu nhất), bấm mở
 * hộp nhỏ liệt kê từng gian + số tồn sàn đang hiện + trạng thái đồng bộ.
 *
 * 05/11/2026 (anh Trung): thay DÒNG BUNG "sơ đồ kho ↔ gian". NỐI MỘT CHIỀU — nối / gỡ nối chỉ làm ở
 * trang Sản phẩm trên sàn (sản phẩm sàn nối VÀO Tổng kho), nên hộp này CHỈ XEM, không có đường dẫn nối.
 * Dữ liệu lấy thẳng từ `channelLinks` của dòng — không gọi thêm API khi mở.
 *
 * MÃ CỦA SÀN (mã sản phẩm / mã phân loại + nút sao chép) nằm Ở ĐÂY, cạnh từng gian — không còn
 * dưới tên / mã SKU của sản phẩm kho (anh Trung 05/11: sản phẩm Tổng kho là sản phẩm riêng, mã
 * quản lý của nó là mã SKU kho; lấy mã sàn áp lên nó là không hợp lý).
 */
export function ChannelLinksPopover({
  links,
  available,
  skuCode,
}: {
  links: ChannelLink[];
  /** "Có thể bán" của SKU kho — con số mọi gian đang bật đồng bộ phải giữ. */
  available: number;
  skuCode: string;
}) {
  const groups = new Map<string, ChannelLink[]>();
  for (const l of links) {
    const g = groups.get(l.channelName) ?? [];
    g.push(l);
    groups.set(l.channelName, g);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => ((ORDER.indexOf(a[0]) + 99) % 100) - ((ORDER.indexOf(b[0]) + 99) % 100)
  );
  const skuUpper = skuCode.trim().toUpperCase();

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5 text-left transition-opacity hover:opacity-75"
            title="Bấm để xem từng gian"
          />
        }
      >
        {ordered.map(([channelName, group]) => {
          const meta = CHANNEL_META[channelName as keyof typeof CHANNEL_META];
          const worst = group.reduce(
            (acc, l) => ((RANK[l.state ?? "unknown"] ?? 1) > (RANK[acc] ?? 1) ? (l.state ?? "unknown") : acc),
            "match" as string
          );
          return (
            <span
              key={channelName}
              // Cột chỉ ~94px chữ ở 1280: đệm px-1.5 để "Shopee ×5 ⊗" vừa ô (px-2 tràn 3px, đo 05/11);
              // từ ×10 trở lên tên sàn tự cắt chứ chip không được tràn sang cột Nhập · Xuất.
              className={cn(
                "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium tabular-nums",
                chipTone(worst)
              )}
            >
              <span className="min-w-0 truncate">{meta?.label ?? channelName}</span>
              <span className="shrink-0 opacity-70">×{group.length}</span>
              {worst === "pending" ? (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              ) : worst === "match" ? (
                <CheckCircle2 className="size-3 shrink-0" />
              ) : worst === "mismatch" || worst === "alert" ? (
                <XCircle className="size-3 shrink-0" />
              ) : null}
            </span>
          );
        })}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="border-b px-3 py-2">
          <div className="text-sm font-medium">Đang bán trên {formatNumber(links.length)} gian</div>
          <div className={TEXT_SUB}>
            Kho có thể bán <b className="tabular-nums text-foreground">{formatNumber(available)}</b>, gian bật đồng bộ
            giữ đúng số này.
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {ordered.flatMap(([channelName, group]) =>
            group.map((l, i) => {
              const meta = CHANNEL_META[channelName as keyof typeof CHANNEL_META];
              const st = l.state ?? "unknown";
              const hint = stateHint(st, available);
              const bad = st === "mismatch" || st === "alert";
              const num = st === "pending" ? available : (l.channelStock ?? null);
              const differentSku = l.channelSku.trim().toUpperCase() !== skuUpper;
              return (
                <li
                  key={`${channelName}-${l.shopName}-${l.channelSku}-${i}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1.5"
                >
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta?.className ?? ""}`}
                  >
                    {meta?.label ?? channelName}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm" title={l.shopName}>
                      {l.shopName}
                    </span>
                    {/* Dòng trạng thái được xuống dòng (không cắt): "lệch, kho muốn N · khác mã kho" phải đọc đủ. */}
                    <span className={cn("block text-xs", hint.className)}>
                      {hint.text}
                      {differentSku && (
                        <span
                          className="ml-1.5 text-amber-700"
                          title={`Mã trên sàn: ${l.channelSku}. Đặt cùng mã trên mọi shop thì Hubsell tự khớp, không lo nối nhầm.`}
                        >
                          · khác mã kho
                        </span>
                      )}
                    </span>
                    {(l.itemId || l.modelId) && (
                      <span className="flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted-foreground">
                        {l.itemId && (
                          <span className="flex min-w-0 items-center gap-0.5" title={`Mã sản phẩm trên sàn: ${l.itemId}`}>
                            <span className="min-w-0 select-all truncate">{l.itemId}</span>
                            <CopyIconButton value={l.itemId} what="mã sản phẩm" className="size-4" />
                          </span>
                        )}
                        {l.modelId && (
                          <span className="flex min-w-0 items-center gap-0.5" title={`Mã phân loại trên sàn: ${l.modelId}`}>
                            <span className="min-w-0 select-all truncate">{l.modelId}</span>
                            <CopyIconButton value={l.modelId} what="mã phân loại" className="size-4" />
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      bad ? "text-red-700" : st === "off" ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {num === null ? "?" : formatNumber(num)}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
