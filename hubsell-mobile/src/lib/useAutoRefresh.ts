import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

/**
 * SỐ "TƯƠI" NHƯ WEB — web dùng React Query (staleTime 30s + refetch khi tab
 * được focus) nên quay lại Tổng quan là thấy số mới. Mobile trước đây chỉ tải
 * MỘT lần lúc mount: mở app để cả ngày là số đứng yên (anh Trung 03/10).
 *
 * Hook này gọi lại `reload` (tải NỀN, không spinner) khi:
 *   · app từ nền quay lại foreground (AppState → "active");
 *   · màn hình chứa nó được focus lại (đổi tab rồi quay về);
 *   · định kỳ mỗi `intervalMs` khi app đang mở (mặc định 60s).
 * Lần tải đầu vẫn do màn hình tự gọi — hook không tải lúc mount để khỏi
 * gọi đúp với useEffect sẵn có.
 */
export function useAutoRefresh(reload: () => void, intervalMs = 60_000) {
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  const mounted = useRef(false);

  // Focus: bỏ qua lần focus ĐẦU (trùng với mount), chỉ tải khi quay lại.
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reloadRef.current();
      mounted.current = true;
    }, [])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") reloadRef.current();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") reloadRef.current();
    }, intervalMs);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [intervalMs]);
}
