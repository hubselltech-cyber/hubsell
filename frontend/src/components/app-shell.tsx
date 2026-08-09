"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Menu, Loader2, LogOut, UserRound } from "lucide-react";

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
  /** Tên glyph Material Symbols Rounded (https://fonts.google.com/icons). */
  icon: string;
  /** Vai trò nào nhìn thấy mục này. Không có tên trong đây thì mục bị ẩn hẳn. */
  roles: Role[];
  /**
   * Mục chỉ dành cho QUẢN TRỊ NỀN TẢNG (cờ isPlatformAdmin trên tài khoản) —
   * ẩn hẳn với mọi chủ shop thường. Backend vẫn chặn 403 độc lập với UI.
   */
  platformOnly?: boolean;
  children?: NavChild[];
}

const ALL_ROLES: Role[] = ["ADMIN", "SALES", "WAREHOUSE"];

const NAV_ITEMS: NavItem[] = [
  // Kho không có việc gì ở Tổng quan; SALES vào được nhưng bị cắt chỉ số tài chính
  { href: "/", label: "Tổng quan", icon: "dashboard", roles: ["ADMIN", "SALES"] },
  { href: "/orders", label: "Đơn hàng", icon: "shopping_cart", roles: ALL_ROLES },
  {
    label: "Quản lý Tài chính",
    // "credit_card" (thẻ ngân hàng): gọn, sang, outline và filled cùng một
    // silhouette — "wallet" và "account_balance_wallet" đều bị chê thô
    // (anh Trung 08/08).
    icon: "credit_card",
    roles: ["ADMIN"],
    children: [
      { href: "/finance/analytics", label: "Báo cáo dòng tiền" },
      { href: "/finance/realized-pnl", label: "Lãi/Lỗ Thực Hiện" },
      { href: "/finance/expenses", label: "Thu chi vận hành" },
      { href: "/finance/cost-prices", label: "Cấu hình Giá vốn" },
    ],
  },
  {
    // Nghiệp vụ kho gom về một nhóm: nhập hàng, quản lý sản phẩm và đối soát
    // hàng hoàn đều là việc của kho.
    label: "Quản lý Kho",
    icon: "package_2",
    roles: ALL_ROLES,
    children: [
      // GIỮ NGUYÊN đường dẫn /products — đây chỉ là gom nhóm ở tầng menu, đổi
      // route sẽ làm hỏng link cũ và bookmark của người dùng mà chẳng được gì.
      { href: "/products", label: "Kho vật lý" },
      { href: "/warehouse/returns", label: "Đối soát đơn hoàn" },
      // Điều chuyển từ nhóm Tài chính sang (nghiệp vụ đối soát vận chuyển sát
      // với kho vận); route cũ /finance/shipping-alerts vẫn redirect về đây.
      { href: "/warehouse/shipping-alerts", label: "Đối soát phí ship" },
    ],
  },
  {
    // Tự động hoá CSKH & phản hồi sàn đa kênh — hiện là preview mock (cùng
    // trạng thái với Trợ lý quảng cáo). CSKH là việc của SALES nên SALES vào
    // được; kho không liên quan.
    label: "Trợ lý vận hành",
    icon: "smart_toy",
    roles: ["ADMIN", "SALES"],
    children: [
      { href: "/operations-assistant/chat", label: "Trợ lý Chat" },
      { href: "/operations-assistant/reviews", label: "Phản hồi đánh giá" },
      // Điều chuyển từ nhóm Tài chính sang; route cũ /finance/loss-orders vẫn
      // redirect về đây. LƯU Ý phân quyền: nhóm cha mở cho SALES nên SALES
      // cũng thấy menu này — chấp nhận tạm, chờ phương thức phân quyền mới
      // (anh Trung 08/08).
      {
        href: "/operations-assistant/loss-orders",
        label: "Cảnh báo & P&L Sản phẩm",
      },
      { href: "/operations-assistant/ai-rules", label: "Cấu hình kịch bản AI" },
    ],
  },
  {
    // Khung giữ chỗ cho tích hợp Marketing/Ads API 3 sàn — hiện là preview
    // mock. Chi phí Ads là dữ liệu tài chính nên chỉ ADMIN thấy (cùng luật
    // với nhóm Quản lý Tài chính).
    label: "Trợ lý quảng cáo",
    icon: "campaign",
    roles: ["ADMIN"],
    children: [
      { href: "/ads/tiktok", label: "Quảng cáo TikTok" },
      { href: "/ads/shopee", label: "Quảng cáo Shopee" },
      { href: "/ads/lazada", label: "Quảng cáo Lazada" },
    ],
  },
  {
    // Mạng lưới KOC & Affiliate đa kênh (đặt dưới Trợ lý quảng cáo để gom cụm
    // Marketing). Booking fee / Net-ROI là dữ liệu tài chính → chỉ ADMIN (xem
    // canAccessKocMarketing). Trang Shopee/Lazada đọc SỐ THẬT từ /api/koc/*;
    // TikTok là CỔNG CHỜ (đợi sandbox + shop thật uỷ quyền); Hàng mẫu & Chi
    // phí còn preview mock.
    label: "Mạng lưới KOC & Marketing",
    // "handshake" thay "diversity_3": hợp tác/booking KOC (anh Trung 08/08).
    icon: "handshake",
    roles: ["ADMIN"],
    children: [
      { href: "/koc-marketing/overview", label: "Tổng quan Net-ROI Đa kênh" },
      { href: "/koc-marketing/shopee", label: "Shopee Affiliate (AMS)" },
      { href: "/koc-marketing/lazada", label: "Lazada Affiliate" },
      { href: "/koc-marketing/tiktok", label: "TikTok Affiliate & MCN" },
      { href: "/koc-marketing/samples", label: "Hàng mẫu & Seeding" },
      { href: "/koc-marketing/expenses", label: "Chi phí Booking & Hợp đồng" },
    ],
  },
  {
    // Hóa đơn điện tử & thuế — nghiệp vụ chạy hằng ngày nhưng tần suất thấp
    // hơn cụm bán hàng/marketing nên xếp sau (thứ tự anh Trung chốt 08/08).
    label: "Hóa đơn & Thuế",
    icon: "receipt_long",
    roles: ["ADMIN"],
    children: [
      { href: "/invoicing/connect", label: "Kết nối & Xuất hóa đơn" },
      { href: "/invoicing/tax-settings", label: "Thuế bổ sung" },
      { href: "/invoicing/history", label: "Lịch sử & Báo cáo thuế" },
    ],
  },
  // "store" thay "storefront": nhà mái hiên có CỬA GIỮA (anh Trung 08/08).
  { href: "/channels", label: "Kênh bán", icon: "store", roles: ["ADMIN"] },
  // Nhãn sidebar để ngắn cho khỏi xuống dòng; tên đầy đủ "Liên kết SP vào kho
  // vật lý" nằm ở tiêu đề trang (PAGE_TITLES) và cột bảng.
  { href: "/mappings", label: "Liên kết sản phẩm", icon: "link", roles: ["ADMIN"] },
  { href: "/staff", label: "Nhân viên", icon: "group", roles: ["ADMIN"] },
];

