import type { Href } from "expo-router";

/**
 * Deep-link trong bản ghi thông báo là ĐƯỜNG DẪN WEB (backend ghi cho chuông
 * web: /orders?cancelRequested=1, /warehouse/returns, /ads/tiktok/campaign?id=…).
 * App đổi sang màn tương ứng; không có màn thì trả null (dòng chỉ để đọc).
 * Một chỗ duy nhất — thêm màn mới trên app thì nối ở đây.
 */
export function hrefForNotificationLink(link: string | null | undefined): Href | null {
  if (!link) return null;
  const [rawPath, rawQuery = ""] = link.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  const q = new URLSearchParams(rawQuery);

  if (path.startsWith("/orders") || path.startsWith("/operations-assistant")) {
    const params: Record<string, string> = {};
    if (q.get("cancelRequested")) params.cancelRequested = "1";
    const search = q.get("search");
    if (search) params.search = search;
    return { pathname: "/(admin)/orders", params } as Href;
  }
  if (path.startsWith("/warehouse/returns") || path.startsWith("/returns")) {
    return { pathname: "/(admin)/warehouse", params: { tab: "returns" } } as Href;
  }
  if (path.startsWith("/products") || path.startsWith("/inventory") || path.startsWith("/warehouse")) {
    return { pathname: "/(admin)/warehouse", params: { tab: "stock" } } as Href;
  }
  if (path.startsWith("/ads/tiktok/campaign")) {
    const id = q.get("id");
    if (id) return { pathname: "/tiktok-campaign", params: { id } } as Href;
  }
  if (path.startsWith("/ads") || path.includes("ads") || path.includes("quang-cao")) {
    return { pathname: "/(admin)/home", params: { page: "2" } } as Href;
  }
  if (
    path.startsWith("/finance") ||
    path.startsWith("/cash-flow") ||
    path.startsWith("/reports") ||
    path.startsWith("/dashboard")
  ) {
    return { pathname: "/(admin)/home", params: { page: "1" } } as Href;
  }
  return null;
}
