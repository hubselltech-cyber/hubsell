"use client";

// ============================================================
// DẢI MỜI BỔ SUNG SĐT — mỏng, dưới header, chỉ với chủ shop CHƯA có số.
//
// Bối cảnh (anh Trung 27/09/2026): khách vào bằng Google không có SĐT, sale
// không liên hệ được. Không chặn ở bước đăng nhập Google (mất lợi thế một
// chạm) mà mời ĐÚNG CHỖ: khu Cấu hình / Gói / Kiếm Tiền — nơi khách chủ động
// đi tìm tài khoản và hỗ trợ.
//
// Chủ đích:
// - Điều kiện hiện: chủ shop (isAdmin), không phải khu HQ, user.phone trống,
//   và CHỈ trong khu Cấu hình (/settings/*) + Kiếm Tiền Cùng Hubsell
//   (/affiliate) — anh Trung 27/09: khách đi tìm hỗ trợ sẽ vào đúng khu đó,
//   các trang làm việc hằng ngày (Tổng quan, Đơn hàng…) không bày dải này.
// - Nhập ngay trên dải (PhoneInput + Lưu), không bắt sang trang khác. Lưu
//   xong dải biến mất, header/menu cập nhật qua onUserChange.
// - Nút X tắt hẳn, lưu localStorage THEO USER ID (máy chung nhiều tài khoản
//   không vạ lây), không nhắc lại.
// - Ẩn ở /settings/general vì khách đã đứng ngay trước thẻ Thông tin liên hệ.
// - Tông xanh dịu (thông tin, không cảnh báo). Câu chữ nói thật: Hubsell
//   LIÊN HỆ khi có sự cố — không hứa SMS/Zalo tự động vì chưa làm.
// - Báo trạng thái lên shell (onStateChange) để dải app di động NHƯỜNG khi
//   dải này đang hiện — hai dải xếp chồng rất xấu; dải này sống ngắn (một lần
//   lưu hoặc một lần X là hết) nên đi trước.
// ============================================================

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Phone, X } from "lucide-react";

import { PhoneInput } from "@/components/auth/phone-input";
import { ApiError, updateContact, type AuthUser } from "@/lib/api";
import { isAdmin } from "@/lib/permissions";

export type PhoneNudgeState = "shown" | "hidden";

const DISMISS_PREFIX = "hubsell_phone_nudge_dismissed:";

function readDismissed(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(userId: string) {
  try {
    localStorage.setItem(DISMISS_PREFIX + userId, "1");
  } catch {
    /* chế độ riêng tư chặn storage — coi như chưa tắt */
  }
}

/** Khu vực khách đi tìm hỗ trợ/tài khoản — chỉ hiện dải ở đây. */
const SHOW_ON_PREFIXES = ["/settings", "/affiliate"];

export function PhoneNudgeBand({
  user,
  hqWorkspace,
  onUserChange,
  onStateChange,
}: {
  user: AuthUser;
  hqWorkspace: boolean;
  onUserChange: (user: AuthUser) => void;
  onStateChange?: (state: PhoneNudgeState) => void;
}) {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed(user.id));
  const [country, setCountry] = useState(user.country ?? "VN");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const visible =
    !dismissed &&
    !hqWorkspace &&
    isAdmin(user) &&
    !user.phone &&
    SHOW_ON_PREFIXES.some((p) => pathname.startsWith(p)) &&
    !pathname.startsWith("/settings/general");

  useEffect(() => {
    onStateChange?.(visible ? "shown" : "hidden");
  }, [visible, onStateChange]);

  if (!visible) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6,15}$/.test(phone)) {
      toast.error("Vui lòng nhập số điện thoại hợp lệ (6-15 chữ số)");
      return;
    }
    setSaving(true);
    try {
      const res = await updateContact({ country, phoneNumber: phone });
      onUserChange(res.user);
      toast.success("Đã lưu số điện thoại liên hệ");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSaving(false);
    }
  }

  function dismiss() {
    writeDismissed(user.id);
    setDismissed(true);
  }

  return (
    <form
      onSubmit={save}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 md:px-6 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100"
    >
      <Phone className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 basis-60">
        <span className="font-semibold">Để lại số điện thoại</span>
        <span className="hidden md:inline">
          {" "}
          để Hubsell liên hệ khi gian hàng gặp sự cố. Chỉ dùng để hỗ trợ bạn.
        </span>
      </p>
      <div className="w-56 shrink-0 [&_input]:bg-card">
        <PhoneInput
          country={country}
          phone={phone}
          onCountryChange={setCountry}
          onPhoneChange={setPhone}
        />
      </div>
      <button
        type="submit"
        disabled={saving || phone.length < 6}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-sky-300 bg-card px-3 font-medium transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-800 dark:hover:bg-sky-900/40"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        Lưu
      </button>
      <button
        type="button"
        onClick={dismiss}
        title="Không hiện lại"
        aria-label="Không hiện lời mời bổ sung số điện thoại nữa"
        className="shrink-0 rounded-md p-1 text-sky-900/70 transition-colors hover:bg-sky-100 hover:text-sky-900 dark:text-sky-100/70 dark:hover:bg-sky-900/40"
      >
        <X className="size-4" />
      </button>
    </form>
  );
}
