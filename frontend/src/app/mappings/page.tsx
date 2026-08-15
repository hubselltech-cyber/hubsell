"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Trang Liên kết sản phẩm đã GỘP vào hub Hàng hóa (tab "Chờ liên kết") —
 * route cũ giữ lại làm redirect để bookmark/link nội bộ không gãy.
 */
export default function MappingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/products?tab=links");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
