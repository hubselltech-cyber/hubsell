import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Device from "expo-device";
import { fetchPackHours, matchTem } from "@/api/pack-video";
import { useAuth } from "@/auth/AuthContext";
import { packVideoRecordCaps } from "@/lib/pack-video-access";
import {
  HOURS_BLOCKED_RESYNC_MS,
  HOURS_RESYNC_MS,
  OUT_OF_HOURS_TEXT,
  afterClipStored,
  hoursLabel,
  outOfHours,
  parsePackHours,
  type PackHours,
} from "@/lib/pack-video-hours";
import { CODE_LINES_DELAY_MS, overlayLabelSupported, overlayLines, setOverlayLabel } from "@/lib/pack-video-overlay";
import {
  enqueueUpload,
  pendingUploadCount,
  resumeUploads,
  retryUpload,
  setHoursListener,
  setUploadListener,
  subscribeUploadCount,
  type UploadState,
} from "@/lib/pack-video-upload";
import { playScanSound } from "@/lib/scan-sounds";
import { Camera, CommonResolutions, useCameraPermission, useVideoOutput, type Recorder } from "react-native-vision-camera";
import {
  useBarcodeScannerOutput,
  type Barcode,
  type TargetBarcodeFormat,
} from "react-native-vision-camera-barcode-scanner";

/**
 * MÀN QUAY VIDEO ĐÓNG HÀNG / KHUI HÀNG HOÀN trên app (lên bản app thật 26/11/2026 — dựng và thử trên nhánh thử
 * 14–24/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 40).
 *
 * LUỒNG (anh Trung chốt 14/11: "cái anh cần là tự động"): đưa tem vào khung hình là quay, tem KẾ tự cắt clip — không
 * có nút bắt đầu, không quét kết thúc. Clip quay xong vào hàng chờ và lên hệ thống (lib/pack-video-upload.ts), lên
 * xong thì tệp trên máy tự xóa (anh chốt 18/11: không lưu trong máy).
 *
 * LUẬT CẮT (bản 3 + 4, đã thử trên máy thật):
 *   - Cắt theo GIÁ TRỊ mã, không theo loại mã: giá trị trông như mã vận đơn (8–30 chữ số / chữ cái) mà chưa thấy
 *     trong clip đang quay = tem mới. Mã vạch và QR cùng mang một mã vận đơn là một giá trị, không cắt nhầm; QR đường
 *     link bị bỏ qua. (Bản 1 "mã lạ = tem mới" và bản 2 "chỉ mã vạch mới cắt" đều cắt sai với tem TikTok × J&T.)
 *   - Mọi mã thấy trong 1,5 giây đầu của clip coi là cùng một tem.
 *   - Tem ĐÃ QUAY XONG trong phiên mà đưa vào lại → báo "đã quay rồi", không mở clip mới, không cắt clip đang quay.
 *     Mỗi chế độ (đóng / khui) một sổ tem: kiện hoàn về vẫn dán tem cũ nên tem đã quay đóng vẫn quay khui được.
 *
 * KHÔNG có nút chọn độ phân giải / bitrate / tỷ lệ (anh chốt 20/11: "khóa cứng luôn tỉ lệ 3:4 và 800K"); không có
 * nút, đường dẫn hay lời mời MUA giờ quay (luật thanh toán của Apple — giờ mua trên web).
 *
 * Tệp này nhập thư viện camera gốc → CHỈ được nạp sau khi `hasPackVideoNative()` đúng (app/pack-video.tsx nạp muộn).
 */

/** Mảng phải đứng ngoài component: hook đọc mã tạo lại đầu ra mỗi khi mảng đổi tham chiếu. */
const FORMATS: TargetBarcodeFormat[] = ["code-128", "qr-code"];
/** Giá trị trông như mã vận đơn / mã đơn. */
const TRACKING_LIKE = /^[A-Za-z0-9-]{8,30}$/;
/** Mã thấy trong khoảng này từ đầu clip = cùng một tem. */
const SAME_LABEL_WINDOW_MS = 1500;

/**
 * Chữ của bảng điều khiển KHÔNG phóng theo cỡ chữ hệ thống: máy để chữ to thì bảng chiếm nửa màn hình, che mất
 * khung quay (anh Trung thử iPhone 18/11).
 */
function T(props: React.ComponentProps<typeof Text>) {
  return <Text allowFontScaling={false} {...props} />;
}

