"use client";

// Divider "Hoặc tiếp tục với" + hàng nút đăng nhập mạng xã hội.
// GOOGLE đã nối OAuth thật (redirect sang backend /api/auth/google — backend
// chưa cấu hình key sẽ trả 503 và FE báo rõ). Facebook/Apple/GitHub: UI sẵn
// sàng, bấm ra thông báo "sắp ra mắt" — Apple đòi Developer Program trả phí,
// FB đòi App Review; nối sau khi có tài khoản, tránh phung phí thời gian beta.

import { toast } from "sonner";

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

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12Z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-foreground" aria-hidden>
      <path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58l-.01-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.49 5.92.43.38.82 1.11.82 2.24l-.01 3.32c0 .32.21.7.82.58A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-foreground" aria-hidden>
      <path d="M16.36 12.76c.03 3.26 2.86 4.35 2.89 4.36-.02.08-.45 1.55-1.49 3.07-.9 1.31-1.83 2.62-3.3 2.64-1.44.03-1.91-.85-3.56-.85-1.65 0-2.17.83-3.53.88-1.42.05-2.5-1.42-3.4-2.72C2.1 17.46.7 12.6 2.6 9.39a5.27 5.27 0 0 1 4.45-2.7c1.39-.03 2.7.94 3.55.94.85 0 2.45-1.16 4.13-.99.7.03 2.67.28 3.94 2.14-.1.06-2.35 1.37-2.31 3.98ZM13.63 4.85c.75-.9 1.25-2.16 1.11-3.41-1.08.04-2.38.72-3.15 1.62-.69.8-1.3 2.08-1.13 3.3 1.2.1 2.42-.61 3.17-1.51Z" />
    </svg>
  );
}

export function SocialAuthButtons() {
  const comingSoon = (name: string) => () =>
    toast.info(`Đăng nhập bằng ${name} sắp ra mắt — hiện hãy dùng Google hoặc email.`);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">Hoặc tiếp tục với</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Button
          type="button"
          variant="outline"
          aria-label="Đăng nhập bằng Google"
          onClick={() => window.location.assign(googleAuthUrl())}
        >
          <GoogleIcon />
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-label="Đăng nhập bằng Facebook"
          onClick={comingSoon("Facebook")}
        >
          <FacebookIcon />
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-label="Đăng nhập bằng Apple"
          onClick={comingSoon("Apple")}
        >
          <AppleIcon />
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-label="Đăng nhập bằng GitHub"
          onClick={comingSoon("GitHub")}
        >
          <GithubIcon />
        </Button>
      </div>
    </div>
  );
}
