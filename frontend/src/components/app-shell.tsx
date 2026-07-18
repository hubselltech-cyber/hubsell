"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Link2,
  LogOut,
  Package,
  ShoppingCart,
  Store,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  clearToken,
  fetchMe,
  getStoredUser,
  setStoredUser,
  type AuthUser,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Tổng quan", icon: Home, adminOnly: true },
  { href: "/orders", label: "Đơn hàng", icon: ShoppingCart, adminOnly: false },
  { href: "/products", label: "Sản phẩm", icon: Package, adminOnly: false },
  { href: "/channels", label: "Kênh bán", icon: Store, adminOnly: true },
  { href: "/mappings", label: "Liên kết SP", icon: Link2, adminOnly: true },
];

// Tiêu đề trang hiển thị trên Header, suy ra từ đường dẫn hiện tại
const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/orders", title: "Quản lý đơn hàng" },
  { prefix: "/products", title: "Quản lý sản phẩm" },
  { prefix: "/channels", title: "Cấu hình kết nối" },
  { prefix: "/mappings", title: "Liên kết sản phẩm" },
];

function getPageTitle(pathname: string): string {
  const found = PAGE_TITLES.find((p) => pathname.startsWith(p.prefix));
  return found?.title ?? "Tổng quan";
}

// Bố cục chuẩn SaaS: Sidebar dọc bên trái + Header mỏng phía trên + nội dung chính
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
      return;
    }
    // Phiên cũ chưa lưu user → hỏi máy chủ
    fetchMe()
      .then((res) => {
        setStoredUser(res.user);
        setUser(res.user);
      })
      .catch(() => {
        // các trang tự xử lý chuyển hướng khi 401
      });
  }, []);

  const isStaff = user?.role === "STAFF";
  const items = NAV_ITEMS.filter((i) => !(isStaff && i.adminOnly));

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-muted/40">
      {/* ===== SIDEBAR DỌC BÊN TRÁI ===== */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-background md:flex">
        {/* Logo + tên thương hiệu */}
        <Link
          href={isStaff ? "/orders" : "/"}
          className="flex items-center gap-3 border-b px-5 py-4"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-600 text-lg font-bold text-primary-foreground shadow-sm">
            H
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight tracking-tight">
              Hubsell
            </p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              Quản lý bán hàng đa kênh
            </p>
          </div>
        </Link>

        {/* Menu điều hướng xếp dọc */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="size-4.5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Chân sidebar */}
        <div className="border-t p-4">
          <p className="text-center text-xs text-muted-foreground">
            Hubsell © 2026
          </p>
        </div>
      </aside>

      {/* ===== KHU VỰC BÊN PHẢI: HEADER + NỘI DUNG ===== */}
      <div className="flex min-h-screen flex-col md:pl-60">
        {/* Header mỏng */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {/* Trái: tên trang hiện tại */}
          <h1 className="text-lg font-semibold tracking-tight">
            {getPageTitle(pathname)}
          </h1>

          {/* Phải: thông tin người dùng + đăng xuất */}
          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden items-center gap-2 sm:flex">
                <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                  <UserRound className="size-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium">{user.fullName}</span>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    user.role === "ADMIN"
                      ? "border-violet-200 bg-violet-100 text-violet-700"
                      : "border-sky-200 bg-sky-100 text-sky-700"
                  )}
                >
                  {user.role === "ADMIN" ? "Chủ shop" : "Nhân viên"}
                </span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="size-4" />
              Đăng xuất
            </Button>
          </div>
        </header>

        {/* Nội dung chính */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
