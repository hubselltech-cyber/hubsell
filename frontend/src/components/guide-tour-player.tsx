"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { RotateCcw, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * TRÌNH PHÁT HƯỚNG DẪN ĐỘNG dùng chung — "video" quay màn hình giả lập trên
 * ảnh chụp giao diện thật: con trỏ ảo lướt tới mục tiêu → click gợn sóng →
 * phóng to vùng thao tác (kèm mô phỏng gõ phím) → thu về, kèm giọng nữ Hoài My
 * thuyết minh từng bước (MP3 thu sẵn, xem scripts/generate-*-voice.js).
 *
 * Nơi dùng: màn onboarding lần đầu đăng nhập (onboarding-overlay.tsx) và các
 * mục của trang Hướng dẫn sử dụng (/guide). Bộ bước của từng tour nằm ở
 * lib/guide-tours.ts — ảnh + tọa độ sinh từ scripts/capture-*-assets.js.
 */

export type TourTarget = { x: number; y: number; w: number; h: number };

export type TourStep = {
  img: string;
  title: string;
  desc: string;
  /** Tâm + kích thước mục tiêu, tính bằng % khung ảnh 3:2 (1440x960). */
  target: TourTarget;
  /** Mức phóng to khi "camera" zoom vào mục tiêu. */
  zoom: number;
  /** Ảnh dọc (vd trang uỷ quyền Shopee): hiển thị trọn trong khung thay vì phủ kín. */
  fit?: "contain";
  /**
   * Mô phỏng GÕ PHÍM trong pha zoom: mỗi field là một ô trên ảnh (tọa độ %
   * khung) được phủ nền trắng che placeholder rồi chữ hiện dần từng ký tự.
   */
  typing?: { box: TourTarget; text: string }[];
};

// Nhịp một bước: con trỏ lướt tới → click (gợn sóng) → zoom vào ngắm → thu về.
const MOVE_MS = 1000;
const CLICK_MS = 700;
const ZOOM_MS = 2300;
const RESET_MS = 700;

type Phase = "move" | "click" | "zoom" | "reset";

/**
 * Tâm zoom tự né mép: mục tiêu sát cạnh mà lấy đúng tâm mục tiêu làm
 * transform-origin thì sau khi phóng to sẽ bị cắt mất một nửa. Dịch origin vừa
 * đủ để cả mục tiêu (kèm đệm) nằm trọn khung: điểm p sau scale quanh origin o
 * nằm tại o + (p − o)·z.
 */
function zoomOrigin(t: TourTarget, zoom: number) {
  const pad = 2.5;
  const clampAxis = (center: number, half: number) => {
    const lo = Math.max(0, center - half - pad);
    const hi = Math.min(100, center + half + pad);
    const maxO = (lo * zoom) / (zoom - 1); // mép trái/trên mục tiêu không tràn
    const minO = (hi * zoom - 100) / (zoom - 1); // mép phải/dưới không tràn
    if (minO > maxO) return center; // mục tiêu rộng hơn khung sau zoom — lấy tâm
    return Math.min(Math.max(center, minO), maxO);
  };
  return { x: clampAxis(t.x, t.w / 2), y: clampAxis(t.y, t.h / 2) };
}

