import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/auth/AuthContext";
import { Card } from "@/components/Card";
import { hapticTap } from "@/lib/haptics";
import { usePlan } from "@/plan/PlanContext";

/**
 * THẺ KHÓA thay nội dung màn tầng nâng cao (Tổng quan số tiền, Tài chính,
 * Quảng cáo) khi backend trả 403 PLAN_LOCKED — tương ứng PlanLockedScreen web.
 * Phải nói rõ đơn + tồn kho vẫn đồng bộ để khách yên tâm dữ liệu không mất.
 * CÙNG HÀNH VI iOS + Android (anh Trung 08/10, luật store xem plan-ui.ts): câu
 * chữ trung tính — không nhắc gói, giá, gia hạn, nơi mua, không chỉ sang bản
 * web; `message` là câu client đã thay trung tính. Chỉ còn nút "tải lại".
 */
export function PlanLockedCard({
  message,
  onRetry,
  compact = false,
}: {
  /** Câu lỗi từ client (đã trung tính) — hiện làm thân thẻ. */
  message?: string;
  /** "Đã mở lại, tải lại" — màn gọi tải lại dữ liệu của mình. */
  onRetry: () => void;
  /** Bản gọn cho khối con (Gợi ý Ads) — không có ô icon lớn. */
  compact?: boolean;
}) {
  const { refresh } = usePlan();
  const { user } = useAuth();
  const isOwner = user?.role === "ADMIN";

  return (
    <Card className={compact ? "items-center p-4" : "items-center p-6"}>
      {compact ? null : (
        <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-500/15">
          <Ionicons name="lock-closed-outline" size={26} color="#dc2626" />
        </View>
      )}
      <Text className="text-center text-base font-semibold text-slate-900 dark:text-slate-100">
        Tính năng này đang tạm khóa
      </Text>
      <Text className="mt-1.5 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
        {message ?? "Tính năng này hiện chưa được bật cho tài khoản của bạn."} Đơn hàng và tồn
        kho vẫn được đồng bộ đầy đủ phía sau.
      </Text>
      {isOwner ? null : (
        <Text className="mt-2 text-center text-xs font-medium leading-5 text-slate-700 dark:text-slate-200">
          Liên hệ chủ shop để được mở lại.
        </Text>
      )}
      <Pressable
        className="mt-3"
        hitSlop={8}
        onPress={() => {
          hapticTap();
          void refresh();
          onRetry();
        }}
      >
        <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          Đã mở lại, tải lại
        </Text>
      </Pressable>
    </Card>
  );
}