// Khu CHÂN SIDEBAR — tách hẳn khỏi khu làm việc bên trên, ghim sát đáy với
// đường kẻ phân cách (anh Trung chốt 08/08): đây là chỗ "cài một lần rồi
// quên", không chen giữa các nghiệp vụ chạy hằng ngày.
const NAV_ITEMS_BOTTOM: NavItem[] = [
  {
    // Hướng dẫn sử dụng cơ bản cho khách hàng mới (kế hoạch 09/08) — đặt cạnh
    // Cấu hình theo thông lệ SaaS: tài liệu trợ giúp nằm khu "ít khi động tới".
    // Mở cho MỌI vai trò: nhân viên cũng cần tra cứu cách dùng phần việc của mình.
    href: "/guide",
    label: "Hướng dẫn sử dụng",
    icon: "help",
    roles: ALL_ROLES,
  },
  {
    // Cấu hình hệ thống gom thành nhóm phân cấp theo quy hoạch SaaS.
    label: "Cấu hình",
    icon: "settings",
    roles: ["ADMIN"],
    children: [
      { href: "/settings/general", label: "Cấu hình chung" },
      // "Hóa đơn & Thuế" đã chuyển lên danh mục lớn riêng (route /invoicing/*);
      // /settings/tax cũ redirect sang đó để bookmark không chết.
      { href: "/settings/other", label: "Cấu hình khác" },
      // "Nhật ký Webhook" từng ở đây đã XÓA HẲN (06/08): dữ liệu vận hành nội
      // bộ không nên lộ với khách — chỉ còn bản toàn hệ thống trong /admin.
    ],
  },
  {
    // Khu QUẢN TRỊ NỀN TẢNG Hubsell — thống kê người dùng đăng ký, nhật ký
    // webhook TOÀN hệ thống. Chỉ hiện với tài khoản có cờ isPlatformAdmin.
    href: "/admin",
    label: "Hệ thống",
    icon: "admin_panel_settings",
    roles: ["ADMIN"],
    platformOnly: true,
  },
];

