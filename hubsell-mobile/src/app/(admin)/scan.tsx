import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import ScanReturnsScreen from "../(warehouse)/scan";

/**
 * Tab "Quét đơn hoàn" trong khu chủ shop — dùng CHUNG màn quét của khu kho.
 * Tab bar giữ màn mounted khi chuyển tab, mà màn quét giữ sáng màn hình +
 * mở camera → chỉ render khi tab đang được xem; rời tab là thả camera.
 */
export default function AdminScanTab() {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  if (!focused) return <View className="flex-1 bg-slate-950" />;
  return <ScanReturnsScreen embedded />;
}
