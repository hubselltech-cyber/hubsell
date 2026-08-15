"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Trang Đồng bộ tồn kho đã GỘP vào hub Hàng hóa (dialog Cài đặt trên header) —
 * route cũ giữ lại làm redirect để bookmark/link nội bộ không gãy.
 */
export default function WarehouseSyncRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/products?sync=1");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
