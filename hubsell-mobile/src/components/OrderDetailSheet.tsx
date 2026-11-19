import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { lookupOrder } from "@/api/orders";
import type { OrderDto, OrderPaymentDto } from "@/types/api";
import { OrderDetailPanel } from "@/components/OrderDetailPanel";
import { hapticTap } from "@/lib/haptics";

/**
 * Hộp trượt CHI TIẾT ĐƠN HÀNG khi bấm một đơn trong danh sách — cùng nội dung
 * với màn quét QR (OrderDetailPanel). Thông tin đơn hiện ngay từ dòng đã có,
 * khối phí / doanh thu tải sau qua lượt tra theo mã đơn.
 */
export function OrderDetailSheet({
  order,
  onClose,
  onChanged,
  onArrange,
  onPrint,
}: {
  order: OrderDto | null;
  onClose: () => void;
  /** Shop vừa trả lời sàn về yêu cầu hủy — màn ngoài tải lại. */
  onChanged?: () => void;
  /**
   * Việc kế tiếp của RIÊNG đơn này (19/11/2026): đơn Chờ xử lý → Chuẩn bị hàng, đơn Đã xử
   * lý → In phiếu. Màn ngoài mở hộp tương ứng; không truyền thì hộp chỉ để xem như trước.
   */
  onArrange?: (order: OrderDto) => void;
  onPrint?: (order: OrderDto) => void;
}) {
  // Đáy hộp chừa phần nút điều hướng / vạch vuốt của máy.
  const insets = useSafeAreaInsets();
  // Kết quả tra gắn theo id đơn — đổi đơn là kết quả cũ tự hết hiệu lực.
  const [result, setResult] = useState<{
    id: string;
    payment?: OrderPaymentDto;
    order?: OrderDto;
  } | null>(null);

  const orderId = order?.id;
  const orderCode = order?.orderCode;
  useEffect(() => {
    if (!orderId || !orderCode) return;
    let cancelled = false;
    lookupOrder(orderCode, { detail: true })
      .then((res) => {
        if (cancelled) return;
        // Mã đơn trùng mã vận đơn của đơn khác thì bỏ, giữ dòng đang xem.
        setResult(res.order.id === orderId ? { id: orderId, ...res } : { id: orderId });
      })
      .catch(() => {
        if (!cancelled) setResult({ id: orderId });
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, orderCode]);

  const detail = result && result.id === orderId ? result : null;
  const loading = order !== null && detail === null;

  // Việc kế tiếp theo trạng thái MỚI NHẤT của đơn (lượt tra chi tiết có thể mới hơn dòng
  // ngoài danh sách). Đơn khách chưa thanh toán: sàn chưa cho chuẩn bị → không hiện nút.
  const current = detail?.order ?? order;
  const next: { label: string; icon: "cube-outline" | "print-outline"; run: () => void } | null = !current
    ? null
    : current.shippingStatus === "PENDING" && current.paymentStatus !== "UNPAID" && onArrange
      ? { label: "Chuẩn bị hàng", icon: "cube-outline", run: () => onArrange(current) }
      : current.shippingStatus === "PROCESSED" && onPrint
        ? {
            label: current.labelPrintedAt ? "In lại phiếu" : "In phiếu",
            icon: "print-outline",
            run: () => onPrint(current),
          }
        : null;

  return (
    <Modal
      visible={order !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="max-h-[85%] rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chi tiết đơn hàng
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Đóng">
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>
          {order ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <OrderDetailPanel
                order={detail?.order ?? order}
                payment={detail?.payment}
                onCancelDecided={onChanged}
              />
              {loading ? (
                <View className="mt-2 flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#64748b" />
                  <Text className="text-[11px] text-slate-400 dark:text-slate-500">
                    Đang tải phí và doanh thu của đơn…
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          ) : null}
          {next ? (
            <Pressable
              className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-3 active:opacity-80"
              onPress={() => {
                hapticTap();
                next.run();
              }}
              accessibilityRole="button"
            >
              <Ionicons name={next.icon} size={16} color="#fff" />
              <Text className="text-sm font-bold text-white">{next.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
