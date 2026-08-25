"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  LogOut,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Store,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { clearToken } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Màn chào mừng lần đầu đăng nhập: KHÔNG còn tạo gian hàng giả lập nữa —
 * thay bằng HƯỚNG DẪN ĐỘNG kiểu video quay màn hình (con trỏ ảo tự chạy,
 * click, phóng to từng vùng thao tác) trên ảnh chụp giao diện THẬT của trang
 * Kênh bán, kết thúc đưa thẳng người dùng sang /channels để liên kết shop.
 *
 * Ảnh + tọa độ mục tiêu sinh bởi scripts/capture-onboarding-assets.js —
 * UI trang Kênh bán đổi thì chạy lại script và dán tọa độ mới vào TOUR_STEPS.
 */

// Nhớ "đã xem hướng dẫn" để lần chặn sau (chưa kết nối mà đi trang khác)
// vào thẳng thẻ hành động, không bắt xem lại video từ đầu.
const SEEN_KEY = "hubsell_onboarding_tour_seen";

const IMG_EMPTY = "/onboarding/onboard-channels-empty.png";
const IMG_DIALOG = "/onboarding/onboard-connect-dialog.png";
// Trang uỷ quyền THẬT của Shopee (bản gốc ở guide-assets/shopee-oauth-login.png,
// 960x1180 dọc — bước này hiển thị dạng contain, không phải ảnh do script chụp).
const IMG_SHOPEE_OAUTH = "/onboarding/onboard-shopee-oauth.png";
// Màn Confirm Authorization dựng lại theo ảnh thật (scripts/capture-shopee-confirm.js).
const IMG_SHOPEE_CONFIRM = "/onboarding/onboard-shopee-confirm.png";
const IMG_CONNECTED = "/onboarding/onboard-channel-connected.png";
const ALL_IMAGES = [
  IMG_EMPTY,
  IMG_DIALOG,
  IMG_SHOPEE_OAUTH,
  IMG_SHOPEE_CONFIRM,
  IMG_CONNECTED,
];

type TourStep = {
  img: string;
  title: string;
  desc: string;
  /** Tâm + kích thước mục tiêu, tính bằng % khung ảnh 1440x960. */
  target: { x: number; y: number; w: number; h: number };
  /** Mức phóng to khi "camera" zoom vào mục tiêu. */
  zoom: number;
  /** Ảnh dọc (trang uỷ quyền Shopee): hiển thị trọn trong khung thay vì phủ kín. */
  fit?: "contain";
  /**
   * Mô phỏng GÕ PHÍM trong pha zoom: mỗi field là một ô trên ảnh (tọa độ %
   * khung) được phủ nền trắng che placeholder rồi chữ hiện dần từng ký tự.
   */
  typing?: { box: { x: number; y: number; w: number; h: number }; text: string }[];
};