// Tiêu đề trang hiển thị trên Header, suy ra từ đường dẫn hiện tại
const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/admin", title: "Quản trị nền tảng Hubsell" },
  { prefix: "/guide", title: "Hướng dẫn sử dụng" },
  { prefix: "/orders", title: "Quản lý đơn hàng" },
  { prefix: "/products", title: "Kho vật lý" },
  { prefix: "/warehouse/returns", title: "Đối soát đơn hoàn" },
  { prefix: "/channels", title: "Cấu hình kết nối" },
  { prefix: "/mappings", title: "Liên kết SP vào kho vật lý" },
  { prefix: "/staff", title: "Quản lý nhân viên" },
  { prefix: "/settings/general", title: "Cấu hình chung" },
  { prefix: "/settings/other", title: "Cấu hình khác" },
  { prefix: "/invoicing/connect", title: "Kết nối & Xuất hóa đơn" },
  { prefix: "/invoicing/tax-settings", title: "Thuế bổ sung" },
  { prefix: "/invoicing/history", title: "Lịch sử & Báo cáo thuế" },
  { prefix: "/settings", title: "Cấu hình hệ thống" },
  { prefix: "/finance/analytics", title: "Báo cáo dòng tiền" },
  { prefix: "/finance/realized-pnl", title: "Lãi/Lỗ Thực Hiện" },
  { prefix: "/finance/expenses", title: "Thu chi vận hành" },
  { prefix: "/operations-assistant/loss-orders", title: "Cảnh báo & P&L Sản phẩm" },
  { prefix: "/finance/cost-prices", title: "Cấu hình Giá vốn" },
  { prefix: "/warehouse/shipping-alerts", title: "Đối soát phí vận chuyển" },
  { prefix: "/operations-assistant/chat", title: "Trợ lý Chat CSKH" },
  { prefix: "/operations-assistant/reviews", title: "Phản hồi đánh giá đa kênh" },
  { prefix: "/operations-assistant/ai-rules", title: "Cấu hình kịch bản AI" },
  { prefix: "/koc-marketing/overview", title: "Tổng quan Net-ROI Đa kênh" },
  { prefix: "/koc-marketing/tiktok", title: "TikTok Affiliate & MCN" },
  { prefix: "/koc-marketing/shopee", title: "Shopee Affiliate (AMS)" },
  { prefix: "/koc-marketing/lazada", title: "Lazada Affiliate" },
  { prefix: "/koc-marketing/samples", title: "Quản lý Hàng mẫu & Seeding" },
  { prefix: "/koc-marketing/expenses", title: "Chi phí Booking & Hợp đồng" },
  { prefix: "/ads/tiktok", title: "Trợ lý quảng cáo TikTok" },
  { prefix: "/ads/shopee", title: "Trợ lý quảng cáo Shopee" },
  { prefix: "/ads/lazada", title: "Trợ lý quảng cáo Lazada" },
];

function getPageTitle(pathname: string): string {
  const found = PAGE_TITLES.find((p) => pathname.startsWith(p.prefix));
  return found?.title ?? "Tổng quan";
}

