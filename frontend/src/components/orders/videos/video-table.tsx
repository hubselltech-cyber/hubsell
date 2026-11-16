"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Download, FolderOpen, Loader2, Play } from "lucide-react";

import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import { SortHeader, type SortState } from "@/components/shared/sort-header";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PackVideoRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PACK_VIDEO_ORDER_STATUS_META,
  PACK_VIDEO_STATUS_META,
  formatClipDuration,
  isPackVideoPlayable,
  packVideoOrderPath,
} from "@/lib/pack-video";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import {
  ChannelBadge,
  CodeWithCopy,
  MetaBadge,
  VideoProductsCell,
  shopNameOf,
} from "./video-bits";
import { downloadPackVideo } from "./video-download";

export type VideoSortKey = "recordedAt" | "duration";

/**
 * BẢNG VIDEO — một dòng = một video (tab Video đóng hàng; tab Thống kê dùng lại cho danh
 * sách video dài nhất với `compact`).
 *
 * Bảng nằm trong hộp cuộn, tiêu đề cột bám đỉnh (khẩu vị bảng số liệu 17/09). Sắp xếp ngay
 * tại tiêu đề cột "Quay lúc" / "Thời lượng" — xếp trong các video ĐANG HIỆN trên trang này
 * (máy chủ trả theo trang, mới nhất trước); danh sách video dài nhất cả kỳ nằm ở tab Thống kê.
 *
 * Chưa có cột "Giữ tới": luật xóa theo trạng thái đơn chưa chạy, không vẽ cột rỗng.
 */
