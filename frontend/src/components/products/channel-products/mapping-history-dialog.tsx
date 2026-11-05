"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchMappingLogs, type MappingLogEntry } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const ACTION_META: Record<MappingLogEntry["action"], { label: string; className: string }> = {
  LINK: { label: "Nối", className: "bg-emerald-50 text-emerald-700" },
  CREATE: { label: "Tạo SKU + nối", className: "bg-sky-50 text-sky-700" },
  UNLINK: { label: "Gỡ nối", className: "bg-rose-50 text-rose-700" },
  IGNORE: { label: "Bỏ qua", className: "bg-slate-100 text-slate-700" },
  UNIGNORE: { label: "Bỏ cờ bỏ qua", className: "bg-slate-100 text-slate-700" },
};
const SOURCE_LABEL: Record<string, string> = { manual: "tay", auto: "tự khớp", batch: "theo lô", order: "trên đơn", "quick-link": "nối nhanh" };

/** LỊCH SỬ LIÊN KẾT (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md mục 6.5) — ai nối / gỡ gì, lúc nào, từ đâu. */
export function MappingHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [page, setPage] = useState(1);
  const q = useApiQuery({ queryKey: qk.mappingLogs({ page }), queryFn: () => fetchMappingLogs({ page, pageSize: 50 }), enabled: open });
  const rows = q.data?.items ?? [];
  const pageCount = q.data?.pageCount ?? 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            Lịch sử liên kết
          </DialogTitle>
          <DialogDescription>Mọi lần nối, gỡ, tạo SKU từ sàn, bỏ qua — ghi từ 05/11/2026.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border">
          {q.loading ? (
            <p className={cn(TEXT_SUB, "px-3 py-6 text-center")}>Đang tải…</p>
          ) : rows.length === 0 ? (
            <p className={cn(TEXT_SUB, "px-3 py-6 text-center")}>Chưa có thao tác nào được ghi.</p>
          ) : (
            <table className="w-full table-fixed text-sm">
              <tbody>
                {rows.map((r) => {
                  const meta = ACTION_META[r.action] ?? ACTION_META.LINK;
                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="w-32 px-3 py-2 align-top text-xs text-muted-foreground tabular-nums">{formatDateTime(r.createdAt)}</td>
                      <td className="w-28 px-2 py-2 align-top">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", meta.className)}>{meta.label}</span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="truncate font-mono text-xs">
                          {r.channelSku ?? "—"}
                          {r.productSku ? <span className="text-muted-foreground"> → </span> : null}
                          {r.productSku ?? ""}
                        </div>
                        <div className={cn(TEXT_SUB, "truncate")}>
                          {r.channelName ? `${CHANNEL_META[r.channelName].label} · ` : ""}
                          {r.shopName ?? ""}
                          {r.source ? ` · ${SOURCE_LABEL[r.source] ?? r.source}` : ""}
                        </div>
                      </td>
                      <td className="w-32 px-3 py-2 align-top text-xs text-muted-foreground">{r.actorName ?? "hệ thống"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {rows.length > 0 && (
          <div className="flex items-center justify-between">
            <span className={cn(TEXT_SUB, "tabular-nums")}>
              {formatNumber(q.data?.total ?? 0)} dòng · trang {page}/{pageCount}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-4" /> Trước
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Sau <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
