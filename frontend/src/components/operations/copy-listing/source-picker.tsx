"use client";

// ============================================================
// BƯỚC 1 (nguồn gian đã nối / kho Hubsell): chọn sàn → gian, tìm, bảng tick sản phẩm
// có phân trang, nút "Lấy sản phẩm mới từ sàn". Sản phẩm đã tick giữ qua các trang /
// lần tìm (Map ở new-copy-step.tsx). Remount theo key=sourceType để reset tìm / trang.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Refreshing } from "@/components/shared/refreshing";
import { apiErrorMessage, fetchCopyListingSources, syncCopyListingSources, type ChannelName, type CopyListingChannel, type CopyListingSource } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ACTION_GREEN, PagerFooter, Thumb } from "./primitives";

export function SourcePicker({
  sourceType,
  channels,
  platformsPresent,
  sourcePlatform,
  sourceChannelId,
  onPlatformChange,
  onPickChannel,
  picked,
  onPickedChange,
}: {
  sourceType: "CHANNEL" | "PRODUCT";
  channels: CopyListingChannel[];
  platformsPresent: ChannelName[];
  sourcePlatform: ChannelName | "";
  sourceChannelId: string;
  onPlatformChange: (p: ChannelName | "") => void;
  onPickChannel: (id: string) => void;
  picked: Map<string, CopyListingSource>;
  onPickedChange: (next: Map<string, CopyListingSource>) => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  /** Số sản phẩm mỗi trang — khẩu vị bảng chuẩn: chọn được 10/20/50/100. */
  const [pageSize, setPageSize] = useState(20);
  const [syncing, setSyncing] = useState(false);
  const invalidate = useInvalidate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Đổi gian nguồn → về trang 1.
  useEffect(() => setPage(1), [sourceChannelId]);

  const sourceChoices = channels.filter((c) => !sourcePlatform || c.channelName === sourcePlatform);

  const params = {
    type: sourceType === "CHANNEL" ? ("channel" as const) : ("product" as const),
    channelId: sourceType === "CHANNEL" ? sourceChannelId : undefined,
    search: debounced,
    page,
    pageSize,
  };
  const sourcesQ = useApiQuery({
    queryKey: qk.copyListingSources(params),
    queryFn: () => fetchCopyListingSources(params),
    enabled: sourceType === "PRODUCT" || Boolean(sourceChannelId),
  });
  const pageCount = sourcesQ.data ? Math.max(1, Math.ceil(sourcesQ.data.total / sourcesQ.data.pageSize)) : 1;
  const pageItems = sourcesQ.data?.items ?? [];
  const allOnPagePicked = pageItems.length > 0 && pageItems.every((s) => picked.has(s.key));

  function togglePick(s: CopyListingSource) {
    const next = new Map(picked);
    if (next.has(s.key)) next.delete(s.key);
    else next.set(s.key, s);
    onPickedChange(next);
  }

  function togglePage() {
    const next = new Map(picked);
    if (allOnPagePicked) pageItems.forEach((s) => next.delete(s.key));
    else pageItems.forEach((s) => next.set(s.key, s));
    onPickedChange(next);
  }

  /** Kéo danh mục gian nguồn về ngay rồi nạp lại bảng (sản phẩm vừa đăng trên sàn). */
  async function syncSourceChannel() {
    if (!sourceChannelId) return;
    setSyncing(true);
    try {
      const r = await syncCopyListingSources(sourceChannelId);
      await invalidate(qk.copyListingChannels(), qk.copyListingSourcesAll());
      if (r.skipped) toast.info("Gian này vừa được kéo chưa tới 2 phút — danh sách đã là mới nhất.");
      else toast.success(`Đã lấy từ sàn: ${formatNumber(r.scanned)} sản phẩm, ${formatNumber(r.created)} mới, ${formatNumber(r.updated)} cập nhật.`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {sourceType === "CHANNEL" && (
          <>
            <NativeSelect
              className="w-40"
              aria-label="Chọn sàn nguồn"
              value={sourcePlatform}
              onChange={(e) => {
                const p = e.target.value as ChannelName | "";
                onPlatformChange(p);
                const first =
                  channels.find((c) => (!p || c.channelName === p) && c.id === sourceChannelId) ?? channels.find((c) => !p || c.channelName === p);
                if (first && first.id !== sourceChannelId) onPickChannel(first.id);
              }}
            >
              <option value="">Mọi sàn</option>
              {platformsPresent.map((p) => (
                <option key={p} value={p}>
                  {CHANNEL_META[p].label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="w-72" aria-label="Chọn gian nguồn" value={sourceChannelId} onChange={(e) => onPickChannel(e.target.value)}>
              {sourceChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {sourcePlatform ? "" : `${CHANNEL_META[c.channelName].label} · `}
                  {c.shopName} ({formatNumber(c.productCount)} SP)
                </option>
              ))}
            </NativeSelect>
          </>
        )}
        <div className="relative w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-8"
            placeholder="Tìm theo tên hoặc mã SKU"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {sourceType === "CHANNEL" && (
          /* Danh mục gian chỉ tự làm mới mỗi đêm → sản phẩm vừa đăng trên sàn phải bấm mới có (anh hỏi 30/10).
             Anh chốt 30/10 chiều: nút sang bên phải, màu xanh. */
          <Button
            className={cn("ml-auto", ACTION_GREEN)}
            disabled={!sourceChannelId || syncing}
            title="Sản phẩm mới đăng trên sàn tự về Hubsell mỗi đêm (3–5 giờ sáng). Vừa đăng xong thì bấm để lấy ngay."
            onClick={syncSourceChannel}
          >
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            {syncing ? "Đang lấy…" : "Lấy sản phẩm mới từ sàn"}
          </Button>
        )}
      </div>

      <Refreshing active={sourcesQ.refreshing}>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[4%]">
                  <input type="checkbox" className="size-4 accent-primary" aria-label="Chọn tất cả sản phẩm trên trang" checked={allOnPagePicked} onChange={togglePage} />
                </TableHead>
                <TableHead className="w-[56%]">Sản phẩm</TableHead>
                <TableHead className="w-[12%] text-right">Phân loại</TableHead>
                <TableHead className="w-[28%] text-right">Giá</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((s) => {
                const active = picked.has(s.key);
                return (
                  <TableRow key={s.key} className={cn("cursor-pointer", active && "bg-slate-50")} onClick={() => togglePick(s)}>
                    <TableCell>
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded border",
                          active ? "border-primary bg-primary text-primary-foreground" : "border-slate-300"
                        )}
                      >
                        {active && <Check className="size-3" />}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Thumb src={s.imageUrl} alt={s.title} />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-slate-900">{s.title}</div>
                          <div className={cn(TEXT_SUB, "flex items-center gap-1 truncate")}>
                            <span className="truncate">{s.skus.slice(0, 3).join(" · ")}</span>
                            {s.skus.length > 3 && <span>+{s.skus.length - 3}</span>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.variantCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.minPrice === s.maxPrice ? (
                        <Money value={s.minPrice} />
                      ) : (
                        <span>
                          <Money value={s.minPrice} /> – <Money value={s.maxPrice} />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {sourcesQ.data && pageItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    Không có sản phẩm nào khớp.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Refreshing>
      <PagerFooter
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        total={sourcesQ.data?.total ?? 0}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </>
  );
}
