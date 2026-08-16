import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
// Bộ icon Material Symbols (Rounded) — variable font có trục FILL: sidebar
// đổi icon outline ↔ filled khi active đúng kiểu YouTube Studio.
import "material-symbols/rounded.css";

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
        {/* Dark mode do next-themes quản lý: gắn class `dark` lên <html> trước
            paint (script tự chèn, chống nháy trắng), lưu localStorage
            "hubsell-theme-mode". Mặc định SÁNG để khách cũ không bị đổi bất
            ngờ; "system" là lựa chọn chủ động trong Cấu hình chung. KHÁC với
            data-theme (accent monochrome/indigo/emerald) do script phía trên
            quản lý — hai trục độc lập, phối tự do. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          storageKey="hubsell-theme-mode"
          disableTransitionOnChange
        >
          {/* Tầng cache dữ liệu React Query (Tầng 1 kế hoạch UI): quay lại
              trang cũ hiện ngay số trong cache rồi âm thầm refetch. */}
          <QueryProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </QueryProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
