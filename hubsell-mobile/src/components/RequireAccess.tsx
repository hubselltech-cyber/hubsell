import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { accessOf, type AppAccess } from "@/lib/permissions";

/**
 * CỔNG QUYỀN của một màn: người đang đăng nhập không có quyền `allow` thì bị
 * đưa về cổng "/" (cổng tự chọn tab đầu tiên họ có, hoặc màn "chưa có quyền").
 * Thanh tab đã giấu tab không có quyền; cổng này chặn nốt lối đi vòng (đường
 * dẫn gõ tay trên giả lập web, màn còn mở khi chủ shop vừa rút quyền).
 * Bọc NGOÀI thân màn để thân màn không phải return sớm trước các hook.
 */
export function RequireAccess({
  allow,
  children,
}: {
  allow: (access: AppAccess) => boolean;
  children: React.ReactNode;
}) {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (!allow(accessOf(user))) return <Redirect href="/" />;
  return <>{children}</>;
}