// Những nhóm menu chứa route đang xem — để tự xoè nhóm ra khi điều hướng tới
// trang con của nó (người dùng vẫn cụp tay lại được, xem openMenus bên dưới).
function menusForPath(pathname: string): string[] {
  const labels: string[] = [];
  if (pathname.startsWith("/finance")) labels.push("Quản lý Tài chính");
  if (pathname.startsWith("/invoicing")) labels.push("Hóa đơn & Thuế");
  if (pathname.startsWith("/products") || pathname.startsWith("/warehouse"))
    labels.push("Quản lý Kho");
  if (pathname.startsWith("/settings")) labels.push("Cấu hình");
  if (pathname.startsWith("/ads")) labels.push("Trợ lý quảng cáo");
  if (pathname.startsWith("/koc-marketing"))
    labels.push("Mạng lưới KOC & Marketing");
  if (pathname.startsWith("/operations-assistant"))
    labels.push("Trợ lý vận hành");
  return labels;
}

// Icon sidebar bằng Material Symbols Rounded (variable font, trục FILL) —
// active thì FILL 0→1: icon outline "đổ đầy" thành filled đúng kiểu YouTube
// Studio, chi tiết bên trong vẫn khoét trắng vì glyph filled được vẽ riêng.
// Outline để wght 350 — mỏng hơn mặc định 400 nhưng không mảnh dây (300):
// đối chiếu ảnh sidebar YouTube Studio thật thì nét của họ nằm đúng khoảng này.
// Khi đổ đầy trả về wght 400 để khối đen đủ đậm.
// transition font-variation-settings cho chuyển trạng thái mượt.
function NavIcon({ name, filled }: { name: string; filled?: boolean }) {
  return (
    <span
      aria-hidden
      className="material-symbols-rounded w-5 shrink-0 text-center text-[20px] leading-none transition-[font-variation-settings] duration-200 select-none"
      style={{
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${filled ? 400 : 350}, 'GRAD' 0, 'opsz' 24`,
      }}
    >
      {name}
    </span>
  );
}

// Bố cục chuẩn SaaS: Sidebar dọc + Header mỏng + nội dung chính.
// Kèm Onboarding guard: chưa kết nối gian hàng nào → hiện màn hình chặn.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [hasChannels, setHasChannels] = useState<boolean | null>(null);
  // Drawer điều hướng trên điện thoại — dưới md sidebar cố định bị ẩn,
  // không có drawer này thì người dùng mobile không đi đâu được ngoài trang hiện tại
  const [mobileOpen, setMobileOpen] = useState(false);
  // openMenus là NGUỒN CHÂN LÝ DUY NHẤT cho việc nhóm nào đang xoè: route chỉ
  // được "gieo" nhóm vào đây lúc mount/điều hướng, KHÔNG ép mở khi render —
  // ép mở là người dùng hết cụp tay được nhóm chứa trang đang xem.
  const [openMenus, setOpenMenus] = useState<Set<string>>(
    () => new Set(menusForPath(pathname))
  );

  // Điều hướng sang trang con của nhóm đang đóng thì tự xoè nhóm đó ra —
  // chỉ THÊM vào state nên không phá thao tác cụp tay trước đó của người dùng.
  useEffect(() => {
    setOpenMenus((prev) => {
      const labels = menusForPath(pathname);
      if (labels.every((l) => prev.has(l))) return prev;
      const next = new Set(prev);
      labels.forEach((l) => next.add(l));
      return next;
    });
  }, [pathname]);

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

  // Cùng một luật hiển thị cho cả khu làm việc lẫn khu chân sidebar.
  const visible = (i: NavItem) =>
    user !== null &&
    i.roles.includes(user.role) &&
    (!i.platformOnly || user.isPlatformAdmin === true);
  const items = NAV_ITEMS.filter(visible);
  const bottomItems = NAV_ITEMS_BOTTOM.filter(visible);

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

  // Vẽ MỘT mục menu — tách hàm để khu làm việc và khu chân sidebar (Cấu hình /
  // Hệ thống) dùng chung một kiểu dáng, không bao giờ lệch nhau.
  const renderNavItem = (item: NavItem) => {
    // ----- Mục có MENU CON (ví dụ: Quản lý Tài chính) -----
    if (item.children) {
      const groupActive = item.children.some((c) =>
        pathname.startsWith(c.href)
      );
      // groupActive chỉ dùng để TÔ MÀU nhãn nhóm; trạng thái xoè/cụp
      // do openMenus quyết định hoàn toàn — trước đây `|| groupActive`
      // ép nhóm chứa trang đang xem luôn mở, bấm không cụp lại được.
      const open = openMenus.has(item.label);
      return (
        <div key={item.label}>
          <button
            type="button"
            onClick={() => toggleMenu(item.label)}
            className={cn(
              // text-left: button mặc định canh GIỮA — nhãn dài xuống
              // 2 dòng (vd "Quản lý Tài chính" trên drawer hẹp) sẽ bị
              // canh giữa lộn xộn nếu không ép canh trái.
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
              // Chưa chọn vẫn để chữ/icon ĐẬM MÀU (slate-700) chứ không
              // xám nhạt — học YouTube Studio: cả sidebar sắc nét, trạng
              // thái active phân biệt bằng pill + icon đổ đầy chứ không
              // phải bằng cách dìm màu phần còn lại.
              groupActive
                ? "font-semibold text-sidebar-active-text"
                : "font-medium text-slate-700 hover:bg-muted hover:text-foreground",
              // Nhóm đang CỤP mà chứa trang hiện hành → nhận pill nền y
              // như mục thường (hết cảnh active "nửa vời" chỉ đậm chữ);
              // lúc XOÈ thì nhường pill cho mục con đang chọn bên dưới,
              // tránh hai pill chồng nhau trong cùng một nhóm.
              groupActive && !open && "bg-sidebar-active-bg"
            )}
          >
            <NavIcon name={item.icon} filled={groupActive} />
            <span className="min-w-0 flex-1">{item.label}</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 transition-transform",
                open && "rotate-180"
              )}
            />
          </button>
          {open && (
            <div className="mt-1.5 space-y-1 border-l pl-4 ml-5">
              {item.children.map((child) => {
                const childActive = pathname.startsWith(child.href);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={cn(
                      "relative block rounded-lg px-3 py-2 text-sm transition-colors",
                      childActive
                        ? "bg-sidebar-active-bg font-semibold text-sidebar-active-text"
                        : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {/* Vạch neo thị giác — nét dọc mảnh sát cạnh trái của mục đang chọn */}
                    {childActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-active-border"
                      />
                    )}
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
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href!);
    return (
      <Link
        key={item.href}
        href={item.href!}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
          // Chưa chọn để slate-700 sắc màu (xem chú thích ở nút nhóm).
          active
            ? "bg-sidebar-active-bg font-semibold text-sidebar-active-text"
            : "font-medium text-slate-700 hover:bg-muted hover:text-foreground"
        )}
      >
        {/* Kiểu YouTube Studio: mục active = pill nền + icon FILLED
            (glyph filled thật của Material Symbols — chi tiết trong
            icon vẫn khoét trắng, không phải silhouette). Vạch neo bỏ
            ở tầng này — icon filled là tín hiệu chính; menu con
            (không có icon) vẫn giữ vạch neo. */}
        <NavIcon name={item.icon} filled={active} />
        {item.label}
      </Link>
    );
  };

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

        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
          {items.map(renderNavItem)}
        </nav>

        {/* Khu CHÂN SIDEBAR: Cấu hình & Hệ thống ghim sát đáy (nav flex-1 bên
            trên đẩy khối này xuống), kẻ phân cách tách hẳn khỏi khu làm việc.
            Vai trò không thấy mục nào (SALES/WAREHOUSE) thì ẩn luôn đường kẻ. */}
        {bottomItems.length > 0 && (
          <div className="space-y-1.5 border-t px-3 py-3">
            {bottomItems.map(renderNavItem)}
          </div>
        )}

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
      {/* Nền trắng của sidebar tự tách khỏi nền slate-50 của trang; viền phải
          làm mờ đi để ranh giới tinh tế thay vì một nét xám cứng. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-200/60 bg-card md:flex">
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
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-slate-200/60 bg-card shadow-xl">
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
