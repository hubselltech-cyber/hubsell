"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ChevronDown,
  Coins,
  Menu,
  Loader2,
  Moon,
  Search as SearchIcon,
  Sun,
  type LucideIcon,
} from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";

import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { ChannelDisconnectedBanner } from "@/components/channel-disconnected-banner";
import { CommandPalette } from "@/components/command-palette";
import { NavIcon } from "@/components/nav-icon";
import { NotificationBell } from "@/components/notification-bell";
import { OnboardingOverlay } from "@/components/onboarding-overlay";
import {
  PlanLockedScreen,
  PlanQuotaBanner,
  isPlanGatedPath,
  useMyPlan,
} from "@/components/plan-quota-guard";
import { Button } from "@/components/ui/button";
import { UserAvatarMenu } from "@/components/user-avatar-menu";
import {
  ApiError,
  clearToken,
  fetchMe,
  getStoredUser,
  setStoredUser,
  type AuthUser,
} from "@/lib/api";
import {
  can,
  homePathFor,
  isAdmin,
  isPlatformWorkspace,
} from "@/lib/permissions";
import { prefetchRoute } from "@/lib/prefetch";
import { themeBaseIsSystem } from "@/lib/theme";
import { TEXT_PAGE_TITLE } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface NavChild {
  href: string;
  label: string;
  /**
   * Khóa quyền LÁ của trang (permission-registry). Vắng mặt = thừa kế perm của
   * nhóm cha (nhóm nguyên khối như KOC/Hóa đơn & Thuế).
   */
  perm?: string;
  /**
   * Trang con VĨNH VIỄN CHỈ CHỦ SHOP nằm trong một nhóm nhân viên vẫn thấy
   * (vd "Đồng bộ tồn kho" trong Quản lý Kho) — nhân viên không bao giờ thấy.
   */
  adminOnly?: boolean;
}
export interface NavItem {
  href?: string;
  label: string;
  /**
   * Tên glyph Material Symbols Rounded (https://fonts.google.com/icons), hoặc
   * một component lucide-react cho mục cần icon không có glyph tương xứng
   * (vd Coins của "Kiếm Tiền Cùng Hubsell") — NavIcon tự nhận dạng cả hai.
   */
  icon: string | LucideIcon;
  /**
   * Khóa quyền trong permission-registry (nhóm hoặc lá). Chủ shop luôn thấy;
   * nhân viên phải có quyền tương ứng. Vắng mặt = mọi người đăng nhập đều thấy
   * (vd Hướng dẫn sử dụng) — TRỪ KHI adminOnly bật.
   */
  perm?: string;
  /**
   * Khu VĨNH VIỄN CHỈ CHỦ SHOP (Kênh bán, Nhân viên, Cấu hình…) — cố tình không
   * nằm trong cây phân quyền, nhân viên không bao giờ thấy.
   */
  adminOnly?: boolean;
  /**
   * Mục chỉ dành cho QUẢN TRỊ NỀN TẢNG (cờ isPlatformAdmin trên tài khoản) —
   * ẩn hẳn với mọi chủ shop thường. Backend vẫn chặn 403 độc lập với UI.
   */
  platformOnly?: boolean;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tổng quan", icon: "dashboard", perm: "dashboard" },
  { href: "/orders", label: "Đơn hàng", icon: "shopping_cart", perm: "orders" },
  {
    label: "Quản lý Tài chính",
    // "credit_card" (thẻ ngân hàng): gọn, sang, outline và filled cùng một
    // silhouette — "wallet" và "account_balance_wallet" đều bị chê thô
    // (anh Trung 08/08).
    icon: "credit_card",
    perm: "finance",
    children: [
      { href: "/finance/analytics", label: "Báo cáo dòng tiền", perm: "finance.analytics" },
      { href: "/finance/realized-pnl", label: "Lãi/Lỗ Thực Hiện", perm: "finance.realized-pnl" },
      { href: "/finance/expenses", label: "Thu chi vận hành", perm: "finance.expenses" },
      { href: "/finance/cost-prices", label: "Cấu hình Giá vốn", perm: "finance.cost-prices" },
    ],
  },
  {
    // Nghiệp vụ kho gom về một nhóm: nhập hàng, quản lý sản phẩm và đối soát
    // hàng hoàn đều là việc của kho.
    label: "Quản lý Kho",
    icon: "package_2",
    perm: "warehouse",
    children: [
      // GIỮ NGUYÊN đường dẫn /products — đây chỉ là gom nhóm ở tầng menu, đổi
      // route sẽ làm hỏng link cũ và bookmark của người dùng mà chẳng được gì.
      // HUB "HÀNG HÓA" (chốt 15/08): gộp Kho vật lý + Liên kết sản phẩm + Đồng
      // bộ tồn kho vào MỘT trang — tab Tồn kho / Chờ liên kết + dialog Cài đặt
      // đồng bộ. Route cũ /mappings, /warehouse/sync redirect về đây.
      { href: "/products", label: "Hàng hóa", perm: "warehouse.products" },
      { href: "/warehouse/returns", label: "Đối soát đơn hoàn", perm: "warehouse.returns" },
      // Điều chuyển từ nhóm Tài chính sang (nghiệp vụ đối soát vận chuyển sát
      // với kho vận); route cũ /finance/shipping-alerts vẫn redirect về đây.
      { href: "/warehouse/shipping-alerts", label: "Đối soát phí ship", perm: "warehouse.shipping-alerts" },
    ],
  },
  {
    // Tự động hoá CSKH & phản hồi sàn đa kênh — chat Shopee THẬT production.
    label: "Trợ lý vận hành",
    icon: "smart_toy",
    perm: "operations",
    children: [
      { href: "/operations-assistant/chat", label: "Trợ lý Chat", perm: "operations.chat" },
      { href: "/operations-assistant/reviews", label: "Phản hồi đánh giá", perm: "operations.reviews" },
      // Trước 10/08 mục này "SALES thấy menu nhưng API 403 vì là dữ liệu lãi/lỗ"
      // — cây phân quyền đã giải đúng nợ đó: có lá operations.loss-orders mới thấy.
      {
        href: "/operations-assistant/loss-orders",
        label: "Cảnh báo & P&L Sản phẩm",
        perm: "operations.loss-orders",
      },
      { href: "/operations-assistant/ai-rules", label: "Cấu hình kịch bản AI", perm: "operations.ai-rules" },
    ],
  },
  {
    label: "Trợ lý quảng cáo",
    icon: "campaign",
    perm: "ads",
    children: [
      { href: "/ads/tiktok", label: "Quảng cáo TikTok", perm: "ads.tiktok" },
      { href: "/ads/shopee", label: "Quảng cáo Shopee", perm: "ads.shopee" },
      { href: "/ads/lazada", label: "Quảng cáo Lazada", perm: "ads.lazada" },
    ],
  },
  {
    // Mạng lưới KOC & Affiliate đa kênh — mục NGUYÊN KHỐI trong cây quyền
    // (khóa "koc"): cấp là cấp cả cụm, các trang con thừa kế perm nhóm.
    label: "Mạng lưới KOC & Marketing",
    // "handshake" thay "diversity_3": hợp tác/booking KOC (anh Trung 08/08).
    icon: "handshake",
    perm: "koc",
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
    // Hóa đơn & thuế — mục NGUYÊN KHỐI (khóa "invoicing"), thứ tự anh Trung chốt 08/08.
    label: "Hóa đơn & Thuế",
    icon: "receipt_long",
    perm: "invoicing",
    children: [
      { href: "/invoicing/connect", label: "Kết nối & Xuất hóa đơn" },
      { href: "/invoicing/tax-settings", label: "Thuế bổ sung" },
      { href: "/invoicing/history", label: "Lịch sử & Báo cáo thuế" },
    ],
  },
  // "store" thay "storefront": nhà mái hiên có CỬA GIỮA (anh Trung 08/08).
  { href: "/channels", label: "Kênh bán", icon: "store", adminOnly: true },
  // "Liên kết sản phẩm" đã GỘP vào hub Hàng hóa (tab Chờ liên kết) — /mappings
  // redirect về /products?tab=links, không còn mục sidebar riêng.
  { href: "/staff", label: "Nhân viên", icon: "group", adminOnly: true },
];

