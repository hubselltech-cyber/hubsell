import React from "react";
import { View } from "react-native";
import { Image } from "expo-image";

/**
 * Orb Trợ lý Hubsell — bản mobile của avatar web (chốt nhận diện 21/08):
 * quả cầu navy tối + vành emerald + MŨI TÊN THẬT tách từ logo
 * (assets/images/assistant-arrow.png — cùng file với frontend/public).
 * Nền navy dùng hex cố định có chủ đích: nhận diện trợ lý LUÔN TỐI ở cả
 * 2 theme, không ăn theo dark mode.
 */
export function AssistantOrb({ size = 48 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#0a1424",
        borderWidth: Math.max(1.5, size * 0.03),
        borderColor: "#10b981",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Ảnh mũi tên 284x223 — giữ tỷ lệ, chiếm ~66% orb như bản web */}
      <Image
        source={require("../../assets/images/assistant-arrow.png")}
        style={{ width: size * 0.66, height: size * 0.66 * (223 / 284) }}
        contentFit="contain"
      />
    </View>
  );
}
