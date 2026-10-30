"use client";

// Hàng hóa → Tạo sản phẩm mới: luồng soạn + đăng lên gian của Sao chép sản phẩm (docs/SAO-CHEP-SAN-PHAM.md mục 24, 30).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { ManualCreatePage } from "@/components/operations/copy-listing/manual-create-page";
import { AppShell } from "@/components/shell/app-shell";
import { getToken } from "@/lib/api";

export default function NewProductPage() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);
  return (
    <AppShell>
      <ManualCreatePage />
    </AppShell>
  );
}