// Khu CHÂN SIDEBAR — tách hẳn khỏi khu làm việc bên trên, ghim sát đáy với
// đường kẻ phân cách (anh Trung chốt 08/08): đây là chỗ "cài một lần rồi
// quên", không chen giữa các nghiệp vụ chạy hằng ngày.
const NAV_ITEMS_BOTTOM: NavItem[] = [
  {
    // Hướng dẫn sử dụng cơ bản cho khách hàng mới (kế hoạch 09/08) — đặt cạnh
    // Cấu hình theo thông lệ SaaS: tài liệu trợ giúp nằm khu "ít khi động tới".
    // KHÔNG có perm: nhân viên cũng cần tra cứu cách dùng phần việc của mình.
    href: "/guide",
    label: "Hướng dẫn sử dụng",
    icon: "help",
  },
  {
    // Cấu hình hệ thống gom thành nhóm phân cấp theo quy hoạch SaaS.
    label: "Cấu hình",
    icon: "settings",
    adminOnly: true,
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
    // Affiliate Tiếp Thị của CHÍNH Hubsell (giới thiệu bạn bè nhận 10% vào Ví
    // Hubsell) — KHÁC nhóm "Mạng lưới KOC & Marketing" của chủ shop. Vị trí
    // ngay dưới Cấu hình (anh Trung chốt 09/08); icon lucide Coins vì Material
    // Symbols không có glyph đồng xu ưng ý.
    href: "/affiliate",
    label: "Kiếm Tiền Cùng Hubsell",
    icon: Coins,
    adminOnly: true,
  },
  {
    // Khu QUẢN TRỊ NỀN TẢNG Hubsell — thống kê người dùng đăng ký, nhật ký
    // webhook TOÀN hệ thống. Chỉ hiện với tài khoản có cờ isPlatformAdmin.
    href: "/admin",
    label: "Hệ thống",
    icon: "admin_panel_settings",
    adminOnly: true,
    platformOnly: true,
  },
];

