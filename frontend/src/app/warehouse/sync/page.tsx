"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Trang Đồng bộ tồn kho đã gộp thành hộp cài đặt theo gian. Từ 19/11/2026 hộp chỉ còn mở từ trang
 * Sản phẩm trên sàn (nút "Đồng bộ tồn theo gian" — Tổng kho bỏ nút đồng bộ); route cũ giữ lại làm
 * redirect để bookmark / link nội bộ không gãy.
 */
export default function WarehouseSyncRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/products/marketplace?sync=1");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
