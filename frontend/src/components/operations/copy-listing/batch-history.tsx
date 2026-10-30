"use client";

// Tab "Lịch sử": các đợt đã tạo (mỗi gian một chip trạng thái), bấm mở lại.

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Refreshing } from "@/components/shared/refreshing";
import { fetchCopyListingBatches } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { PagerFooter, StatusChip, Thumb } from "./primitives";
import { JOB_STATUS, TARGET_STATUS } from "./shared";

const PAGE_SIZE = 20;

export function BatchHistory({ onOpen }: { onOpen: (batchId: string) => void }) {
  const [page, setPage] = useState(1);
  const q = useApiQuery({ queryKey: qk.copyListingBatches(page), queryFn: () => fetchCopyListingBatches(page, PAGE_SIZE) });
  const data = q.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <CardContent className="p-0">
        <Refreshing active={q.refreshing}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Đợt sao chép</TableHead>
                <TableHead className="w-[32%]">Gian đích</TableHead>
                <TableHead className="w-[14%]">Trạng thái</TableHead>
                <TableHead className="w-[14%] text-right">Thời gian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((b) => (
                <TableRow key={b.id} className="cursor-pointer" onClick={() => onOpen(b.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Thumb src={b.firstImageUrl} alt={b.firstTitle} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-900">
                          {b.firstTitle}
                          {b.productCount > 1 && <span className="text-slate-500"> +{b.productCount - 1} sản phẩm</span>}
                        </div>
                        <div className={TEXT_SUB}>
                          {b.sourceType === "CHANNEL" ? "Từ gian hàng" : b.sourceType === "MANUAL" ? "Tạo mới" : "Từ kho Hubsell"} · {b.productCount} sản phẩm ×{" "}
                          {b.channelCount} gian
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {b.targets.map((t, i) => (
                        <span
                          key={i}
                          className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]", TARGET_STATUS[t.status].className)}
                        >
                          {CHANNEL_META[t.channelName].label} · {t.shopName}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusChip {...JOB_STATUS[b.status]} />
                  </TableCell>
                  <TableCell className={cn("text-right", TEXT_SUB)}>{formatDateTime(b.createdAt)}</TableCell>
                </TableRow>
              ))}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    Chưa có đợt sao chép nào.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Refreshing>
        <div className="border-t border-slate-100 px-5 py-3">
          <PagerFooter page={page} pageCount={pageCount} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </div>
      </CardContent>
    </Card>
  );
}