// ============================================================
// SIDEBAR KHU ĐIỀU HÀNH HUBSELL — thay TOÀN BỘ hai khối trên khi tài khoản
// thuộc không gian điều hành (isPlatformWorkspace: chủ nền tảng dev@hubsell.tech
// hoặc nhân viên điều hành do chủ nền tảng tạo). Đây là "văn phòng công ty
// Hubsell": quản lý nhân sự nội bộ + số liệu toàn nền tảng, KHÔNG có nghiệp vụ
// bán hàng nào (đơn, kho, tài chính shop… đều vô nghĩa với tài khoản này).
// ============================================================
const NAV_ITEMS_HQ: NavItem[] = [
  // Dashboard điều hành: biểu đồ đăng ký / hoạt động / rời bỏ — góc nhìn của
  // người quản lý, tách khỏi khu tác nghiệp bên dưới.
  { href: "/admin", label: "Tổng quan", icon: "dashboard", perm: "hq.overview" },
  // Khu của SALE/CSKH: CRM khách hàng đăng ký.
  { href: "/admin/customers", label: "Khách hàng", icon: "support_agent", perm: "hq.customers" },
  // Khu của KẾ TOÁN: sổ quỹ + duyệt lệnh rút + nghĩa vụ hóa đơn — tách hẳn
  // trang riêng để Sale không bao giờ nhìn thấy sổ tiền.
  { href: "/admin/finance", label: "Kế toán", icon: "account_balance", perm: "hq.finance" },
  // Bảng giá gói + thuê bao + ghi nhận thanh toán — cùng lá hq.finance (việc
  // của kế toán); riêng SỬA bảng giá backend chỉ cho chủ nền tảng.
  { href: "/admin/plans", label: "Gói dịch vụ", icon: "workspace_premium", perm: "hq.finance" },
  { href: "/admin/marketing", label: "Marketing", icon: "campaign", perm: "hq.marketing" },
  // Chỉ chủ nền tảng tạo/phân quyền nhân viên điều hành — nhân viên không thấy.
  { href: "/staff", label: "Nhân viên", icon: "group", adminOnly: true },
];
const NAV_ITEMS_HQ_BOTTOM: NavItem[] = [
  // Khu kỹ thuật: nhật ký webhook (lá hq.webhooks) + nhật ký thao tác (chỉ
  // chủ nền tảng — trang tự ẩn phần này với nhân viên).
  { href: "/admin/system", label: "Hệ thống", icon: "admin_panel_settings", perm: "hq.webhooks" },
];

