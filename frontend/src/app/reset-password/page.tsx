"use client";

// ============================================================
// TRANG ĐẶT LẠI MẬT KHẨU — đích của link trong email Quên mật khẩu
// (?token=... — hạn 30 phút, dùng một lần). Đọc token qua window.location
// (client-only) để khỏi bọc Suspense như useSearchParams ở Next 16.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { ApiError, resetPassword } from "@/lib/api";

const schema = z
  .object({
    password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Mật khẩu nhập lại không khớp",
    path: ["confirmPassword"],
  });

type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setTokenValue] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    setTokenValue(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function onSubmit(values: Values) {
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await resetPassword(token, values.password);
      toast.success(res.message);
      router.replace("/login");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <KeyRound className="mx-auto size-10 text-primary" />
          <CardTitle>Đặt lại mật khẩu</CardTitle>
          <CardDescription>
            {token
              ? "Nhập mật khẩu mới cho tài khoản của bạn."
              : "Link không hợp lệ — hãy mở đúng link trong email Quên mật khẩu."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mật khẩu mới</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder="Ít nhất 6 ký tự"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nhập lại mật khẩu mới</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder="••••••••"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  Đổi mật khẩu
                </Button>
              </form>
            </Form>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.replace("/login")}
            >
              Về trang đăng nhập
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
