import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { getItem, setItem } from "@/auth/storage";
import { ScanModeSwitch, type ScanTabMode } from "@/components/ScanChrome";
import { PackScanScreen } from "@/screens/PackScanScreen";
import { ScanScreen } from "@/screens/ScanScreen";

/** Chế độ dùng lần trước của tab QR — người gói hàng mở lại là vào thẳng Đóng gói. */
const MODE_KEY = "scanTabMode";

/**
 * Nội dung của nút QR GIỮA thanh tab — hai việc, đổi bằng công tắc nổi trên camera
 * (anh Trung chốt 05/11):
 *   Xem đơn  — quét bất kỳ đơn nào để xem CHI TIẾT ĐƠN HÀNG (04/10);
 *   Đóng gói — quét liên tục các kiện đã gói → đơn sang "Đã đóng gói". Khu nhân viên
 *              không có tab Đơn hàng nên đây là lối vào của người gói hàng.
 * Vào được tab này tức là đã có quyền Đơn hàng (layout hai khu chỉ hiện nút QR khi có),
 * đúng quyền cả hai API cần.
 *
 * Thanh tab giữ màn mounted khi chuyển tab, mà màn quét giữ sáng màn hình + mở camera →
 * chỉ render khi tab đang được xem; rời tab là thả camera.
 * `homeHref` = tab đầu của khu (Trang chủ / Kho) — nút X góc trái màn quét về đó
 * (khách 16/10: bàn phím che thanh tab, không thấy đường ra).
 */
export function ScanDetailTab({ homeHref }: { homeHref: Href }) {
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  // null = chưa đọc xong lựa chọn đã lưu — chưa dựng camera, khỏi mở nhầm chế độ rồi đổi.
  const [mode, setMode] = useState<ScanTabMode | null>(null);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  useEffect(() => {
    let stale = false;
    getItem(MODE_KEY)
      .then((v) => {
        if (!stale) setMode(v === "pack" ? "pack" : "detail");
      })
      .catch(() => {
        if (!stale) setMode("detail");
      });
    return () => {
      stale = true;
    };
  }, []);

  if (!focused || mode === null) return <View className="flex-1 bg-slate-950" />;

  const changeMode = (next: ScanTabMode) => {
    setMode(next);
    void setItem(MODE_KEY, next).catch(() => {});
  };
  const onClose = () => router.navigate(homeHref);
  const modeSwitch = <ScanModeSwitch value={mode} onChange={changeMode} />;

  return mode === "pack" ? (
    <PackScanScreen embedded onClose={onClose} modeSwitch={modeSwitch} />
  ) : (
    <ScanScreen embedded mode="detail" onClose={onClose} modeSwitch={modeSwitch} />
  );
}
