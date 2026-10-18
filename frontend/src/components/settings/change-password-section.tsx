"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ApiError, changePassword, fetchMe } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";

const schema = z
  .object({
    currentPassword: z.string(),
    newPassword: z.string().min(8, "Mật khẩu mới phải có ít nhất 8 ký tự"),
    confirmPassword: z.string().min(1, "Vui lòng nhập lại mật khẩu mới"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Mật khẩu nhập lại không khớp",
    path: ["confirmPassword"],
  });
type FormValues = z.infer<typeof schema>;

/**
 * ĐỔI MẬT KHẨU — người dùng tự đổi cho chính tài khoản đang đăng nhập
 * (Admin lẫn nhân viên). Bắt buộc nhập mật khẩu hiện tại để chống người khác
 * mượn phiên đang mở đổi trộm.
 *
 * ĐẶT MẬT KHẨU (18/10/2026): tài khoản đăng ký bằng Google chưa từng đặt mật
 * khẩu (/me trả hasPassword=false) → cùng thẻ này đổi thành "Đặt mật khẩu",
 * ẩn ô mật khẩu hiện tại. Lý do: app điện thoại chỉ đăng nhập bằng email +
 * mật khẩu, khách Google không có đường vào. Chờ /me xong mới mở nút gửi để
 * không nhảy giao diện.
 */
export function ChangePasswordSection() {
  const [submitting, setSubmitting] = useState(false);
  // null = chưa biết (đang hỏi /me); mặc định coi như có mật khẩu.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((r) => alive && setHasPassword(r.user.hasPassword !== false))
      .catch(() => alive && setHasPassword(true));
    return () => {
      alive = false;
    };
  }, []);

  const setting = hasPassword === false;

  async function onSubmit(values: FormValues) {
    if (!setting) {
      if (!values.currentPassword) {
        form.setError("currentPassword", { message: "Vui lòng nhập mật khẩu hiện tại" });
        return;
      }
      if (values.newPassword === values.currentPassword) {
        form.setError("newPassword", { message: "Mật khẩu mới phải khác mật khẩu hiện tại" });
        return;
      }
    }
    setSubmitting(true);
    try {
      await changePassword({
        currentPassword: setting ? undefined : values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success(
        setting
          ? "Đã đặt mật khẩu — đăng nhập app điện thoại bằng email và mật khẩu này."
          : "Đã đổi mật khẩu — dùng mật khẩu mới cho lần đăng nhập sau."
      );
      form.reset();
      setHasPassword(true);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được máy chủ"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-slate-500" />
          {setting ? "Đặt mật khẩu" : "Đổi mật khẩu"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <p className={TEXT_SUB}>
          {setting
            ? "Tài khoản của bạn đăng nhập bằng Google và chưa có mật khẩu. Đặt mật khẩu để đăng nhập app điện thoại Hubsell bằng email này."
            : "Áp dụng cho tài khoản đang đăng nhập. Phiên hiện tại vẫn giữ nguyên; các lần đăng nhập sau dùng mật khẩu mới."}
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 space-y-4">
            {!setting && (
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mật khẩu hiện tại</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{setting ? "Mật khẩu" : "Mật khẩu mới"}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
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
                    <FormLabel>{setting ? "Nhập lại mật khẩu" : "Nhập lại mật khẩu mới"}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || hasPassword === null}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {setting ? "Đặt mật khẩu" : "Đổi mật khẩu"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
