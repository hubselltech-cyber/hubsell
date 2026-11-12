import React, { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { Ionicons } from "@expo/vector-icons";
import { scanPacking } from "@/api/orders";
import { ApiError } from "@/api/client";
import { CameraPermissionPrompt, CircleControl, SCANNABLE } from "@/components/ScanChrome";
import { groupVN } from "@/lib/format";
import { PackScanGate } from "@/lib/pack-scan-gate";
import {
  flashOfError,
  flashOfResponse,
  isNetworkFailure,
  type PackFlash,
  type PackFlashKind,
  type PackHaptic,
} from "@/lib/pack-scan-feedback";
import { playScanSound } from "@/lib/scan-sounds";
import { useKeyboardLift } from "@/lib/useKeyboardLift";
import { TABULAR } from "@/theme/tokens";

/**
 * MÀN QUÉT ĐÓNG GÓI (05/11/2026, anh Trung) — bước nội bộ sau in phiếu, cùng việc với
 * trang /orders/packing của web: gói xong, quét lại từng kiện → đơn sang "Đã đóng gói";
 * đơn ĐÃ HỦY kêu còi riêng để bỏ kiện lại, không để ship ôm đi.
 *
 * Khác hẳn ScanScreen (quét → hộp kết quả → BẤM mới quét tiếp): ở đây quét LIÊN TỤC,
 * không có nút nào phải bấm giữa hai kiện. Phản hồi = âm + rung + màn báo tự tắt
 * (lib/pack-scan-feedback.ts); chống bắn lặp và mã vạch thứ hai của cùng tem =
 * lib/pack-scan-gate.ts. Cả hai là hàm thuần, có test.
 *
 * Lối vào: nút "Đóng gói" cạnh ô tìm ở Đơn hàng (route gốc /pack-scan, có mũi tên về),
 * và công tắc "Xem đơn · Đóng gói" ở tab QR giữa (embedded) — lối của nhân viên, khu
 * nhân viên không có tab Đơn hàng.
 *
 * KHÔNG làm ở app: "Bỏ dấu" khi quét nhầm, lập biên bản bàn giao — ở web.
 */

/** Lượt gọi quá chừng này coi là mất mạng — không để một kiện treo cả dây chuyền. Mặc định tự chọn. */
const REQUEST_TIMEOUT_MS = 8000;
/**
 * Mã KHÔNG ra đơn do camera đọc: hoãn báo lỗi chừng này. Tem có mã phân tuyến đứng trước
 * mã vận đơn thì trong lúc hoãn, mã vận đơn ra đơn → bỏ luôn báo lỗi oan. Mặc định tự chọn.
 */
const UNKNOWN_GRACE_MS = 700;

/** Màu màn báo — cố định, không theo giao diện sáng / tối (phải nhận ra từ khóe mắt). */
const FLASH_STYLE: Record<
  PackFlashKind,
  { bg: string; fg: string; sub: string; icon: keyof typeof Ionicons.glyphMap; dot: string }
> = {
  ok: { bg: "rgba(5,150,105,0.95)", fg: "#ffffff", sub: "#d1fae5", icon: "checkmark-circle", dot: "#34d399" },
  caution: { bg: "rgba(245,158,11,0.96)", fg: "#1c1917", sub: "#451a03", icon: "warning", dot: "#fbbf24" },
  dup: { bg: "rgba(245,158,11,0.96)", fg: "#1c1917", sub: "#451a03", icon: "copy", dot: "#fbbf24" },
  cancelled: { bg: "rgba(220,38,38,0.97)", fg: "#ffffff", sub: "#fee2e2", icon: "ban", dot: "#f87171" },
  blocked: { bg: "rgba(190,18,60,0.96)", fg: "#ffffff", sub: "#ffe4e6", icon: "close-circle", dot: "#fb7185" },
  failed: { bg: "rgba(190,18,60,0.96)", fg: "#ffffff", sub: "#ffe4e6", icon: "alert-circle", dot: "#fb7185" },
};

function vibrate(kind: PackHaptic) {
  if (Platform.OS === "web") return;
  const N = Haptics.NotificationFeedbackType;
  const fire = (t: Haptics.NotificationFeedbackType) => void Haptics.notificationAsync(t).catch(() => {});
  if (kind === "success") fire(N.Success);
  else if (kind === "warning") fire(N.Warning);
  else {
    fire(N.Error);
    // Đơn hủy: nhịp thứ hai để tay cầm máy cũng nhận ra, không lẫn với lỗi thường.
    if (kind === "errorTwice") setTimeout(() => fire(N.Error), 350);
  }
}

export function PackScanScreen({
  embedded = false,
  onClose,
  modeSwitch,
}: {
  /** Đang nằm trong tab QR giữa → nút X (onClose) thay mũi tên quay lại. */
  embedded?: boolean;
  onClose?: () => void;
  /** Công tắc "Xem đơn · Đóng gói" của tab QR giữa. */
  modeSwitch?: React.ReactNode;
}) {
  useKeepAwake(); // gói hàng cả ca — không để màn hình tự tắt
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWeb = Platform.OS === "web";
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  /** Màn báo đang hiện; `id` đổi mỗi lượt để hai kết quả giống nhau liên tiếp vẫn hẹn giờ lại. */
  const [flash, setFlash] = useState<(PackFlash & { id: number }) | null>(null);
  /** Kết quả gần nhất — nằm lại ở dải đáy sau khi màn báo tắt. */
  const [last, setLast] = useState<PackFlash | null>(null);
  const [counts, setCounts] = useState({ packed: 0, cancelled: 0, failed: 0 });
  /**
   * Ô đếm tính theo ĐƠN, không theo lượt quét (12/11/2026, khách báo "đơn hủy bị tính
   * nhiều lần"): một kiện hủy bắn lại sau 10 giây vẫn kêu còi nhưng không cộng thêm.
   * Khóa = ô đếm + id đơn (hoặc mã vừa quét khi không ra đơn).
   */
  const [counted] = useState(() => new Set<string>());
  /** Đơn ĐÃ HỦY gặp trong lượt quét — mới nhất trước; bấm ô "Đơn hủy" để xem lại và chép mã. */
  const [cancelledList, setCancelledList] = useState<CancelledHit[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const rootRef = useRef<View>(null);
  const { kbLift, kbOpen } = useKeyboardLift(rootRef);
  const navInset = embedded || kbLift > 0 ? 0 : insets.bottom;

  // useState (không useRef): tạo MỘT lần cho cả đời màn, đọc được lúc render.
  const [gate] = useState(() => new PackScanGate());
  const flashSeq = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
    };
  }, []);

  /** Hiện màn báo + kêu + rung + cộng ô đếm (mỗi đơn / mỗi mã chỉ cộng MỘT lần). */
  const announce = useCallback((f: PackFlash, orderId?: string) => {
    if (!alive.current) return;
    playScanSound(f.sound);
    vibrate(f.haptic);
    if (f.counter) {
      const key = f.counter;
      const once = `${key}:${orderId ?? f.code}`;
      if (!counted.has(once)) {
        counted.add(once);
        setCounts((c) => ({ ...c, [key]: c[key] + 1 }));
        if (f.kind === "cancelled") {
          setCancelledList((list) => [{ key: once, code: f.code, meta: f.meta, at: Date.now() }, ...list]);
        }
      }
    }
    setLast(f);
    const id = ++flashSeq.current;
    setFlash({ ...f, id });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      if (alive.current) setFlash((cur) => (cur?.id === id ? null : cur));
    }, f.holdMs);
  }, [counted]);

  /** Gửi một mã lên máy chủ. `fromCamera` = qua cửa chống bắn lặp, áp luật im lặng / hoãn báo. */
  const submit = useCallback(
    async (code: string, fromCamera: boolean) => {
      setBusy(true);
      try {
        const res = await Promise.race([
          scanPacking(code),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new ApiError("Máy chủ trả lời quá chậm", 408, null)),
              REQUEST_TIMEOUT_MS
            )
          ),
        ]);
        const seen = gate.resolved(code, res.order.id, Date.now());
        // Đã ra đơn → báo lỗi "không thấy mã" đang hoãn (mã vạch khác của cùng tem) là oan.
        if (graceTimer.current) {
          clearTimeout(graceTimer.current);
          graceTimer.current = null;
        }
        // Luật 5: camera đọc sang mã vạch khác của tem ĐANG nằm trong khung (mã đơn cạnh mã
        // vận đơn) → máy chủ trả lời lần hai cho đúng đơn đó: im, không kêu "đã quét rồi" oan.
        // Còn kiện được đưa vào LẦN NỮA ("repeat") thì luôn báo — bản 05/11 im lặng 10 giây
        // theo id đơn nên quét lại là màn hình đơ (anh Trung thử máy thật 12/11).
        if (fromCamera && seen === "alias") return;
        announce(flashOfResponse(res, seen === "repeat"), res.order.id);
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        const message = err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại";
        const f = flashOfError(code, status, message);
        if (isNetworkFailure(status)) {
          gate.networkFailed(code, Date.now());
          announce(f);
        } else {
          gate.unknown(code);
          if (fromCamera) {
            if (graceTimer.current) clearTimeout(graceTimer.current);
            graceTimer.current = setTimeout(() => {
              graceTimer.current = null;
              announce(f);
            }, UNKNOWN_GRACE_MS);
          } else {
            announce(f);
          }
        }
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [announce, gate]
  );

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      const code = data.trim();
      if (!code) return;
      if (gate.admit(code, Date.now()) !== "fire") return;
      void submit(code, true);
    },
    [gate, submit]
  );

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    Keyboard.dismiss();
    // Máy chủ khớp chính xác, hoặc khớp một phần từ 6 ký tự (ít hơn là ra quá nhiều đơn).
    if (code.length < 6) {
      // Gõ thiếu là nhắc người gõ, chưa phải một kiện lỗi → không cộng ô Lỗi.
      announce({
        ...flashOfError(code, 400, "Gõ đủ mã, hoặc ít nhất 6 ký tự cuối của mã vận đơn / mã đơn"),
        counter: null,
      });
      return;
    }
    if (!gate.admitManual(code)) return; // đang có lượt gọi — giữ nguyên chữ để bấm lại
    setManual("");
    void submit(code, false);
  };

  // ----- Quyền camera (chỉ trên máy thật) -----
  if (!isWeb) {
    if (!permission) return <View className="flex-1 bg-slate-950" />;
    if (!permission.granted) {
      return (
        <CameraPermissionPrompt permission={permission} onRequest={() => void requestPermission()} />
      );
    }
  }

  const fs = flash ? FLASH_STYLE[flash.kind] : null;

  return (
    <View ref={rootRef} collapsable={false} className="flex-1 bg-slate-950">
      {/* Nền: camera thật trên máy — placeholder trên web (giả lập) */}
      {!isWeb ? (
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...SCANNABLE] }}
          onBarcodeScanned={onBarcodeScanned}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Ionicons name="barcode-outline" size={64} color="#334155" />
          <Text className="mt-3 px-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Camera quét chạy trên điện thoại.{"\n"}Bản web: gõ mã ở ô bên dưới để thử luồng.
          </Text>
        </View>
      )}

      {/* Chạm vào vùng camera = hạ bàn phím (bàn phím mở thì che thanh tab). */}
      {!isWeb && kbOpen ? (
        <Pressable
          className="absolute inset-0"
          onPress={() => Keyboard.dismiss()}
          accessibilityLabel="Đóng bàn phím"
        />
      ) : null}

      {/* MÀN BÁO — phủ kín vùng camera, tự tắt, không nhận chạm (không có gì để bấm). */}
      {flash && fs ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center px-6"
          style={{ backgroundColor: fs.bg }}
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`${flash.title}. ${flash.code}. ${flash.detail ?? ""}`}
        >
          <Ionicons name={fs.icon} size={92} color={fs.fg} />
          <Text
            className="mt-3 text-center text-[30px] font-extrabold leading-[36px]"
            style={{ color: fs.fg }}
          >
            {flash.title}
          </Text>
          <Text
            className="mt-2 text-center text-[19px] font-bold"
            style={[TABULAR, { color: fs.fg }]}
            numberOfLines={1}
          >
            {flash.code}
          </Text>
          {flash.meta ? (
            <Text className="mt-1 text-center text-sm font-medium" style={{ color: fs.sub }} numberOfLines={1}>
              {flash.meta}
            </Text>
          ) : null}
          {flash.detail ? (
            <Text
              className="mt-3 text-center text-[17px] font-semibold leading-6"
              style={{ color: fs.fg }}
            >
              {flash.detail}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Thanh trên + công tắc + khung ngắm */}
      <View
        pointerEvents="box-none"
        className="absolute inset-0"
        style={{ paddingTop: insets.top + 12 }}
      >
        <View className="flex-row items-center justify-between px-4">
          <View className="flex-1 flex-row items-center gap-2.5 pr-2">
            {embedded && onClose ? (
              <Pressable
                className="active:opacity-70"
                onPress={() => {
                  Keyboard.dismiss();
                  onClose();
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Đóng màn quét"
              >
                <CircleControl>
                  <Ionicons name="close" size={22} color="#fff" />
                </CircleControl>
              </Pressable>
            ) : !embedded && router.canGoBack() ? (
              <Pressable
                className="active:opacity-70"
                onPress={() => router.back()}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Quay lại"
              >
                <CircleControl>
                  <Ionicons name="arrow-back" size={20} color="#fff" />
                </CircleControl>
              </Pressable>
            ) : null}
            <View className="flex-1">
              {/* Đổ bóng chữ — nền camera có thể SÁNG (tem trắng, kho đèn mạnh) */}
              <Text
                className="text-lg font-bold text-white"
                style={{ textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 }}
              >
                Quét đóng gói
              </Text>
              <Text
                className="text-[11px] text-slate-200"
                style={{ textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 }}
                numberOfLines={1}
              >
                Quét liên tục từng kiện đã gói — không cần bấm
              </Text>
            </View>
          </View>
          {!isWeb ? (
            <Pressable
              className="active:opacity-70"
              onPress={() => setTorch((t) => !t)}
              accessibilityRole="button"
              accessibilityLabel={torch ? "Tắt đèn" : "Bật đèn"}
            >
              {torch ? (
                <View className="h-10 w-10 items-center justify-center rounded-full bg-amber-400">
                  <Ionicons name="flash" size={18} color="#0f172a" />
                </View>
              ) : (
                <CircleControl>
                  <Ionicons name="flash-outline" size={18} color="#fff" />
                </CircleControl>
              )}
            </Pressable>
          ) : null}
        </View>
        {modeSwitch}
        {!isWeb && !flash ? (
          <View className="flex-1 items-center justify-center" style={{ paddingBottom: 150 }}>
            <View className="h-40 w-72 rounded-2xl border-2 border-white/80" />
          </View>
        ) : null}
      </View>

      {/* DẢI ĐÁY cố định (không phải popup): kết quả gần nhất + ba ô đếm + ô gõ tay.
          Người gói nhìn kiện, lỡ mất màn báo thì ở đây vẫn còn dấu. */}
      <View
        className="absolute inset-x-0 px-3"
        style={{ bottom: kbLift, paddingBottom: 10 + navInset }}
      >
        <View className="rounded-2xl bg-slate-900/90 p-3">
          <View className="flex-row items-center gap-2">
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: last ? FLASH_STYLE[last.kind].dot : "#475569" }}
            />
            <Text className="flex-1 text-[13px] text-slate-200" numberOfLines={1}>
              {last ? (
                <>
                  <Text className="font-bold text-white" style={TABULAR}>
                    {last.code}
                  </Text>
                  {" — "}
                  {last.short}
                </>
              ) : (
                "Chưa quét kiện nào"
              )}
            </Text>
            {busy ? <Text className="text-[11px] text-slate-400">đang ghi…</Text> : null}
          </View>

          <View className="mt-2.5 flex-row gap-2">
            <CountTile label="Đã gói" value={counts.packed} color="#34d399" />
            <CountTile
              label="Đơn hủy"
              value={counts.cancelled}
              color="#f87171"
              onPress={counts.cancelled > 0 ? () => setShowCancelled(true) : undefined}
            />
            <CountTile label="Lỗi" value={counts.failed} color="#cbd5e1" />
          </View>

          {/* Gõ tay — tem nhăn / rách là chuyện hằng ngày ở kho */}
          <View className="mt-2.5 flex-row items-center gap-2">
            <TextInput
              className="flex-1 rounded-xl bg-slate-800 px-3 py-2.5 text-sm text-white"
              // minWidth 0: ô nhập trên web có bề rộng tối thiểu riêng, không ép thì đẩy nút ra ngoài màn hẹp.
              style={{ minWidth: 0 }}
              placeholder="Tem rách? Gõ mã vận đơn / mã đơn…"
              placeholderTextColor="#94a3b8"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              value={manual}
              onChangeText={setManual}
              onSubmitEditing={submitManual}
            />
            <Pressable
              className={`rounded-xl px-4 py-2.5 ${manual.trim() ? "bg-emerald-500 active:opacity-80" : "bg-slate-700"}`}
              onPress={submitManual}
              disabled={!manual.trim()}
              accessibilityRole="button"
              accessibilityLabel="Ghi đóng gói mã vừa gõ"
            >
              <Text className="text-sm font-bold text-white">Ghi</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* DANH SÁCH ĐƠN HỦY của lượt quét — để người gói rút đúng các kiện đó ra. */}
      <Modal
        visible={showCancelled}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="slide"
        onRequestClose={() => setShowCancelled(false)}
      >
        <View className="flex-1 justify-end bg-black/50">
          <Pressable className="flex-1" onPress={() => setShowCancelled(false)} />
          <View
            className="max-h-[70%] rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
            style={{ paddingBottom: 16 + insets.bottom }}
          >
            <View className="mb-1 flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/15">
                <Ionicons name="ban" size={16} color="#dc2626" />
              </View>
              <Text className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100">
                Đơn hủy đã quét ({groupVN(cancelledList.length)})
              </Text>
              <Pressable
                className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                onPress={() => setShowCancelled(false)}
                accessibilityRole="button"
                accessibilityLabel="Đóng"
              >
                <Ionicons name="close" size={22} color="#64748b" />
              </Pressable>
            </View>
            <Text className="mb-2 text-xs leading-[18px] text-slate-500 dark:text-slate-400">
              Bỏ các kiện này lại, không đưa cho đơn vị vận chuyển. Danh sách chỉ tính trong lượt quét này.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {cancelledList.map((c) => (
                <View
                  key={c.key}
                  className="mb-2 flex-row items-center gap-3 rounded-2xl border border-slate-100 px-3 py-2.5 dark:border-slate-800"
                >
                  <View className="min-w-0 flex-1">
                    <Text
                      className="text-sm font-bold text-slate-900 dark:text-slate-100"
                      style={TABULAR}
                      numberOfLines={1}
                      selectable
                    >
                      {c.code}
                    </Text>
                    <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
                      {[c.meta, `quét lúc ${clock(c.at)}`].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Pressable
                    className="flex-row items-center gap-1 rounded-full bg-slate-100 px-3 py-2 active:opacity-70 dark:bg-slate-800"
                    onPress={() => {
                      void Clipboard.setStringAsync(c.code).catch(() => {});
                      setCopiedCode(c.code);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Sao chép mã đơn ${c.code}`}
                  >
                    <Ionicons
                      name={copiedCode === c.code ? "checkmark" : "copy-outline"}
                      size={14}
                      color={copiedCode === c.code ? "#059669" : "#64748b"}
                    />
                    <Text
                      className={`text-xs font-semibold ${
                        copiedCode === c.code
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {copiedCode === c.code ? "Đã chép" : "Sao chép"}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface CancelledHit {
  key: string;
  code: string;
  meta: string | null;
  at: number;
}

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Một ô đếm của phiên quét — số to, nhãn nhỏ, ba ô chia đều. */
function CountTile({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  value: number;
  color: string;
  /** Có = ô bấm được (mở danh sách), hiện mũi tên nhỏ. */
  onPress?: () => void;
}) {
  return (
    <Pressable
      className={`flex-1 flex-row items-baseline justify-center gap-1.5 rounded-xl bg-slate-800 py-1.5 ${
        onPress ? "active:opacity-70" : ""
      }`}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={onPress ? `${label}: ${value}, bấm để xem danh sách` : undefined}
    >
      <Text className="text-lg font-extrabold" style={[TABULAR, { color }]}>
        {groupVN(value)}
      </Text>
      <Text className="text-[11px] font-medium text-slate-300" numberOfLines={1}>
        {label}
      </Text>
      {onPress ? <Ionicons name="chevron-forward" size={11} color="#94a3b8" /> : null}
    </Pressable>
  );
}
