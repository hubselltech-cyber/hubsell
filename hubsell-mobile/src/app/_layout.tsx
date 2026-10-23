import "../global.css";
import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/auth/AuthContext";
import { BiometricGate } from "@/auth/BiometricGate";
import { PlanProvider } from "@/plan/PlanContext";
import { NotificationsProvider } from "@/notifications/NotificationsContext";
import { ThemeProvider } from "@/theme/ThemeContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <PlanProvider>
          {/* Chuông + push: ở gốc vì màn Thông báo / Cài đặt nằm ngoài nhóm (admin);
              tự im khi chưa đăng nhập hoặc không phải chủ shop. */}
          <NotificationsProvider>
          <BiometricGate>
            {/* style auto: chữ status bar tự đảo theo scheme sáng/tối */}
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              {/* Trợ lý Hubsell — trượt lên dạng modal từ orb nổi ở Trang chủ */}
              <Stack.Screen name="assistant" options={{ presentation: "modal" }} />
            </Stack>
          </BiometricGate>
          </NotificationsProvider>
          </PlanProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
