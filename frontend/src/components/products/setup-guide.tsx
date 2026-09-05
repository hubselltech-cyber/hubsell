"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  CloudUpload,
  Link2,
  Loader2,
  Settings2,
  Sparkles,
  Store,
  Warehouse,
} from "lucide-react";

import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import type { SyncHeaderState } from "@/components/products/sync-settings-dialog";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { HubStoryStrip } from "./hub-story-strip";

const OPEN_KEY = "hubsell_hub_guide_open";

export interface ChannelProductCounts {
  all: number;
  linked: number;
  unlinked: number;
}

interface SetupGuideProps {
  isAdmin: boolean;
  /** Số SKU kho — chip tóm tắt ở header. */
  productTotal: number;
  /** Đã tải xong số liệu để tính bước nào xong — trước đó không quyết định mở/đóng. */
  ready: boolean;
  /** Gian hàng ACTIVE (mọi sàn) — bước 1. Chỉ chủ shop mới có. */
  channels: Channel[];
  /** Đếm sản phẩm sàn — bước 2. Chỉ chủ shop mới có. */
  counts: ChannelProductCounts | null;
  /** Trạng thái đồng bộ tồn theo gian — bước 3. Chỉ chủ shop mới có. */
  syncState: SyncHeaderState | null;
  /** Sau khi kéo sản phẩm từ sàn về (bước 1). */
  onSynced: () => void | Promise<void>;
  /** Mở hộp "Tự khớp + tạo SKU" (bước 2). */
  onOpenOneClick: () => void;
  /** Sang tab Sản phẩm trên sàn để nối tay. */
  onOpenLinks: () => void;
  /** Mở dialog cài đặt đồng bộ tồn (bước 3 + nút Cài đặt ở header). */
  onOpenSync: () => void;
}

/**
 * KHỐI "KHO TRUNG TÂM HUBSELL" — tầng dẫn đường của hub Hàng hóa (anh Trung
 * 06/09: seller mở trang không biết bắt đầu từ đâu, giống Sapo). Sắp xếp ba
 * tầng: NGUYÊN LÝ (dải kể chuyện, bắt buộc giữ) → VIỆC PHẢI LÀM (3 bước, mỗi
 * bước một nút) → bảng làm việc ở dưới (trang tự render).
 *
 *   Bước 1  Kéo sản phẩm từ sàn về      xong khi có ≥1 sản phẩm sàn
 *   Bước 2  Nối về SKU kho              xong khi không còn sản phẩm sàn chưa nối
 *   Bước 3  Bật đồng bộ tồn từng gian   xong khi mọi gian Shopee/Lazada đã bật
 *
 * Header luôn hiện (tóm tắt số + nút Cài đặt đồng bộ + nút thu/bung). Thân khối
 * mặc định BUNG khi chưa xong, THU khi đã xong; seller tự bấm thì nhớ lựa chọn
 * (localStorage). Không có nút X đóng vĩnh viễn — luôn có đường xem lại nguyên lý.
 * Nhân viên: chỉ thấy nguyên lý, không thấy 3 bước (việc của chủ shop).
 */