export function TourPlayer({
  steps,
  voiceDir,
  onFinish,
  alt = "Hướng dẫn sử dụng Hubsell",
}: {
  steps: TourStep[];
  /** Thư mục chứa step-N.mp3 thuyết minh — bỏ trống thì ẩn nút loa. */
  voiceDir?: string;
  /**
   * Gọi khi phát hết bước cuối. Không truyền → tour tự DỪNG ở cuối và hiện
   * nút "Xem lại từ đầu" (chế độ trang Hướng dẫn sử dụng).
   */
  onFinish?: () => void;
  alt?: string;
}) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("move");
  const [done, setDone] = useState(false);
  // Số ký tự đã "gõ" (tính trên chuỗi ghép mọi field) của bước có typing.
  const [typed, setTyped] = useState(0);

  // THUYẾT MINH bằng MP3 thu sẵn — mặc định TẮT: trình duyệt chặn tự phát âm
  // thanh khi chưa có thao tác người dùng, bấm nút loa = bật.
  const [voiceOn, setVoiceOn] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakingRef = useRef(false); // đang đọc dở
  const waitingRef = useRef(false); // pha zoom đã hết giờ, đang nán chờ đọc xong

  // Danh sách ảnh duy nhất — chồng sẵn tất cả, chỉ đổi opacity để không nháy
  // trắng khi sang ảnh khác. Ảnh của bước fit:"contain" hiển thị trọn khung.
  const allImages = useMemo(() => [...new Set(steps.map((s) => s.img))], [steps]);
  const containImages = useMemo(
    () => new Set(steps.filter((s) => s.fit === "contain").map((s) => s.img)),
    [steps]
  );

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    speakingRef.current = false;
  }, []);

  useEffect(() => stopSpeaking, [stopSpeaking]); // unmount thì im lặng ngay

  const speakStep = useCallback(
    (i: number) => {
      if (!voiceDir) return;
      stopSpeaking();
      const a = new Audio(`${voiceDir}/step-${i + 1}.mp3`);
      audioRef.current = a;
      speakingRef.current = true;
      const doneSpeaking = () => {
        if (audioRef.current !== a) return; // đã bị bước khác/nút tắt thay thế
        speakingRef.current = false;
        // Pha zoom hết giờ từ trước — đọc xong mới cho máy trạng thái đi tiếp.
        if (waitingRef.current) {
          waitingRef.current = false;
          setPhase("reset");
        }
      };
      a.onended = doneSpeaking;
      a.onerror = doneSpeaking;
      // play() bị chặn (chưa có thao tác người dùng) → coi như đọc xong, không treo.
      a.play().catch(doneSpeaking);
    },
    [voiceDir, stopSpeaking]
  );

  // Sang bước mới (hoặc vừa bật loa giữa chừng) → đọc lời bước đó;
  // tắt loa → ngắt ngay và thả máy trạng thái nếu đang nán chờ.
  useEffect(() => {
    if (voiceOn && !done) {
      speakStep(step);
      return;
    }
    stopSpeaking();
    if (waitingRef.current) {
      waitingRef.current = false;
      setPhase("reset");
    }
  }, [step, voiceOn, done, speakStep, stopSpeaking]);

  const current = steps[step];
  const { target } = current;
  const origin = zoomOrigin(target, current.zoom);

  useEffect(() => {
    setTyped(0);
  }, [step]);

  // Gõ phím mô phỏng trong pha zoom — 85ms/ký tự, hết chuỗi thì tự dừng.
  useEffect(() => {
    if (phase !== "zoom" || !current.typing) return;
    const total = current.typing.reduce((s, f) => s + f.text.length, 0);
    const iv = setInterval(() => {
      setTyped((t) => (t >= total ? t : t + 1));
    }, 85);
    return () => clearInterval(iv);
  }, [phase, current]);

  // Máy trạng thái theo timeout — mỗi pha tự hẹn giờ chuyển pha kế tiếp.
  useEffect(() => {
    if (done) return; // đã phát hết (chế độ /guide) — đứng yên chờ Xem lại
    // Đang thuyết minh mà pha zoom hết giờ → nán lại chờ đọc xong (onended sẽ
    // đẩy sang reset); kèm phao 20s phòng audio treo không phát ended (file
    // dài nhất ~11s).
    let safety: ReturnType<typeof setTimeout> | undefined;
    const zoomDone = () => {
      if (speakingRef.current) {
        waitingRef.current = true;
        safety = setTimeout(() => {
          if (waitingRef.current) {
            waitingRef.current = false;
            setPhase("reset");
          }
        }, 20000);
        return;
      }
      setPhase("reset");
    };
    const next: Record<Phase, { after: number; run: () => void }> = {
      move: { after: MOVE_MS, run: () => setPhase("click") },
      click: { after: CLICK_MS, run: () => setPhase("zoom") },
      zoom: { after: ZOOM_MS, run: zoomDone },
      reset: {
        after: RESET_MS,
        run: () => {
          if (step + 1 >= steps.length) {
            if (onFinish) onFinish();
            else setDone(true);
            return;
          }
          setStep(step + 1);
          setPhase("move");
        },
      },
    };
    const t = setTimeout(next[phase].run, next[phase].after);
    return () => {
      clearTimeout(t);
      if (safety) clearTimeout(safety);
    };
  }, [phase, step, steps.length, onFinish, done]);

  const jumpTo = useCallback((i: number) => {
    waitingRef.current = false; // nhảy bước thì bỏ mọi cữ chờ đọc của bước cũ
    setDone(false);
    setStep(i);
    setPhase("move");
  }, []);

  const zoomed = phase === "zoom" && !done;
  const showPress = (phase === "click" || phase === "zoom") && !done;

  return (
    <div className="space-y-4">
      {/* Khung "video" — tỉ lệ đúng ảnh chụp 1440x960 */}
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border bg-muted shadow-lg [container-type:size]">
        <div
          className="absolute inset-0 transition-transform duration-700 ease-in-out"
          style={{
            transform: zoomed ? `scale(${current.zoom})` : "scale(1)",
            transformOrigin: `${origin.x}% ${origin.y}%`,
          }}
        >
          {allImages.map((src) => (
            <Image
              key={src}
              src={src}
              alt={alt}
              fill
              unoptimized
              priority
              className={cn(
                "transition-opacity duration-300",
                containImages.has(src) ? "object-contain" : "object-cover",
                src === current.img ? "opacity-100" : "opacity-0"
              )}
            />
          ))}

          {/* Vòng nhấn mục tiêu — sáng lên từ lúc click tới hết pha zoom */}
          <div
            className={cn(
              "absolute rounded-md border-2 border-primary shadow-[0_0_0_4px_rgba(16,185,129,0.25)] transition-opacity duration-300",
              showPress ? "opacity-100" : "opacity-0"
            )}
            style={{
              left: `${target.x - target.w / 2 - 0.5}%`,
              top: `${target.y - target.h / 2 - 0.8}%`,
              width: `${target.w + 1}%`,
              height: `${target.h + 1.6}%`,
            }}
          />

          {/* Ô nhập được "gõ" dần trong pha zoom: nền trắng che placeholder
              của ảnh, chữ hiện từng ký tự + caret nhấp nháy. */}
          {phase === "zoom" &&
            !done &&
            (() => {
              let offset = 0;
              return (current.typing ?? []).map((f) => {
                const start = offset;
                offset += f.text.length;
                const shown = f.text.slice(
                  0,
                  Math.max(0, Math.min(typed - start, f.text.length))
                );
                const active = typed >= start && typed < start + f.text.length;
                return (
                  <div
                    key={f.text}
                    className="absolute flex items-center rounded-sm bg-white pl-3 text-[2.9cqh] text-slate-700"
                    style={{
                      left: `${f.box.x - f.box.w / 2 + 0.5}%`,
                      top: `${f.box.y - f.box.h / 2 + 0.9}%`,
                      width: `${f.box.w - 1}%`,
                      height: `${f.box.h - 1.8}%`,
                    }}
                  >
                    {shown}
                    {active && <span className="animate-pulse">|</span>}
                  </div>
                );
              });
            })()}

          {/* Gợn sóng lúc click */}
          {phase === "click" && !done && (
            <span
              className="absolute size-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-primary/40"
              style={{ left: `${target.x}%`, top: `${target.y}%` }}
            />
          )}

          {/* Con trỏ ảo — lướt giữa các mục tiêu nhờ transition left/top */}
          <svg
            viewBox="0 0 24 24"
            className={cn(
              "absolute z-10 h-[3.2%] w-auto drop-shadow-md transition-all ease-in-out",
              phase === "move" ? "duration-1000" : "duration-300",
              showPress && "scale-90"
            )}
            style={{ left: `${target.x}%`, top: `${target.y}%` }}
          >
            <path
              d="M5 2 L5 19 L9.5 15.5 L12.5 21.5 L15.5 20 L12.5 14 L18 13.5 Z"
              fill="#fff"
              stroke="#1e293b"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Màn kết thúc (chế độ /guide): mờ nhẹ + nút xem lại */}
        {done && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/50">
            <p className="text-sm font-medium text-white">
              Bạn đã xem hết {steps.length} bước
            </p>
            <Button size="sm" onClick={() => jumpTo(0)}>
              <RotateCcw className="size-3.5" />
              Xem lại từ đầu
            </Button>
          </div>
        )}

        {/* Nhãn bước — ghim góc trái trên, không bị zoom cuốn theo */}
        <div className="absolute left-3 top-3 rounded-full bg-slate-900/85 px-3 py-1 text-xs font-semibold text-white shadow">
          Bước {step + 1}/{steps.length}
        </div>

        {/* Nút thuyết minh — ghim góc phải trên */}
        {voiceDir && (
          <button
            type="button"
            onClick={() => setVoiceOn((v) => !v)}
            title={voiceOn ? "Tắt thuyết minh" : "Bật giọng đọc thuyết minh"}
            aria-label={voiceOn ? "Tắt thuyết minh" : "Bật giọng đọc thuyết minh"}
            className={cn(
              "absolute right-3 top-3 flex size-8 items-center justify-center rounded-full shadow transition-colors",
              voiceOn
                ? "bg-primary text-primary-foreground"
                : "bg-slate-900/85 text-white hover:bg-slate-900"
            )}
          >
            {voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
        )}
      </div>

      {/* Chú thích bước hiện tại */}
      <div className="min-h-16 text-center">
        <p className="font-semibold">{current.title}</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
          {current.desc}
        </p>
      </div>

      {/* Chấm tiến trình — bấm để nhảy tới bước bất kỳ */}
      <div className="flex items-center justify-center gap-2">
        {steps.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={`Xem bước ${i + 1}`}
            onClick={() => jumpTo(i)}
            className={cn(
              "h-2 rounded-full transition-all",
              i === step && !done
                ? "w-6 bg-primary"
                : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"
            )}
          />
        ))}
      </div>
    </div>
  );
}
