"use client";

import Link from "next/link";
import { Video } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PACK_VIDEO_UNBOX_RECORD_PATH } from "@/lib/pack-video";
import { usePackVideoCaps } from "@/lib/use-feature";

/**
 * Nút "Quay khui hàng" cho trang Đối soát đơn hoàn: kho thường đang đứng ở trang đó khi kiện hoàn về, nên đây là
 * lối vào thẳng màn quay ở CHẾ ĐỘ KHUI (anh Trung 16/11/2026: "Chưa có đường quay video khui hàng…").
 * Chỉ hiện với người quay khui được (chủ đã mở cổng, hoặc nhân viên của chủ đó có quyền Đối soát đơn hoàn).
 */
export function UnboxRecordLink() {
  // Chỉ người quay khui được (chủ, hoặc nhân viên có quyền Đối soát đơn hoàn — 24/11/2026).
  const { unbox } = usePackVideoCaps();
  if (!unbox) return null;
  return (
    <Link
      href={PACK_VIDEO_UNBOX_RECORD_PATH}
      className={buttonVariants({ variant: "outline" })}
      title="Mở màn quay ở chế độ khui hàng hoàn"
    >
      <Video className="size-4" />
      Quay khui hàng
    </Link>
  );
}
