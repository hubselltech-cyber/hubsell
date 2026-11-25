"use client";

import * as React from "react";
import { History, Search, X } from "lucide-react";

import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import { Refreshing } from "@/components/shared/refreshing";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchPackVideoDeleted, type PackVideoDeletedRow } from "@/lib/api";
import { deleteReasonLabel, formatVnDate } from "@/lib/pack-video";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { CodeWithCopy, CursorPager, useCursorPages } from "./video-bits";

/**
 * TAB LỊCH SỬ XÓA — video hệ thống đã tự xóa, kèm lý do, để chủ shop (và người hỗ trợ) trả lời được câu
 * "video của đơn này đâu rồi". Anh Trung 25/11/2026: chỉ HAI cột — mã vận đơn và lý do — cùng một ô tìm theo
 * mã vận đơn. Ngày xóa là dòng phụ của lý do, không phải cột thứ ba. Chỉ đọc; video đã xóa không khôi phục được.
 */
export function DeletedTab() {
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [term, setTerm] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const pages = useCursorPages(JSON.stringify([term, pageSize]));

  const q = useApiQuery({
    queryKey: qk.packVideoDeleted({ q: term, limit: pageSize, cursor: pages.cursor ?? null }),
    queryFn: () => fetchPackVideoDeleted({ q: term, limit: pageSize, cursor: pages.cursor }),
  });
  const rows: PackVideoDeletedRow[] = React.useMemo(() => q.data?.items ?? [], [q.data]);
  const nextCursor = q.data?.nextCursor ?? null;

  return (
    <div className="space-y-5">
      <div className="relative w-full sm:w-80">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9 pr-9"
          aria-label="Tìm video đã xóa theo mã vận đơn"
          placeholder="Tìm mã vận đơn…"
          autoComplete="off"
          spellCheck={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Xóa mã đang tìm"
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {q.error ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{q.error}</p>
          ) : q.loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải lịch sử xóa…</p>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <History className="mx-auto mb-2 size-8" />
              {term ? "Không có video đã xóa nào có mã vận đơn này." : "Chưa có video nào bị xóa."}
            </div>
          ) : (
            <Refreshing active={q.placeholder}>
              <Table containerClassName={PNL_TABLE_SCROLLER}>
                <TableHeader className={cn(PNL_STICKY_HEAD, "bg-card")}>
                  <TableRow>
                    <TableHead className="w-80">Mã vận đơn</TableHead>
                    <TableHead>Lý do xóa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((v, index) => (
                    <TableRow key={v.id} className={cn(index % 2 === 1 && "bg-muted/40")}>
                      <TableCell>
                        <CodeWithCopy value={v.trackingCode} what="mã vận đơn" strong />
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <span>{deleteReasonLabel(v.deleteRule, v.kind)}</span>
                        {v.deletedAt && <div className={cn(TEXT_SUB, "mt-0.5 tabular-nums")}>Xóa ngày {formatVnDate(v.deletedAt)}</div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Refreshing>
          )}
        </CardContent>
      </Card>

      {(rows.length > 0 || pages.hasPrev) && (
        <CursorPager
          page={pages.page}
          pageSize={pageSize}
          onPageSize={setPageSize}
          hasPrev={pages.hasPrev}
          hasNext={Boolean(nextCursor)}
          onPrev={pages.prev}
          onNext={() => nextCursor && pages.next(nextCursor)}
          busy={q.loading || q.refreshing}
          unit="video"
        />
      )}
    </div>
  );
}
