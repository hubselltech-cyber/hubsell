"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Smartphone, Video } from "lucide-react";

import {
  ALL_CHANNELS,
  ChannelFilter,
  type ChannelFilterValue,
} from "@/components/shared/channel-filter";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchChannels,
  fetchPackVideoSummary,
  fetchPackVideos,
  type PackVideoChip,
  type PackVideoListParams,
  type PackVideoRow,
} from "@/lib/api";
import { rangeToQuery, type DateRange } from "@/lib/date-range";
import { PACK_VIDEOS_PATH, packVideoOrderPath } from "@/lib/pack-video";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";

import { CursorPager, useCursorPages } from "./video-bits";
import { VideoChips } from "./video-filters";
import { QuickViewDialog } from "./video-quick-view";
import { VideoSearchBox } from "./video-search-box";
import { VideoTable } from "./video-table";

/** Trễ nhịp ô tìm — cùng mức trang Đơn hàng. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * Bộ lọc sàn / gian của trang → danh sách id gian mà API video nhận. Dùng chung ô cache
 * danh sách gian với ChannelFilter (không gọi thêm). Đang chọn "mọi gian của một sàn" thì
 * đổi thành id các gian thuộc sàn đó.
 */
function useChannelIds(filter: ChannelFilterValue): string[] {
  const { data } = useQuery({
    queryKey: qk.channels(),
    queryFn: () => fetchChannels(),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: Boolean(filter.channelName) && !filter.channelId,
  });
  return React.useMemo(() => {
    if (filter.channelId) return [filter.channelId];
    if (!filter.channelName) return [];
    return (data ?? []).filter((c) => c.channelName === filter.channelName).map((c) => c.id);
  }, [filter, data]);
}

/**
 * TAB VIDEO ĐÓNG HÀNG — một dòng = một video, mới nhất trên cùng.
 *
 * BỐ CỤC (bám bố cục anh Trung chốt cho Đối soát đơn hoàn 13/11/2026): ô tìm gọn bên trái
 * + lọc ngày quay bên phải → hàng chip có số đếm (trái) + lọc gian (phải) → bảng → chuyển trang.
 * Mặc định "Toàn bộ thời gian", không lọc gì: shop mở trang là thấy ngay video mới quay.
 */
export function VideosTab() {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");
  const [range, setRange] = React.useState<DateRange | null>(null);
  const [channelFilter, setChannelFilter] = React.useState<ChannelFilterValue>(ALL_CHANNELS);
  const [chip, setChip] = React.useState<PackVideoChip>("all");
  const [pageSize, setPageSize] = React.useState(20);
  const [viewing, setViewing] = React.useState<PackVideoRow | null>(null);
  /** Mã vừa được Enter / máy quét bắn vào — ra đúng một đơn thì mở thẳng hồ sơ. */
  const [jumpFor, setJumpFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const channelIds = useChannelIds(channelFilter);
  const baseParams: PackVideoListParams = {
    kind: "PACK",
    range,
    channelIds,
    q: q || undefined,
  };
  const baseKey = {
    kind: "PACK",
    range: rangeToQuery(range ?? undefined),
    channelIds,
    q,
  };
  const pages = useCursorPages(JSON.stringify([baseKey, chip, pageSize]));

  const listQ = useApiQuery({
    queryKey: qk.packVideos({ ...baseKey, chip, limit: pageSize, cursor: pages.cursor ?? null }),
    queryFn: () => fetchPackVideos({ ...baseParams, chip, limit: pageSize, cursor: pages.cursor }),
  });
  const summaryQ = useApiQuery({
    queryKey: qk.packVideoSummary(baseKey),
    queryFn: () => fetchPackVideoSummary(baseParams),
  });

  const rows = React.useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const nextCursor = listQ.data?.nextCursor ?? null;
  const busy = listQ.loading || listQ.refreshing;

  // Mã bắn vào ra đúng MỘT đơn (mọi video trên trang thuộc cùng một đơn, không còn trang
  // sau) → mở thẳng hồ sơ đơn đó. Chỉ xét khi danh sách của đúng mã ấy đã về.
  React.useEffect(() => {
    if (!jumpFor || jumpFor !== q || listQ.refreshing || listQ.placeholder || !listQ.data) return;
    setJumpFor(null);
    if (listQ.data.nextCursor) return;
    const orderIds = new Set(listQ.data.items.map((v) => v.orderId));
    const only = orderIds.size === 1 ? [...orderIds][0] : null;
    if (only) router.push(packVideoOrderPath(only));
  }, [jumpFor, q, listQ.refreshing, listQ.placeholder, listQ.data, router]);

  const isFiltering =
    Boolean(q) || chip !== "all" || range !== null || Boolean(channelFilter.channelName);

  return (
    <div className="space-y-5">
      {/* ===== Ô TÌM (trái) + LỌC NGÀY QUAY (phải) ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <VideoSearchBox
          value={search}
          onChange={setSearch}
          onSubmit={(code) => {
            setQ(code);
            setJumpFor(code);
          }}
        />
        <div className="sm:ml-auto">
          <DateRangePicker allowAll value={range} onChange={setRange} />
        </div>
      </div>

      {/* ===== CHIP MỘT CHẠM (trái) + LỌC GIAN (phải) ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <VideoChips value={chip} onChange={setChip} counts={summaryQ.data ?? {}} />
        <div className="ml-auto">
          <ChannelFilter value={channelFilter} onChange={setChannelFilter} />
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {listQ.error ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{listQ.error}</p>
          ) : listQ.loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải danh sách video…</p>
          ) : rows.length === 0 ? (
            isFiltering ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Video className="mx-auto mb-2 size-8" />
                Không có video nào khớp bộ lọc.
              </div>
            ) : (
              <FirstVideoGuide />
            )
          ) : (
            <Refreshing active={listQ.placeholder}>
              <VideoTable rows={rows} onPlay={setViewing} />
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
          busy={busy}
          unit="video"
        />
      )}

      <QuickViewDialog video={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

/**
 * Màn trống của shop chưa quay video nào: hai lối bắt đầu — webcam trên máy tính (một nút, vào thẳng màn quay)
 * và app điện thoại. Anh Trung 18/11: mọi video, webcam hay điện thoại, đều lên hệ thống → cả hai cùng hiện ở đây.
 */
function FirstVideoGuide() {
  return (
    <div className="flex flex-col items-center gap-5 px-4 py-12 text-center">
      <p className="max-w-lg text-sm text-foreground">
        Chưa có video nào. Quay xong là video tự lưu lên hệ thống và hiện ở đây, tìm lại được bằng mã vận đơn.
      </p>
      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        <StartOption
          icon={Video}
          title="Webcam trên máy tính"
          detail="Giơ tem vào camera là tự quay, đưa tem kế là tự cắt sang video mới."
          action={
            <Link href={`${PACK_VIDEOS_PATH}/record`} className={buttonVariants({ size: "sm" })}>
              <Video className="size-4" />
              Quay video
            </Link>
          }
        />
        <StartOption
          icon={Smartphone}
          title="App Hubsell trên điện thoại"
          detail="Tab Tổng quan → ô Quay video đóng gói."
        />
      </div>
    </div>
  );
}

function StartOption({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: typeof Video;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-background p-4">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
