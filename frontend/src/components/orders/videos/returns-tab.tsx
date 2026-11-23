"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, FolderOpen, PackageSearch } from "lucide-react";

import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import { Refreshing } from "@/components/shared/refreshing";
import { SortHeader } from "@/components/shared/sort-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchPackVideoReturns,
  type PackVideoReturnCard,
  type PackVideoReturnRow,
  type PackVideoReturnSort,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PACK_VIDEO_RETURN_STATUS_META,
  formatClipDuration,
  packVideoOrderPath,
  returnTypeLabel,
} from "@/lib/pack-video";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ComplaintDueCell, useMinuteClock } from "./complaint-due-cell";
import { ChannelBadge, CodeWithCopy, CursorPager, MetaBadge, shopNameOf, useCursorPages } from "./video-bits";
import { ReturnVideoCards } from "./video-filters";

/** Ô "Video đóng" / "Video khui" của một đơn: có thì ghi thời lượng, chưa có thì nói rõ. */
function VideoPresence({
  video,
  missingLabel,
}: {
  video: { id: string; durationSec: number } | null;
  missingLabel: string;
}) {
  if (!video) {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
        {missingLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums">
      Có · {formatClipDuration(video.durationSec)}
    </span>
  );
}

/**
 * TAB ĐƠN HOÀN — một dòng = một ĐƠN có hoàn (không phải một video), để chuẩn bị bằng
 * chứng khiếu nại: đơn nào đã có video đóng, đơn nào kho báo hỏng mà chưa quay lúc mở kiện.
 * Video khui hàng nằm ngay trong tab này (mỗi video khui luôn thuộc một đơn hoàn).
 *
 * Việc NHẬN HÀNG / NHẬP KHO / BÁO HỎNG không làm ở đây — vẫn ở trang Đối soát đơn hoàn.
 * Ba thẻ số to bấm được = bộ lọc (bấm lại để bỏ), cùng kiểu thẻ lọc của trang đó.
 */
export function ReturnsTab() {
  const [card, setCard] = React.useState<PackVideoReturnCard>("all");
  // null = theo thẻ: thẻ "Sắp hết hạn" sắp theo hạn, còn lại mới báo hoàn trước (máy chủ quyết).
  const [sortPick, setSortPick] = React.useState<PackVideoReturnSort | null>(null);
  const sort: PackVideoReturnSort = sortPick ?? (card === "due_soon" ? "due" : "requested");
  const [pageSize, setPageSize] = React.useState(20);
  const pages = useCursorPages(JSON.stringify([card, sort, pageSize]));
  const nowMs = useMinuteClock();

  const q = useApiQuery({
    queryKey: qk.packVideoReturns({ card, sort, limit: pageSize, cursor: pages.cursor ?? null }),
    queryFn: () => fetchPackVideoReturns({ card, sort, limit: pageSize, cursor: pages.cursor }),
  });
  // Mũi tên cố định một chiều: hạn = gần hết nhất trước, giờ báo hoàn = mới nhất trước.
  const sortState = { key: sort, dir: sort === "due" ? ("asc" as const) : ("desc" as const) };
  const onSort = (s: { key: PackVideoReturnSort }) => setSortPick(s.key);
  const rows: PackVideoReturnRow[] = React.useMemo(() => q.data?.items ?? [], [q.data]);
  const nextCursor = q.data?.nextCursor ?? null;

  return (
    <div className="space-y-5">
      <ReturnVideoCards
        value={card}
        onToggle={(key) => {
          setCard((cur) => (cur === key ? "all" : key));
          setSortPick(null);
        }}
        cards={q.data?.cards ?? {}}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Mỗi dòng là một đơn có hoàn. Mở hồ sơ để xem video đóng và video khui cạnh nhau.
        </p>
        <Link href="/warehouse/returns" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Xử lý ở Đối soát đơn hoàn
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {q.error ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{q.error}</p>
          ) : q.loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải danh sách đơn hoàn…</p>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <PackageSearch className="mx-auto mb-2 size-8" />
              {card === "all" ? "Chưa có đơn hoàn nào." : "Không có đơn hoàn nào khớp thẻ đang chọn."}
            </div>
          ) : (
            <Refreshing active={q.placeholder}>
              <Table containerClassName={PNL_TABLE_SCROLLER} className="min-w-[56rem]">
                <TableHeader className={cn(PNL_STICKY_HEAD, "bg-card")}>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead aria-sort={sort === "due" ? "ascending" : undefined}>
                      <SortHeader
                        label="Hạn khiếu nại"
                        sortKey="due"
                        sort={sortState}
                        onSort={onSort}
                        firstDir="asc"
                        title="Gần hết hạn nhất trước · đã quá hạn xếp sau · chưa có hạn xếp cuối"
                      />
                    </TableHead>
                    <TableHead aria-sort={sort === "requested" ? "descending" : undefined}>
                      <SortHeader
                        label="Sàn báo hoàn"
                        sortKey="requested"
                        sort={sortState}
                        onSort={onSort}
                        title="Mới báo hoàn trước"
                      />
                    </TableHead>
                    <TableHead>Video đóng</TableHead>
                    <TableHead>Video khui</TableHead>
                    <TableHead>Tình trạng kho</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o, index) => {
                    const shop = shopNameOf(o.channelPlatform, o.shopName);
                    return (
                      <TableRow key={o.orderId} className={cn(index % 2 === 1 && "bg-muted/40")}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ChannelBadge platform={o.channelPlatform} />
                            <CodeWithCopy value={o.orderCode} what="mã đơn" strong />
                          </div>
                          {/* Tên gian xuống dòng 2 cạnh mã vận đơn — nhường bề ngang cho cột Hạn khiếu nại (25/11). */}
                          <div className="mt-1 flex items-center gap-2">
                            <CodeWithCopy value={o.trackingCode} what="mã vận đơn" />
                            {shop && (
                              <span className={cn(TEXT_SUB, "max-w-40 truncate")} title={shop}>
                                · {shop}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <ComplaintDueCell due={o.complaintDue} platform={o.channelPlatform} nowMs={nowMs} />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {o.returnRequestedAt ? (
                            formatDateTime(o.returnRequestedAt)
                          ) : (
                            <span className={TEXT_SUB}>Chưa rõ</span>
                          )}
                          {/* Loại hoàn = dòng phụ của mốc báo hoàn (gộp cột cùng chủ đề, 25/11). */}
                          <div className={cn(TEXT_SUB, "mt-0.5")}>{returnTypeLabel(o.returnType)}</div>
                        </TableCell>
                        <TableCell>
                          <VideoPresence video={o.packVideo} missingLabel="Không có" />
                        </TableCell>
                        <TableCell>
                          <VideoPresence video={o.unboxVideo} missingLabel="Chưa quay" />
                        </TableCell>
                        <TableCell>
                          <MetaBadge meta={PACK_VIDEO_RETURN_STATUS_META[o.returnStatus]} />
                        </TableCell>
                        <TableCell className="text-right">
                          {o.packVideo || o.unboxVideo ? (
                            <Link
                              href={packVideoOrderPath(o.orderId)}
                              className={buttonVariants({ variant: "outline", size: "sm" })}
                            >
                              <FolderOpen className="size-3.5" />
                              Mở hồ sơ
                            </Link>
                          ) : (
                            <span className={TEXT_SUB}>—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
          unit="đơn"
        />
      )}
    </div>
  );
}
