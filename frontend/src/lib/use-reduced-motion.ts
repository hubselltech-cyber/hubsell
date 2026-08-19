"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Người dùng bật "giảm chuyển động" trong hệ điều hành? Dùng cho các animation
 * JS không đi qua Tailwind (Recharts…) — CSS thì đã có `motion-reduce:`.
 * SSR/lần render đầu trả false để không lệch hydration.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
