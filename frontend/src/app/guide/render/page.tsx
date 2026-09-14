"use client";

import { useCallback, useEffect, useState } from "react";

import { TourPlayer } from "@/components/tour/guide-tour-player";
import {
  CHANNELS_TOUR,
  INVOICE_TOUR,
  LAZADA_TOUR,
  ORDERS_TOUR,
  WAREHOUSE_TOUR,
  type GuideTour,
} from "@/lib/guide-tours";

/**
 * SÂN KHẤU QUAY MP4 cho các tour hướng dẫn — dùng bởi scripts/render-tour-video.js
 * (Playwright ghi màn hình 1920x1080, ghép giọng đọc bằng ffmpeg → file cho
 * anh Trung đăng YouTube). Không có menu/đăng nhập: chỉ khung tour + tiêu đề.
 *
 * Giao thức với script quay:
 *  - ?tour=lazada&hold=ms,ms,… → độ dài pha zoom từng bước (khớp độ dài MP3).
 *  - Trước khi bắt đầu, trang TRẮNG hoàn toàn (mốc dò trong video); script gọi
 *    window.__startTour() sau khi đã nạp sẵn ảnh (danh sách ở window.__tourImages).
 *  - Mỗi lần sang bước, trang ghi performance.now() vào window.__stepTimes;
 *    phát hết → window.__tourDone = true. Script dựa vào đó đặt mốc từng file
 *    MP3 cho khớp hình.
 */

const TOURS: Record<string, { tour: GuideTour; title: string }> = {
  lazada: { tour: LAZADA_TOUR, title: "Kết nối gian hàng Lazada" },
  channels: { tour: CHANNELS_TOUR, title: "Kết nối gian hàng Shopee" },
  kho: { tour: WAREHOUSE_TOUR, title: "Quản lý kho & liên kết sản phẩm" },
  donhang: { tour: ORDERS_TOUR, title: "Đơn hàng & đối soát dòng tiền" },
  hoadon: { tour: INVOICE_TOUR, title: "Kết nối & xuất hóa đơn điện tử" },
};

type RenderWindow = Window & {
  __startTour?: () => void;
  __tourImages?: string[];
  __stepTimes?: number[];
  __tourDone?: boolean;
};

export default function TourRenderPage() {
  const [cfg, setCfg] = useState<{ key: string; hold?: number[] } | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const key = p.get("tour") ?? "lazada";
    const holdRaw = p.get("hold");
    const hold = holdRaw
      ? holdRaw.split(",").map((v) => Number(v) || 0)
      : undefined;
    setCfg({ key, hold });
    const w = window as RenderWindow;
    w.__tourImages = TOURS[key]?.tour.steps.map((s) => s.img) ?? [];
    w.__stepTimes = [];
    w.__tourDone = false;
    w.__startTour = () => setStarted(true);
  }, []);

  const onStepChange = useCallback(() => {
    (window as RenderWindow).__stepTimes?.push(performance.now());
  }, []);
  const onFinish = useCallback(() => {
    (window as RenderWindow).__tourDone = true;
  }, []);

  const entry = cfg ? TOURS[cfg.key] : null;
  // Chưa bắt đầu: trắng tinh — script dò khung hình đầu tiên hết trắng làm mốc 0.
  if (!started || !entry) {
    return <div className="fixed inset-0 bg-white" />;
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 bg-[#0b1220] text-white">
      <header className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-lg font-black text-white">
          H
        </span>
        <span className="text-xl font-semibold tracking-tight">
          Hubsell · {entry.title}
        </span>
      </header>
      <div className="w-[1344px] [&_p]:text-white [&_.text-muted-foreground]:text-slate-300">
        <TourPlayer
          steps={entry.tour.steps}
          stepZoomMs={cfg?.hold}
          onStepChange={onStepChange}
          onFinish={onFinish}
          alt={entry.title}
        />
      </div>
    </div>
  );
}
