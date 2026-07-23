"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * /settings — trang gốc chỉ điều hướng sang mục con mặc định (Cấu hình chung).
 * Cấu hình đã tách thành 3 mục con phân cấp trong sidebar; giữ route này để link
 * hoặc bookmark cũ vẫn vào được.
 */
export default function SettingsIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings/general");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
