"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Màn hình chặn khi Nhân viên (Staff) vào trang chỉ dành cho Chủ shop (Admin)
export function AccessDenied() {
  return (
    <div className="flex justify-center py-16">
      <Card className="w-full max-w-md border-rose-200">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-rose-100">
            <ShieldAlert className="size-7 text-rose-600" />
          </div>
          <div>
            <p className="text-lg font-semibold">Bạn không có quyền truy cập</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Trang này chỉ dành cho Chủ shop (Admin). Tài khoản Nhân viên được
              làm việc ở trang Đơn hàng và Sản phẩm.
            </p>
          </div>
          <Button nativeButton={false} render={<Link href="/orders" />}>
            Về trang Đơn hàng
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
