import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
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
import { fetchOrders, lookupOrder, markDamaged, receiveReturn } from "@/api/orders";
import { ApiError } from "@/api/client";
import type { LookupAmbiguousBody, OrderDto, OrderPaymentDto } from "@/types/api";
import { CHANNEL_LABEL, RETURN_STATUS, SHIPPING_STATUS } from "@/lib/labels";
import { playScanSound } from "@/lib/scan-sounds";
import { Badge } from "@/components/Badge";
import { ActionButton } from "@/components/ActionButton";
import { OrderDetailPanel } from "@/components/OrderDetailPanel";

/**
 * MÀN QUÉT MÃ dùng chung — mode "returns": quét xử lý đơn hoàn (mở từ Kho →
 * Đơn hoàn); mode "detail": nút QR giữa thanh tab, xem chi tiết đơn hàng.
 *
 * Luồng 2 CÔNG ĐOẠN (chốt 13/08, khớp web):
 *   [✓ Quét nhận]  → POST /warehouse/returns/:id/receive — ghi "hàng đã về
 *                    tay", KHÔNG cộng kho; nhập kho là nút bulk trên web.
 *   [✗ Hàng hỏng]  → POST /orders/:id/return DAMAGED — không cộng kho,
 *                    chuyển sang chờ khiếu nại.
 *
 * Camera bắn sự kiện liên tục (~10 lần/giây) nên PHẢI khóa sau lần đọc đầu
 * (scanLock) — không khóa là gọi API trùng và rung máy loạn xạ.
 *
 * mode="detail" (anh Trung 04/10): cùng camera, cùng lượt tra mã, nhưng kết quả
 * là CHI TIẾT ĐƠN HÀNG chỉ để xem (shop, trạng thái, sản phẩm, tiền sàn trả) — nút QR giữa
 * thanh tab của chủ shop. Không có nút Quét nhận / Hàng hỏng ở chế độ này.
 */

type Panel =
  | { type: "order"; order: OrderDto; payment?: OrderPaymentDto }
  | { type: "candidates"; code: string; total: number; list: Candidate[] }
  | { type: "error"; message: string }
  | { type: "done"; message: string; warn?: string };

/** Một đơn trong danh sách "mã khớp nhiều đơn" — từ lượt tìm theo vài ký tự hoặc 409 của lookup. */
type Candidate = {
  orderCode: string;
  trackingCode: string | null;
  shopName?: string;
  statusLabel?: string;
};

