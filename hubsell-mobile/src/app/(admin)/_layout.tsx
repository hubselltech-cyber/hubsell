import React from "react";
import { Redirect } from "expo-router";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/auth/AuthContext";
import { hapticSelect } from "@/lib/haptics";
import {
  ConversationsProvider,
  useConversations,
} from "@/chat/ConversationsContext";

/** Khu CHỦ SHOP — nhân viên lạc vào đây bị đá về cổng phân vai. */
export default function AdminLayout() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;

  return (
    <ConversationsProvider>
      <AdminTabs />
    </ConversationsProvider>
  );
}

function AdminTabs() {
  // Đếm tin chưa đọc cho badge tab — provider poll sẵn nên vào app là có số
  const { totalUnread } = useConversations();
  // Tab bar là component native — không ăn class dark: nên đổi màu bằng JS
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? "#f1f5f9" : "#0f172a",
        tabBarInactiveTintColor: dark ? "#64748b" : "#94a3b8",
        tabBarStyle: {
          backgroundColor: dark ? "#0f172a" : "#ffffff",
          borderTopColor: dark ? "#1e293b" : "#e2e8f0",
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
      screenListeners={{ tabPress: () => hapticSelect() }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Trang chủ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Đơn hàng",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bag-handle-outline" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Tin nhắn",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={size - 2} color={color} />
          ),
          tabBarBadge: totalUnread
            ? totalUnread > 99
              ? "99+"
              : totalUnread
            : undefined,
          tabBarBadgeStyle: {
            backgroundColor: "#10b981",
            color: "#fff",
            fontSize: 10,
            fontWeight: "700",
          },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Cấu hình",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size - 2} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
