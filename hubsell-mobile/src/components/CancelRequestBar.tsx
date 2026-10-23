import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "@/api/client";
import { decideCancelRequest, type CancelDecideResult } from "@/api/orders";
import type { OrderDto } from "@/types/api";
import { CHANNEL_LABEL } from "@/lib/labels";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { TABULAR } from "@/theme/tokens";

/**
 * KHÁCH XIN HỦY ĐƠN — phần app của luồng web 23/10/2026 (anh Trung chốt tối
 * 23/10 làm luôn trên app): cờ `cancelRequestedAt` đi kèm MỌI trạng thái, đơn
 * ở nguyên tab của nó; trên thẻ đơn và chi tiết đơn hiện dải đỏ "Khách xin hủy ·
 * còn N giờ" + MỘT nút "Trả lời sàn" mở hộp 2 lựa chọn (Chấp nhận hủy / Từ chối,
 * tiếp tục giao), mỗi lựa chọn xác nhận một lần rồi gọi sàn thật qua
 * POST /api/orders/:id/cancel-request/decide. Quá hạn sàn tự hủy nên dải nêu rõ.
 */

/** Giờ còn lại tới hạn (âm = quá hạn); null khi sàn không cho hạn (Lazada). */
export function hoursLeft(dueAt: string | null | undefined, now = Date.now()): number | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - now;
  return Math.round((ms / 36e5) * 10) / 10;
}

/** Ngắn để vừa một dòng trên màn 320 cạnh nút: "còn 38 giờ" / "quá hạn". */
function deadlineText(dueAt: string | null | undefined): string {
  const h = hoursLeft(dueAt);
  if (h === null) return "chờ shop trả lời";
  if (h <= 0) return "quá hạn, sàn có thể tự hủy";
  if (h < 1) return `còn ${Math.max(1, Math.round(h * 60))} phút`;
  if (h < 48) return `còn ${Math.round(h)} giờ`;
  return `còn ${Math.round(h / 24)} ngày`;
}

/** Viên nhỏ cạnh mã đơn trên thẻ (như viên Hỏa tốc). */
export function CancelRequestPill() {
  return (
    <View className="rounded-full bg-red-500 px-2 py-0.5">
      <Text className="text-[10px] font-bold text-white">Khách xin hủy</Text>
    </View>
  );
}

/**
 * Dải đỏ + nút Trả lời sàn. Tự ẩn khi đơn không có cờ. `onDecided` để màn
 * ngoài tải lại danh sách sau khi sàn chốt.
 */
export function CancelRequestBar({
  order,
  onDecided,
  className = "",
}: {
  order: OrderDto;
  onDecided?: (r: CancelDecideResult) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!order.cancelRequestedAt) return null;
  const overdue = (hoursLeft(order.cancelRequestDueAt) ?? 1) <= 0;
  return (
    <>
      <View
        className={`mt-2 rounded-xl border px-3 py-2 ${
          overdue
            ? "border-red-300 bg-red-100 dark:border-red-500/40 dark:bg-red-500/20"
            : "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"
        } ${className}`}
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name="alert-circle" size={16} color="#ef4444" />
          <View className="min-w-0 flex-1">
            <Text className="text-[12px] font-semibold text-red-700 dark:text-red-300" numberOfLines={2}>
              Khách xin hủy · {deadlineText(order.cancelRequestDueAt)}
            </Text>
            {order.cancelRequestReason ? (
              {/* Lý do = tên chọn sẵn của sàn ("Muốn thay đổi địa chỉ giao hàng") — một dòng là đủ (anh chốt) */}
              <Text className="text-[11px] text-red-600/80 dark:text-red-300/80" numberOfLines={1}>
                {order.cancelRequestReason}
              </Text>
            ) : null}
          </View>
          <Pressable
            className="rounded-lg bg-red-500 px-2.5 py-1.5 active:opacity-80"
            onPress={() => {
              hapticTap();
              setOpen(true);
            }}
            // Không đặt role button: nút nằm TRONG thẻ đơn (cũng là button) — web báo lồng nút.
            accessibilityLabel={`Trả lời sàn về yêu cầu hủy đơn ${order.orderCode}`}
          >
            <Text className="text-[11px] font-bold text-white">Trả lời</Text>
          </Pressable>
        </View>
      </View>
      <CancelDecisionSheet
        order={open ? order : null}
        onClose={() => setOpen(false)}
        onDecided={(r) => {
          setOpen(false);
          onDecided?.(r);
        }}
      />
    </>
  );
}

/**
 * Hộp trượt gọn (anh Trung chốt 23/10 tối: "chỉ Đồng ý – Từ chối, không nói
 * dài"): một dòng mã đơn · sàn · shop · hạn, hai nút. Bấm là gọi sàn ngay,
 * không có bước xác nhận thứ hai — nút nói rõ việc nó làm.
 */
export function CancelDecisionSheet({
  order,
  onClose,
  onDecided,
}: {
  order: OrderDto | null;
  onClose: () => void;
  onDecided: (r: CancelDecideResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState("");

  const close = () => {
    if (busy) return;
    setError("");
    onClose();
  };

  const submit = async (accept: boolean) => {
    if (!order || busy) return;
    setBusy(accept ? "accept" : "reject");
    setError("");
    try {
      const r = await decideCancelRequest(order.id, accept);
      hapticSelect();
      onDecided(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không gọi được sàn, thử lại hoặc xử lý trên Seller Center.");
    } finally {
      setBusy(null);
    }
  };

  const channel = order ? (CHANNEL_LABEL[order.channel.channelName] ?? order.channel.channelName) : "";

  return (
    <Modal
      visible={order !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={close}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={close} />
        <View
          className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ paddingBottom: 16 + insets.bottom }}
        >
          <View className="mb-2 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          {order ? (
            <>
              <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
                Khách xin hủy đơn <Text style={TABULAR}>{order.orderCode}</Text>
              </Text>
              <Text className="mt-1 text-[12px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
                {channel} · {order.channel.shopName} · {deadlineText(order.cancelRequestDueAt)}
                {order.cancelRequestReason ? ` · ${order.cancelRequestReason}` : ""}
              </Text>
              {error ? <Text className="mt-2 text-xs text-red-500">{error}</Text> : null}
              <View className="mt-4 flex-row gap-2">
                <Pressable
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 active:opacity-80 dark:bg-slate-800"
                  onPress={() => void submit(false)}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel="Từ chối yêu cầu hủy, tiếp tục giao"
                >
                  {busy === "reject" ? <ActivityIndicator size="small" color="#334155" /> : null}
                  <Text className="text-sm font-bold text-slate-700 dark:text-slate-200">Từ chối</Text>
                </Pressable>
                <Pressable
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-red-500 py-3 active:opacity-80"
                  onPress={() => void submit(true)}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel="Đồng ý hủy đơn"
                >
                  {busy === "accept" ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text className="text-sm font-bold text-white">Đồng ý hủy</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
