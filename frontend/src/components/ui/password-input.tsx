"use client";

// Ô mật khẩu có nút Ẩn/Hiện (icon con mắt) — dùng chung cho Đăng nhập, Đăng
// ký, Đặt lại mật khẩu. Giữ nguyên mọi props của Input; chỉ khoá prop `type`.

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<typeof Input>, "type">;

export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className="pr-10"
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  }
);
