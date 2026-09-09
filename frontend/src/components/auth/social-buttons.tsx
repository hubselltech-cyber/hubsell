"use client";

// Divider "Hoặc" + nút đăng nhập Google (OAuth thật: redirect sang backend
// /api/auth/google — backend chưa cấu hình key sẽ trả 503 và FE báo rõ).
//
// 09/09/2026: bỏ 3 nút Facebook / Apple / GitHub từng chỉ bắn toast "sắp ra
// mắt" — nút chết trên màn hình đầu tiên là dấu hiệu sản phẩm chưa xong, và
// GitHub không có nghĩa gì với chủ shop. Khi nào nối thật thì thêm lại nút.

import { Button } from "@/components/ui/button";
import { googleAuthUrl } from "@/lib/api";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.6 2.8c2.11-1.96 3.32-4.85 3.32-8.62Z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.43.35-2.09L2.18 7.07A10.94 10.94 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.6-2.8c-1 .67-2.28 1.08-3.68 1.08-2.86 0-5.29-1.93-6.16-4.53l-3.66 2.84C3.99 20.53 7.7 23 12 23Z" />
    </svg>
  );
}

export function SocialAuthButtons() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">Hoặc</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => window.location.assign(googleAuthUrl())}
      >
        <GoogleIcon />
        Tiếp tục với Google
      </Button>
    </div>
  );
}