/** Gõ tay từ chừng này ký tự mới tìm — ít hơn thì ra quá nhiều đơn, vô nghĩa. Mặc định tự chọn. */
const MIN_SEARCH_CHARS = 3;
const SEARCH_PAGE = 20;

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
export function ScanScreen({
  embedded = false,
  mode = "returns",
}: {
  embedded?: boolean;
  mode?: "returns" | "detail";
}) {
  const detail = mode === "detail";
  const { height: winHeight } = useWindowDimensions();
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

  // BÀN PHÍM CHE Ô NHẬP (anh Trung 04/10, máy Android thật): ô nhập và panel kết
  // quả đều là lớp NỔI bám đáy (absolute bottom 0) nên padding của
  // KeyboardAvoidingView không đẩy được chúng. Tự đo: phần đáy màn quét nằm dưới
  // mép trên bàn phím bao nhiêu thì nâng các lớp nổi lên bấy nhiêu. Đo theo vị
  // trí thật trên màn nên đúng cả khi màn quét nằm trên thanh tab lẫn khi phủ kín.
  const rootRef = useRef<View>(null);
  const [kbLift, setKbLift] = useState(0);
  useEffect(() => {
    if (isWeb) return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const kbTop = e.endCoordinates.screenY;
      rootRef.current?.measureInWindow((_x, y, _w, h) => {
        setKbLift(Math.max(0, Math.round(y + h - kbTop)));
      });
    });
    const hide = Keyboard.addListener(hideEvt, () => setKbLift(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [isWeb]);

  const reset = useCallback(() => {
    setPanel(null);
    setDamageNote("");
    scanLock.current = false;
  }, []);

  /**
   * GÕ TAY vài ký tự (anh Trung 04/10: người ta hay gõ mấy số CUỐI của mã, không
   * ai gõ cả dãy): tìm mọi đơn CHỨA chuỗi đó qua ô tìm kiếm đa năng của danh
   * sách đơn (mã đơn, mã vận đơn đi / hoàn, tên khách, SĐT). Một đơn → mở luôn;
   * nhiều đơn → danh sách để chọn; không có → rơi về lượt tra chính xác (có tự
   * hỏi lại sàn) như khi quét camera.
   */
  const handleManual = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    Keyboard.dismiss();
    if (q.length < MIN_SEARCH_CHARS) {
      setPanel({ type: "error", message: `Nhập ít nhất ${MIN_SEARCH_CHARS} ký tự của mã đơn hoặc mã vận đơn` });
      return;
    }
    setBusy(true);
    try {
      const res = await fetchOrders({ search: q, pageSize: SEARCH_PAGE });
      if (res.items.length === 1) {
        await handleCode(res.items[0].orderCode);
        return;
      }
      if (res.items.length > 1) {
        playScanSound("duplicate");
        setPanel({
          type: "candidates",
          code: q,
          total: res.total,
          list: res.items.map((o) => ({
            orderCode: o.orderCode,
            trackingCode: o.trackingCode,
            shopName: o.channel.shopName,
            statusLabel: SHIPPING_STATUS[o.shippingStatus]?.label,
          })),
        });
        setBusy(false);
        return;
      }
    } catch {
      // Lượt tìm hỏng (mất mạng, thiếu quyền) → vẫn thử tra chính xác bên dưới.
    }
    await handleCode(q);
  };

  const handleCode = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await lookupOrder(trimmed, { detail });
      // Âm phân biệt ngay từ lượt tra: đơn còn thao tác được = success;
      // đơn ĐÃ quét nhận/nhập kho/xử lý rồi = tiếng "quét trùng". Xem chi tiết
      // thì đơn nào tra ra cũng là thành công.
      const fresh =
        detail ||
        res.order.returnStatus === "AWAITING" ||
        res.order.returnStatus === "NONE";
      playScanSound(fresh ? "success" : "duplicate");
      void Haptics.notificationAsync(
        fresh
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
      setPanel({ type: "order", order: res.order, payment: res.payment });
    } catch (err) {
      playScanSound("error");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (err instanceof ApiError && err.status === 409 && err.body) {
        const body = err.body as LookupAmbiguousBody;
        if (Array.isArray(body.candidates) && body.candidates.length > 0) {
          setPanel({
            type: "candidates",
            code: trimmed,
            total: body.candidates.length,
            list: body.candidates,
          });
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
  }, [detail]);

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
            Hubsell chỉ dùng camera để đọc mã trên tem kiện hàng.
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
        className="absolute inset-x-0 rounded-t-3xl bg-white dark:bg-slate-900 px-4 pt-4"
        // Chi tiết đơn dài hơn panel quét hoàn → cho chiếm gần hết màn, cuộn bên trong.
        // bottom = kbLift: bàn phím mở (ô ghi chú hàng hỏng) thì panel nổi lên trên nó.
        style={{
          bottom: kbLift,
          paddingBottom: 16,
          maxHeight: detail ? Math.round(winHeight * 0.8) : 460,
        }}
      >
        {busy && !panel ? (
          <View className="items-center py-8">
            <ActivityIndicator size="large" color="#64748b" />
            <Text className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Đang tra cứu — nếu chưa có sẽ tự hỏi lại sàn…
            </Text>
          </View>
        ) : null}

        {panel?.type === "order" ? (
          detail ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <OrderDetailPanel order={panel.order} payment={panel.payment} />
              <ActionButton
                label="Quét đơn khác"
                icon="scan-outline"
                className="mt-4"
                onPress={reset}
              />
            </ScrollView>
          ) : (
            <OrderPanel order={panel.order} />
          )
        ) : null}

        {panel?.type === "candidates" ? (
          <View style={{ flexShrink: 1 }}>
            <Text className="mb-1 text-base font-bold text-slate-900 dark:text-slate-100">
              "{panel.code}" khớp {panel.total} đơn
            </Text>
            <Text className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              {panel.total > panel.list.length
                ? `Đang hiện ${panel.list.length} đơn mới nhất. Gõ thêm ký tự để thu hẹp, hoặc chọn đơn:`
                : "Chọn đúng đơn:"}
            </Text>
            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
              {panel.list.map((c) => (
                <Pressable
                  key={c.orderCode}
                  className="mb-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 active:bg-slate-100 dark:active:bg-slate-800"
                  onPress={() => {
                    setPanel(null);
                    void handleCode(c.orderCode);
                  }}
                >
                  <View className="flex-row items-center justify-between gap-2">
                    <Text
                      className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100"
                      numberOfLines={1}
                    >
                      {c.orderCode}
                    </Text>
                    {c.statusLabel ? (
                      <Text className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {c.statusLabel}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-xs text-slate-500 dark:text-slate-400" numberOfLines={1}>
                    {c.trackingCode ? `VĐ: ${c.trackingCode}` : "Chưa có mã vận đơn"}
                    {c.shopName ? ` · ${c.shopName}` : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
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
                {detail ? "Quét xem chi tiết đơn" : "Quét đơn hoàn"}
              </Text>
              <Text
                className="text-[11px] text-slate-200"
                style={{ textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 }}
              >
                {detail
                  ? "Đưa mã vận đơn hoặc mã đơn vào khung"
                  : "Đưa mã vận đơn trên tem vào khung"}
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
          className="absolute inset-x-0 px-4"
          style={{ bottom: kbLift, paddingBottom: 12 }}
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
                  placeholder="Gõ vài số cuối mã vận đơn / mã đơn…"
                  placeholderTextColor={onGlass ? "#e2e8f0" : "#94a3b8"}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="search"
                  value={manual}
                  onChangeText={setManual}
                  onSubmitEditing={() => {
                    if (manual.trim()) {
                      scanLock.current = true;
                      void handleManual(manual);
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
                      void handleManual(manual);
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
    </View>
  );
}
