"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MailCheck, Store } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { CountrySelect } from "@/components/auth/country-select";
import { SocialAuthButtons } from "@/components/auth/social-buttons";
import {
  login,
  register as apiRegister,
  fetchMe,
  forgotPassword,
  setToken,
  setStoredUser,
  ApiError,
  type AuthUser,
} from "@/lib/api";
import { homePathFor } from "@/lib/permissions";

// ----- Validation bằng zod -----

// Ô đăng nhập chấp nhận CẢ username lẫn email — backend phân biệt theo "@".
const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Nhập tên đăng nhập hoặc email"),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
});

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Vui lòng nhập họ tên"),
    email: z.string().trim().email("Email không hợp lệ"),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9][a-z0-9._]{2,29}$/,
        "3-30 ký tự: chữ thường, số, dấu chấm, gạch dưới; không chứa @"
      ),
    country: z.string().length(2),
    password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Mật khẩu nhập lại không khớp",
    path: ["confirmPassword"],
  });

const forgotSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ"),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type ForgotValues = z.infer<typeof forgotSchema>;

type Mode = "login" | "register" | "forgot";

function LoginForm({
  onSuccess,
  onForgot,
}: {
  onSuccess: (user: AuthUser) => void;
  onForgot: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setSubmitting(true);
    try {
      const res = await login(values.identifier, values.password);
      setToken(res.token);
      setStoredUser(res.user);
      toast.success(`Chào mừng trở lại, ${res.user.fullName}!`);
      onSuccess(res.user);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="identifier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tên đăng nhập hoặc Email</FormLabel>
              <FormControl>
                <Input
                  placeholder="tendangnhap hoặc ban@email.com"
                  autoComplete="username"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Mật khẩu</FormLabel>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={onForgot}
                >
                  Quên mật khẩu?
                </button>
              </div>
              <FormControl>
                <PasswordInput
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Đăng nhập
        </Button>
        <SocialAuthButtons />
      </form>
    </Form>
  );
}

function RegisterForm({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      username: "",
      country: "VN",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: RegisterValues) {
    setSubmitting(true);
    try {
      const res = await apiRegister({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        username: values.username,
        country: values.country,
      });
      setToken(res.token);
      setStoredUser(res.user);
      toast.success(`Tạo tài khoản thành công. Xin chào, ${res.user.fullName}!`);
      onSuccess(res.user);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Họ và tên</FormLabel>
              <FormControl>
                <Input placeholder="Nguyễn Văn A" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder="ban@email.com" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tên đăng nhập</FormLabel>
              <FormControl>
                <Input
                  placeholder="tendangnhap"
                  autoComplete="username"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quốc gia</FormLabel>
              <FormControl>
                <CountrySelect value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mật khẩu</FormLabel>
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
              <FormLabel>Nhập lại mật khẩu</FormLabel>
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
          Tạo tài khoản
        </Button>
        <SocialAuthButtons />
      </form>
    </Form>
  );
}

// Màn QUÊN MẬT KHẨU: nhập email → nhận link đặt lại (hạn 30 phút).
function ForgotForm({ onBack }: { onBack: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotValues) {
    setSubmitting(true);
    try {
      await forgotPassword(values.email);
      setSentTo(values.email);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto size-10 text-emerald-500" />
        <p className="text-sm text-muted-foreground">
          Nếu <b className="text-foreground">{sentTo}</b> có tài khoản Hubsell, link
          đặt lại mật khẩu đã được gửi tới hộp thư (hạn 30 phút). Kiểm tra cả mục
          Spam nhé.
        </p>
        <Button variant="outline" className="w-full" onClick={onBack}>
          <ArrowLeft className="size-4" /> Về trang đăng nhập
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email đã đăng ký</FormLabel>
              <FormControl>
                <Input placeholder="ban@email.com" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Gửi link đặt lại mật khẩu
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          <ArrowLeft className="size-4" /> Quay lại đăng nhập
        </Button>
      </form>
    </Form>
  );
}

const MODE_COPY: Record<Mode, { title: string; description: string }> = {
  login: {
    title: "Đăng nhập",
    description: "Dùng tên đăng nhập hoặc email để vào hệ thống.",
  },
  register: {
    title: "Tạo tài khoản mới",
    description: "Điền thông tin bên dưới để bắt đầu dùng Hubsell.",
  },
  forgot: {
    title: "Quên mật khẩu",
    description: "Nhập email đã đăng ký — chúng tôi sẽ gửi link đặt lại mật khẩu.",
  },
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");

  function goToDashboard(user: AuthUser) {
    // Nhân viên kho không vào được Tổng quan → đưa thẳng tới Đơn hàng
    router.replace(homePathFor(user.role));
  }

  // Nhận kết quả đăng nhập Google: backend redirect về ?social=ok&token=...
  // (hoặc ?social=error&msg=). Dọn query ngay để token không nằm lại trong URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const social = params.get("social");
    if (!social) return;
    window.history.replaceState({}, "", "/login");
    if (social === "error") {
      toast.error(`Đăng nhập Google thất bại: ${params.get("msg") || "lỗi không rõ"}`);
      return;
    }
    const token = params.get("token");
    if (social === "ok" && token) {
      setToken(token);
      fetchMe()
        .then(({ user }) => {
          setStoredUser(user);
          toast.success(`Chào mừng, ${user.fullName}!`);
          router.replace(homePathFor(user.role));
        })
        .catch(() => toast.error("Không lấy được thông tin tài khoản, hãy thử lại."));
    }
    // router ổn định trong app router — chạy đúng một lần khi mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground">
            H
          </div>
          <div className="text-center">
            <p className="text-xl font-bold">Hubsell</p>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <Store className="size-3.5" /> Quản lý bán hàng đa kênh
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{MODE_COPY[mode].title}</CardTitle>
            <CardDescription>{MODE_COPY[mode].description}</CardDescription>
          </CardHeader>
          <CardContent>
            {mode === "login" && (
              <LoginForm onSuccess={goToDashboard} onForgot={() => setMode("forgot")} />
            )}
            {mode === "register" && <RegisterForm onSuccess={goToDashboard} />}
            {mode === "forgot" && <ForgotForm onBack={() => setMode("login")} />}

            {mode !== "forgot" && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {mode === "login" ? (
                  <>
                    Chưa có tài khoản?{" "}
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setMode("register")}
                    >
                      Đăng ký ngay
                    </button>
                  </>
                ) : (
                  <>
                    Đã có tài khoản?{" "}
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setMode("login")}
                    >
                      Đăng nhập
                    </button>
                  </>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        {/* KHÔNG in tài khoản demo ra đây nữa: URL production công khai
            (Vercel), lộ credentials admin là lộ dữ liệu shop thật. */}
        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Quản lý bán hàng đa kênh
        </p>
      </div>
    </div>
  );
}
