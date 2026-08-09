"use client";

import { useRef } from "react";
import { ExternalLink, Maximize2, Presentation } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TEXT_SUB } from "@/lib/typography";

/**
 * HƯỚNG DẪN SỬ DỤNG — trang chỉ còn BẢN TRÌNH CHIẾU nhúng toàn khung
 * (anh Trung chốt 09/08: ẩn hẳn bản text, nhường trọn không gian cho slide).
 *
 * Nội dung nằm ở file tĩnh public/huong-dan-hubsell.html (9 slide, ảnh chụp
 * giao diện thật — tái tạo ảnh bằng frontend/scripts/capture-guide-assets.js).
 * Deck có stage 16:9 tự co theo iframe nên chỉ cần cấp khung đủ cao.
 */
export default function GuidePage() {
  // Tham chiếu iframe để nút "Toàn màn hình" phóng đúng khung trình chiếu
  const frameRef = useRef<HTMLIFrameElement>(null);

  return (
    <AppShell>
      <Card className="overflow-hidden py-0 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Presentation className="size-4 text-slate-500" />
            Hướng dẫn sử dụng Hubsell — 8 bước
            <span className={TEXT_SUB}>
              (phím ← → hoặc lăn chuột để chuyển)
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => frameRef.current?.requestFullscreen()}
            >
              <Maximize2 className="size-3.5" />
              Toàn màn hình
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a
                  href="/huong-dan-hubsell.html"
                  target="_blank"
                  rel="noopener"
                />
              }
            >
              <ExternalLink className="size-3.5" />
              Mở tab mới
            </Button>
          </div>
        </div>
        {/* Cao theo cửa sổ (trừ header app + thanh công cụ + đệm trang) để slide
            luôn choán gần trọn màn hình; deck tự letterbox khi lệch tỷ lệ. */}
        <iframe
          ref={frameRef}
          src="/huong-dan-hubsell.html"
          title="Slide hướng dẫn sử dụng Hubsell"
          className="w-full border-0"
          style={{ height: "max(480px, calc(100vh - 200px))" }}
          allowFullScreen
        />
      </Card>
    </AppShell>
  );
}