export function VideoTable({
  rows,
  onPlay,
  compact = false,
  initialSort = { key: "recordedAt", dir: "desc" },
}: {
  rows: PackVideoRow[];
  /** Mở hộp xem nhanh một video. */
  onPlay: (video: PackVideoRow) => void;
  /** true = bỏ cột Sản phẩm và không giới hạn chiều cao (bảng ngắn trong tab Thống kê). */
  compact?: boolean;
  /** Chiều xếp lúc mở bảng; mặc định mới quay trước. */
  initialSort?: SortState<VideoSortKey>;
}) {
  const [sort, setSort] = React.useState<SortState<VideoSortKey>>(initialSort);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) =>
      sort.key === "duration"
        ? (a.durationSec - b.durationSec) * sign
        : (new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()) * sign
    );
  }, [rows, sort]);

  async function handleDownload(video: PackVideoRow) {
    setDownloadingId(video.id);
    await downloadPackVideo(video.id);
    setDownloadingId(null);
  }

  return (
    <Table containerClassName={compact ? undefined : PNL_TABLE_SCROLLER} className="min-w-[52rem]">
      <TableHeader className={cn(PNL_STICKY_HEAD, "bg-card")}>
        <TableRow>
          <TableHead className="w-12 pr-0" aria-label="Xem nhanh" />
          <TableHead>Mã vận đơn</TableHead>
          {!compact && <TableHead>Sản phẩm</TableHead>}
          <TableHead aria-sort={sort.key === "recordedAt" ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
            <SortHeader
              label="Quay lúc"
              sortKey="recordedAt"
              sort={sort}
              onSort={setSort}
              title="Xếp các video đang hiện trên trang này theo giờ quay"
            />
          </TableHead>
          <TableHead>Người quay</TableHead>
          <TableHead aria-sort={sort.key === "duration" ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
            <SortHeader
              label="Thời lượng"
              sortKey="duration"
              sort={sort}
              onSort={setSort}
              title="Xếp các video đang hiện trên trang này theo thời lượng — video dài nhất cả kỳ xem ở tab Thống kê"
            />
          </TableHead>
          <TableHead>Đơn</TableHead>
          <TableHead className="text-right">Thao tác</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((v, index) => {
          const playable = isPackVideoPlayable(v.status);
          const shop = shopNameOf(v.channelPlatform, v.shopName);
          return (
            <TableRow key={v.id} className={cn(index % 2 === 1 && "bg-muted/40")}>
              <TableCell className="w-12 pr-0">
                <button
                  type="button"
                  disabled={!playable}
                  onClick={() => onPlay(v)}
                  aria-label={`Xem nhanh video ${v.trackingCode}`}
                  title={playable ? "Xem nhanh" : (PACK_VIDEO_STATUS_META[v.status]?.label ?? "Chưa xem được")}
                  className="flex size-8 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-muted disabled:hover:text-foreground"
                >
                  <Play className="size-4 translate-x-px" />
                </button>
              </TableCell>

              <TableCell>
                <CodeWithCopy value={v.trackingCode} what="mã vận đơn" strong />
                <div className="mt-1 flex items-center gap-1.5">
                  {v.orderId ? (
                    <>
                      <ChannelBadge platform={v.channelPlatform} />
                      <span className={cn(TEXT_SUB, "font-mono")}>{v.orderCode}</span>
                      {shop && <span className={cn(TEXT_SUB, "max-w-20 truncate 2xl:max-w-28")} title={shop}>· {shop}</span>}
                    </>
                  ) : (
                    <span className={cn(TEXT_SUB, "text-amber-700")}>Chưa khớp đơn</span>
                  )}
                </div>
              </TableCell>

              {!compact && (
                <TableCell className="w-44 max-w-44 whitespace-normal 2xl:w-56 2xl:max-w-56">
                  <VideoProductsCell items={v.order?.items ?? []} />
                </TableCell>
              )}

              <TableCell className="tabular-nums">{formatDateTime(v.recordedAt)}</TableCell>

              {/* Cột riêng (anh Trung 16/11: "thêm cột người quay để seller dễ thống kê"). */}
              <TableCell>
                <p className="max-w-28 truncate 2xl:max-w-40" title={v.recordedByName ?? undefined}>
                  {v.recordedByName ?? "—"}
                </p>
                {v.deviceName && (
                  <p className={cn(TEXT_SUB, "max-w-28 truncate 2xl:max-w-40")} title={v.deviceName}>
                    {v.deviceName}
                  </p>
                )}
              </TableCell>

              <TableCell>
                <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                  {formatClipDuration(v.durationSec)}
                  {v.durationFlag && (
                    <span
                      className="text-amber-600"
                      title={"Thời lượng app báo lệch so với cỡ tệp thật.\n• Hệ thống mới chỉ gắn cờ, chưa trừ giờ.\n• Mở video xem thử để kiểm tra."}
                    >
                      <AlertTriangle className="size-3.5" aria-label="Thời lượng cần kiểm tra" />
                    </span>
                  )}
                </span>
              </TableCell>

              <TableCell>
                {v.order ? (
                  <div className="flex flex-col items-start gap-1">
                    <MetaBadge meta={PACK_VIDEO_ORDER_STATUS_META[v.order.shippingStatus]} />
                    {v.order.hasReturn && (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        Có hoàn
                      </span>
                    )}
                  </div>
                ) : (
                  !PACK_VIDEO_STATUS_META[v.status] && <span className={TEXT_SUB}>—</span>
                )}
                <MetaBadgeLine video={v} />
              </TableCell>

              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  {v.orderId && (
                    <Link
                      href={packVideoOrderPath(v.orderId)}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      title="Mở hồ sơ video của đơn này"
                      aria-label={`Mở hồ sơ video của đơn ${v.orderCode ?? v.trackingCode}`}
                    >
                      <FolderOpen className="size-3.5" />
                      <span className="hidden 2xl:inline">Hồ sơ</span>
                    </Link>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!playable || downloadingId === v.id}
                    onClick={() => void handleDownload(v)}
                    title="Tải video về máy"
                    aria-label={`Tải video ${v.trackingCode} về máy`}
                  >
                    {downloadingId === v.id ? (
                      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    <span className="hidden 2xl:inline">Tải về</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Dòng nhãn dưới thời lượng khi tệp chưa ở trạng thái bình thường (chưa tải lên / đã xóa / mất). */
function MetaBadgeLine({ video }: { video: PackVideoRow }) {
  const meta = PACK_VIDEO_STATUS_META[video.status];
  if (!meta) return null;
  return (
    <div className="mt-1">
      <MetaBadge meta={meta} />
    </div>
  );
}
