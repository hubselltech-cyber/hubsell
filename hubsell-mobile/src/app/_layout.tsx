import "../global.css";
import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/auth/AuthContext";
import { BiometricGate } from "@/auth/BiometricGate";
import { ThemeProvider } from "@/theme/ThemeContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <BiometricGate>
            {/* style auto: chữ status bar tự đảo theo scheme sáng/tối */}
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              {/* Trợ lý Hubsell — trượt lên dạng modal từ orb nổi ở Trang chủ */}
              <Stack.Screen name="assistant" options={{ presentation: "modal" }} />
            </Stack>
          </BiometricGate>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
