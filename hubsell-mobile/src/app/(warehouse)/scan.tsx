import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { lookupOrder, markDamaged, receiveReturn } from "@/api/orders";
import { ApiError } from "@/api/client";
import type { LookupAmbiguousBody, OrderDto } from "@/types/api";
import { CHANNEL_LABEL, RETURN_STATUS } from "@/lib/labels";
import { playScanSound } from "@/lib/scan-sounds";
import { Badge } from "@/components/Badge";
import { ActionButton } from "@/components/ActionButton";

/**
 * QUÉT XỬ LÝ ĐƠN HOÀN — màn hình mặc định của nhân viên kho.
 *
 * Luồng 2 CÔNG ĐOẠN (chốt 13/08, khớp web):
 *   [✓ Quét nhận]  → POST /warehouse/returns/:id/receive — ghi "hàng đã về
 *                    tay", KHÔNG cộng kho; nhập kho là nút bulk trên web.
 *   [✗ Hàng hỏng]  → POST /orders/:id/return DAMAGED — không cộng kho,
 *                    chuyển sang chờ khiếu nại.
 *
 * Camera bắn sự kiện liên tục (~10 lần/giây) nên PHẢI khóa sau lần đọc đầu
 * (scanLock) — không khóa là gọi API trùng và rung máy loạn xạ.
 */

type Panel =
  | { type: "order"; order: OrderDto }
  | { type: "candidates"; code: string; list: LookupAmbiguousBody["candidates"] }
  | { type: "error"; message: string }
  | { type: "done"; message: string; warn?: string };

const SCANNABLE = [
  "qr",
  "code128",
  "code39",
  "code93",
  "itf14",
  "ean13",
  "datamatrix",
] as const;

// Liquid Glass (trend 2026) CHỈ cho lớp điều khiển nổi trên camera — panel
// dữ liệu vẫn nền đặc cho dễ đọc. Máy không hỗ trợ (Android/iOS cũ/web)
// fallback về đen mờ như cũ.
const GLASS = isLiquidGlassAvailable();

