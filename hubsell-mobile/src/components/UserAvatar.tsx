import React from "react";
import { Image, Text, View } from "react-native";
import type { AuthUser } from "../types/api";

/** Ảnh đại diện đặt trên web; chưa đặt thì hiện chữ cái đầu của tên. */
export function UserAvatar({ user }: { user: AuthUser }) {
  if (user.avatar) {
    return (
      <Image
        source={{ uri: user.avatar }}
        className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800"
        accessibilityLabel="Ảnh đại diện"
      />
    );
  }
  return (
    <View className="h-12 w-12 items-center justify-center rounded-full bg-slate-900 dark:bg-slate-700">
      <Text className="text-lg font-bold text-white">
        {(user.fullName || "?").charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}
