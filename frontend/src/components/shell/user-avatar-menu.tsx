"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Loader2, LogOut, Trash2, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ApiError, ROLE_META, updateAvatar, type AuthUser } from "@/lib/api";
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
        <span className="hidden text-sm font-medium sm:inline">
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
          <UserAvatarCircle
            user={user}
            className="size-14"
            iconClassName="size-6"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email ?? user.staffUsername ?? user.username}
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={saving}
            onClick={() => fileInputRef.current?.click()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImageUp className="size-4" />
            )}
            {user.avatar ? "Đổi ảnh đại diện" : "Tải ảnh đại diện lên"}
          </Button>
          {user.avatar && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-red-600 hover:text-red-600"
              disabled={saving}
              onClick={() => save(null)}
            >
              <Trash2 className="size-4" />
              Gỡ ảnh đại diện
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Ảnh được cắt vuông và thu nhỏ tự động — chọn ảnh nào cũng được.
        </p>
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
