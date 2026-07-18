"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, PlugZap, Sparkles, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  connectChannel,
  clearToken,
  type ChannelName,
} from "@/lib/api";

// Các sàn có thể kết nối nhanh ở màn hình onboarding
const CONNECT_OPTIONS: {
  name: ChannelName;
  label: string;
  bg: string;
  ring: string;
}[] = [
  { name: "SHOPEE", label: "Shopee", bg: "from-orange-500 to-orange-600", ring: "hover:ring-orange-300" },
  { name: "TIKTOK", label: "TikTok Shop", bg: "from-zinc-800 to-black", ring: "hover:ring-zinc-400" },
  { name: "LAZADA", label: "Lazada", bg: "from-blue-500 to-indigo-600", ring: "hover:ring-blue-300" },
];

export function OnboardingOverlay({
  isAdmin,
  onConnected,
  onLogout,
}: {
  isAdmin: boolean;
  onConnected: () => void;
  onLogout: () => void;
}) {
  const [connecting, setConnecting] = useState<ChannelName | null>(null);

  async function handleConnect(name: ChannelName) {
    setConnecting(name);
    try {
      await connectChannel(name);
      toast.success(`Đã kết nối gian hàng ${name}! Đang mở khoá hệ thống…`);
      onConnected();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gradient-to-br from-muted/60 via-background to-primary/5 p-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-2xl font-bold text-primary-foreground shadow-lg">
            H
          </div>
          <div>
            <h1 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
              <Sparkles className="size-6 text-primary" />
              Chào mừng bạn đến với Hubsell!
            </h1>
            <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
              Bước đầu tiên để kích hoạt hệ thống là kết nối gian hàng. Vui lòng
              chọn một sàn dưới đây để bắt đầu lấy dữ liệu.
            </p>
          </div>
        </div>

        {isAdmin ? (
          <>
            {/* 3 nút kết nối nhanh */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {CONNECT_OPTIONS.map((opt) => {
                const busy = connecting === opt.name;
                return (
                  <button
                    key={opt.name}
                    type="button"
                    disabled={connecting !== null}
                    onClick={() => handleConnect(opt.name)}
                    className={`group flex flex-col items-center gap-3 rounded-2xl border bg-background p-6 text-center shadow-sm ring-2 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 ${opt.ring}`}
                  >
                    <div
                      className={`flex size-14 items-center justify-center rounded-xl bg-gradient-to-br ${opt.bg} text-white shadow`}
                    >
                      {busy ? (
                        <Loader2 className="size-7 animate-spin" />
                      ) : (
                        <Store className="size-7" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold">{opt.label}</p>
                      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <PlugZap className="size-3" />
                        Kết nối ngay
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Đây là kết nối giả lập (demo) — hệ thống sẽ cấp API Token ảo và mở
              khoá toàn bộ tính năng ngay sau khi kết nối.
            </p>
          </>
        ) : (
          // Nhân viên không thể tự kết nối gian hàng
          <div className="rounded-2xl border bg-background p-8 text-center shadow-sm">
            <Store className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">Cửa hàng chưa kết nối gian hàng nào</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Vui lòng liên hệ Chủ shop để kết nối gian hàng trước khi bắt đầu
              làm việc.
            </p>
          </div>
        )}

        {/* Đăng xuất */}
        <div className="mt-8 flex justify-center">
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
