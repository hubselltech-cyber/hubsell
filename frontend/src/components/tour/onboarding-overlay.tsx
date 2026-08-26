"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  LogOut,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Store,
  Zap,
} from "lucide-react";

import { TourPlayer } from "@/components/tour/guide-tour-player";
import { Button } from "@/components/ui/button";
import { clearToken } from "@/lib/api";
import { CHANNELS_TOUR } from "@/lib/guide-tours";

/**
 * Màn chào mừng lần đầu đăng nhập: KHÔNG còn tạo gian hàng giả lập nữa —
 * thay bằng HƯỚNG DẪN ĐỘNG kiểu video quay màn hình (TourPlayer dùng chung
 * với trang /guide; bộ bước + giọng đọc ở lib/guide-tours.ts → CHANNELS_TOUR),
 * kết thúc đưa thẳng người dùng sang /channels để liên kết shop thật.
 */

// Nhớ "đã xem hướng dẫn" để lần chặn sau (chưa kết nối mà đi trang khác)
// vào thẳng thẻ hành động, không bắt xem lại video từ đầu.
const SEEN_KEY = "hubsell_onboarding_tour_seen";

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
  // 'tour' = đang phát hướng dẫn; 'ready' = thẻ hành động cuối.
  const [view, setView] = useState<"tour" | "ready">("tour");

  // Đã xem một lần rồi → vào thẳng thẻ hành động (vẫn có nút Xem lại).
  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY)) setView("ready");
  }, []);

  const markSeen = useCallback(() => {
    localStorage.setItem(SEEN_KEY, "1");
    setView("ready");
  }, []);

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
                ? view === "tour"
                  ? "Xem nhanh cách liên kết gian hàng thật — chỉ mất chưa đầy một phút."
                  : "Liên kết gian hàng thật của bạn để Hubsell bắt đầu đồng bộ đơn hàng."
                : "Bước đầu tiên để kích hoạt hệ thống là kết nối gian hàng."}
            </p>
          </div>
        </div>

        {isAdmin ? (
          view === "tour" ? (
            <>
              <TourPlayer
                steps={CHANNELS_TOUR.steps}
                voiceDir={CHANNELS_TOUR.voiceDir}
                onFinish={markSeen}
                alt="Hướng dẫn liên kết gian hàng"
              />
              <div className="mt-4 flex justify-center">
                <Button variant="ghost" size="sm" onClick={markSeen}>
                  Bỏ qua hướng dẫn
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            // Thẻ hành động cuối: vào thẳng Kênh bán để liên kết shop thật
            <div className="rounded-2xl border bg-background p-8 text-center shadow-sm">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                <PlugZap className="size-7 text-primary" />
              </div>
              <p className="text-lg font-semibold">Bạn đã sẵn sàng!</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Vào trang <span className="font-medium text-foreground">Kênh bán</span>,
                bấm “Kết nối gian hàng” rồi uỷ quyền trên sàn — đơn hàng sẽ tự
                đồng bộ về ngay sau đó.
              </p>

              <div className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm">
                {[
                  { icon: ShieldCheck, text: "Uỷ quyền chính chủ trên trang của sàn — Hubsell không giữ mật khẩu của bạn." },
                  { icon: Zap, text: "Đơn hàng, sản phẩm tự đồng bộ về ngay sau khi kết nối." },
                  { icon: Store, text: "Một sàn kết nối được nhiều gian hàng, quản lý tập trung một nơi." },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-start gap-2.5 text-muted-foreground">
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col items-center gap-2">
                <Button size="lg" onClick={onGoConnect}>
                  <PlugZap className="size-4" />
                  Liên kết gian hàng ngay
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setView("tour")}>
                  <RotateCcw className="size-3.5" />
                  Xem lại hướng dẫn
                </Button>
              </div>
            </div>
          )
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
