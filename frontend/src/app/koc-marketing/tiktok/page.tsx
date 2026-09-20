"use client";

import Link from "next/link";
import { Lock } from "lucide-react";

import { KocShell } from "@/components/koc/koc-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TEXT_SUB } from "@/lib/typography";

/**
 * TikTok Affiliate & MCN — ĐANG KHÓA (anh Trung 20/09): phần này chưa làm lại,
 * không để khách vào dùng. Đây là TẦNG 2 của khóa (tầng 1 = mục sidebar xám +
 * ổ khóa, cờ `locked` trong app-shell): ai gõ thẳng URL cũng chỉ thấy thẻ này,
 * trang không gọi API nào.
 *
 * MỞ LẠI: trả về `<KocChannelPage platform="TIKTOK" />` + bỏ cờ `locked` ở
 * app-shell. Khung số liệu TikTok vẫn nguyên trong koc-channel-page.tsx.
 */
export default function KocTiktokPage() {
  return (
    <KocShell>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted">
            <Lock className="size-5 text-muted-foreground" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900">
              TikTok Affiliate & MCN chưa mở
            </p>
            <p className={TEXT_SUB}>
              Tính năng đang được hoàn thiện. Số liệu affiliate Shopee và Lazada
              vẫn xem bình thường ở trang Tổng quan Net-ROI.
            </p>
          </div>
          <Link
            href="/koc-marketing/overview"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            Về Tổng quan Net-ROI
          </Link>
        </CardContent>
      </Card>
    </KocShell>
  );
}