/** Nút tròn trên nền camera: Liquid Glass khi máy hỗ trợ, fallback đen mờ. */
function CircleControl({ children }: { children: React.ReactNode }) {
  if (GLASS) {
    return (
      <GlassView
        glassEffectStyle="regular"
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View className="h-10 w-10 items-center justify-center rounded-full bg-black/40">
      {children}
    </View>
  );
}

/** embedded = đang nằm trong một TAB (khu chủ shop) → không có mũi tên quay lại. */
export default function ScanReturnsScreen({ embedded = false }: { embedded?: boolean }) {
  useKeepAwake(); // kho quét cả ca — không để màn hình tự tắt
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [manual, setManual] = useState("");
  const [damageNote, setDamageNote] = useState("");
  const scanLock = useRef(false);
  const isWeb = Platform.OS === "web";

  const reset = useCallback(() => {
    setPanel(null);
    setDamageNote("");
    scanLock.current = false;
  }, []);

  const handleCode = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await lookupOrder(trimmed);
      // Âm phân biệt ngay từ lượt tra: đơn còn thao tác được = success;
      // đơn ĐÃ quét nhận/nhập kho/xử lý rồi = tiếng "quét trùng"
      const fresh =
        res.order.returnStatus === "AWAITING" || res.order.returnStatus === "NONE";
      playScanSound(fresh ? "success" : "duplicate");
      void Haptics.notificationAsync(
        fresh
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
      setPanel({ type: "order", order: res.order });
    } catch (err) {
      playScanSound("error");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (err instanceof ApiError && err.status === 409 && err.body) {
        const body = err.body as LookupAmbiguousBody;
        if (Array.isArray(body.candidates) && body.candidates.length > 0) {
          setPanel({ type: "candidates", code: trimmed, list: body.candidates });
          return;
        }
      }
      setPanel({
        type: "error",
        message: err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanLock.current || busy || panel) return;
      scanLock.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      void handleCode(data);
    },
    [busy, panel, handleCode]
  );

  const doReceive = async (order: OrderDto) => {
    setBusy(true);
    try {
      const res = await receiveReturn(order.id);
      playScanSound("success");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPanel({
        type: "done",
        message: `Đã quét nhận đơn ${order.orderCode}`,
        warn: res.unannounced
          ? "Sàn CHƯA báo hoàn đơn này — kiểm tra lại kiện hàng"
          : undefined,
      });
    } catch (err) {
      playScanSound("error");
      setPanel({
        type: "error",
        message: err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại",
      });
    } finally {
      setBusy(false);
    }
  };

  const doDamage = async (order: OrderDto) => {
    setBusy(true);
    try {
      await markDamaged(order.id, damageNote);
      playScanSound("success");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPanel({
        type: "done",
        message: `Đã đánh dấu HÀNG HỎNG đơn ${order.orderCode} — chờ khiếu nại`,
      });
    } catch (err) {
      playScanSound("error");
      setPanel({
        type: "error",
        message: err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại",
      });
    } finally {
      setBusy(false);
    }
  };

  // ----- Quyền camera (chỉ trên máy thật) -----
  if (!isWeb) {
    if (!permission) return <View className="flex-1 bg-slate-950" />;
    if (!permission.granted) {
      return (
        <View className="flex-1 items-center justify-center bg-slate-950 px-8">
          <Ionicons name="camera-outline" size={48} color="#64748b" />
          <Text className="mt-4 text-center text-base font-semibold text-white">
            Cần quyền Camera để quét mã vận đơn
          </Text>
          <Text className="mt-2 text-center text-sm text-slate-400 dark:text-slate-500">
            Hubsell chỉ dùng camera để đọc mã trên tem kiện hàng hoàn.
          </Text>
          <ActionButton
            label="Cấp quyền Camera"
            icon="camera"
            className="mt-6 min-w-[220px]"
            onPress={() => void requestPermission()}
          />
        </View>
      );
    }
  }

  const renderPanel = () => {
    if (!panel && !busy) return null;
    return (
      <View
        className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white dark:bg-slate-900 px-4 pt-4"
        style={{ paddingBottom: 16, maxHeight: 460 }}
      >
        {busy && !panel ? (
          <View className="items-center py-8">
            <ActivityIndicator size="large" color="#64748b" />
            <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Đang tra cứu — nếu chưa có sẽ tự hỏi lại sàn…
            </Text>
          </View>
        ) : null}

        {panel?.type === "order" ? <OrderPanel order={panel.order} /> : null}

        {panel?.type === "candidates" ? (
          <View>
            <Text className="mb-1 text-base font-bold text-slate-900 dark:text-slate-100">
              Mã khớp {panel.list.length} đơn
            </Text>
            <Text className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Chọn đúng đơn theo mã trên tem:
            </Text>
            {panel.list.map((c) => (
              <Pressable
                key={c.orderCode}
                className="mb-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 active:bg-slate-100 dark:active:bg-slate-800"
                onPress={() => {
                  setPanel(null);
                  void handleCode(c.orderCode);
                }}
              >
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {c.orderCode}
                </Text>
                {c.trackingCode ? (
                  <Text className="text-xs text-slate-500 dark:text-slate-400">VĐ: {c.trackingCode}</Text>
                ) : null}
              </Pressable>
            ))}
            <ActionButton
              label="Quét lại"
              icon="scan-outline"
              variant="neutral"
              className="mt-1"
              onPress={reset}
            />
          </View>
        ) : null}

        {/* KẾT QUẢ (lỗi / xong): biểu tượng to trong vòng màu, chữ 17px, cảnh
            báo trong hộp vàng riêng, nút Quét tiếp FULL-WIDTH xanh đặc — thứ
            duy nhất cần bấm nên phải là thứ nổi nhất (trước là viên xám nhỏ). */}
        {panel?.type === "error" ? (
          <View className="items-center pt-2">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/20">
              <Ionicons name="alert" size={34} color="#ef4444" />
            </View>
            <Text className="mt-3 text-center text-[17px] font-bold text-slate-900 dark:text-slate-100">
              Không quét được
            </Text>
            <Text className="mt-1 mb-4 text-center text-sm text-slate-600 dark:text-slate-300">
              {panel.message}
            </Text>
            <ActionButton
              label="Quét lại"
              icon="scan-outline"
              className="w-full"
              onPress={reset}
            />
          </View>
        ) : null}

        {panel?.type === "done" ? (
          <View className="items-center pt-2">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
              <Ionicons name="checkmark" size={36} color="#059669" />
            </View>
            <Text className="mt-3 text-center text-[17px] font-bold text-slate-900 dark:text-slate-100">
              {panel.message}
            </Text>
            {panel.warn ? (
              <View className="mt-3 w-full flex-row items-start gap-2 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5">
                <Ionicons name="warning" size={18} color="#d97706" />
                <Text className="flex-1 text-[13px] font-medium leading-5 text-amber-800 dark:text-amber-300">
                  {panel.warn}
                </Text>
              </View>
            ) : null}
            <ActionButton
              label="Quét đơn tiếp theo"
              icon="scan-outline"
              className="mt-4 w-full"
              onPress={reset}
            />
          </View>
        ) : null}
      </View>
    );
  };

  const OrderPanel = ({ order }: { order: OrderDto }) => {
    const ret = RETURN_STATUS[order.returnStatus];
    // Trạng thái nào còn được thao tác — bám đúng luật backend
    const canReceive =
      order.returnStatus === "AWAITING" || order.returnStatus === "NONE";
    const canDamage = canReceive || order.returnStatus === "RECEIVED";
    return (
      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
            {order.orderCode}
          </Text>
          <Badge label={ret.label} bg={ret.bg} text={ret.text} />
        </View>
        <Text className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {CHANNEL_LABEL[order.channel.channelName] ?? order.channel.channelName}
          {" · "}
          {order.channel.shopName}
          {" · "}
          {order.customerName}
        </Text>

        {order.items.map((it) => (
          <View key={it.id} className="mb-2 flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
              {(it.imageUrl ?? it.product?.imageUrl) ? (
                <Image
                  source={{ uri: (it.imageUrl ?? it.product?.imageUrl)! }}
                  style={{ width: 48, height: 48 }}
                  contentFit="cover"
                />
              ) : (
                <Ionicons name="cube-outline" size={18} color="#94a3b8" />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-[13px] font-medium text-slate-900 dark:text-slate-100" numberOfLines={2}>
                {it.productName}
              </Text>
              <Text className="text-xs text-slate-500 dark:text-slate-400">
                {it.channelSku ? `${it.channelSku} · ` : ""}x{it.quantity}
              </Text>
            </View>
          </View>
        ))}

        {canDamage ? (
          <TextInput
            className="mb-3 mt-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100"
            placeholder="Ghi chú tình trạng kiện (vỡ, thiếu, bị tráo…) — tùy chọn"
            placeholderTextColor="#94a3b8"
            value={damageNote}
            onChangeText={setDamageNote}
          />
        ) : (
          <Text className="mb-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
            Đơn này đã được xử lý — không còn thao tác nào ở bước quét.
          </Text>
        )}

        {/* Cụm thao tác: Quét nhận = primary xanh đặc, Hàng hỏng = danger đỏ
            (vẫn rõ, không giành tay với nút chính), hai nút bằng nhau để nhãn
            không gãy dòng; Bỏ qua = neutral full-width phía dưới. Cao 64px —
            kho đeo găng. */}
        <View className="flex-row gap-3">
          {canReceive ? (
            <ActionButton
              label="Quét nhận"
              sublabel="chờ nhập kho trên web"
              icon="checkmark-circle"
              className="flex-1 min-h-[64px]"
              onPress={() => void doReceive(order)}
              loading={busy}
            />
          ) : null}
          {canDamage ? (
            <ActionButton
              label="Hàng hỏng"
              sublabel="chờ khiếu nại"
              icon="close-circle"
              variant="danger"
              className="flex-1 min-h-[64px]"
              onPress={() => void doDamage(order)}
              disabled={busy}
            />
          ) : null}
        </View>
        <ActionButton
          label={canReceive || canDamage ? "Bỏ qua — quét tiếp" : "Quét đơn tiếp theo"}
          icon="scan-outline"
          variant={canReceive || canDamage ? "neutral" : "primary"}
          className="mt-3"
          onPress={reset}
          disabled={busy}
        />
      </ScrollView>
    );
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-950"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
            Camera quét chạy trên điện thoại (Expo Go).{"\n"}Bản web: nhập mã ở ô
            bên dưới để thử luồng.
          </Text>
        </View>
      )}

      {/* Khung ngắm + thanh trên */}
      <View
        pointerEvents="box-none"
        className="absolute inset-0"
        style={{ paddingTop: insets.top + 12 }}
      >
        <View className="flex-row items-center justify-between px-4">
          <View className="flex-row items-center gap-2.5">
            {/* Chỉ hiện lối về khi được push vào (không phải tab) và có chỗ
                để về; nhân viên kho vào thẳng (màn gốc) thì không hiện. */}
            {!embedded && router.canGoBack() ? (
              <Pressable
                className="active:opacity-70"
                onPress={() => router.back()}
                hitSlop={6}
              >
                <CircleControl>
                  <Ionicons name="arrow-back" size={20} color="#fff" />
                </CircleControl>
              </Pressable>
            ) : null}
            <View>
              {/* Đổ bóng chữ — nền camera có thể SÁNG (tem trắng, kho đèn
                  mạnh), chữ trắng trần sẽ chìm nghỉm */}
              <Text
                className="text-lg font-bold text-white"
                style={{ textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 }}
              >
                Quét đơn hoàn
              </Text>
              <Text
                className="text-[11px] text-slate-200"
                style={{ textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 }}
              >
                Đưa mã vận đơn trên tem vào khung
              </Text>
            </View>
          </View>
          {!isWeb ? (
            <Pressable className="active:opacity-70" onPress={() => setTorch((t) => !t)}>
              {torch ? (
                // Đèn ĐANG BẬT giữ nền amber đặc — trạng thái phải nhìn ra ngay
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
        {!isWeb && !panel ? (
          <View className="flex-1 items-center justify-center">
            <View className="h-40 w-72 rounded-2xl border-2 border-white/80" />
          </View>
        ) : null}
      </View>

      {/* Ô nhập tay — tem nhăn/rách là chuyện hằng ngày ở kho. Máy hỗ trợ
          Liquid Glass thì thanh nhập trong mờ nổi trên camera. */}
      {!panel && !busy ? (
        <View
          className="absolute inset-x-0 bottom-0 px-4"
          style={{ paddingBottom: 12 }}
        >
          {(() => {
            const inner = (onGlass: boolean) => (
              <View
                className={`flex-row items-center gap-2 p-2 ${
                  onGlass ? "" : "rounded-2xl bg-white dark:bg-slate-900/95"
                }`}
              >
                <TextInput
                  className={`flex-1 px-3 py-2 text-sm ${
                    onGlass ? "text-white" : "text-slate-900 dark:text-slate-100"
                  }`}
                  placeholder="Hoặc nhập mã vận đơn / mã đơn…"
                  placeholderTextColor={onGlass ? "#e2e8f0" : "#94a3b8"}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={manual}
                  onChangeText={setManual}
                  onSubmitEditing={() => {
                    if (manual.trim()) {
                      scanLock.current = true;
                      void handleCode(manual);
                      setManual("");
                    }
                  }}
                />
                <Pressable
                  className={`rounded-xl px-4 py-2.5 active:opacity-80 ${
                    onGlass ? "bg-white/25" : "bg-slate-900 dark:bg-slate-700"
                  }`}
                  onPress={() => {
                    if (manual.trim()) {
                      scanLock.current = true;
                      void handleCode(manual);
                      setManual("");
                    }
                  }}
                >
                  <Text className="text-sm font-semibold text-white">Tra mã</Text>
                </Pressable>
              </View>
            );
            return GLASS ? (
              <GlassView
                glassEffectStyle="regular"
                style={{ borderRadius: 16, overflow: "hidden" }}
              >
                {inner(true)}
              </GlassView>
            ) : (
              inner(false)
            );
          })()}
        </View>
      ) : null}

      {renderPanel()}
    </KeyboardAvoidingView>
  );
}
