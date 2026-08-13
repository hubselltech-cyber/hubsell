import React from "react";
import { Text, View } from "react-native";

export function Badge({
  label,
  bg,
  text,
}: {
  label: string;
  bg: string;
  text: string;
}) {
  return (
    <View className={`rounded-full px-2 py-0.5 ${bg}`}>
      <Text className={`text-[11px] font-semibold ${text}`}>{label}</Text>
    </View>
  );
}
