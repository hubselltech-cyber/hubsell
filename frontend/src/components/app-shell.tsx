"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  Home,
  Menu,
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
  ROLE_META,
  setStoredUser,
  type AuthUser,
  type Role,
} from "@/lib/api";
import { homePathFor } from "@/lib/permissions";
import { TEXT_PAGE_TITLE } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface NavChild {
  href: string;
  label: string;
}
interface NavItem {
  href?: string;
  label: string;
  icon: LucideIcon;
  /** Vai trò nào nhìn thấy mục này. Không có tên trong đây thì mục bị ẩn hẳn. */
  roles: Role[];
  children?: NavChild[];
}

const ALL_ROLES: Role[] = ["ADMIN", "SALES", "WAREHOUSE"];

const NAV_ITEMS: NavItem[] = [
  // Kho không có việc gì ở Tổng quan; SALES vào được nhưng bị cắt chỉ số tài chính
  { href: "/", label: "Tổng quan", icon: Home, roles: ["ADMIN", "SALES"] },
  { href: "/orders", label: "Đơn hàng", icon: ShoppingCart, roles: ALL_ROLES },
  {
    label: "Quản lý Tài chính",
    icon: Wallet,
    roles: ["ADMIN"],
    children: [
      { href: "/finance/analytics", label: "Báo cáo dòng tiền" },
      { href: "/finance/expenses", label: "Chi phí vận hành" },
      { href: "/finance/loss-orders", label: "Cảnh báo & P&L Sản phẩm" },
      { href: "/finance/shipping-alerts", label: "Đối soát phí ship" },
      { href: "/finance/cost-prices", label: "Cấu hình Giá vốn" },
    ],
  },
  {
    // Nghiệp vụ kho gom về một nhóm: nhập hàng, quản lý sản phẩm và đối soát
    // hàng hoàn đều là việc của kho.
    label: "Quản lý Kho",
    icon: Package,
    roles: ALL_ROLES,
    children: [
      // GIỮ NGUYÊN đường dẫn /products — đây chỉ là gom nhóm ở tầng menu, đổi
      // route sẽ làm hỏng link cũ và bookmark của người dùng mà chẳng được gì.
      { href: "/products", label: "Sản phẩm" },
      { href: "/warehouse/returns", label: "Đối soát đơn hoàn" },
    ],
  },
  { href: "/channels", label: "Kênh bán", icon: Store, roles: ["ADMIN"] },
  { href: "/mappings", label: "Liên kết SP", icon: Link2, roles: ["ADMIN"] },
  { href: "/staff", label: "Nhân viên", icon: Users, roles: ["ADMIN"] },
];

// Tiêu đề trang hiển thị trên Header, suy ra từ đường dẫn hiện tại
const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/orders", title: "Quản lý đơn hàng" },
  { prefix: "/products", title: "Quản lý sản phẩm" },
  { prefix: "/warehouse/returns", title: "Đối soát đơn hoàn" },
  { prefix: "/channels", title: "Cấu hình kết nối" },
  { prefix: "/mappings", title: "Liên kết sản phẩm" },
  { prefix: "/staff", title: "Quản lý nhân viên" },
  { prefix: "/finance/analytics", title: "Báo cáo dòng tiền" },
  { prefix: "/finance/expenses", title: "Chi phí vận hành" },
  { prefix: "/finance/loss-orders", title: "Cảnh báo & P&L Sản phẩm" },
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
  // Drawer điều hướng trên điện thoại — dưới md sidebar cố định bị ẩn,
  // không có drawer này thì người dùng mobile không đi đâu được ngoài trang hiện tại
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenus, setOpenMenus] = useState<Set<string>>(() => {
    const open = new Set<string>();
    if (pathname.startsWith("/finance")) open.add("Quản lý Tài chính");
    if (pathname.startsWith("/products") || pathname.startsWith("/warehouse"))
      open.add("Quản lý Kho");
    return open;
  });

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

  // Chuyển trang xong thì tự đóng drawer — người dùng bấm menu là muốn đi,
  // không muốn phải đóng tay
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const items = user
    ? NAV_ITEMS.filter((i) => i.roles.includes(user.role))
    : [];

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

  // Ruột sidebar (logo + menu + chân) — desktop và drawer mobile dùng chung
  // một khối để hai bên không bao giờ lệch nhau khi thêm mục mới
  const sidebarInner = (
    <>
        <Link
          href={homePathFor(user?.role)}
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
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ===== SIDEBAR DỌC BÊN TRÁI (desktop) ===== */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-card md:flex">
        {sidebarInner}
      </aside>

      {/* ===== DRAWER ĐIỀU HƯỚNG (mobile, dưới md) ===== */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Lớp phủ mờ — chạm ra ngoài để đóng */}
          <div
            className="absolute inset-0 bg-foreground/30"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-card shadow-xl">
            {sidebarInner}
          </aside>
        </div>
      )}

      {/* ===== KHU VỰC BÊN PHẢI: HEADER + NỘI DUNG ===== */}
      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="outline"
              size="icon-sm"
              className="shrink-0 md:hidden"
              aria-label="Mở menu điều hướng"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <h1 className={cn(TEXT_PAGE_TITLE, "truncate")}>
              {getPageTitle(pathname)}
            </h1>
          </div>

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
                    ROLE_META[user.role].className
                  )}
                >
                  {ROLE_META[user.role].label}
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
        <main className="w-full flex-1 px-4 py-5 md:px-6 md:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
