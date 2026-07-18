"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  Home,
  Link2,
  Loader2,
  LogOut,
  Package,
  ShoppingCart,
  Store,
  Users,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { OnboardingOverlay } from "@/components/onboarding-overlay";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  clearToken,
  fetchMe,
  getStoredUser,
  setStoredUser,
  type AuthUser,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavChild {
  href: string;
  label: string;
}
interface NavItem {
  href?: string;
  label: string;
  icon: LucideIcon;
  adminOnly: boolean;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tổng quan", icon: Home, adminOnly: true },
  { href: "/orders", label: "Đơn hàng", icon: ShoppingCart, adminOnly: false },
  {
    label: "Quản lý Tài chính",
    icon: Wallet,
    adminOnly: true,
    children: [
      { href: "/finance/analytics", label: "Báo cáo dòng tiền" },
      { href: "/finance/expenses", label: "Chi phí vận hành" },
      { href: "/finance/loss-orders", label: "Cảnh báo đơn lỗ" },
      { href: "/finance/shipping-alerts", label: "Đối soát phí ship" },
      { href: "/finance/cost-prices", label: "Cấu hình Giá vốn" },
    ],
  },
  { href: "/products", label: "Sản phẩm", icon: Package, adminOnly: false },
  { href: "/channels", label: "Kênh bán", icon: Store, adminOnly: true },
  { href: "/mappings", label: "Liên kết SP", icon: Link2, adminOnly: true },
  { href: "/staff", label: "Nhân viên", icon: Users, adminOnly: true },
];

// Tiêu đề trang hiển thị trên Header, suy ra từ đường dẫn hiện tại
const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/orders", title: "Quản lý đơn hàng" },
  { prefix: "/products", title: "Quản lý sản phẩm" },
  { prefix: "/channels", title: "Cấu hình kết nối" },
  { prefix: "/mappings", title: "Liên kết sản phẩm" },
  { prefix: "/staff", title: "Quản lý nhân viên" },
  { prefix: "/finance/analytics", title: "Báo cáo dòng tiền" },
  { prefix: "/finance/expenses", title: "Chi phí vận hành" },
  { prefix: "/finance/loss-orders", title: "Cảnh báo đơn lỗ" },
  { prefix: "/finance/cost-prices", title: "Cấu hình Giá vốn" },
  { prefix: "/finance/shipping-alerts", title: "Đối soát phí vận chuyển" },
];

function getPageTitle(pathname: string): string {
  const found = PAGE_TITLES.find((p) => pathname.startsWith(p.prefix));
  return found?.title ?? "Tổng quan";
}

// Bố cục chuẩn SaaS: Sidebar dọc + Header mỏng + nội dung chính.
// Kèm Onboarding guard: chưa kết nối gian hàng nào → hiện màn hình chặn.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [hasChannels, setHasChannels] = useState<boolean | null>(null);
  // Menu con nào đang mở (theo label). Tự mở nhóm Tài chính khi đang ở /finance/*
  const [openMenus, setOpenMenus] = useState<Set<string>>(
    () => new Set(pathname.startsWith("/finance") ? ["Quản lý Tài chính"] : [])
  );

  function toggleMenu(label: string) {
    setOpenMenus((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetchMe();
      setStoredUser(res.user);
      setUser(res.user);
      setHasChannels(res.hasChannels);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      // Lỗi khác (máy chủ tắt): coi như đã có kênh để không chặn nhầm,
      // các trang sẽ tự hiển thị lỗi kết nối máy chủ.
      setHasChannels(true);
    }
  }, [router]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const isStaff = user?.role === "STAFF";
  const items = NAV_ITEMS.filter((i) => !(isStaff && i.adminOnly));

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  // Đang kiểm tra trạng thái — hiện spinner nhẹ để tránh nháy nội dung
  if (hasChannels === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Chưa kết nối gian hàng → chặn toàn bộ, hiện màn hình onboarding
  if (!hasChannels) {
    return (
      <OnboardingOverlay
        isAdmin={user?.role === "ADMIN"}
        onConnected={checkStatus}
        onLogout={() => router.replace("/login")}
      />
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      {/* ===== SIDEBAR DỌC BÊN TRÁI ===== */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-background md:flex">
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

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            // ----- Mục có MENU CON (ví dụ: Quản lý Tài chính) -----
            if (item.children) {
              const groupActive = item.children.some((c) =>
                pathname.startsWith(c.href)
              );
              const open = openMenus.has(item.label) || groupActive;
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    onClick={() => toggleMenu(item.label)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      groupActive
                        ? "text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="size-4.5 shrink-0" />
                    {item.label}
                    <ChevronDown
                      className={cn(
                        "ml-auto size-4 transition-transform",
                        open && "rotate-180"
                      )}
                    />
                  </button>
                  {open && (
                    <div className="mt-1 space-y-1 border-l pl-4 ml-5">
                      {item.children.map((child) => {
                        const childActive = pathname.startsWith(child.href);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={cn(
                              "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                              childActive
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // ----- Mục thường -----
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href!);
            return (
              <Link
                key={item.href}
                href={item.href!}
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

        <div className="border-t p-4">
          <p className="text-center text-xs text-muted-foreground">
            Hubsell © 2026
          </p>
        </div>
      </aside>

      {/* ===== KHU VỰC BÊN PHẢI: HEADER + NỘI DUNG ===== */}
      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <h1 className="text-lg font-semibold tracking-tight">
            {getPageTitle(pathname)}
          </h1>

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

        {/* Bung rộng theo màn hình (không khoá max-width) để các bảng dữ liệu
            tận dụng tối đa không gian — chuẩn layout ERP như Salework. */}
        <main className="w-full flex-1 px-6 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
