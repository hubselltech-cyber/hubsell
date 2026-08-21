import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * ══ GIỌNG NÓI → CHỮ (chốt 21/08, đồng bộ với nút mic web) ══
 *
 * - NATIVE: expo-speech-recognition — bộ nhận dạng có sẵn của iOS
 *   (SFSpeechRecognizer) / Android (SpeechRecognizer), tiếng Việt, MIỄN PHÍ.
 *   Là native module nên CHỈ chạy trong dev build/bản phát hành — Expo Go
 *   thiếu module thì require ném lỗi → supported=false, ẩn nút mic, app vẫn
 *   chạy bình thường (vì vậy phải require động, không import tĩnh).
 * - WEB (giả lập localhost:8081): Web Speech API của trình duyệt, y hệt
 *   widget web — nên test được mic ngay trên Chrome không cần build native.
 *
 * Hợp đồng dùng: bấm toggle → nghe; transcript tạm bắn qua onTranscript (hiện
 * live trong ô input); câu chốt bắn qua onFinal (tự gửi). Bấm toggle lần nữa
 * = dừng và chốt những gì đã nghe.
 */

interface SpeechSub {
  remove(): void;
}

interface NativeSpeechModule {
  start(opts: { lang: string; interimResults: boolean; continuous: boolean }): void;
  stop(): void;
  abort(): void;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  addListener(
    event: "result" | "end" | "error",
    cb: (e: { isFinal?: boolean; results?: { transcript: string }[] }) => void
  ): SpeechSub;
}

let nativeModule: NativeSpeechModule | null = null;
if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require("expo-speech-recognition")
      .ExpoSpeechRecognitionModule as NativeSpeechModule;
  } catch {
    nativeModule = null; // Expo Go — chưa có native module
  }
}

// ── Web Speech API (đường web-sim) ──
interface WebSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getWebSpeechCtor(): (new () => WebSpeechRecognition) | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceInput(handlers: {
  onTranscript: (text: string) => void;
  onFinal: (text: string) => void;
}) {
  const supported =
    Platform.OS === "web" ? getWebSpeechCtor() !== null : nativeModule !== null;
  const [listening, setListening] = useState(false);

  // Handlers đổi mỗi render — listener native đăng ký 1 lần nên đi qua ref.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const webRecRef = useRef<WebSpeechRecognition | null>(null);
  const subsRef = useRef<SpeechSub[]>([]);
  const finalRef = useRef("");

  const cleanupNative = useCallback(() => {
    for (const s of subsRef.current) s.remove();
    subsRef.current = [];
  }, []);

  // Unmount giữa chừng (đóng màn chat) → hủy phiên nghe, không gửi vu vơ.
  useEffect(() => {
    return () => {
      webRecRef.current?.abort();
      webRecRef.current = null;
      if (subsRef.current.length > 0) {
        cleanupNative();
        nativeModule?.abort();
      }
    };
  }, [cleanupNative]);

  const toggle = useCallback(async () => {
    // Đang nghe → bấm lần nữa = chốt câu (stop vẫn trả kết quả cuối rồi mới end)
    if (listening) {
      if (Platform.OS === "web") webRecRef.current?.stop();
      else nativeModule?.stop();
      return;
    }

    finalRef.current = "";

    if (Platform.OS === "web") {
      const Ctor = getWebSpeechCtor();
      if (!Ctor) return;
      const rec = new Ctor();
      rec.lang = "vi-VN";
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        handlersRef.current.onTranscript(text);
        if (e.results.length > 0 && e.results[e.results.length - 1].isFinal) {
          finalRef.current = text;
        }
      };
      rec.onerror = () => {
        finalRef.current = ""; // not-allowed/no-speech — onend luôn bắn sau đó
      };
      rec.onend = () => {
        setListening(false);
        webRecRef.current = null;
        const q = finalRef.current.trim();
        if (q) handlersRef.current.onFinal(q);
      };
      webRecRef.current = rec;
      setListening(true);
      rec.start();
      return;
    }

    if (!nativeModule) return;
    const { granted } = await nativeModule.requestPermissionsAsync();
    if (!granted) return;

    cleanupNative();
    subsRef.current.push(
      nativeModule.addListener("result", (e) => {
        const text = e.results?.[0]?.transcript ?? "";
        handlersRef.current.onTranscript(text);
        if (e.isFinal) finalRef.current = text;
      }),
      nativeModule.addListener("error", () => {
        finalRef.current = "";
      }),
      nativeModule.addListener("end", () => {
        setListening(false);
        cleanupNative();
        const q = finalRef.current.trim();
        if (q) handlersRef.current.onFinal(q);
      })
    );
    setListening(true);
    nativeModule.start({ lang: "vi-VN", interimResults: true, continuous: false });
  }, [listening, cleanupNative]);

  return { supported, listening, toggle };
}
