"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Video } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchPackVideosByOrder, type PackVideoOrderDossier, type PackVideoRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PACK_VIDEOS_PATH,
  PACK_VIDEO_KIND_LABEL,
  PACK_VIDEO_ORDER_STATUS_META,
  PACK_VIDEO_RETURN_STATUS_META,
  evidenceUploadHint,
  formatClipDuration,
  formatFileSize,
  isPackVideoPlayable,
} from "@/lib/pack-video";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ChannelBadge, CodeWithCopy, MetaBadge, VideoProductsCell, shopNameOf } from "./video-bits";
import { downloadPackVideo } from "./video-download";
import { VideoPlayer } from "./video-player";

/** Video đóng trước, video khui sau; cùng loại thì quay trước đứng trước. */
function orderVideos(videos: PackVideoRow[]): PackVideoRow[] {
  return [...videos].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "PACK" ? -1 : 1;
    return new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime();
  });
}

/** Một video trong hồ sơ: trình phát + dòng mô tả + nhãn cách nộp + nút tải về. */
function DossierVideo({ video }: { video: PackVideoRow }) {
  const [downloading, setDownloading] = React.useState(false);
  const playable = isPackVideoPlayable(video.status);
  const hint = evidenceUploadHint(video.durationSec);
  return (
    <div className="min-w-0 space-y-2.5">
      <VideoPlayer video={video} />
      <div>
        <p className="text-sm font-medium text-slate-900">
          {PACK_VIDEO_KIND_LABEL[video.kind]} · <span className="tabular-nums">{formatClipDuration(video.durationSec)}</span>
        </p>
        <p className={cn(TEXT_SUB, "mt-0.5")}>
          Quay {formatDateTime(video.recordedAt)}
          {video.recordedByName ? ` · ${video.recordedByName}` : ""}
          {video.deviceName ? ` · ${video.deviceName}` : ""}
          {` · ${formatFileSize(video.sizeBytes)}`}
        </p>
      </div>
      {playable && (
        <>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
              hint.direct
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
          >
            {hint.label}
          </span>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                await downloadPackVideo(video.id);
                setDownloading(false);
              }}
            >
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Download className="size-3.5" />
              )}
              Tải {PACK_VIDEO_KIND_LABEL[video.kind].toLowerCase()} về
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Milestone({ label, at }: { label: string; at: string | null }) {
  if (!at) return null;
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right tabular-nums text-slate-900">{formatDateTime(at)}</dd>
    </div>
  );
}

/** Cột thông tin đơn bên phải: mã, gian, trạng thái, các mốc, sản phẩm. */
function OrderPanel({ data }: { data: PackVideoOrderDossier }) {
  const { order, videos } = data;
  const shop = shopNameOf(order.channelPlatform, order.shopName);
  const firstPack = videos.find((v) => v.kind === "PACK");
  const firstUnbox = videos.find((v) => v.kind === "UNBOX");
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-4 py-5">
        <div className="space-y-1.5">
          <p className={TEXT_SUB}>Mã vận đơn</p>
          <CodeWithCopy value={order.trackingCode} what="mã vận đơn" strong />
        </div>
        <div className="space-y-1.5">
          <p className={TEXT_SUB}>Đơn hàng</p>
          <div className="flex flex-wrap items-center gap-2">
            <ChannelBadge platform={order.channelPlatform} />
            <CodeWithCopy value={order.orderCode} what="mã đơn" strong />
          </div>
          {shop && <p className={TEXT_SUB}>{shop}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <MetaBadge meta={PACK_VIDEO_ORDER_STATUS_META[order.shippingStatus]} />
          <MetaBadge meta={PACK_VIDEO_RETURN_STATUS_META[order.returnStatus]} />
        </div>

        <dl className="space-y-1.5 border-t pt-4 text-sm">
          <Milestone label="Quay lúc đóng" at={firstPack?.recordedAt ?? null} />
          <Milestone label="Giao thành công" at={order.deliveredAt} />
          <Milestone label="Sàn báo hoàn" at={order.returnRequestedAt} />
          <Milestone label="Kho nhận kiện" at={order.returnedAt} />
          <Milestone label="Quay lúc khui" at={firstUnbox?.recordedAt ?? null} />
        </dl>

        <div className="space-y-2 border-t pt-4">
          <p className={TEXT_SUB}>Sản phẩm của đơn</p>
          <VideoProductsCell items={order.items} expanded />
        </div>

        {order.returnStatus !== "NONE" && (
          <Link href="/warehouse/returns" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}>
            Xử lý ở Đối soát đơn hoàn
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * HỒ SƠ VIDEO CỦA MỘT ĐƠN — nơi dòng Đơn hàng, dòng Đối soát đơn hoàn và bảng video cùng
 * trỏ tới (trang riêng, gửi được đường dẫn; không phải hộp thoại).
 *
 * Đơn có cả video đóng lẫn video khui thì hai trình phát đứng CẠNH NHAU để đối chiếu lúc
 * gói với lúc mở kiện. Video không bị cắt hay chỉnh sửa — sàn đòi bằng chứng liền một đoạn.
 */
export function OrderVideoDossier({ orderId }: { orderId: string }) {
  const q = useApiQuery({
    queryKey: qk.packVideosByOrder(orderId),
    queryFn: () => fetchPackVideosByOrder(orderId),
    enabled: Boolean(orderId),
  });
  // Đang chuyển sang đơn khác mà trong ô cache còn hồ sơ đơn trước → coi như đang tải, không
  // bao giờ để video của đơn này hiện dưới mã của đơn kia.
  const data = q.data && !q.placeholder && q.data.order.id === orderId ? q.data : undefined;
  const videos = React.useMemo(() => (data ? orderVideos(data.videos) : []), [data]);

  return (
    <div className="space-y-5">
      <Link href={PACK_VIDEOS_PATH} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <ArrowLeft className="size-4" />
        Về danh sách video
      </Link>

      {q.error ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">{q.error}</CardContent>
        </Card>
      ) : !data ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Đang tải hồ sơ video…
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="shadow-sm">
            <CardContent className="py-5">
              {videos.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  <Video className="mx-auto mb-2 size-8" />
                  Đơn này chưa có video nào.
                </div>
              ) : (
                // Mỗi trình phát rộng tối đa 20rem (khung dọc) — hai video là vừa một hàng từ sm trở lên.
                <div className="grid gap-5 sm:grid-cols-[repeat(auto-fill,minmax(15rem,20rem))]">
                  {videos.map((v) => (
                    <DossierVideo key={v.id} video={v} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <OrderPanel data={data} />
        </div>
      )}
    </div>
  );
}
