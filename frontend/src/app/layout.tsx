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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
