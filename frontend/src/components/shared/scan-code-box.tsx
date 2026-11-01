"use client";

import * as React from "react";
import { Camera, Loader2, ScanLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Ô QUÉT MÃ DÙNG CHUNG (tách từ ô quét hàng hoàn 01/11/2026 để màn Đóng gói
 * dùng lại). Hai đường vào, cùng đổ về `onScan(code)`:
 *
 *  1. MÁY QUÉT CHUYÊN DỤNG (barcode sọc hoặc 2D/QR) — hoạt động y hệt bàn phím:
 *     "gõ" chuỗi đã giải mã rồi bấm Enter. Một ô input bắt Enter là chạy được
 *     cả hai loại mã, không cần thư viện. Ô tự lấy tiêu điểm và tự lấy lại sau
 *     mỗi lần quét để bắn liên tục cả xấp mà không phải chạm chuột.
 *
 *  2. CAMERA (webcam hoặc điện thoại) — html5-qrcode, nạp động khi bấm bật
 *     camera. `keepCameraOpen` = true thì quét trúng KHÔNG tắt camera (màn đóng
 *     gói bắn hàng chục kiện liên tiếp), chỉ chặn bắn lặp cùng một mã trong 2 giây.
 *
 * Camera cần HTTPS hoặc localhost — mở qua IP nội bộ bằng http:// thì trình
 * duyệt chặn, lúc đó component báo rõ thay vì im lặng hỏng.
 */
export function ScanCodeBox({
  onScan,
  disabled,
  placeholder = "Bắn máy quét vào đây, hoặc gõ mã vận đơn rồi Enter…",
  ariaLabel = "Quét mã",
  hint,
  keepCameraOpen = false,
  cameraTitle = "Dùng camera điện thoại hoặc webcam để quét mã trên kiện hàng",
  boxId = "hubsell-qr-reader",
}: {
  /** Xử lý một mã đã quét; ném lỗi thì ô GIỮ mã để người dùng nhìn lại. */
  onScan: (code: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Dòng giải thích dưới ô (mặc định nói về máy quét như bàn phím). */
  hint?: React.ReactNode;
  keepCameraOpen?: boolean;
  cameraTitle?: string;
  /** id khung camera — hai ô trên cùng trang phải khác nhau. */
  boxId?: string;
}) {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [camOpen, setCamOpen] = React.useState(false);
  const [camError, setCamError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scannerRef = React.useRef<{ stop: () => Promise<void> } | null>(null);
  const lastCamRef = React.useRef<{ code: string; at: number }>({
    code: "",
    at: 0,
  });
  const busyRef = React.useRef(false);

  // Tự lấy tiêu điểm khi vào trang để bắn máy quét được ngay
  React.useEffect(() => {
    if (!disabled && !camOpen) inputRef.current?.focus();
  }, [disabled, camOpen]);

  const handle = React.useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await onScan(value);
        setCode("");
      } catch {
        // Giữ nguyên mã trên ô để nhìn lại được đã quét gì; lỗi đã báo ở onScan
      } finally {
        busyRef.current = false;
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [onScan],
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
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(boxId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" }, // ưu tiên camera sau trên điện thoại
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded: string) => {
          if (keepCameraOpen) {
            // Camera đọc ~10 khung/giây → cùng một tem bắn ra nhiều lần; chỉ nhận
            // lại mã đó sau 2 giây (người gói đã đưa kiện khác vào khung).
            const now = Date.now();
            if (
              lastCamRef.current.code === decoded &&
              now - lastCamRef.current.at < 2000
            )
              return;
            lastCamRef.current = { code: decoded, at: now };
            await handle(decoded);
            return;
          }
          await stopCamera(); // quét trúng là tắt ngay, tránh bắn lặp cùng một mã
          await handle(decoded);
        },
        () => {
          // callback này chạy mỗi khung hình không tìm thấy mã — bỏ qua
        },
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
            placeholder={placeholder}
            aria-label={ariaLabel}
            value={code}
            disabled={disabled || busy}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              // Máy quét kết thúc bằng Enter — đây là chỗ bắt cả barcode lẫn QR
              if (e.key === "Enter") {
                e.preventDefault();
                handle(code);
              }
            }}
          />
          {busy && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <Button
          variant="outline"
          onClick={camOpen ? stopCamera : startCamera}
          disabled={disabled}
          title={cameraTitle}
        >
          {camOpen ? <X className="size-4" /> : <Camera className="size-4" />}
          {camOpen ? "Tắt camera" : "Bật camera quét mã"}
        </Button>
      </div>

      {hint !== null && (
        <p className={TEXT_SUB}>
          {hint ??
            "Máy quét barcode/2D hoạt động như bàn phím — bắn xong là tự xử lý, không cần bấm gì thêm. Ô nhập tự lấy lại tiêu điểm để quét liên tục cả xấp."}
        </p>
      )}

      {/* Khung camera — luôn có trong DOM khi mở vì thư viện cần phần tử sẵn */}
      <div className={cn(!camOpen && "hidden")}>
        <div
          id={boxId}
          className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border bg-muted"
        />
        {camError && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {camError}
          </p>
        )}
      </div>
    </div>
  );
}
