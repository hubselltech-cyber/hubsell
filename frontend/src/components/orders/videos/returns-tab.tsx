"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, FolderOpen, PackageSearch, Search, X } from "lucide-react";

import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import { ComplaintDueCell, useMinuteClock } from "@/components/shared/complaint-due-cell";
import { Refreshing } from "@/components/shared/refreshing";
import { SortHeader } from "@/components/shared/sort-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

import { ChannelBadge, CodeWithCopy, CursorPager, MetaBadge, shopNameOf, useCursorPages } from "./video-bits";
import { ReturnVideoCards } from "./video-filters";

/** "02:10 22/11" — bỏ năm khi là năm nay (cột hẹp lại); năm khác thì giữ đủ. */
function shortDateTime(iso: string): string {
  return formatDateTime(iso).replace(`/${new Date().getFullYear()}`, "");
}

/** Một dòng của ô Video: "Đóng · 0:51" (có) / "Khui · chưa quay" (chưa có). */
function VideoPresence({
  kind,
  video,
  missingLabel,
}: {
  kind: string;
  video: { id: string; durationSec: number } | null;
  missingLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        video ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-50 text-zinc-600"
      )}
    >
      {kind} · {video ? formatClipDuration(video.durationSec) : missingLabel}
    </span>
  );
}

/** Tình trạng kho: huy hiệu = phần chính, phần sau dấu "·" xuống dòng phụ (cột hẹp lại, bảng vừa 1366). */
function StockStatus({ meta }: { meta: { label: string; className: string } | undefined }) {
  if (!meta) return null;
  const [main, ...rest] = meta.label.split(" · ");
  return (
    <>
      <MetaBadge meta={{ label: main, className: meta.className }} title={meta.label} />
      {rest.length > 0 && <div className={cn(TEXT_SUB, "mt-1 whitespace-nowrap")}>{rest.join(" · ")}</div>}
    </>
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
  // Mặc định sắp theo HẠN (25/11/2026): đơn sắp hết hạn lên đầu → đã quá hạn (vừa quá hạn trước) → chưa có
  // hạn (mới báo hoàn trước). Shop không có đơn nào có hạn thì thứ tự y như "mới báo hoàn trước".
  const [sort, setSort] = React.useState<PackVideoReturnSort>("due");
  const [pageSize, setPageSize] = React.useState(20);
  // Ô tìm: gõ xong ~300 ms mới hỏi máy chủ.
  const [search, setSearch] = React.useState("");
  const [term, setTerm] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const pages = useCursorPages(JSON.stringify([card, sort, pageSize, term]));
  const nowMs = useMinuteClock();

  const q = useApiQuery({
    queryKey: qk.packVideoReturns({ card, sort, q: term, limit: pageSize, cursor: pages.cursor ?? null }),
    queryFn: () => fetchPackVideoReturns({ card, sort, q: term, limit: pageSize, cursor: pages.cursor }),
  });
  // Mũi tên cố định một chiều: hạn = gần hết nhất trước, giờ báo hoàn = mới nhất trước.
  const sortState = { key: sort, dir: sort === "due" ? ("asc" as const) : ("desc" as const) };
  const onSort = (s: { key: PackVideoReturnSort }) => setSort(s.key);
  const rows: PackVideoReturnRow[] = React.useMemo(() => q.data?.items ?? [], [q.data]);
  const nextCursor = q.data?.nextCursor ?? null;

  return (
    <div className="space-y-5">
      <ReturnVideoCards
        value={card}
        onToggle={(key) => setCard((cur) => (cur === key ? "all" : key))}
        cards={q.data?.cards ?? {}}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 pr-9"
            aria-label="Tìm đơn hoàn theo mã đơn hoặc mã vận đơn"
            placeholder="Tìm mã đơn, mã vận đơn…"
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
              {term
                ? "Không có đơn hoàn nào khớp mã đang tìm."
                : card === "all"
                  ? "Chưa có đơn hoàn nào."
                  : "Không có đơn hoàn nào khớp thẻ đang chọn."}
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
                    <TableHead>Video</TableHead>
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
                              <span className={cn(TEXT_SUB, "max-w-[5.5rem] truncate")} title={shop}>
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
                            shortDateTime(o.returnRequestedAt)
                          ) : (
                            <span className={TEXT_SUB}>Chưa rõ</span>
                          )}
                          {/* Loại hoàn = dòng phụ của mốc báo hoàn (gộp cột cùng chủ đề, 25/11). */}
                          <div className={cn(TEXT_SUB, "mt-0.5")}>{returnTypeLabel(o.returnType)}</div>
                        </TableCell>
                        <TableCell>
                          {/* Video đóng + video khui gộp một cột (25/11/2026) — cùng chủ đề, bảng bớt một cột. */}
                          <div className="flex flex-col items-start gap-1">
                            <VideoPresence kind="Đóng" video={o.packVideo} missingLabel="không có" />
                            <VideoPresence kind="Khui" video={o.unboxVideo} missingLabel="chưa quay" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <StockStatus meta={PACK_VIDEO_RETURN_STATUS_META[o.returnStatus]} />
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
