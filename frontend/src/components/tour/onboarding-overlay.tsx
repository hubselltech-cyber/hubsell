"use client";

import Image from "next/image";
import { LogOut, PlugZap, ShieldCheck, Sparkles, Store, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clearToken } from "@/lib/api";

/**
 * Màn chào mừng lần đầu đăng nhập: thẻ hành động đưa thẳng người dùng sang
 * /channels để liên kết shop thật.
 *
 * 28/10/2026 anh Trung bỏ video hướng dẫn (TourPlayer) chạy trước thẻ này —
 * nhiều khách mới báo không xem được, màn đầu tiên lại hiện khung trắng.
 * Tour vẫn còn ở /guide và nút "Hướng dẫn kết nối" trong /channels (khách tự bấm).
 */

export function OnboardingOverlay({
  isAdmin,
  onGoConnect,
  onLogout,
}: {
  isAdmin: boolean;
  /** Đưa người dùng sang trang Kênh bán (/channels) để liên kết shop thật. */
  onGoConnect: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gradient-to-br from-muted/60 via-background to-primary/5 p-4">
      <div className="w-full max-w-3xl py-6">
        {/* Logo + lời chào */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {/* unoptimized: giữ độ nét từ bản gốc 417px (xem chú thích ở /login) */}
          <Image
            src="/logo-hubsell.png"
            alt="Hubsell"
            width={417}
            height={417}
            priority
            unoptimized
            className="size-18 rounded-2xl shadow-lg"
          />
          <div>
            <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
              <Sparkles className="size-6 text-primary" />
              Chào mừng bạn đến với Hubsell!
            </h1>
            <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
              {isAdmin
                ? "Nối gian hàng → nhập giá vốn → nối quảng cáo: ba bước để trợ lý chỉ ra chiến dịch nào đang lỗ."
                : "Bước đầu tiên để kích hoạt hệ thống là kết nối gian hàng."}
            </p>
          </div>
        </div>

        {isAdmin ? (
          // Thẻ hành động: vào thẳng Kênh bán để liên kết shop thật
          <div className="rounded-2xl border bg-background p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <PlugZap className="size-7 text-primary" />
            </div>
            <p className="text-lg font-semibold">Bạn đã sẵn sàng!</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Vào trang <span className="text-foreground">Kênh bán</span>,
              bấm “Kết nối gian hàng” rồi uỷ quyền trên sàn — đơn hàng sẽ tự
              đồng bộ về ngay sau đó.
            </p>

            <div className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm">
              {[
                { icon: ShieldCheck, text: "Uỷ quyền chính chủ trên trang của sàn — Hubsell không giữ mật khẩu của bạn." },
                { icon: Zap, text: "Đơn hàng, phí sàn tự về ngay — cùng giá vốn, đây là số để tính ROAS hòa vốn từng sản phẩm." },
                { icon: Store, text: "Nối xong gian thì nối quảng cáo của sàn đó — trợ lý canh chiến dịch trên cả ba sàn ở một nơi." },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-2.5 text-muted-foreground">
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-center">
              <Button size="lg" onClick={onGoConnect}>
                <PlugZap className="size-4" />
                Liên kết gian hàng ngay
              </Button>
            </div>
          </div>
        ) : (
          // Nhân viên không thể tự kết nối gian hàng
          <div className="rounded-2xl border bg-background p-8 text-center shadow-sm">
            <Store className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p>Cửa hàng chưa kết nối gian hàng nào</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Vui lòng liên hệ Chủ shop để kết nối gian hàng trước khi bắt đầu
              làm việc.
            </p>
          </div>
        )}

        {/* Đăng xuất */}
        <div className="mt-6 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearToken();
              onLogout();
            }}
          >
            <LogOut className="size-4" />
            Đăng xuất
          </Button>
        </div>
      </div>
    </div>
  );
}