const TOUR_STEPS: TourStep[] = [
  {
    img: IMG_EMPTY,
    title: "Mở menu “Kênh bán”",
    desc: "Trong thanh điều hướng bên trái, chọn Kênh bán — trung tâm quản lý mọi gian hàng của bạn.",
    target: { x: 8.3, y: 54.9, w: 14.93, h: 4.58 },
    zoom: 1.9,
  },
  {
    img: IMG_EMPTY,
    title: "Bấm “Kết nối gian hàng”",
    desc: "Nút nằm ở góc phải phía trên. Một sàn có thể kết nối nhiều gian hàng khác nhau.",
    target: { x: 92.21, y: 10.83, w: 11.13, h: 3.33 },
    zoom: 2,
  },
  {
    img: IMG_DIALOG,
    title: "Chọn sàn muốn kết nối",
    desc: "Shopee, Lazada hay TikTok Shop — chọn sàn bạn đang bán trong ô “Sàn thương mại”.",
    target: { x: 50, y: 48.96, w: 28.89, h: 3.75 },
    zoom: 1.7,
  },
  {
    img: IMG_DIALOG,
    title: "Uỷ quyền chính chủ trên sàn",
    desc: "Bấm “Tiếp tục” — bạn đăng nhập ngay trên trang của sàn để cho phép Hubsell truy cập; tên gian hàng được lấy về tự động.",
    target: { x: 58.3, y: 61.88, w: 12.29, h: 3.33 },
    zoom: 1.85,
  },
  // 3 bước dưới diễn ra trên TRANG CHÍNH CHỦ của Shopee (ảnh thật trang
  // "Đăng nhập để cấp quyền"). Tọa độ theo KHUNG 3:2 sau khi ảnh dọc
  // 960x1180 được contain + căn giữa (ảnh chiếm 22.88%→77.12% bề ngang).
  {
    img: IMG_SHOPEE_OAUTH,
    title: "Chọn khu vực Việt Nam",
    desc: "Bạn được chuyển sang trang đăng nhập chính chủ của Shopee — đổi khu vực ở ô đầu tiên thành VN.",
    target: { x: 35.25, y: 37.9, w: 8.4, h: 6.9 },
    zoom: 1.6,
    fit: "contain",
    // Che chữ "SG" trong ảnh gốc bằng "VN" cho khớp lời hướng dẫn.
    typing: [{ box: { x: 33.8, y: 37.9, w: 4.8, h: 6.9 }, text: "VN" }],
  },
  {
    img: IMG_SHOPEE_OAUTH,
    title: "Đăng nhập tài khoản Shopee của shop",
    desc: "Điền tên đăng nhập và mật khẩu Shopee rồi bấm “Đăng Nhập” — bạn nhập trực tiếp trên trang Shopee, Hubsell không nhìn thấy mật khẩu.",
    target: { x: 50, y: 42.6, w: 37.9, h: 16.3 },
    zoom: 1.5,
    fit: "contain",
    typing: [
      { box: { x: 54.2, y: 37.9, w: 29.5, h: 6.9 }, text: "shop_cua_ban" },
      { box: { x: 50, y: 47.4, w: 37.9, h: 6.8 }, text: "••••••••••" },
    ],
  },
  {
    img: IMG_SHOPEE_CONFIRM,
    title: "Xác nhận uỷ quyền cho Hubsell",
    desc: "Shopee liệt kê các quyền Hubsell cần (sản phẩm, đơn hàng, thanh toán, khuyến mãi) — bấm “Confirm Authorization” để hoàn tất kết nối.",
    target: { x: 24.86, y: 53.13, w: 23.33, h: 4.79 },
    zoom: 1.8,
  },
  {
    img: IMG_CONNECTED,
    title: "Đồng bộ đơn hàng",
    desc: "Kết nối xong, đơn hàng tự chảy về Hubsell. Muốn kéo ngay lập tức, bấm “Đồng bộ đơn” trên gian vừa nối.",
    target: { x: 73.19, y: 28.75, w: 8.24, h: 2.92 },
    zoom: 1.95,
  },
];

// Nhịp một bước: con trỏ lướt tới → click (gợn sóng) → zoom vào ngắm → thu về.
const MOVE_MS = 1000;
const CLICK_MS = 700;
const ZOOM_MS = 2300;
const RESET_MS = 700;

type Phase = "move" | "click" | "zoom" | "reset";

/**
 * Tâm zoom tự né mép: mục tiêu sát cạnh (menu Kênh bán sát trái, nút Kết nối
 * gian hàng sát phải) mà lấy đúng tâm mục tiêu làm transform-origin thì sau khi
 * phóng to sẽ bị cắt mất một nửa. Dịch origin vừa đủ để cả mục tiêu (kèm đệm)
 * nằm trọn khung: điểm p sau scale quanh origin o nằm tại o + (p − o)·z.
 */
