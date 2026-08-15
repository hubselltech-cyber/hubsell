"use client";

import { useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Maximize2,
  Package,
  Presentation,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * HƯỚNG DẪN SỬ DỤNG — danh sách MỤC XỔ XUỐNG (accordion), mỗi mục một bộ slide
 * riêng (anh Trung chốt 15/08: tách "Liên kết gian hàng" và "Quản lý kho" thành
 * hai mục, bấm vào mục nào thì slide của phần đó mở rộng ngay bên dưới).
 *
 * Slide là các file tĩnh public/huong-dan-*.html (stage 16:9 tự co theo iframe,
 * CSS/JS dùng chung ở guide-assets/deck.css + deck.js). Ảnh chụp giao diện thật
 * tái tạo bằng frontend/scripts/capture-guide-assets.js (kênh bán) và
 * capture-warehouse-assets.js (hub Hàng hóa).
 */

interface GuideSection {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  slides: number;
  src: string;
}

const SECTIONS: GuideSection[] = [
  {
    key: "channels",
    icon: Store,
    title: "Liên kết gian hàng",
    description:
      "Kết nối Shopee / Lazada / TikTok Shop về Hubsell — làm 1 lần cho mỗi gian, mất chưa tới 2 phút.",
    slides: 5,
    src: "/huong-dan-lien-ket-gian-hang.html",
  },
  {
    key: "warehouse",
    icon: Package,
    title: "Quản lý kho & liên kết sản phẩm",
    description:
      "Kéo sản phẩm từ sàn về, nối SKU vào một kho duy nhất — tồn ban đầu tự lấy theo sàn, rồi bật đồng bộ tồn ngược lên mọi gian.",
    slides: 7,
    src: "/huong-dan-quan-ly-kho.html",
  },
  {
    key: "finance",
    icon: Wallet,
    title: "Đơn hàng & đối soát dòng tiền",
    description:
      "Đơn tự chảy về mỗi 10 phút, nhập giá vốn để tính lãi/lỗ thật, đối soát để biết từng đơn thực nhận bao nhiêu.",
    slides: 5,
    src: "/huong-dan-don-hang-doi-soat.html",
  },
];

/** Một mục xổ xuống: header bấm để mở/đóng + khung trình chiếu bên trong. */
function GuideAccordionItem({
  section,
  open,
  onToggle,
}: {
  section: GuideSection;
  open: boolean;
  onToggle: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Iframe chỉ gắn vào DOM từ lần mở ĐẦU TIÊN, sau đó giữ nguyên (ẩn bằng CSS)
  // để đóng/mở lại không phải tải lại deck và mất vị trí slide đang xem.
  const [everOpened, setEverOpened] = useState(open);

  const Icon = section.icon;

  return (
    <Card className="overflow-hidden py-0 shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!everOpened) setEverOpened(true);
          onToggle();
        }}
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
              <Presentation className="size-3" />
              {section.slides} slide
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

      {everOpened && (
        <div className={cn("border-t", !open && "hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2">
            <p className={TEXT_SUB}>Phím ← → hoặc lăn chuột để chuyển slide</p>
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
                render={<a href={section.src} target="_blank" rel="noopener" />}
              >
                <ExternalLink className="size-3.5" />
                Mở tab mới
              </Button>
            </div>
          </div>
          {/* Cao theo cửa sổ (trừ header app + hai thanh mục + đệm) — deck tự
              letterbox khi lệch tỷ lệ 16:9. */}
          <iframe
            ref={frameRef}
            src={section.src}
            title={`Slide hướng dẫn: ${section.title}`}
            className="w-full border-0"
            style={{ height: "max(440px, calc(100vh - 320px))" }}
            allowFullScreen
          />
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
          Chọn phần cần xem — mỗi mục là một bộ slide ngắn kèm ảnh màn hình thật
          khoanh đỏ đúng chỗ cần bấm.
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