export function SetupGuide({
  isAdmin,
  productTotal,
  ready,
  channels,
  counts,
  syncState,
  onSynced,
  onOpenOneClick,
  onOpenLinks,
  onOpenSync,
}: SetupGuideProps) {
  const router = useRouter();

  // null = chưa đọc localStorage / seller chưa từng bấm → mặc định theo tiến độ.
  const [stored, setStored] = useState<boolean | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(OPEN_KEY);
      if (v === "1") setStored(true);
      else if (v === "0") setStored(false);
    } catch {
      // không đọc được thì theo mặc định
    }
    setHydrated(true);
  }, []);

  const channelCount = channels.length;
  const all = counts?.all ?? 0;
  const unlinked = counts?.unlinked ?? 0;
  const linked = counts?.linked ?? 0;
  const enabled = syncState?.enabledCount ?? 0;
  const totalSync = syncState?.totalChannels ?? 0;
  const pending = syncState?.pending ?? 0;

  const step1Done = all > 0;
  const step2Done = all > 0 && unlinked === 0;
  // Không có gian Shopee/Lazada nào (vd chỉ TikTok) thì không có gì để bật.
  const step3Done = totalSync > 0 ? enabled === totalSync : step2Done;
  const doneCount = [step1Done, step2Done, step3Done].filter(Boolean).length;
  const complete = isAdmin ? doneCount === 3 : true;

  // Chủ shop: chưa xong → bung; xong → thu. Nhân viên: thu (bảng là việc chính).
  const open = stored ?? (hydrated && ready ? !complete : false);

  function toggle() {
    const next = !open;
    setStored(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // không lưu được thì lần sau theo mặc định — vô hại
    }
  }

  // Bước ĐANG CẦN LÀM = bước đầu tiên chưa xong. Chỉ bước này nổi (viền + nền
  // màu chủ đạo), bước đã xong và bước chưa tới lùi lại — mắt seller rơi thẳng
  // vào việc phải làm thay vì ba hộp bằng nhau (anh Trung 06/09 chê phẳng).
  const nextStepNo = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 0;

  const stepCircle = (n: number, state: "done" | "active" | "later") => (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        state === "done"
          ? "bg-emerald-600 text-white"
          : state === "active"
            ? "bg-primary text-primary-foreground shadow-sm"
            : "bg-muted text-muted-foreground"
      )}
    >
      {state === "done" ? <Check className="size-4" /> : n}
    </span>
  );

  const stepCard = (
    n: number,
    done: boolean,
    title: string,
    status: React.ReactNode,
    action: React.ReactNode
  ) => {
    const state: "done" | "active" | "later" = done
      ? "done"
      : n === nextStepNo
        ? "active"
        : "later";
    return (
      <div
        data-tour={`setup-step-${n}`}
        className={cn(
          "flex flex-col gap-2.5 rounded-xl p-4",
          state === "active"
            ? "bg-primary/5 ring-2 ring-primary/40 shadow-sm"
            : state === "done"
              ? "bg-emerald-50/50 ring-1 ring-emerald-200/60"
              : "bg-transparent ring-1 ring-foreground/10 opacity-80"
        )}
      >
        <div className="flex items-center gap-2.5">
          {stepCircle(n, state)}
          <span
            className={cn(
              "text-[15px] font-semibold leading-tight",
              state === "later" && "text-muted-foreground"
            )}
          >
            {title}
          </span>
        </div>
        <p
          className={cn(
            "min-h-10 text-[13px] leading-snug",
            state === "active" ? "text-foreground/80" : "text-muted-foreground"
          )}
        >
          {status}
        </p>
        <div className="flex flex-wrap items-center gap-2">{action}</div>
      </div>
    );
  };

  // ===== BƯỚC 1: KÉO SẢN PHẨM TỪ SÀN VỀ =====
  const step1 = stepCard(
    1,
    step1Done,
    "Kéo sản phẩm từ sàn về",
    channelCount === 0
      ? "Chưa nối gian hàng nào. Nối Shopee / Lazada / TikTok trước, rồi kéo danh mục về."
      : step1Done
        ? `${formatNumber(all)} sản phẩm sàn từ ${formatNumber(channelCount)} gian. Sàn thêm hàng mới thì kéo lại.`
        : `${formatNumber(channelCount)} gian đã nối, chưa kéo sản phẩm nào về.`,
    channelCount === 0 ? (
      <Button size="sm" onClick={() => router.push("/channels")}>
        <Store className="size-3.5" />
        Nối gian hàng
      </Button>
    ) : (
      <SyncChannelProductsButton
        onSynced={onSynced}
        label={step1Done ? "Kéo lại từ sàn" : "Kéo sản phẩm về"}
        className={cn(
          "h-7 px-2.5 text-[0.8rem]",
          step1Done && "border bg-background text-foreground hover:bg-muted"
        )}
      />
    )
  );

  // ===== BƯỚC 2: NỐI VỀ SKU KHO =====
  const step2 = stepCard(
    2,
    step2Done,
    "Nối về SKU kho",
    !step1Done
      ? "Làm bước 1 trước. Sản phẩm trùng mã SKU với kho sẽ tự nối, phần còn lại Hubsell tạo SKU kho giúp."
      : step2Done
        ? `Đã nối ${formatNumber(linked)} sản phẩm sàn về ${formatNumber(productTotal)} SKU kho. Gian nào bán, kho và mọi gian cùng trừ.`
        : `Còn ${formatNumber(unlinked)} sản phẩm sàn chưa nối về kho. Chưa nối thì đơn về không trừ được tồn.`,
    step2Done ? (
      <Button size="sm" variant="outline" onClick={onOpenLinks}>
        <Link2 className="size-3.5" />
        Xem sản phẩm trên sàn
      </Button>
    ) : (
      <>
        <Button size="sm" onClick={onOpenOneClick} disabled={!step1Done}>
          <Sparkles className="size-3.5" />
          Tự khớp + tạo SKU
        </Button>
        <button
          type="button"
          onClick={onOpenLinks}
          className={cn(TEXT_SUB, "underline-offset-2 hover:text-foreground hover:underline")}
        >
          hoặc nối tay từng dòng
        </button>
      </>
    )
  );

  // ===== BƯỚC 3: BẬT ĐỒNG BỘ TỒN TỪNG GIAN =====
  const step3 = stepCard(
    3,
    step3Done,
    "Bật đồng bộ tồn cho từng gian",
    !syncState
      ? "Đang kiểm tra…"
      : totalSync === 0
        ? channelCount === 0
          ? "Nối gian Shopee / Lazada rồi bật ở đây."
          : "Chưa có gian Shopee / Lazada nào. TikTok Shop sẽ hỗ trợ đẩy tồn sau."
        : enabled === 0
          ? "Chưa bật gian nào, số Có thể bán chưa được đẩy lên sàn. Bật từng gian sau khi so số."
          : enabled < totalSync
            ? `${formatNumber(enabled)}/${formatNumber(totalSync)} gian đang đồng bộ, còn ${formatNumber(totalSync - enabled)} gian chưa bật.`
            : `${formatNumber(totalSync)}/${formatNumber(totalSync)} gian đồng bộ. Kho đổi số là mọi gian đổi theo.`,
    totalSync > 0 ? (
      <Button
        size="sm"
        variant={step3Done ? "outline" : "default"}
        onClick={onOpenSync}
        title={!step2Done ? "Nên nối SKU (bước 2) trước để có gì mà đẩy" : undefined}
      >
        <CloudUpload className="size-3.5" />
        {step3Done ? "Cài đặt đồng bộ" : enabled > 0 ? "Bật gian còn lại" : "Bật đồng bộ"}
      </Button>
    ) : null
  );

  return (
    // Thẻ nổi (bóng nhẹ) + dải tiêu đề nhuộm màu chủ đạo, thân là nền lõm nhạt:
    // khối này KHÁC TÔNG với bảng bên dưới nên không còn cảm giác phẳng.
    <div data-tour="setup-guide" className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* ===== HEADER: luôn hiện ===== */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
          open ? "bg-primary/[0.06]" : "bg-primary/[0.03]"
        )}
      >
        <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Warehouse className="size-4" />
          </span>
          Kho trung tâm Hubsell
        </span>

        {ready && (
          <span className={cn(TEXT_SUB, "inline-flex flex-wrap items-center gap-x-1.5 tabular-nums")}>
            <span>{formatNumber(productTotal)} SKU kho</span>
            {isAdmin && counts && (
              <>
                <span aria-hidden>·</span>
                <span className={unlinked > 0 ? "font-medium text-amber-700" : undefined}>
                  {unlinked > 0
                    ? `${formatNumber(unlinked)} SP sàn chưa nối`
                    : `${formatNumber(linked)} SP sàn đã nối`}
                </span>
              </>
            )}
            {isAdmin && syncState && totalSync > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className={enabled === 0 ? "font-medium text-amber-700" : undefined}>
                  đồng bộ {formatNumber(enabled)}/{formatNumber(totalSync)} gian
                </span>
                {pending > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    {formatNumber(pending)} đang đẩy
                  </span>
                )}
              </>
            )}
          </span>
        )}

        {isAdmin && ready && !complete && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Thiết lập {doneCount}/3 bước
          </span>
        )}
        {isAdmin && ready && complete && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            <Check className="size-3" />
            Đã thiết lập
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={onOpenSync}>
              <Settings2 className="size-3.5" />
              Cài đặt đồng bộ
            </Button>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className={cn(
              TEXT_SUB,
              "inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
            )}
          >
            {open ? "Thu gọn" : isAdmin ? "Nguyên lý & các bước" : "Xem nguyên lý"}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {/* ===== THÂN: nguyên lý → 3 bước ===== */}
      {open && (
        <div className="space-y-4 border-t bg-muted/30 px-4 py-4">
          <HubStoryStrip />
          {isAdmin && (
            <div className="grid gap-3 md:grid-cols-3">
              {step1}
              {step2}
              {step3}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
