import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import * as storage from "@/auth/storage";
import { hapticTap } from "@/lib/haptics";
import { usePlan } from "@/plan/PlanContext";
import { planBannerOf } from "@/plan/plan-ui";

const SEEN_KEY = "hubsell.planBannerSeen";

async function readSeen(): Promise<string[]> {
  try {
    const parsed = JSON.parse((await storage.getItem(SEEN_KEY)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * DẢI NHẮC GÓI dưới thanh mục Trang chủ (08/10) — cùng triết lý PlanQuotaBanner
 * web: vàng khi sắp hết hạn / chạm 80% trần (có nút tắt, nhớ theo khóa), đỏ khi
 * hết hạn / vượt trần / đã khóa (KHÔNG tắt được).
 * LUẬT STORE (plan-ui.ts): dải chỉ là CHỮ trung tính — không bấm được, không
 * link, không nhắc gói / gia hạn; CÙNG hành vi iOS + Android. Nhân viên thấy
 * lời nhắc "báo chủ shop".
 */
export function PlanBanner() {
  const { plan } = usePlan();
  const { user } = useAuth();
  const router = useRouter();
  const content = planBannerOf(plan);
  // null = chưa đọc kho → chưa vẽ (tránh nháy dải vàng rồi biến mất).
  const [seen, setSeen] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readSeen().then((s) => {
      if (!cancelled) setSeen(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!content || seen === null) return null;
  if (content.dismissible && seen.includes(content.key)) return null;

  const isOwner = user?.role === "ADMIN";
  const red = content.tone === "red";

  const dismiss = () => {
    hapticTap();
    const next = [...new Set([...seen, content.key])].slice(-20);
    setSeen(next);
    void storage.setItem(SEEN_KEY, JSON.stringify(next));
  };

  return (
    <View className="px-4 pb-2">
      <View
        accessibilityRole="alert"
        className={`flex-row items-start gap-2.5 rounded-2xl border px-3 py-2.5 ${
          red
            ? "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"
            : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
        }`}
      >
        <Ionicons
          name={red ? "alert-circle" : "time-outline"}
          size={18}
          color={red ? "#dc2626" : "#d97706"}
          style={{ marginTop: 1 }}
        />
        <View className="flex-1">
          <Text
            className={`text-[13px] font-semibold leading-[18px] ${
              red ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-200"
            }`}
          >
            {content.lead}
          </Text>
          <Text
            className={`mt-0.5 text-[11px] leading-4 ${
              red ? "text-red-600/90 dark:text-red-300/80" : "text-amber-700/90 dark:text-amber-200/80"
            }`}
          >
            {isOwner ? content.detail : "Báo chủ shop để không gián đoạn việc dùng app."}
          </Text>
          {/* iOS + chủ shop: đã mua được trong app (10/10) → dẫn thẳng tới màn Gói dịch vụ. */}
          {isOwner && Platform.OS === "ios" ? (
            <Pressable
              onPress={() => {
                hapticTap();
                router.push("/plan");
              }}
              className="mt-1.5 self-start active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="Mở mục Gói dịch vụ"
            >
              <Text
                className={`text-[12px] font-semibold ${
                  red ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-200"
                }`}
              >
                Xem gói dịch vụ ›
              </Text>
            </Pressable>
          ) : null}
        </View>
        {content.dismissible ? (
          <Pressable
            onPress={dismiss}
            hitSlop={10}
            accessibilityLabel="Tắt nhắc"
            className="-mr-1 -mt-1 p-1"
          >
            <Ionicons name="close" size={16} color={red ? "#dc2626" : "#d97706"} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
