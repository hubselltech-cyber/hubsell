import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Inter là font hiếm hoi có bộ ký tự TIẾNG VIỆT đầy đủ trên Google Fonts.
// Font trước đó (Geist) chỉ có subset latin nên mọi chữ có dấu bị rơi về font
// hệ thống — hai font trộn lẫn trên cùng một dòng là lý do chữ nhìn lởm chởm.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

// Font mono chỉ dùng cho mã SKU / token / mã vận đơn — toàn ký tự ASCII nên
// không cần subset tiếng Việt.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hubsell — Quản lý bán hàng đa kênh",
  description: "Nền tảng quản lý bán hàng đa kênh: Shopee, Lazada, TikTok, Offline",
};

// Áp theme TRƯỚC KHI render (chống nháy màu mặc định khi F5): đọc lựa chọn từ
// localStorage, hợp lệ thì gắn lên <html data-theme>, rác/không có → monochrome.
// Phải là script inline chứ không phải useEffect — effect chạy SAU paint đầu
// tiên, người dùng theme indigo sẽ thấy giao diện chớp đen/trắng một nhịp.
// Danh sách id hợp lệ phải khớp ThemeId trong lib/theme.ts.
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("hubsell-theme");document.documentElement.setAttribute("data-theme",t==="indigo"||t==="emerald"?t:"monochrome")}catch(e){document.documentElement.setAttribute("data-theme","monochrome")}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: data-theme được script gắn trước khi React
    // hydrate nên khác markup server — khác biệt này là chủ đích, không phải bug.
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
