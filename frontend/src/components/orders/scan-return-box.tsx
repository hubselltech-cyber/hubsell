"use client";

import * as React from "react";
import { toast } from "sonner";
import { Camera, Loader2, ScanLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, lookupOrderByCode, type Order } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Ô QUÉT MÃ HÀNG HOÀN
 *
 * Hai đường vào, cùng đổ về một chỗ:
 *
 *  1. MÁY QUÉT CHUYÊN DỤNG (barcode sọc hoặc 2D/QR) — loại này hoạt động y hệt
 *     bàn phím: nó "gõ" chuỗi đã giải mã rồi bấm Enter. Nên chỉ cần một ô input
 *     thường bắt sự kiện Enter là chạy được cả hai loại mã, không cần thư viện.
 *     Ô tự lấy tiêu điểm và tự lấy lại sau mỗi lần quét để nhân viên bắn liên
 *     tục cả xấp mà không phải chạm chuột.
 *
 *  2. CAMERA (webcam hoặc điện thoại) — dùng html5-qrcode. Thư viện này nặng
 *     nên chỉ nạp khi người dùng thật sự bấm bật camera (import động), tránh
 *     bắt mọi người tải kèm dù không dùng tới.
 *
 * Camera cần HTTPS hoặc localhost mới truy cập được — mở qua IP nội bộ bằng
 * http:// thì trình duyệt chặn, lúc đó component báo rõ thay vì im lặng hỏng.
 */
export function ScanReturnBox({
  onFound,
  disabled,
}: {
  onFound: (order: Order) => void;
  disabled?: boolean;
}) {
  const [code, setCode] = React.useState("");
  const [looking, setLooking] = React.useState(false);
  const [camOpen, setCamOpen] = React.useState(false);
  const [camError, setCamError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scannerRef = React.useRef<{ stop: () => Promise<void> } | null>(null);
  const camBoxId = "hubsell-qr-reader";

  // Tự lấy tiêu điểm khi vào tab để bắn máy quét được ngay
  React.useEffect(() => {
    if (!disabled && !camOpen) inputRef.current?.focus();
  }, [disabled, camOpen]);

  const lookup = React.useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || looking) return;
      setLooking(true);
      try {
        const res = await lookupOrderByCode(value);
        setCode("");
        onFound(res.order);
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Không tra cứu được mã"
        );
        // Giữ nguyên mã sai trên ô để nhân viên nhìn lại được đã quét gì
      } finally {
        setLooking(false);
        inputRef.current?.focus();
      }
    },
    [looking, onFound]
  );

  async function stopCamera() {
    try {
      await scannerRef.current?.stop();
    } catch {
      // camera có thể đã tự dừng, không cần báo
    }
    scannerRef.current = null;
    setCamOpen(false);
  }

  async function startCamera() {
    setCamError(null);
    setCamOpen(true);
    try {
      // Nạp động: thư viện chỉ tải khi thật sự cần dùng camera
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(camBoxId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" }, // ưu tiên camera sau trên điện thoại
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded: string) => {
          await stopCamera(); // quét trúng là tắt ngay, tránh bắn lặp cùng một mã
          await lookup(decoded);
        },
        () => {
          // callback này chạy mỗi khung hình không tìm thấy mã — bỏ qua
        }
      );
    } catch (err) {
      const msg =
        window.isSecureContext === false
          ? "Trình duyệt chỉ cho bật camera trên HTTPS hoặc localhost. Hãy mở trang qua HTTPS rồi thử lại."
          : err instanceof Error
            ? err.message
            : "Không mở được camera";
      setCamError(msg);
      scannerRef.current = null;
    }
  }

  // Dọn camera khi component bị gỡ (đổi tab, rời trang…)
  React.useEffect(() => {
    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-72 flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            className="pl-9 pr-9 font-mono"
            placeholder="Bắn máy quét vào đây, hoặc gõ mã vận đơn rồi Enter…"
            aria-label="Quét mã vận đơn hàng hoàn"
            value={code}
            disabled={disabled || looking}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              // Máy quét kết thúc bằng Enter — đây là chỗ bắt cả barcode lẫn QR
              if (e.key === "Enter") {
                e.preventDefault();
                lookup(code);
              }
            }}
          />
          {looking && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <Button
          variant="outline"
          onClick={camOpen ? stopCamera : startCamera}
          disabled={disabled}
          title="Dùng camera điện thoại hoặc webcam để quét mã QR trên kiện hàng"
        >
          {camOpen ? <X className="size-4" /> : <Camera className="size-4" />}
          {camOpen ? "Tắt camera" : "Bật camera quét mã"}
        </Button>
      </div>

      <p className={TEXT_SUB}>
        Máy quét barcode/2D hoạt động như bàn phím — bắn xong là tự tra, không
        cần bấm gì thêm. Ô nhập tự lấy lại tiêu điểm để quét liên tục cả xấp.
      </p>

      {/* Khung camera — luôn có trong DOM khi mở vì thư viện cần phần tử sẵn */}
      <div className={cn(!camOpen && "hidden")}>
        <div
          id={camBoxId}
          className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border bg-muted"
        />
        {camError && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {camError}
          </p>
        )}
      </div>
    </div>
  );
}
