"use client";

import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Package,
  PlaySquare,
  ReceiptText,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { TourPlayer } from "@/components/tour/guide-tour-player";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CHANNELS_TOUR,
  INVOICE_TOUR,
  ORDERS_TOUR,
  WAREHOUSE_TOUR,
  type GuideTour,
} from "@/lib/guide-tours";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * HƯỚNG DẪN SỬ DỤNG — danh sách MỤC XỔ XUỐNG (accordion), mỗi mục một TOUR
 * ĐỘNG kiểu video quay màn hình (anh Trung chốt 25/08 sau khi duyệt màn
 * onboarding: nâng toàn bộ trang hướng dẫn lên phong cách này): con trỏ ảo
 * tự chạy trên ảnh giao diện thật, click, phóng to vùng thao tác, kèm giọng
 * nữ thuyết minh (nút loa trên khung).
 *
 * Bộ bước + ảnh + giọng đọc của từng tour: lib/guide-tours.ts. Bộ SLIDE cũ
 * (public/huong-dan-*.html) giữ lại làm "bản chi tiết" mở tab mới — nhiều
 * chữ hơn, có FAQ, cho ai muốn đọc kỹ.
 */

interface GuideSection {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  tour: GuideTour;
  /** Bộ slide chi tiết (deck HTML cũ) — mở ở tab mới. */
  deckSrc: string;
}

const SECTIONS: GuideSection[] = [
  {
    key: "channels",
    icon: Store,
    title: "Liên kết gian hàng",
    description:
      "Kết nối Shopee / Lazada / TikTok Shop về Hubsell — làm 1 lần cho mỗi gian, mất chưa tới 2 phút.",
    tour: CHANNELS_TOUR,
    deckSrc: "/huong-dan-lien-ket-gian-hang.html",
  },
  {
    key: "warehouse",
    icon: Package,
    title: "Quản lý kho & liên kết sản phẩm",
    description:
      "Nguyên lý kho trung tâm trước, rồi 3 bước thiết lập: kéo sản phẩm từ sàn về, nối SKU vào một kho duy nhất, bật đồng bộ tồn lên mọi gian.",
    tour: WAREHOUSE_TOUR,
    deckSrc: "/huong-dan-quan-ly-kho.html",
  },
  {
    key: "finance",
    icon: Wallet,
    title: "Đơn hàng & đối soát dòng tiền",
    description:
      "Đơn tự chảy về mỗi 10 phút, nhập giá vốn để tính lãi/lỗ thật, đối soát để biết từng đơn thực nhận bao nhiêu.",
    tour: ORDERS_TOUR,
    deckSrc: "/huong-dan-don-hang-doi-soat.html",
  },
  {
    key: "invoicing",
    icon: ReceiptText,
    title: "Kết nối & Xuất hóa đơn điện tử",
    description:
      "Nối tài khoản meInvoice của shop một lần — đơn đã giao tick là ra hóa đơn gửi Cơ quan Thuế, hoặc bật tự động phát hành & tự điều chỉnh khi hoàn.",
    tour: INVOICE_TOUR,
    deckSrc: "/huong-dan-xuat-hoa-don.html",
  },
];

/** Một mục xổ xuống: header bấm để mở/đóng + tour động bên trong. */
function GuideAccordionItem({
  section,
  open,
  onToggle,
}: {
  section: GuideSection;
  open: boolean;
  onToggle: () => void;
}) {
  // Tour chỉ mount từ lần mở ĐẦU TIÊN — mục đóng thì unmount để dừng hẳn
  // animation + giọng đọc (mở lại tour chạy lại từ bước 1, đúng ý "xem video").
  const Icon = section.icon;

  return (
    <Card className="overflow-hidden py-0 shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors",
          open ? "bg-muted/40" : "hover:bg-muted/30"
        )}
      >
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors",
            open
              ? "border-primary/30 bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-semibold text-slate-800">
            {section.title}
            <span
              className={cn(
                TEXT_SUB,
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
              )}
            >
              <PlaySquare className="size-3" />
              {section.tour.steps.length} bước
            </span>
          </span>
          <span className={cn(TEXT_SUB, "mt-0.5 block")}>
            {section.description}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2">
            <p className={TEXT_SUB}>
              Hướng dẫn tự chạy như video — bấm nút loa để nghe thuyết minh,
              bấm chấm tròn để nhảy bước.
            </p>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={section.deckSrc} target="_blank" rel="noopener" />}
            >
              <ExternalLink className="size-3.5" />
              Bản slide chi tiết
            </Button>
          </div>
          <div className="mx-auto max-w-3xl px-4 py-5">
            <TourPlayer
              steps={section.tour.steps}
              voiceDir={section.tour.voiceDir}
              alt={`Hướng dẫn: ${section.title}`}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

export default function GuidePage() {
  // Mỗi lúc chỉ mở một mục — mở mục mới thì mục cũ tự cụp (accordion).
  const [openKey, setOpenKey] = useState<string | null>(SECTIONS[0].key);

  return (
    <AppShell>
      <div className="space-y-4">
        <p className="text-muted-foreground">
          Chọn phần cần xem — mỗi mục là một video hướng dẫn ngắn trên giao
          diện thật, có giọng đọc thuyết minh từng bước.
        </p>
        {SECTIONS.map((s) => (
          <GuideAccordionItem
            key={s.key}
            section={s}
            open={openKey === s.key}
            onToggle={() => setOpenKey((cur) => (cur === s.key ? null : s.key))}
          />
        ))}
      </div>
    </AppShell>
  );
}
