import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { lookupOrder } from "@/api/orders";
import type { OrderDto, OrderPaymentDto } from "@/types/api";
import { OrderDetailPanel } from "@/components/OrderDetailPanel";

/**
 * Hộp trượt CHI TIẾT ĐƠN HÀNG khi bấm một đơn trong danh sách — cùng nội dung
 * với màn quét QR (OrderDetailPanel). Thông tin đơn hiện ngay từ dòng đã có,
 * khối phí / doanh thu tải sau qua lượt tra theo mã đơn.
 */
export function OrderDetailSheet({
  order,
  onClose,
}: {
  order: OrderDto | null;
  onClose: () => void;
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
        </View>
      </View>
    </Modal>
  );
}
