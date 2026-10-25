import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useNotifications } from "@/notifications/NotificationsContext";
import { destinationFor } from "@/lib/notification-links";
import { categoryMeta, timeAgo } from "@/lib/notification-meta";
import { hapticTap } from "@/lib/haptics";
import { ICON_TINT } from "@/theme/tokens";
import type { AppNotification } from "@/types/api";

/**
 * MÀN THÔNG BÁO (trang riêng, mở từ chuông Trang chủ). Quy ước như chuông web:
 * mở màn = đã liếc toàn bộ → badge về 0; chấm xanh trên từng dòng giữ theo dữ
 * liệu lúc mở để biết dòng nào vừa tới. Bấm dòng có màn tương ứng thì nhảy
 * sang (đơn hàng, đơn hoàn, quảng cáo…); dòng hệ thống chỉ để đọc.
 * Chữ: tiêu đề 2 dòng, nội dung 3 dòng — máy 320 px không tràn.
 */
export function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, loading, hasMore, refresh, loadMore, markAllRead, open } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  // Vào màn = đã đọc hết (badge về 0). KHÔNG refresh ở đây kẻo lượt đọc về
  // trước lượt đánh dấu → badge nhảy lại số cũ.
  useFocusEffect(
    useCallback(() => {
      markAllRead();
    }, [markAllRead])
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate("/(admin)/home");
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 6 }}>
      <View className="mb-1 flex-row items-center gap-1 px-2">
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
        >
          <Ionicons name="chevron-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Thông báo</Text>
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          onPress={() => {
            hapticTap();
            router.push("/notification-settings");
          }}
          accessibilityRole="button"
          accessibilityLabel="Cài đặt thông báo"
        >
          <Ionicons name="options-outline" size={22} color="#64748b" />
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => <NotificationRow n={item} onPress={() => open(item)} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + insets.bottom }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh(true);
                setRefreshing(false);
              }}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore) void loadMore();
          }}
          ListEmptyComponent={
            <View className="items-center px-6 py-16">
              <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ionicons name="notifications-off-outline" size={26} color="#94a3b8" />
              </View>
              <Text className="text-center text-sm font-medium text-slate-700 dark:text-slate-200">
                Chưa có thông báo nào
              </Text>
              <Text className="mt-1 text-center text-xs leading-5 text-slate-400 dark:text-slate-500">
                Đơn mới, khách xin hủy, hàng hoàn, cảnh báo quảng cáo và kho sẽ hiện ở đây và đẩy về
                máy bạn ngay khi xảy ra.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function NotificationRow({ n, onPress }: { n: AppNotification; onPress: () => void }) {
  const dark = useColorScheme().colorScheme === "dark";
  const meta = categoryMeta(n.category);
  const tint = ICON_TINT[meta.tint];
  const unread = !n.readAt;
  const canOpen = destinationFor(n) !== null;
  // Có việc để làm nhưng app chưa có màn (hóa đơn, gian hàng…) → nói rõ thay vì im.
  const webOnly = !canOpen && !!n.link;
  return (
    <Pressable
      className={`flex-row gap-3 rounded-2xl border px-3 py-3 ${
        unread
          ? "border-emerald-100 bg-white dark:border-emerald-500/20 dark:bg-slate-900"
          : "border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"
      } ${canOpen ? "active:opacity-70" : ""}`}
      onPress={() => {
        if (canOpen) hapticTap();
        onPress();
      }}
      accessibilityRole={canOpen ? "button" : "text"}
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: dark ? tint.dark : tint.light }}
      >
        <Ionicons name={meta.icon} size={20} color={tint.icon} />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start gap-2">
          <Text
            className={`flex-1 text-sm leading-5 ${
              unread ? "font-semibold text-slate-900 dark:text-slate-50" : "font-medium text-slate-700 dark:text-slate-200"
            }`}
            numberOfLines={2}
          >
            {n.title}
          </Text>
          {unread ? <View className="mt-1.5 h-2 w-2 rounded-full bg-emerald-500" /> : null}
        </View>
        {n.body ? (
          <Text className="mt-0.5 text-[13px] leading-[18px] text-slate-500 dark:text-slate-400" numberOfLines={3}>
            {n.body}
          </Text>
        ) : null}
        <View className="mt-1.5 flex-row items-center gap-1">
          <Text className="flex-1 text-[11px] text-slate-400 dark:text-slate-500">{timeAgo(n.createdAt)}</Text>
          {canOpen ? (
            <>
              <Text className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Mở</Text>
              <Ionicons name="chevron-forward" size={12} color="#10b981" />
            </>
          ) : webOnly ? (
            <>
              <Ionicons name="laptop-outline" size={12} color="#94a3b8" />
              <Text className="text-[11px] text-slate-400 dark:text-slate-500">Xem trên máy tính</Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
