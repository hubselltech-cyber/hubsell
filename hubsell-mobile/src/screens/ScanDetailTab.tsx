import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { ScanScreen } from "@/screens/ScanScreen";

/**
 * Nội dung của nút QR GIỮA thanh tab — quét bất kỳ đơn nào để xem CHI TIẾT ĐƠN
 * HÀNG (anh Trung 04/10). Thanh tab giữ màn mounted khi chuyển tab, mà màn quét
 * giữ sáng màn hình + mở camera → chỉ render khi tab đang được xem; rời tab là
 * thả camera.
 * `homeHref` = tab đầu của khu (Trang chủ / Kho) — nút X góc trái màn quét về đó
 * (khách 16/10: bàn phím che thanh tab, không thấy đường ra).
 */
export function ScanDetailTab({ homeHref }: { homeHref: Href }) {
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  if (!focused) return <View className="flex-1 bg-slate-950" />;
  return (
    <ScanScreen embedded mode="detail" onClose={() => router.navigate(homeHref)} />
  );
}
