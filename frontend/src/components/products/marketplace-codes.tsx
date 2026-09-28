"use client";

import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { CHANNEL_META } from "@/lib/channel-meta";
import type { Product } from "@/lib/api";

/**
 * MÃ TRÊN SÀN dưới mã SKU / tên sản phẩm ở bảng Hàng hóa (anh Trung 28/09):
 * `kind="item"` = mã sản phẩm sàn (dưới TÊN), `kind="model"` = mã phân loại
 * (dưới MÃ SKU) — cùng chỗ đặt với bảng Giá vốn. Dãy số dài luôn hiện kèm nút
 * sao chép một chạm. Một SKU kho nối nhiều gian → mỗi mã một dòng, mã trùng
 * (cùng sản phẩm bán ở 2 gian cùng sàn) chỉ in một lần; tooltip ghi gian nào.
 */
export function MarketplaceCodes({
  links,
  kind,
}: {
  links: Product["channelLinks"];
  kind: "item" | "model";
}) {
  const what = kind === "item" ? "Mã sản phẩm" : "Mã phân loại";
  const byCode = new Map<string, string[]>();
  for (const l of links ?? []) {
    const code = kind === "item" ? l.itemId : l.modelId;
    if (!code) continue;
    const shop = `${CHANNEL_META[l.channelName]?.label ?? l.channelName} · ${l.shopName}`;
    const shops = byCode.get(code);
    if (shops) shops.push(shop);
    else byCode.set(code, [shop]);
  }
  if (byCode.size === 0) return null;

  return (
    <>
      {[...byCode.entries()].map(([code, shops]) => (
        <span
          key={code}
          className="flex max-w-full items-center gap-1 font-mono text-[11px] text-muted-foreground"
          title={`${what} trên sàn: ${code}\n${shops.join("\n")}`}
        >
          <span className="min-w-0 select-all truncate">{code}</span>
          <CopyIconButton value={code} what={what.toLowerCase()} className="size-4" />
        </span>
      ))}
    </>
  );
}
