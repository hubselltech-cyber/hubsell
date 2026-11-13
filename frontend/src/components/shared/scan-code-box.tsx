"use client";

import * as React from "react";
import { Camera, Loader2, ScanLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Trần số mã chờ xử lý — mức tự chọn, đủ cho một xấp kiện bắn dồn khi mạng chậm. */
const SCAN_QUEUE_MAX = 50;

/**
 * Ô QUÉT MÃ DÙNG CHUNG (tách từ ô quét hàng hoàn 01/11/2026 để màn Đóng gói
 * dùng lại). Hai đường vào, cùng đổ về `onScan(code)`:
 *
 *  1. MÁY QUÉT CHUYÊN DỤNG (barcode sọc hoặc 2D/QR) — hoạt động y hệt bàn phím:
 *     "gõ" chuỗi đã giải mã rồi bấm Enter. Một ô input bắt Enter là chạy được
 *     cả hai loại mã, không cần thư viện.
 *
 *     BẮN LIÊN TỤC (13/11/2026): ô KHÔNG BAO GIỜ bị khóa trong lúc xử lý — mã
 *     vừa bắn vào HÀNG CHỜ, ô trống ngay cho mã kế; hàng chờ chạy lần lượt.
 *     Trước đó ô bị `disabled` khi đang tra mã: trình duyệt ngừng đưa phím vào
 *     ô đã khóa và KHÔNG tự trả lại sau khi mở khóa (activeElement vẫn chỉ vào
 *     ô nên nhìn như con trỏ còn đó) → thử bắn 4 mã liên tiếp chỉ mã đầu được
 *     ghi, 3 mã sau mất không báo gì. Mã lỗi hiện ở dòng đỏ dưới ô chứ không
 *     nằm lại trong ô (nằm lại thì dính liền vào mã kế tiếp).
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
  compact = false,
  grabTyping = false,
}: {
  /** Xử lý một mã đã quét; ném lỗi thì mã đó hiện ở dòng "Mã vừa lỗi" dưới ô. */
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
  /**
   * Bản GỌN cho thanh công cụ (Đối soát đơn hoàn, 13/11/2026): một dòng, nút
   * camera chỉ còn biểu tượng, dòng giải thích dời vào chú thích khi rê chuột.
   */
  compact?: boolean;
  /**
   * Gõ phím khi con trỏ đang ở nút / ô tích / nền trang thì kéo con trỏ về ô
   * quét (không đụng ô nhập khác, không chạy khi có hộp thoại mở). Máy quét là
   * bàn phím + Enter: không có cờ này, người vừa bấm một nút rồi bắn mã thì
   * Enter của máy quét bấm lại đúng nút đó.
   */
  grabTyping?: boolean;
}) {
  const [code, setCode] = React.useState("");
  /** Số mã còn trong hàng chờ (kể cả mã đang chạy) — chỉ để hiện vòng xoay. */
  const [pending, setPending] = React.useState(0);
  /** Mã gần nhất bị lỗi — hiện dưới ô, xóa khi có mã chạy xong. */
  const [failed, setFailed] = React.useState<string | null>(null);
  const [camOpen, setCamOpen] = React.useState(false);
  const [camError, setCamError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scannerRef = React.useRef<{ stop: () => Promise<void> } | null>(null);
  const lastCamRef = React.useRef<{ code: string; at: number }>({
    code: "",
    at: 0,
  });
  const queueRef = React.useRef<string[]>([]);
  const drainingRef = React.useRef(false);
  // Hàng chờ luôn gọi onScan MỚI NHẤT (trang cha đổi hàm giữa chừng vẫn đúng).
  const onScanRef = React.useRef(onScan);
  React.useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Tự lấy tiêu điểm khi vào trang để bắn máy quét được ngay
  React.useEffect(() => {
    if (!disabled && !camOpen) inputRef.current?.focus();
  }, [disabled, camOpen]);

  /** Chạy hàng chờ lần lượt; mỗi lúc chỉ một vòng chạy. */
  const drain = React.useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const value = queueRef.current[0];
        try {
          await onScanRef.current(value);
          setFailed(null);
        } catch {
          // Lỗi đã báo ở onScan; giữ mã ở dòng dưới ô để nhìn lại được đã quét gì
          setFailed(value);
        }
        queueRef.current.shift();
        setPending(queueRef.current.length);
      }
    } finally {
      drainingRef.current = false;
    }
  }, []);

  /** Nhận một mã: xếp vào hàng chờ rồi trả ô cho mã kế ngay — không chờ xử lý. */
  const handle = React.useCallback(
    (raw: string) => {
      const value = raw.trim();
      // Trần hàng chờ: kẹt mạng mà vẫn bắn tiếp thì không dồn vô hạn.
      if (!value || queueRef.current.length >= SCAN_QUEUE_MAX) return;
      queueRef.current.push(value);
      setPending(queueRef.current.length);
      void drain();
    },
    [drain],
  );

  // Kéo con trỏ về ô quét khi gõ ở chỗ không phải ô nhập (xem prop grabTyping).
  React.useEffect(() => {
    if (!grabTyping || disabled) return;
    function onKeyDown(e: KeyboardEvent) {
      // Chỉ ký tự in được, không tổ hợp phím; dấu cách để yên cho nút / ô tích.
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
      const t = e.target as HTMLElement | null;
      if (t === inputRef.current) return;
      if (t) {
        if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
        if (
          t.tagName === "INPUT" &&
          !["checkbox", "radio", "button", "submit"].includes((t as HTMLInputElement).type)
        ) {
          return;
        }
      }
      if (document.querySelector('[role="dialog"]')) return;
      // Đổi tiêu điểm ngay trong keydown → chính ký tự này rơi vào ô quét.
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [grabTyping, disabled]);

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
            handle(decoded);
            return;
          }
          await stopCamera(); // quét trúng là tắt ngay, tránh bắn lặp cùng một mã
          handle(decoded);
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
      <div className={cn("flex items-center gap-2", !compact && "flex-wrap")}>
        <div
          className={cn("relative flex-1", compact ? "min-w-0" : "min-w-72")}
          title={compact && typeof hint === "string" ? hint : undefined}
        >
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            className="pl-9 pr-9 font-mono"
            placeholder={placeholder}
            aria-label={ariaLabel}
            value={code}
            // KHÔNG khóa ô khi đang xử lý (xem "BẮN LIÊN TỤC" ở đầu tệp)
            disabled={disabled}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              // Máy quét kết thúc bằng Enter — đây là chỗ bắt cả barcode lẫn QR
              if (e.key === "Enter") {
                e.preventDefault();
                handle(code);
                setCode(""); // trống ngay cho mã kế, mã vừa bắn đã nằm trong hàng chờ
              }
            }}
          />
          {pending > 0 && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <Button
          variant="outline"
          size={compact ? "icon" : undefined}
          onClick={camOpen ? stopCamera : startCamera}
          disabled={disabled}
          title={cameraTitle}
          aria-label={camOpen ? "Tắt camera" : "Bật camera quét mã"}
          className={compact ? "shrink-0" : undefined}
        >
          {camOpen ? <X className="size-4" /> : <Camera className="size-4" />}
          {!compact && (camOpen ? "Tắt camera" : "Bật camera quét mã")}
        </Button>
      </div>

      {failed && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="status">
          Mã vừa lỗi: <span className="font-mono font-semibold">{failed}</span>
        </p>
      )}

      {hint !== null && !compact && (
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
