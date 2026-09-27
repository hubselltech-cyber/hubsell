"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Camera, Loader2, LogOut, Settings2, UserRound } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ApiError, ROLE_META, updateAvatar, type AuthUser } from "@/lib/api";
import { isAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** Cạnh dài nhất của avatar sau khi thu nhỏ — 256px là dư cho vòng tròn 32px
 * trên header kể cả màn Retina, mà data URL chỉ còn vài chục KB. */
const AVATAR_SIZE = 256;

/**
 * Thu nhỏ + cắt vuông chính giữa ảnh người dùng chọn thành data URL JPEG.
 * Làm ngay trên trình duyệt để ảnh gốc chục MB không bao giờ phải rời máy —
 * backend chỉ nhận bản 256px đã nén (giới hạn body JSON 100kb).
 */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh");
    // Nền trắng để PNG trong suốt không hoá nền đen khi ép sang JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size
    );
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

/** Vòng tròn avatar dùng chung cho header (nhỏ) và popover (to). */
export function UserAvatarCircle({
  user,
  className,
  iconClassName,
}: {
  user: AuthUser;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted",
        className
      )}
    >
      {user.avatar ? (
        // Data URL base64 — next/image không tối ưu thêm được gì, dùng <img> thường.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatar}
          alt={`Ảnh đại diện của ${user.fullName}`}
          className="size-full object-cover"
        />
      ) : (
        <UserRound className={cn("text-muted-foreground", iconClassName)} />
      )}
    </div>
  );
}

/**
 * Khối người dùng trên header: bấm vào mở menu đổi/gỡ ảnh đại diện + Đăng
 * xuất. Đặt ở đây (thay vì trang Cấu hình chỉ Chủ shop vào được) để NHÂN VIÊN
 * cũng tự đổi được avatar của chính mình. Đăng xuất nằm TRONG menu này (chuẩn
 * SaaS) chứ không bày nút trần trên header — header chỉ giữ hành động dùng
 * hằng ngày.
 */
export function UserAvatarMenu({
  user,
  onUserChange,
  onLogout,
}: {
  user: AuthUser;
  /** Báo ngược cho AppShell cập nhật state + localStorage sau khi đổi ảnh. */
  onUserChange: (user: AuthUser) => void;
  onLogout: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  async function save(avatar: string | null) {
    setSaving(true);
    try {
      const res = await updateAvatar(avatar);
      onUserChange(res.user);
      toast.success(avatar ? "Đã cập nhật ảnh đại diện" : "Đã gỡ ảnh đại diện");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được máy chủ"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Vui lòng chọn một tệp ảnh (JPG, PNG, WebP…)");
      return;
    }
    try {
      await save(await fileToAvatarDataUrl(file));
    } catch {
      toast.error("Không đọc được ảnh — vui lòng thử ảnh khác");
    }
  }

  return (
    <Popover>
      {/* Mobile vẫn PHẢI thấy khối này (Đăng xuất nằm trong đây) — chỉ thu
          gọn: giấu tên + nhãn vai trò, giữ vòng tròn avatar */}
      <PopoverTrigger
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-muted sm:pr-2"
        aria-label="Mở menu tài khoản"
      >
        <UserAvatarCircle user={user} className="size-8" iconClassName="size-4" />
        <span className="hidden text-sm sm:inline">
          {user.fullName}
        </span>
        <span
          className={cn(
            "hidden rounded-full border px-2.5 py-0.5 text-xs font-medium sm:inline",
            ROLE_META[user.role].className
          )}
        >
          {ROLE_META[user.role].label}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-4">
        <div className="flex items-center gap-3">
          {/* Bấm thẳng vào hình tròn để đổi ảnh (anh Trung 27/09: không cần
              nút + câu giải thích, khách tự hiểu). Huy hiệu máy ảnh nhỏ ở góc
              là dấu hiệu "bấm được"; đang lưu thì xoay. */}
          <button
            type="button"
            disabled={saving}
            onClick={() => fileInputRef.current?.click()}
            title={user.avatar ? "Đổi ảnh đại diện" : "Tải ảnh đại diện lên"}
            aria-label={user.avatar ? "Đổi ảnh đại diện" : "Tải ảnh đại diện lên"}
            className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <UserAvatarCircle
              user={user}
              className="size-14 transition-opacity group-hover:opacity-80"
              iconClassName="size-6"
            />
            <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-popover bg-foreground text-background">
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Camera className="size-3" />
              )}
            </span>
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm">{user.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email ?? user.staffUsername ?? user.username}
            </p>
            {user.avatar && (
              <button
                type="button"
                disabled={saving}
                onClick={() => save(null)}
                className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-red-600 hover:underline"
              >
                Gỡ ảnh
              </button>
            )}
          </div>
        </div>
        {/* Lối tắt tới SĐT liên hệ + đổi mật khẩu (anh Trung 27/09): không
            thêm mục sidebar, khách tìm tài khoản của mình ở đây. Chỉ chủ shop
            vì nhóm Cấu hình là adminOnly. */}
        {isAdmin(user) && (
          <div className="mt-3 border-t pt-3">
            <Link
              href="/settings/general"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
            >
              <Settings2 className="size-4" />
              {user.phone ? "Tài khoản & liên hệ" : "Thêm số điện thoại liên hệ"}
            </Link>
          </div>
        )}
        <div className="mt-3 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-red-600 hover:text-red-600"
            onClick={onLogout}
          >
            <LogOut className="size-4" />
            Đăng xuất
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            // Cho phép chọn lại đúng tệp cũ vẫn kích hoạt onChange.
            e.target.value = "";
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
