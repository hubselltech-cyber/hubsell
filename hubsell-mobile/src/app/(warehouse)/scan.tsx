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

export default function ScanReturnsScreen() {
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
          <Text className="mt-2 text-center text-sm text-slate-400">
            Hubsell chỉ dùng camera để đọc mã trên tem kiện hàng hoàn.
          </Text>
          <Pressable
            className="mt-6 rounded-xl bg-emerald-500 px-6 py-3 active:opacity-80"
            onPress={() => void requestPermission()}
          >
            <Text className="text-sm font-semibold text-white">Cấp quyền Camera</Text>
          </Pressable>
        </View>
      );
    }
  }

  const renderPanel = () => {
    if (!panel && !busy) return null;
    return (
      <View
        className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-4 pt-4"
        style={{ paddingBottom: 16, maxHeight: 460 }}
      >
        {busy && !panel ? (
          <View className="items-center py-8">
            <ActivityIndicator size="large" color="#0f172a" />
            <Text className="mt-3 text-sm text-slate-500">
              Đang tra cứu — nếu chưa có sẽ tự hỏi lại sàn…
            </Text>
          </View>
        ) : null}

        {panel?.type === "order" ? <OrderPanel order={panel.order} /> : null}

        {panel?.type === "candidates" ? (
          <View>
            <Text className="mb-1 text-base font-bold text-slate-900">
              Mã khớp {panel.list.length} đơn
            </Text>
            <Text className="mb-3 text-xs text-slate-500">
              Chọn đúng đơn theo mã trên tem:
            </Text>
            {panel.list.map((c) => (
              <Pressable
                key={c.orderCode}
                className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-3 active:bg-slate-100"
                onPress={() => {
                  setPanel(null);
                  void handleCode(c.orderCode);
                }}
              >
                <Text className="text-sm font-semibold text-slate-900">
                  {c.orderCode}
                </Text>
                {c.trackingCode ? (
                  <Text className="text-xs text-slate-500">VĐ: {c.trackingCode}</Text>
                ) : null}
              </Pressable>
            ))}
            <CloseButton onPress={reset} label="Quét lại" />
          </View>
        ) : null}

        {panel?.type === "error" ? (
          <View className="items-center py-2">
            <Ionicons name="alert-circle-outline" size={36} color="#ef4444" />
            <Text className="mt-2 mb-4 text-center text-sm text-slate-700">
              {panel.message}
            </Text>
            <CloseButton onPress={reset} label="Quét tiếp" />
          </View>
        ) : null}

        {panel?.type === "done" ? (
          <View className="items-center py-2">
            <Ionicons name="checkmark-circle" size={40} color="#10b981" />
            <Text className="mt-2 text-center text-sm font-semibold text-slate-900">
              {panel.message}
            </Text>
            {panel.warn ? (
              <Text className="mt-1 text-center text-xs text-amber-600">
                ⚠️ {panel.warn}
              </Text>
            ) : null}
            <CloseButton onPress={reset} label="Quét tiếp" />
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
          <Text className="text-base font-bold text-slate-900">
            {order.orderCode}
          </Text>
          <Badge label={ret.label} bg={ret.bg} text={ret.text} />
        </View>
        <Text className="mb-3 text-xs text-slate-500">
          {CHANNEL_LABEL[order.channel.channelName] ?? order.channel.channelName}
          {" · "}
          {order.channel.shopName}
          {" · "}
          {order.customerName}
        </Text>

        {order.items.map((it) => (
          <View key={it.id} className="mb-2 flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
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
              <Text className="text-[13px] font-medium text-slate-900" numberOfLines={2}>
                {it.productName}
              </Text>
              <Text className="text-xs text-slate-500">
                {it.channelSku ? `${it.channelSku} · ` : ""}x{it.quantity}
              </Text>
            </View>
          </View>
        ))}

        {canDamage ? (
          <TextInput
            className="mb-3 mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900"
            placeholder="Ghi chú tình trạng kiện (vỡ, thiếu, bị tráo…) — tùy chọn"
            placeholderTextColor="#94a3b8"
            value={damageNote}
            onChangeText={setDamageNote}
          />
        ) : (
          <Text className="mb-3 mt-1 text-xs text-slate-500">
            Đơn này đã được xử lý — không còn thao tác nào ở bước quét.
          </Text>
        )}

        <View className="flex-row gap-3">
          {canReceive ? (
            <Pressable
              className="flex-1 items-center justify-center rounded-2xl bg-emerald-500 py-4 active:opacity-80"
              onPress={() => void doReceive(order)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={22} color="#fff" />
                  <Text className="mt-0.5 text-sm font-bold text-white">
                    Quét nhận
                  </Text>
                  <Text className="text-[10px] text-emerald-100">
                    chờ nhập kho trên web
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
          {canDamage ? (
            <Pressable
              className="flex-1 items-center justify-center rounded-2xl border-2 border-red-500 bg-white py-4 active:opacity-80"
              onPress={() => void doDamage(order)}
              disabled={busy}
            >
              <Ionicons name="close" size={22} color="#ef4444" />
              <Text className="mt-0.5 text-sm font-bold text-red-500">
                Hàng hỏng
              </Text>
              <Text className="text-[10px] text-red-300">chờ khiếu nại</Text>
            </Pressable>
          ) : null}
        </View>
        <CloseButton onPress={reset} label={canReceive || canDamage ? "Bỏ qua — quét tiếp" : "Quét tiếp"} />
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
          <Text className="mt-3 px-10 text-center text-sm text-slate-500">
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
            {/* Chủ shop push từ trang Kho vào — cần lối về; nhân viên kho
                vào thẳng (màn gốc, canGoBack false) thì không hiện. */}
            {router.canGoBack() ? (
              <Pressable
                className="h-10 w-10 items-center justify-center rounded-full bg-black/40 active:bg-black/60"
                onPress={() => router.back()}
                hitSlop={6}
              >
                <Ionicons name="arrow-back" size={20} color="#fff" />
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
            <Pressable
              className={`h-10 w-10 items-center justify-center rounded-full ${
                torch ? "bg-amber-400" : "bg-black/40"
              }`}
              onPress={() => setTorch((t) => !t)}
            >
              <Ionicons
                name={torch ? "flash" : "flash-outline"}
                size={18}
                color={torch ? "#0f172a" : "#fff"}
              />
            </Pressable>
          ) : null}
        </View>
        {!isWeb && !panel ? (
          <View className="flex-1 items-center justify-center">
            <View className="h-40 w-72 rounded-2xl border-2 border-white/80" />
          </View>
        ) : null}
      </View>

      {/* Ô nhập tay — tem nhăn/rách là chuyện hằng ngày ở kho */}
      {!panel && !busy ? (
        <View
          className="absolute inset-x-0 bottom-0 px-4"
          style={{ paddingBottom: 12 }}
        >
          <View className="flex-row items-center gap-2 rounded-2xl bg-white/95 p-2">
            <TextInput
              className="flex-1 px-3 py-2 text-sm text-slate-900"
              placeholder="Hoặc nhập mã vận đơn / mã đơn…"
              placeholderTextColor="#94a3b8"
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
              className="rounded-xl bg-slate-900 px-4 py-2.5 active:opacity-80"
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
        </View>
      ) : null}

      {renderPanel()}
    </KeyboardAvoidingView>
  );
}

function CloseButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      className="mt-3 items-center rounded-xl bg-slate-100 py-3 active:opacity-80"
      onPress={onPress}
    >
      <Text className="text-sm font-semibold text-slate-600">{label}</Text>
    </Pressable>
  );
}
