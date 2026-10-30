"use client";

// ============================================================
// BƯỚC 2: tick gian đích — lọc theo sàn (Segmented) + tìm tên gian khi > 5 gian,
// "Chọn tất cả gian đang hiện". Khách nhiều gian không phải dò cả danh sách.
// ============================================================

import { useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { ChannelName, CopyListingChannel } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { ChannelChip } from "./primitives";

export function TargetPicker({
  channels,
  platformsPresent,
  targets,
  onChange,
}: {
  /** Gian đích khả dụng (đã loại gian nguồn). */
  channels: CopyListingChannel[];
  platformsPresent: ChannelName[];
  targets: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [platform, setPlatform] = useState<ChannelName | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const shown = channels.filter((c) => (platform === "ALL" || c.channelName === platform) && (!q || c.shopName.toLowerCase().includes(q)));
  const allShownTargeted = shown.length > 0 && shown.every((c) => targets.has(c.id));

  function toggle(id: string) {
    const next = new Set(targets);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleShown() {
    const next = new Set(targets);
    if (allShownTargeted) shown.forEach((c) => next.delete(c.id));
    else shown.forEach((c) => next.add(c.id));
    onChange(next);
  }

  const items = (["ALL", ...platformsPresent] as const)
    .map((p) => ({ key: p, n: p === "ALL" ? channels.length : channels.filter((c) => c.channelName === p).length }))
    .filter((x) => x.n > 0)
    .map((x) => ({ key: x.key, label: `${x.key === "ALL" ? "Tất cả" : CHANNEL_META[x.key].label} (${x.n})` }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<ChannelName | "ALL"> ariaLabel="Lọc gian đích theo sàn" value={platform} onChange={setPlatform} items={items} />
        {channels.length > 5 && (
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-8" placeholder="Tìm tên gian" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        <label className="flex cursor-pointer items-center gap-3 bg-slate-50/60 px-4 py-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            aria-label="Chọn tất cả gian đang hiện"
            checked={allShownTargeted}
            disabled={shown.length === 0}
            onChange={toggleShown}
          />
          <span className={cn(TEXT_TABLE_HEAD, "tabular-nums")}>Chọn tất cả {shown.length} gian đang hiện</span>
        </label>
        {shown.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">Không có gian nào khớp.</p>}
        {shown.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
            <input type="checkbox" className="size-4 accent-primary" checked={targets.has(c.id)} onChange={() => toggle(c.id)} />
            <ChannelChip channelName={c.channelName} />
            <span className="text-sm text-slate-900">{c.shopName}</span>
            <span className={cn(TEXT_SUB, "ml-auto tabular-nums")}>
              {formatNumber(c.productCount)} SP đang có{c.apiConnected ? "" : " · gian giả lập"}
            </span>
          </label>
        ))}
      </div>
    </>
  );
}