// Tiêu đề trang hiển thị trên Header, suy ra từ đường dẫn hiện tại
const PAGE_TITLES: { prefix: string; title: string }[] = [
  // Khu điều hành Hubsell — các route con phải đứng TRƯỚC "/admin" (match tiền tố).
  { prefix: "/admin/customers", title: "Khách hàng đăng ký" },
  { prefix: "/admin/finance", title: "Kế toán nội bộ" },
  { prefix: "/admin/plans", title: "Gói dịch vụ & Thuê bao" },
  { prefix: "/admin/marketing", title: "Marketing & Giới thiệu" },
  { prefix: "/admin/system", title: "Hệ thống & Kỹ thuật" },
  { prefix: "/admin", title: "Điều hành Hubsell" },
  { prefix: "/guide", title: "Hướng dẫn sử dụng" },
  { prefix: "/orders", title: "Quản lý đơn hàng" },
  { prefix: "/products", title: "Hàng hóa" },
  { prefix: "/warehouse/sync", title: "Hàng hóa" }, // redirect về hub — tránh nháy tiêu đề lạ
  { prefix: "/warehouse/returns", title: "Đối soát đơn hoàn" },
  { prefix: "/channels", title: "Cấu hình kết nối" },
  { prefix: "/mappings", title: "Hàng hóa" }, // redirect về hub — tránh nháy tiêu đề lạ
  { prefix: "/staff", title: "Quản lý nhân viên" },
  { prefix: "/affiliate", title: "Kiếm Tiền Cùng Hubsell" },
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
  // Command palette Ctrl+K — state đặt ở shell vì cả phím tắt toàn cục lẫn nút
  // "Tìm nhanh" trên header cùng mở một hộp
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Dark mode: resolvedTheme chỉ đáng tin sau khi mount (SSR không biết
  // localStorage) — chưa mount thì icon nút chuyển phải render trung lập
  // để không lệch hydration
  const { resolvedTheme, setTheme, systemTheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    setThemeReady(true);
  }, []);
  const isDark = themeReady && resolvedTheme === "dark";

  // Nút mặt trăng trên header. Bẫy đã sửa (anh Trung báo 22/08): next-themes
  // chỉ nhớ MỘT giá trị nên bấm nút này từng ghim cứng "light"/"dark" và lặng
  // lẽ HỦY lựa chọn "Theo hệ thống" trong Cấu hình chung. Giờ khi lựa chọn
  // GỐC là theo hệ thống (themeBaseIsSystem), nút chỉ là GHI ĐÈ TẠM: gạt về
  // đúng chế độ mà máy đang chỉ thì trả lại "system" — Cấu hình giữ nguyên.
  function toggleDisplayMode() {
    const next = isDark ? "light" : "dark";
    if (themeBaseIsSystem() && next === systemTheme) {
      setTheme("system");
      return;
    }
    setTheme(next);
  }
  // openMenus là NGUỒN CHÂN LÝ DUY NHẤT cho việc nhóm nào đang xoè: route chỉ
  // được "gieo" nhóm vào đây lúc mount/điều hướng, KHÔNG ép mở khi render —
  // ép mở là người dùng hết cụp tay được nhóm chứa trang đang xem.
  const [openMenus, setOpenMenus] = useState<Set<string>>(
    () => new Set(menusForPath(pathname))
  );
  // Rê chuột lên link sidebar là nạp sẵn dữ liệu trang đích vào cache React
  // Query — bấm vào hiện số tức thì (lib/prefetch.ts, Tầng 1 kế hoạch UI).
  const queryClient = useQueryClient();
  const prefetch = (href: string) => prefetchRoute(queryClient, href);

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

  // Chủ shop rút quyền giữa phiên → apiFetch phát sự kiện này khi gặp 403
  // PERMISSION_DENIED. Refetch /me để sidebar cập nhật ngay theo quyền mới.
  useEffect(() => {
    const onDenied = () => {
      checkStatus();
    };
    window.addEventListener("hubsell:permission-denied", onDenied);
    return () =>
      window.removeEventListener("hubsell:permission-denied", onDenied);
  }, [checkStatus]);

  // Chuyển trang xong thì tự đóng drawer — người dùng bấm menu là muốn đi,
  // không muốn phải đóng tay
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Khu điều hành Hubsell không có trang Tổng quan shop — vào "/" (bookmark
  // cũ, gõ tay) thì đưa về trang chủ của khu điều hành (/staff hoặc /admin).
  useEffect(() => {
    if (pathname === "/" && isPlatformWorkspace(user)) {
      router.replace(homePathFor(user));
    }
  }, [pathname, user, router]);

  // Cùng một luật hiển thị cho cả khu làm việc lẫn khu chân sidebar:
  // adminOnly → chỉ chủ shop; perm → tra cây quyền (chủ shop luôn qua);
  // nhóm có children thì lọc từng trang con theo lá — nhân viên chỉ được
  // "Báo cáo dòng tiền" sẽ thấy nhóm Tài chính đúng MỘT mục con.
  const visible = (i: NavItem) =>
    user !== null &&
    (!i.adminOnly || isAdmin(user)) &&
    (!i.platformOnly || user.isPlatformAdmin === true) &&
    (!i.perm || can(user, i.perm));
  const visibleChildren = (i: NavItem): NavItem => {
    if (!i.children) return i;
    const children = i.children.filter(
      (c) =>
        (!c.adminOnly || isAdmin(user)) &&
        (isAdmin(user) || !c.perm || can(user, c.perm))
    );
    return { ...i, children };
  };
  // Không gian điều hành Hubsell → thay trọn bộ menu bằng sidebar HQ.
  const hqWorkspace = isPlatformWorkspace(user);

  // Trạng thái trần gói (GĐ2): nuôi banner cảnh báo + màn khóa tầng giá trị
  // gia tăng. Nhân viên cũng cần (màn khóa phải giải thích được vì sao),
  // khu HQ thì không — văn phòng công ty không có thuê bao.
  const { data: planState } = useMyPlan(user !== null && !hqWorkspace);
  const planLocked = planState !== undefined && !planState.exempt && planState.locked;
  const items = (hqWorkspace ? NAV_ITEMS_HQ : NAV_ITEMS)
    .filter(visible)
    .map(visibleChildren)
    .filter((i) => !i.children || i.children.length > 0);
  const bottomItems = (hqWorkspace ? NAV_ITEMS_HQ_BOTTOM : NAV_ITEMS_BOTTOM)
    .filter(visible)
    .map(visibleChildren)
    .filter((i) => !i.children || i.children.length > 0);

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

  // Chưa kết nối gian hàng → chặn toàn bộ, hiện màn hình onboarding.
  // TRỪ khu điều hành Hubsell: văn phòng công ty không bao giờ liên kết sàn —
  // không bỏ điều kiện này là chủ nền tảng bị màn "kết nối gian hàng" chặn đứng.
  if (!hasChannels && !hqWorkspace) {
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
                    onMouseEnter={() => prefetch(child.href)}
                    onFocus={() => prefetch(child.href)}
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
    // "/" và "/admin" là CHA của các route khác cùng tiền tố → phải khớp
    // tuyệt đối, không thì "Tổng quan" sáng đèn cả khi đang ở /admin/finance.
    const active =
      item.href === "/" || item.href === "/admin"
        ? pathname === item.href
        : pathname.startsWith(item.href!);
    return (
      <Link
        key={item.href}
        href={item.href!}
        onMouseEnter={() => prefetch(item.href!)}
        onFocus={() => prefetch(item.href!)}
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
          href={homePathFor(user)}
          className="flex items-center gap-3 border-b px-5 py-4"
        >
          {/* unoptimized: giữ độ nét từ bản gốc 417px (xem chú thích ở /login) */}
          <Image
            src="/logo-hubsell.png"
            alt="Hubsell"
            width={417}
            height={417}
            unoptimized
            className="size-10 shrink-0 rounded-xl"
          />
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight tracking-tight">
              Hubsell
            </p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {hqWorkspace ? "Điều hành Hubsell" : "Quản lý bán hàng đa kênh"}
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
            {/* Nút mở command palette — bản pill kèm phím tắt trên desktop,
                thu về icon kính lúp trên màn hẹp */}
            <Button
              variant="outline"
              size="sm"
              className="hidden font-normal text-muted-foreground sm:flex"
              onClick={() => setPaletteOpen(true)}
            >
              <SearchIcon className="size-4" />
              Tìm nhanh
              <kbd className="ml-1 rounded border bg-muted px-1.5 py-px font-mono text-[10px]">
                Ctrl K
              </kbd>
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="sm:hidden"
              aria-label="Tìm nhanh (Ctrl+K)"
              onClick={() => setPaletteOpen(true)}
            >
              <SearchIcon className="size-5" />
            </Button>
            {/* Chuông thông báo (Tầng 3) — GĐ1 chỉ chủ shop; khu điều hành HQ
                không có (sự kiện toàn là nghiệp vụ shop) */}
            {user && isAdmin(user) && !hqWorkspace && <NotificationBell />}
            {/* Chuyển nhanh sáng ↔ tối; chỉnh chi tiết (kèm "Theo hệ thống")
                nằm ở Cấu hình chung → Giao diện */}
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={isDark ? "Chuyển giao diện sáng" : "Chuyển giao diện tối"}
              onClick={toggleDisplayMode}
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            {/* Đăng xuất nằm TRONG menu avatar (và trong command palette) —
                header không bày nút trần cho gọn */}
            {user && (
              <UserAvatarMenu
                user={user}
                onUserChange={(u) => {
                  setStoredUser(u);
                  setUser(u);
                }}
                onLogout={handleLogout}
              />
            )}
          </div>
        </header>

        {/* Dải cảnh báo gian mất kết nối — bám TRẠNG THÁI nên không trôi như
            chuông; chỉ chủ shop (nhân viên không nối lại được), khu HQ không
            có gian sàn. Không sticky: đầu trang nào cũng thấy nhưng cuộn
            xuống làm việc thì không án ngữ. */}
        {user && isAdmin(user) && !hqWorkspace && <ChannelDisconnectedBanner />}

        {/* Dải cảnh báo trần gói (GĐ2) — cùng triết lý bám trạng thái; chỉ
            chủ shop vì nhân viên không nâng gói được. */}
        {user && isAdmin(user) && !hqWorkspace && <PlanQuotaBanner />}

        {/* Bung rộng theo màn hình (không khoá max-width) để các bảng dữ liệu
            tận dụng tối đa không gian — chuẩn layout ERP như Salework. */}
        <main className="w-full flex-1 px-4 py-5 md:px-6 md:py-6 lg:px-8">
          {/* key={pathname}: mỗi lần điều hướng remount khối này để chạy lại
              page-enter (mờ dần + trồi nhẹ) — đổi query string không kích hoạt
              vì pathname không chứa query, bộ lọc trên cùng trang không nháy */}
          <div
            key={pathname}
            className="animate-page-enter motion-reduce:animate-none"
          >
            {/* Màn khóa tầng giá trị gia tăng (GĐ2): backend đã chặn 403 ở
                mount — lớp này chỉ để trang khóa hiện màn tử tế thay vì lỗi.
                planState chưa về / lỗi mạng → render bình thường (fail-open,
                cùng triết lý backend). */}
            {planState && planLocked && !hqWorkspace && isPlanGatedPath(pathname) ? (
              <PlanLockedScreen
                data={planState}
                isShopAdmin={user !== null && isAdmin(user)}
              />
            ) : (
              children
            )}
          </div>
        </main>
      </div>

      {/* Command palette Ctrl+K — nhận đúng cây menu ĐÃ lọc quyền ở trên */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={[...items, ...bottomItems]}
        onLogout={handleLogout}
      />

      {/* Trợ lý Hubsell — bong bóng chat nổi mọi trang, sống xuyên chuyển trang
          (nằm NGOÀI khối key={pathname}). GĐ1 chỉ CHỦ SHOP shop thường, cùng
          điều kiện với chuông thông báo. */}
      {/* planLocked: /api/assistant cũng bị khóa — giấu bong bóng thay vì để
          khách chat vào tường lỗi 403; banner + màn khóa đã giải thích đủ. */}
      {user && isAdmin(user) && !hqWorkspace && !planLocked && <AssistantWidget />}
    </div>
  );
}
