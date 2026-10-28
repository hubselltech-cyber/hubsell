import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { getItem, setItem } from "@/auth/storage";
import { groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { RAISED_SHADOW, TABULAR } from "@/theme/tokens";

/**
 * HỘP NHẮC NHẬP GIÁ VỐN trên Tổng quan mobile (28/10/2026) — cùng luật với
 * hộp web `missing-cost-prompt.tsx` anh chốt 02/10: hiện khi KỲ ĐANG XEM có đơn
 * thiếu giá vốn (không hiện ở bước nối gian — lúc đó danh mục chưa về), mỗi lần
 * mở app hỏi tối đa MỘT lần, "Nhập giá vốn" im tới hết phiên, "Bỏ qua" / X =
 * KHÔNG HIỆN LẠI NỮA theo tài khoản trên máy đó ([[feedback-bo-qua-la-khong-hien-lai]]).
 * Chạm ra ngoài hộp không đóng. Chỉ bật khi tab Trang chủ đang được nhìn —
 * Modal của màn nằm nền vẫn phủ lên tab khác (đã thấy đè lên Cấu hình 28/10).
 */
const DISMISSED_KEY = (uid: string) => `hubsell_missing_cost_prompt_dismissed:${uid}`;
/** Đã hỏi trong phiên chạy này (mọi tài khoản) — reset khi app khởi động lại. */
const askedThisRun = new Set<string>();

export function MissingCostPrompt({
  userId,
  orderCount,
  onEnter,
}: {
  userId: string;
  /** Số đơn hôm nay chưa có giá vốn — 0 thì không hỏi. */
  orderCount: number;
  onEnter: () => void;
}) {
  /** Đủ điều kiện hỏi; hộp chỉ vẽ khi Trang chủ đang được nhìn (open = pending && focused). */
  const [pending, setPending] = useState(false);
  const checked = useRef(false);
  const insets = useSafeAreaInsets();
  // Trang chủ đang được nhìn? (expo-router không phơi useIsFocused — theo dõi
  // bằng useFocusEffect: vào = true, rời = false.)
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  useEffect(() => {
    if (orderCount <= 0 || checked.current || askedThisRun.has(userId)) return;
    checked.current = true;
    let alive = true;
    getItem(DISMISSED_KEY(userId))
      .then((v) => {
        if (!alive || v === "1") return;
        askedThisRun.add(userId);
        setPending(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [orderCount, userId]);

  if (!pending || !focused) return null;

  const dismissForever = () => {
    hapticTap();
    setPending(false);
    void setItem(DISMISSED_KEY(userId), "1");
  };
  const enter = () => {
    hapticTap();
    setPending(false);
    onEnter();
  };

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={dismissForever}>
      <View className="flex-1 items-center justify-center bg-black/45 px-6" style={{ paddingBottom: insets.bottom }}>
        <View className="w-full max-w-[360px] rounded-3xl bg-white p-5 dark:bg-slate-900" style={RAISED_SHADOW}>
          <View className="flex-row items-start justify-between">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-500/15">
              <Ionicons name="pricetag" size={22} color="#d97706" />
            </View>
            <Pressable onPress={dismissForever} hitSlop={10} accessibilityLabel="Bỏ qua, không nhắc lại">
              <Ionicons name="close" size={22} color="#94a3b8" />
            </Pressable>
          </View>
          <Text className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
            {groupVN(orderCount)} đơn chưa có giá vốn
          </Text>
          <Text className="mt-1.5 text-[13px] leading-5 text-slate-500 dark:text-slate-400">
            Hubsell chưa tính được lợi nhuận cho những đơn này. Nhập giá vốn một lần, báo cáo và
            Trợ lý quảng cáo sẽ tự tính lại.
          </Text>
          <Pressable
            className="mt-5 h-12 items-center justify-center rounded-2xl bg-emerald-600 active:opacity-85"
            onPress={enter}
          >
            <Text className="text-[15px] font-bold text-white">Nhập giá vốn</Text>
          </Pressable>
          <Pressable className="mt-2 h-11 items-center justify-center rounded-2xl active:opacity-70" onPress={dismissForever}>
            <Text className="text-[14px] font-medium text-slate-500 dark:text-slate-400">Bỏ qua, không nhắc lại</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