function zoomOrigin(t: TourStep["target"], zoom: number) {
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

/** Trình phát hướng dẫn: ảnh thật + con trỏ ảo + thu phóng như video. */
function TourPlayer({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("move");
  // Số ký tự đã "gõ" (tính trên chuỗi ghép mọi field) của bước có typing.
  const [typed, setTyped] = useState(0);

  // THUYẾT MINH bằng file MP3 thu sẵn giọng nữ Hoài My (vi-VN-HoaiMyNeural,
  // sinh bởi scripts/generate-onboarding-voice.js) — mọi máy nghe MỘT giọng
  // tiếng Việt chuẩn, không phụ thuộc giọng đọc cài trên trình duyệt (bản
  // Web Speech API cũ đọc ngọng trên máy thiếu giọng Việt — anh Trung chê).
  // Mặc định TẮT: trình duyệt chặn tự phát âm thanh khi chưa có thao tác
  // người dùng, bấm nút loa = bật.
  const [voiceOn, setVoiceOn] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakingRef = useRef(false); // đang đọc dở
  const waitingRef = useRef(false); // pha zoom đã hết giờ, đang nán chờ đọc xong

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    speakingRef.current = false;
  }, []);

  useEffect(() => stopSpeaking, [stopSpeaking]); // unmount thì im lặng ngay

  const speakStep = useCallback(
    (i: number) => {
      stopSpeaking();
      const a = new Audio(`/onboarding/voice/step-${i + 1}.mp3`);
      audioRef.current = a;
      speakingRef.current = true;
      const done = () => {
        if (audioRef.current !== a) return; // đã bị bước khác/nút tắt thay thế
        speakingRef.current = false;
        // Pha zoom hết giờ từ trước — đọc xong mới cho máy trạng thái đi tiếp.
        if (waitingRef.current) {
          waitingRef.current = false;
          setPhase("reset");
        }
      };
      a.onended = done;
      a.onerror = done;
      // play() bị chặn (chưa có thao tác người dùng) → coi như đọc xong, không treo.
      a.play().catch(done);
    },
    [stopSpeaking]
  );

  // Sang bước mới (hoặc vừa bật loa giữa chừng) → đọc lời bước đó;
  // tắt loa → ngắt ngay và thả máy trạng thái nếu đang nán chờ.
  useEffect(() => {
    if (voiceOn) {
      speakStep(step);
      return;
    }
    stopSpeaking();
    if (waitingRef.current) {
      waitingRef.current = false;
      setPhase("reset");
    }
  }, [step, voiceOn, speakStep, stopSpeaking]);

  const current = TOUR_STEPS[step];
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
          if (step + 1 >= TOUR_STEPS.length) {
            onFinish();
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
  }, [phase, step, onFinish]);

  const jumpTo = useCallback((i: number) => {
    waitingRef.current = false; // nhảy bước thì bỏ mọi cữ chờ đọc của bước cũ
    setStep(i);
    setPhase("move");
  }, []);

  const zoomed = phase === "zoom";
  const showPress = phase === "click" || phase === "zoom";

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
          {/* Chồng sẵn cả 3 ảnh, chỉ đổi opacity — không nháy trắng khi sang ảnh khác */}
          {ALL_IMAGES.map((src) => (
            <Image
              key={src}
              src={src}
              alt="Hướng dẫn liên kết gian hàng"
              fill
              unoptimized
              priority
              className={cn(
                "transition-opacity duration-300",
                // Ảnh dọc của bước fit:"contain" hiển thị trọn (viền hai bên),
                // ảnh app 1440x960 thì phủ kín khung như cũ.
                TOUR_STEPS.some((s) => s.img === src && s.fit === "contain")
                  ? "object-contain"
                  : "object-cover",
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
          {phase === "click" && (
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

        {/* Nhãn bước — ghim góc trái trên, không bị zoom cuốn theo */}
        <div className="absolute left-3 top-3 rounded-full bg-slate-900/85 px-3 py-1 text-xs font-semibold text-white shadow">
          Bước {step + 1}/{TOUR_STEPS.length}
        </div>

        {/* Nút thuyết minh — ghim góc phải trên */}
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
        {TOUR_STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={`Xem bước ${i + 1}`}
            onClick={() => jumpTo(i)}
            className={cn(
              "h-2 rounded-full transition-all",
              i === step
                ? "w-6 bg-primary"
                : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60"
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function OnboardingOverlay({
  isAdmin,
  onGoConnect,
  onLogout,
}: {
  isAdmin: boolean;
  /** Đưa người dùng sang trang Kênh bán (/channels) để liên kết shop thật. */
  onGoConnect: () => void;
  onLogout: () => void;
}) {
  // 'tour' = đang phát hướng dẫn; 'ready' = thẻ hành động cuối.
  const [view, setView] = useState<"tour" | "ready">("tour");

  // Đã xem một lần rồi → vào thẳng thẻ hành động (vẫn có nút Xem lại).
  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY)) setView("ready");
  }, []);

  const markSeen = useCallback(() => {
    localStorage.setItem(SEEN_KEY, "1");
    setView("ready");
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gradient-to-br from-muted/60 via-background to-primary/5 p-4">
      <div className="w-full max-w-3xl py-6">
        {/* Logo + lời chào */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {/* unoptimized: giữ độ nét từ bản gốc 417px (xem chú thích ở /login) */}
          <Image
            src="/logo-hubsell.png"
            alt="Hubsell"
            width={417}
            height={417}
            priority
            unoptimized
            className="size-18 rounded-2xl shadow-lg"
          />
          <div>
            <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
              <Sparkles className="size-6 text-primary" />
              Chào mừng bạn đến với Hubsell!
            </h1>
            <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
              {isAdmin
                ? view === "tour"
                  ? "Xem nhanh cách liên kết gian hàng thật — chỉ mất chưa đầy một phút."
                  : "Liên kết gian hàng thật của bạn để Hubsell bắt đầu đồng bộ đơn hàng."
                : "Bước đầu tiên để kích hoạt hệ thống là kết nối gian hàng."}
            </p>
          </div>
        </div>

        {isAdmin ? (
          view === "tour" ? (
            <>
              <TourPlayer onFinish={markSeen} />
              <div className="mt-4 flex justify-center">
                <Button variant="ghost" size="sm" onClick={markSeen}>
                  Bỏ qua hướng dẫn
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            // Thẻ hành động cuối: vào thẳng Kênh bán để liên kết shop thật
            <div className="rounded-2xl border bg-background p-8 text-center shadow-sm">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                <PlugZap className="size-7 text-primary" />
              </div>
              <p className="text-lg font-semibold">Bạn đã sẵn sàng!</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Vào trang <span className="font-medium text-foreground">Kênh bán</span>,
                bấm “Kết nối gian hàng” rồi uỷ quyền trên sàn — đơn hàng sẽ tự
                đồng bộ về ngay sau đó.
              </p>

              <div className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm">
                {[
                  { icon: ShieldCheck, text: "Uỷ quyền chính chủ trên trang của sàn — Hubsell không giữ mật khẩu của bạn." },
                  { icon: Zap, text: "Đơn hàng, sản phẩm tự đồng bộ về ngay sau khi kết nối." },
                  { icon: Store, text: "Một sàn kết nối được nhiều gian hàng, quản lý tập trung một nơi." },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-start gap-2.5 text-muted-foreground">
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col items-center gap-2">
                <Button size="lg" onClick={onGoConnect}>
                  <PlugZap className="size-4" />
                  Liên kết gian hàng ngay
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setView("tour")}>
                  <RotateCcw className="size-3.5" />
                  Xem lại hướng dẫn
                </Button>
              </div>
            </div>
          )
        ) : (
          // Nhân viên không thể tự kết nối gian hàng
          <div className="rounded-2xl border bg-background p-8 text-center shadow-sm">
            <Store className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">Cửa hàng chưa kết nối gian hàng nào</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Vui lòng liên hệ Chủ shop để kết nối gian hàng trước khi bắt đầu
              làm việc.
            </p>
          </div>
        )}

        {/* Đăng xuất */}
        <div className="mt-6 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearToken();
              onLogout();
            }}
          >
            <LogOut className="size-4" />
            Đăng xuất
          </Button>
        </div>
      </div>
    </div>
  );
}
