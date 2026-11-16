"use client";

import { useParams } from "next/navigation";

import { PackVideoOrderPage } from "@/components/orders/videos/videos-page";

/** /orders/videos/order/[orderId] — hồ sơ video (đóng + khui) của một đơn. */
export default function Page() {
  // Cùng cách trang in phiếu kho đang đọc tham số đường dẫn (useParams trong client component).
  const params = useParams<{ orderId: string }>();
  return <PackVideoOrderPage orderId={params?.orderId ?? ""} />;
}