/**
 * KHÓA CỨNG khung 3:4 + bitrate 800k — anh Trung 20/11: "mình sẽ khóa cứng luôn tỉ lệ 3:4 và 800K". Giờ quay bán MỘT
 * giá nên cỡ tệp không được tùy người quay (1.500k / 3.000k làm giá vốn lưu gấp 2–4 lần, THIET-KE mục 25.13).
 * Số đo iPhone ở mức này: 768×1024, ≈ 7,9 MB / phút (20/11).
 */
const RECORD_RESOLUTION = CommonResolutions.HD_4_3;
/** Tỷ lệ rộng / cao của TỆP quay (máy cầm dọc): cảm biến 4:3 ra tệp 3:4. */
const RECORD_ASPECT = 3 / 4;
const RECORD_BITRATE = 800_000;
/** iPhone 30 khung / giây (15 thì hình xem trước giật — anh Trung 18/11); Android 15 như bản đã đo trên Note8. */
const RECORD_FPS = Platform.OS === "ios" ? 30 : 15;
const CAMERA_CONSTRAINTS = [{ fps: RECORD_FPS }];

interface Seen {
  value: string;
  format: string;
}

type ClipKind = "PACK" | "UNBOX";

interface Clip {
  id: number;
  code: string;
  kind: ClipKind;
  /** null = còn đang quay. */
  durationS: number | null;
  failed: boolean;
  /** Tải lên hệ thống (không có = clip còn đang quay). */
  upload?: UploadState;
}

function uploadText(u: UploadState | undefined): string {
  if (!u) return "";
  if (u.status === "stored") return "✓ đã lên hệ thống";
  if (u.status === "uploading") return `↑ đang tải ${Math.round(u.progress * 100)}%`;
  if (u.status === "queued") return u.error ? `⏳ ${u.error}` : "⏳ chờ tải lên";
  return `✗ chưa lên được: ${u.error ?? "lỗi"}`;
}

const tail = (s: string) => (s.length > 16 ? `…${s.slice(-16)}` : s);

export function PackVideoScreen({ initialMode }: { initialMode?: "unbox" }) {
  useKeepAwake();
  const { hasPermission, requestPermission } = useCameraPermission();
  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winWidth } = useWindowDimensions();
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [clips, setClips] = useState<Clip[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Cảnh báo tem đã quay rồi: chữ + lúc thấy gần nhất (tự tắt sau 3 giây không thấy nữa). */
  const [dup, setDup] = useState<{ text: string; at: number } | null>(null);
  // Nhân viên chỉ quay kiểu mình có quyền (Đơn hàng → đóng; Đối soát đơn hoàn → khui — anh Trung chốt 24/11). Có đúng
  // MỘT kiểu thì khóa ở kiểu đó, ẩn nút kiểu kia. Máy chủ vẫn là rào thật ở bước tải lên.
  const { user } = useAuth();
  const recordCaps = packVideoRecordCaps(user);
  const onlyKind: ClipKind | null =
    recordCaps.pack && !recordCaps.unbox ? "PACK" : recordCaps.unbox && !recordCaps.pack ? "UNBOX" : null;
  const initialKind: ClipKind = onlyKind ?? (initialMode === "unbox" ? "UNBOX" : "PACK");
  const [kind, setKind] = useState<ClipKind>(initialKind);
  const kindRef = useRef<ClipKind>(initialKind);

  const videoOutput = useVideoOutput({
    targetResolution: RECORD_RESOLUTION,
    targetBitRate: RECORD_BITRATE,
    enableAudio: false,
    fileType: "mp4",
    // iPhone: chỉ đường quay "persistent" (AVCaptureVideoDataOutput + AVAssetWriter) mới cho từng khung hình đi qua mã
    // của thư viện — chỗ bản vá Swift in ngày giờ. H.264 được ép trong bản vá Swift lúc tạo bộ ghi (gọi
    // `setOutputSettings` ở đây báo lỗi vì đầu ra chưa nối vào phiên camera). Android giữ đường đã thử.
    enablePersistentRecorder: Platform.OS === "ios",
  });

  // iPhone: lớp ngày giờ được vẽ vào KHUNG GHI, không hiện trên màn xem trước → tự hiện một đồng hồ lên trên.
  const [iosClock, setIosClock] = useState("");
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const p = (n: number) => String(n).padStart(2, "0");
    const tick = () => {
      const d = new Date();
      setIosClock(
        `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
      );
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, []);

  /**
   * Các dòng mã đang được IN LÊN VIDEO (dưới ngày giờ) — anh Trung 18/11. `stampFor` = số clip mà các dòng này thuộc
   * về: câu trả lời "mã đơn hàng" của máy chủ về trễ, clip đã đổi rồi thì bỏ, không in mã đơn của tem trước lên video
   * của tem sau.
   */
  const [stampLines, setStampLines] = useState<string[]>([]);
  const stampFor = useRef(0);
  const applyStamp = useCallback((id: number, lines: string[]) => {
    stampFor.current = id;
    setOverlayLabel(lines);
    setStampLines(lines);
  }, []);
  /**
   * HAI DÒNG MÃ HIỆN TRỄ 1 GIÂY (anh Trung chốt 20/11, "cách C"): lúc mở clip chỉ gỡ chữ của tem trước; hẹn
   * CODE_LINES_DELAY_MS sau khi bộ ghi đã chạy mới in mã của tem này. `stampDue` = clip `stampFor` đã qua mốc;
   * `stampOrder` = mã đơn hàng máy chủ đã trả cho clip đó (về sớm trong giây đầu thì giữ lại, tới mốc mới in).
   */
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stampDue = useRef(false);
  const stampOrder = useRef<string | null>(null);
  // Rời màn quay thì gỡ chữ — lần mở sau không in mã của tem cũ lên clip đầu.
  useEffect(
    () => () => {
      if (stampTimer.current) clearTimeout(stampTimer.current);
      setOverlayLabel([]);
    },
    []
  );

  /**
   * SỐ GIỜ QUAY — sổ giờ ở máy chủ, dùng chung với web. `hours` = null khi chưa hỏi được (đang tải / mất mạng) → vẫn
   * cho quay, máy chủ là rào thật lúc tải lên. Nguồn số: hỏi `/hours` lúc mở màn + khi app trở lại màn hình (khách vừa
   * mua giờ trên web); sau đó máy chủ gửi KÈM số giờ ở mỗi lượt xin vé tải / báo xong (M2.2) nên không hỏi riêng nữa.
   * Máy chủ bản cũ không gửi kèm thì tự trừ thời lượng clip của chính máy này (`afterClipStored`) + hỏi lại theo nhịp thưa.
   */
  const [hours, setHours] = useState<PackHours | null>(null);
  const [hoursFailed, setHoursFailed] = useState(false);
  const hoursRef = useRef<PackHours | null>(null);
  const hoursAt = useRef(0);
  /** Lúc gần nhất máy chủ gửi kèm số giờ ở đường tải lên. */
  const serverHoursAt = useRef(0);
  const hoursLoading = useRef(false);
  /** Tem vừa bị từ chối vì hết giờ — kêu một lần cho mỗi tem, không kêu theo từng khung hình. */
  const lastBlockedCode = useRef("");
  const [noHours, setNoHours] = useState<{ at: number } | null>(null);
  /** Thời lượng (giây) của từng clip đã quay xong, để trừ vào số giờ khi clip đó lên hệ thống. */
  const clipSeconds = useRef<Map<number, number>>(new Map());
  const putHours = useCallback((next: PackHours) => {
    const wasOut = outOfHours(hoursRef.current);
    hoursRef.current = next;
    if (!outOfHours(next)) {
      lastBlockedCode.current = ""; // có giờ lại → tem vừa bị từ chối được quay
      if (wasOut) resumeUploads(); // …và các clip bị từ chối vì hết giờ được gửi lại
    }
    setHours(next);
  }, []);
  /** Số clip chưa lên hệ thống — kể cả clip của lần mở app trước còn nằm trong hàng chờ trên máy. */
  const [pending, setPending] = useState(() => pendingUploadCount());
  useEffect(() => subscribeUploadCount(() => setPending(pendingUploadCount())), []);
  const refreshHours = useCallback(async () => {
    if (hoursLoading.current) return;
    hoursLoading.current = true;
    hoursAt.current = Date.now(); // tính cả lượt hỏi hỏng: không hỏi dồn khi mất mạng
    try {
      putHours(parsePackHours(await fetchPackHours()));
      setHoursFailed(false);
    } catch {
      // Mất mạng / máy chủ lỗi: giữ số đang có (chưa có thì vẫn null = cho quay).
      setHoursFailed(true);
    } finally {
      hoursLoading.current = false;
    }
  }, [putHours]);
  // Hỏi mỗi lần màn quay được mở / quay lại màn này, và khi app trở lại màn hình.
  useFocusEffect(
    useCallback(() => {
      void refreshHours();
    }, [refreshHours])
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshHours();
    });
    return () => sub.remove();
  }, [refreshHours]);
  // Số giờ máy chủ gửi kèm đường tải lên (M2.2) = số thật mới nhất.
  useEffect(() => {
    setHoursListener((raw) => {
      const now = Date.now();
      serverHoursAt.current = now;
      hoursAt.current = now;
      putHours(parsePackHours(raw));
      setHoursFailed(false);
    });
    return () => setHoursListener(null);
  }, [putHours]);
  /** Hết giờ mà vẫn có tem: báo + kêu lỗi (một lần mỗi tem) + hỏi lại máy chủ theo nhịp thưa. */
  const warnOutOfHours = useCallback(
    (code: string, now: number) => {
      if (lastBlockedCode.current !== code) {
        lastBlockedCode.current = code;
        playScanSound("error");
      }
      setNoHours({ at: now });
      if (now - hoursAt.current > HOURS_BLOCKED_RESYNC_MS) void refreshHours();
    },
    [refreshHours]
  );

  const recorderRef = useRef<Recorder | null>(null);
  /** Mã đã biết của tem đang quay. */
  const labelCodes = useRef<Set<string>>(new Set());
  const clipStartedAt = useRef(0);
  const clipId = useRef(0);
  const busy = useRef(false);
  const seq = useRef(0);
  /**
   * Sổ tem đã quay XONG trong phiên: giá trị mã → số clip — MỖI CHẾ ĐỘ MỘT SỔ. `done` luôn trỏ vào sổ của chế độ
   * đang chọn.
   */
  const [bookStore] = useState<Record<ClipKind, Map<string, number>>>(() => ({ PACK: new Map(), UNBOX: new Map() }));
  const books = useRef(bookStore);
  const done = useRef<Map<string, number>>(bookStore[initialKind]);
  const lastDupCode = useRef("");

  /** Ghi các mã vận đơn của clip vừa đóng vào sổ "đã quay". */
  const remember = useCallback(() => {
    if (!clipId.current) return;
    for (const value of labelCodes.current) {
      if (TRACKING_LIKE.test(value)) done.current.set(value, clipId.current);
    }
  }, []);

  const patchClip = useCallback((id: number, patch: Partial<Clip>) => {
    setClips((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  /** Đóng clip đang quay (nếu có) rồi mở clip mới cho `code`. */
  const startClip = useCallback(
    async (code: string, frame: Seen[]) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const prev = recorderRef.current;
        if (prev) {
          remember();
          recorderRef.current = null;
          await prev.stopRecording();
        }
        const id = ++seq.current;
        // Loại video chốt lúc MỞ clip: đổi chế độ giữa chừng thì clip đang quay đã được đóng trước (switchKind).
        const clipKind = kindRef.current;

        // IN MÃ LÊN VIDEO: SAU khi clip cũ đã dừng và TRƯỚC khi mở clip mới thì GỠ chữ của tem trước → giây đầu của clip
        // mới chỉ có ngày giờ. Mã của tem này được in sau CODE_LINES_DELAY_MS (hẹn ở dưới, lúc bộ ghi đã chạy). Mã đơn
        // hàng thì hỏi máy chủ song song; về trước mốc thì giữ lại, về sau mốc mà clip còn đang quay thì in thêm ngay.
        if (stampTimer.current) clearTimeout(stampTimer.current);
        stampDue.current = false;
        stampOrder.current = null;
        applyStamp(id, []);
        if (overlayLabelSupported) {
          void matchTem(code, clipKind)
            .then((res) => {
              const orderCode = res.order?.orderCode;
              if (!orderCode || stampFor.current !== id) return;
              stampOrder.current = orderCode;
              if (stampDue.current) applyStamp(id, overlayLines(code, orderCode));
            })
            .catch(() => {
              // Mất mạng / máy chủ lỗi: video vẫn có mã vận đơn, chỉ thiếu dòng mã đơn hàng.
            });
        }

        const recordedAt = new Date();
        const recorder = await videoOutput.createRecorder({});
        await recorder.startRecording(
          (path) => {
            patchClip(id, { durationS: Math.round(recorder.recordedDuration * 10) / 10 });
            clipSeconds.current.set(id, recorder.recordedDuration);
            // Clip quay xong là lên hệ thống (R2 + sổ video), lên xong xóa trên máy.
            let dims: { width: number; height: number } | null = null;
            try {
              const r = videoOutput.currentResolution;
              if (r) dims = { width: Math.min(r.width, r.height), height: Math.max(r.width, r.height) }; // cầm dọc
            } catch {
              dims = null;
            }
            enqueueUpload({
              localId: String(id),
              path,
              trackingCode: code,
              kind: clipKind,
              recordedAt,
              durationSec: recorder.recordedDuration,
              width: dims?.width ?? null,
              height: dims?.height ?? null,
              deviceName: Device.modelName ?? null,
            });
          },
          (err) => {
            setError(`Quay lỗi: ${err.message}`);
            patchClip(id, { failed: true, durationS: 0 });
          }
        );

        recorderRef.current = recorder;
        // Bộ ghi đã chạy → hẹn in mã của tem này. Trong lúc chờ mà clip đã đổi / đã dừng (stampFor khác) thì bỏ.
        stampTimer.current = setTimeout(() => {
          if (stampFor.current !== id) return;
          stampDue.current = true;
          applyStamp(id, overlayLines(code, stampOrder.current));
        }, CODE_LINES_DELAY_MS);
        // Âm báo (anh Trung 14/11: "còn thiếu tiếng nhạc"): nhận tem + clip đã mở → "ting-ting" như màn quét kho.
        // Video quay KHÔNG thu tiếng nên âm báo không lọt vào tệp.
        playScanSound("success");
        clipId.current = id;
        clipStartedAt.current = Date.now();
        labelCodes.current = new Set(frame.map((b) => b.value));
        labelCodes.current.add(code);
        setError(null);
        setCurrent(code);
        setClips((list) => [{ id, code, kind: clipKind, durationS: null, failed: false }, ...list]);
      } catch (e) {
        applyStamp(0, []); // không có clip nào đang quay → gỡ chữ
        setError(`Không mở được video: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        busy.current = false;
      }
    },
    [applyStamp, patchClip, remember, videoOutput]
  );

  const stopClip = useCallback(async () => {
    const prev = recorderRef.current;
    const stoppedId = stampFor.current;
    if (prev) remember();
    recorderRef.current = null;
    labelCodes.current = new Set();
    clipId.current = 0;
    setCurrent(null);
    if (prev) {
      try {
        await prev.stopRecording();
      } catch (e) {
        setError(`Dừng lỗi: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Gỡ chữ SAU khi clip đã dừng (gỡ trước thì mấy khung cuối của clip mất dòng mã). Trong lúc chờ dừng mà
    // tem mới đã mở clip khác (stampFor đã đổi) thì để yên chữ của clip mới.
    if (stampFor.current === stoppedId) applyStamp(0, []);
  }, [applyStamp, remember]);

  /** Nút Trở về: đóng clip đang quay (nó vào hàng chờ, gửi tiếp ở mọi màn) rồi rời màn quay. */
  const leave = useCallback(() => {
    void stopClip().finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/");
    });
  }, [router, stopClip]);

  /** Đổi Đóng hàng ↔ Khui hàng hoàn: đóng clip đang quay (giữ loại cũ), chuyển sang sổ tem của chế độ mới. */
  const switchKind = useCallback(
    (next: ClipKind) => {
      if (next === kindRef.current) return;
      void stopClip(); // phần đồng bộ (ghi sổ tem của chế độ CŨ) chạy xong trước khi đổi sổ bên dưới
      kindRef.current = next;
      done.current = books.current[next];
      lastDupCode.current = "";
      setDup(null);
      setKind(next);
    },
    [stopClip]
  );

  // Trạng thái tải lên của từng clip (hàng chờ sống ở cấp module, màn này chỉ nghe).
  useEffect(() => {
    setUploadListener((localId, state) => {
      patchClip(Number(localId), { upload: state });
      if (state.status === "stored") {
        const seconds = clipSeconds.current.get(Number(localId));
        clipSeconds.current.delete(Number(localId));
        // Máy chủ vừa gửi kèm số giờ ở lượt báo xong (M2.2) → đó là số thật, không trừ thêm nữa.
        if (Date.now() - serverHoursAt.current < 3000) return;
        // Máy chủ bản cũ: tự trừ thời lượng clip, lâu lâu mới hỏi lại số thật. Clip của lần mở app trước (nạp lại từ
        // hàng chờ trên máy) không có thời lượng ở đây → hỏi lại số thật.
        if (seconds != null && hoursRef.current) putHours(afterClipStored(hoursRef.current, seconds));
        if (seconds == null || Date.now() - hoursAt.current > HOURS_RESYNC_MS) void refreshHours();
      } else if (state.status === "failed") {
        void refreshHours(); // nhiều khả năng máy chủ vừa báo hết giờ
      }
    });
    return () => setUploadListener(null);
  }, [patchClip, putHours, refreshHours]);

  /** Tem đã quay rồi được đưa vào lại: chỉ báo, không mở / cắt clip. */
  const warnDuplicate = useCallback((b: Seen, now: number) => {
    if (lastDupCode.current !== b.value) {
      lastDupCode.current = b.value;
      playScanSound("duplicate"); // "boop-boop", một lần cho mỗi tem
    }
    setDup({ text: `Tem ${tail(b.value)} ĐÃ QUAY RỒI — không quay lại`, at: now });
  }, []);

  const onBarcodeScanned = useCallback(
    (barcodes: Barcode[]) => {
      const now = Date.now();
      const frame: Seen[] = barcodes
        .map((b) => ({ value: b.rawValue ?? b.displayValue ?? "", format: String(b.format) }))
        .filter((b) => b.value);
      if (frame.length === 0) return;
      const recording = recorderRef.current != null;

      const candidates = frame.filter((b) => TRACKING_LIKE.test(b.value));
      if (!recording) {
        if (busy.current) return; // đang đổi clip, lượt đọc này bỏ qua
        const old = candidates.find((b) => done.current.has(b.value));
        if (old) {
          warnDuplicate(old, now);
          return;
        }
        if (!candidates[0]) return; // đường link không mở clip
        if (outOfHours(hoursRef.current)) {
          warnOutOfHours(candidates[0].value, now); // hết giờ: không mở clip mới
          return;
        }
        void startClip(candidates[0].value, frame);
        return;
      }

      const known = labelCodes.current;
      if (now - clipStartedAt.current >= SAME_LABEL_WINDOW_MS) {
        const fresh = candidates.find((b) => !known.has(b.value));
        if (fresh) {
          if (done.current.has(fresh.value)) {
            warnDuplicate(fresh, now); // tem cũ: giữ nguyên clip đang quay
            return;
          }
          lastDupCode.current = "";
          if (outOfHours(hoursRef.current)) {
            // Tem kế = kiện trước đã xong → đóng clip đang quay (nó vẫn lên hệ thống: bắt đầu lúc còn giờ), KHÔNG mở
            // clip mới. Cùng cách với màn webcam.
            void stopClip();
            warnOutOfHours(fresh.value, now);
            return;
          }
          void startClip(fresh.value, frame);
          return;
        }
      }
      // Còn lại: mã của cùng tem (trong 1,5 giây đầu) hoặc đường link → nhớ là thuộc clip này.
      for (const b of frame) {
        if (!done.current.has(b.value)) known.add(b.value); // tem cũ còn lọt trong khung: không tính vào clip này
      }
    },
    [startClip, stopClip, warnDuplicate, warnOutOfHours]
  );

  const barcodeOutput = useBarcodeScannerOutput({
    barcodeFormats: FORMATS,
    outputResolution: "preview",
    onBarcodeScanned,
    onError: (e) => setError(`Đọc mã lỗi: ${e.message}`),
  });

  const outputs = useMemo(() => [videoOutput, barcodeOutput], [videoOutput, barcodeOutput]);

  // Mỗi giây dọn các dải cảnh báo đã cũ (không vẽ lại màn theo từng khung hình).
  useEffect(() => {
    const timer = setInterval(() => {
      setDup((d) => (d && Date.now() - d.at > 3000 ? null : d));
      setNoHours((d) => (d && Date.now() - d.at > 3000 ? null : d));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Đầu ra quay bị tạo lại / rời màn → đóng clip đang quay cho sạch (clip vẫn vào hàng chờ).
  useEffect(() => {
    return () => {
      void recorderRef.current?.stopRecording().catch(() => {});
      recorderRef.current = null;
      setCurrent(null);
    };
  }, [videoOutput]);

  if (!hasPermission) {
    return (
      <View style={s.center}>
        <T style={s.title}>Quay video đóng hàng</T>
        <T style={s.dim}>Hubsell cần quyền Camera để quay video đóng hàng.</T>
        <Pressable style={s.btn} onPress={() => void requestPermission()}>
          <T style={s.btnText}>Cấp quyền camera</T>
        </Pressable>
        <Pressable style={s.backBtn} onPress={leave} accessibilityRole="button" accessibilityLabel="Trở về">
          <Ionicons name="chevron-back" size={18} color="#e2e8f0" />
          <T style={s.backText}>Trở về</T>
        </Pressable>
      </View>
    );
  }

  const unbox = kind === "UNBOX";
  const hoursOut = outOfHours(hours);
  const storedCount = clips.filter((c) => c.upload?.status === "stored").length;
  // Khung xem trước = ĐÚNG tỷ lệ tệp video (bài học Note8: khung khác tỷ lệ thì người quay không thấy dòng ngày giờ),
  // đặt dưới thanh trạng thái, co vừa vùng còn trống.
  const ar = RECORD_ASPECT;
  const box =
    area.w > 0 && area.h > 0
      ? area.w / area.h > ar
        ? { width: Math.floor(area.h * ar), height: area.h }
        : { width: area.w, height: Math.floor(area.w / ar) }
      : null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View
        style={s.cameraArea}
        onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {box ? (
          <View style={box}>
            <Camera
              style={StyleSheet.absoluteFill}
              resizeMode="contain" /* "cover" cắt mất mép trên của hình khi bảng dưới cao lên → mất dòng ngày giờ trên màn xem trước */
              isActive={true}
              device="back"
              outputs={outputs}
              constraints={CAMERA_CONSTRAINTS}
              onError={(e) => setError(`Camera lỗi: ${e.message}`)}
            />
            {Platform.OS === "ios" ? (
              <View pointerEvents="none" style={s.iosStampStack}>
                <T style={s.iosClock}>{iosClock}</T>
                {/* Các dòng mã đang in lên video — vẽ lại ở đây vì màn xem trước iPhone không hiện lớp chữ của tệp. */}
                {stampLines.map((line) => (
                  <T key={line} style={s.iosStampLine}>
                    {line}
                  </T>
                ))}
              </View>
            ) : null}
            {noHours ? (
              <View style={[s.dupBanner, s.noHoursBanner]} pointerEvents="none">
                <T style={s.dupText}>⚠ {OUT_OF_HOURS_TEXT}</T>
              </View>
            ) : dup ? (
              <View style={s.dupBanner} pointerEvents="none">
                <T style={s.dupText}>⚠ {dup.text}</T>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={[s.panel, unbox && s.panelUnbox, { paddingBottom: insets.bottom + 8 }]}>
        {/* Công tắc chế độ: Khui hàng hoàn đổi màu TÍM hẳn (giống màn webcam) để người quay không nhầm chế độ. */}
        <View style={s.kindRow}>
          {/* Anh Trung 20/11: "vào quay video không trở về được chỉ có thoát app" → nút Trở về. Đang quay thì đóng
              clip trước (clip vẫn vào hàng chờ và lên hệ thống), rồi mới rời màn. */}
          <Pressable onPress={leave} style={s.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Trở về">
            <Ionicons name="chevron-back" size={18} color="#e2e8f0" />
            {winWidth >= 360 ? <T style={s.backText}>Trở về</T> : null}
          </Pressable>
          {onlyKind !== "UNBOX" ? (
            <Pressable onPress={() => switchKind("PACK")} style={[s.kindBtn, !unbox && s.kindPackOn]}>
              <T style={[s.kindText, !unbox && s.kindTextOn]}>Đóng hàng</T>
            </Pressable>
          ) : null}
          {onlyKind !== "PACK" ? (
            <Pressable onPress={() => switchKind("UNBOX")} style={[s.kindBtn, unbox && s.kindUnboxOn]}>
              <T style={[s.kindText, unbox && s.kindTextOn]}>Khui hàng hoàn</T>
            </Pressable>
          ) : null}
        </View>
        <View style={s.statusRow}>
          {/* Đang quay: một dòng (mã tem). Đang chờ: câu hướng dẫn được hai dòng — màn 360dp cắt mất "…trước khi mở". */}
          <T style={[s.status, current ? (unbox ? s.recUnbox : s.rec) : s.idle]} numberOfLines={current ? 1 : 2}>
            {current
              ? `● ĐANG QUAY ${unbox ? "KHUI " : ""}${tail(current)}`
              : hoursOut
                ? "Hết giờ quay — không mở video mới"
                : unbox
                  ? "Chờ tem kiện hoàn — quay đủ 6 mặt kiện trước khi mở"
                  : "Chờ tem — đưa mã vận đơn vào khung hình"}
          </T>
          {/* Kiện cuối không có "tem kế" để tự cắt → nút dừng. */}
          {current ? <Chip label="Dừng quay" onPress={() => void stopClip()} /> : null}
        </View>
        {/* Số giờ quay còn lại — cùng số với web (sổ giờ ở máy chủ). Không có nút / đường dẫn mua giờ trong app. */}
        <View style={s.hoursRow}>
          <T style={[s.hoursText, hoursOut && s.hoursOut]} numberOfLines={1}>
            Giờ quay: {hours ? hoursLabel(hours) : hoursFailed ? "chưa kiểm tra được" : "đang kiểm tra…"}
          </T>
          {hoursOut || (!hours && hoursFailed) ? <Chip label="Kiểm tra lại" onPress={() => void refreshHours()} /> : null}
        </View>
        {/* Hàng chờ trên máy: video quay rồi mà chưa lên hệ thống (mất mạng, tắt app giữa chừng). Máy tự gửi tiếp;
            nút để gửi ngay. Lên xong thì tệp trên máy tự xóa. */}
        {pending > 0 ? (
          <View style={s.hoursRow}>
            <T style={s.pendingText} numberOfLines={1}>
              Chờ gửi lên hệ thống: {pending} video
            </T>
            <Chip label="Gửi lại" onPress={() => resumeUploads()} />
          </View>
        ) : null}
        <T style={s.line}>
          Lượt quay này: <T style={s.big}>{clips.length}</T> video{"   "}Đã lên hệ thống:{" "}
          <T style={s.big}>{storedCount}</T>
        </T>

        {error ? <T style={s.err}>{error}</T> : null}

        {/* Mã tem hiện ĐẦY ĐỦ, chật thì xuống dòng (anh Trung 21/11 ở bản webcam: "muốn mã luôn được hiển thị đầy đủ"). */}
        <ScrollView style={s.log}>
          {clips.map((c) => (
            <View key={c.id} style={s.clipRow}>
              <T style={[s.logLine, s.clipText]}>
                {c.kind === "UNBOX" ? "KHUI " : ""}
                {c.code}
                {" · "}
                {c.failed ? "quay lỗi" : c.durationS == null ? "đang quay…" : `${c.durationS} giây`}
                {c.upload ? `\n   ${uploadText(c.upload)}` : ""}
              </T>
              {c.upload?.status === "failed" ? <Chip label="Thử lại" onPress={() => retryUpload(String(c.id))} /> : null}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.chip} hitSlop={6}>
      <T style={s.chipText}>{label}</T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  cameraArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  iosStampStack: { position: "absolute", top: 8, left: 8, alignItems: "flex-start", gap: 2 },
  iosClock: {
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  iosStampLine: {
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 15,
    fontWeight: "700",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24, backgroundColor: "#0f172a" },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  dim: { color: "#94a3b8", textAlign: "center" },
  btn: { backgroundColor: "#10b981", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: "#fff", fontWeight: "700" },
  panel: { backgroundColor: "#0f172a", paddingHorizontal: 12, paddingTop: 8, maxHeight: "40%" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  status: { fontSize: 16, fontWeight: "800", flex: 1 },
  rec: { color: "#f87171" },
  recUnbox: { color: "#c4b5fd" },
  panelUnbox: { backgroundColor: "#2e1065", borderTopWidth: 2, borderTopColor: "#8b5cf6" },
  kindRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  kindBtn: { flex: 1, borderWidth: 1, borderColor: "#475569", borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  kindPackOn: { backgroundColor: "#10b981", borderColor: "#10b981" },
  kindUnboxOn: { backgroundColor: "#8b5cf6", borderColor: "#8b5cf6" },
  kindText: { color: "#cbd5e1", fontSize: 14, fontWeight: "700" },
  kindTextOn: { color: "#fff" },
  idle: { color: "#94a3b8" },
  line: { color: "#e2e8f0", marginTop: 4 },
  big: { color: "#34d399", fontSize: 18, fontWeight: "800" },
  dupBanner: { position: "absolute", top: 48, left: 12, right: 12, backgroundColor: "#b45309", borderRadius: 12, padding: 14 },
  dupText: { color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  noHoursBanner: { backgroundColor: "#b91c1c" },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  hoursText: { color: "#34d399", fontSize: 13, fontWeight: "700", flexShrink: 1, fontVariant: ["tabular-nums"] },
  hoursOut: { color: "#f87171" },
  pendingText: { color: "#fbbf24", fontSize: 13, fontWeight: "700", flexShrink: 1, fontVariant: ["tabular-nums"] },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 10,
    paddingVertical: 8,
    paddingLeft: 6,
    paddingRight: 10,
  },
  backText: { color: "#e2e8f0", fontSize: 14, fontWeight: "700" },
  chip: { borderWidth: 1, borderColor: "#475569", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: "#cbd5e1", fontSize: 12, fontWeight: "600" },
  err: { color: "#fbbf24", marginTop: 6 },
  log: { marginTop: 6, maxHeight: 130 },
  clipRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  clipText: { flex: 1 },
  logLine: { color: "#e2e8f0", fontSize: 12, marginBottom: 6, fontVariant: ["tabular-nums"] },
});
