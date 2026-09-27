"use client";

// ============================================================
// THÔNG TIN LIÊN HỆ — SĐT của chủ tài khoản, trong /settings/general.
//
// Vì sao có (anh Trung 27/09/2026): đăng ký bằng form thì SĐT bắt buộc, nhưng
// vào bằng Google thì không có số và trước đây KHÔNG CÓ CHỖ NÀO bổ sung — sale
// không gọi được khách. Đây là "nhà cố định" của số liên hệ; dải nhắc dưới
// header (phone-nudge-band.tsx) chỉ là lời mời, cùng gọi một API.
// Dùng lại PhoneInput của trang đăng ký (chọn mã vùng + số thuần) để nhất
// quán; số đang lưu là E.164 nên tách mã vùng theo user.country để điền sẵn.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Phone } from "lucide-react";

import { PhoneInput } from "@/components/auth/phone-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  getStoredUser,
  notifyUserChanged,
  updateContact,
  type AuthUser,
} from "@/lib/api";
import { findCountry } from "@/lib/countries";
import { TEXT_SUB } from "@/lib/typography";

/** Tách E.164 "+84912345678" thành { country, national } theo nước của user. */
export function splitStoredPhone(user: AuthUser | null): {
  country: string;
  national: string;
} {
  const country = user?.country ?? "VN";
  const phone = user?.phone ?? "";
  const dial = findCountry(country).dial;
  const national = phone.startsWith(dial) ? phone.slice(dial.length) : phone.replace(/\D/g, "");
  return { country, national };
}

export function ContactInfoSection() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const initial = splitStoredPhone(user);
  const [country, setCountry] = useState(initial.country);
  const [phone, setPhone] = useState(initial.national);
  const [saving, setSaving] = useState(false);

  const dirty = country !== initial.country || phone !== initial.national;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6,15}$/.test(phone)) {
      toast.error("Vui lòng nhập số điện thoại hợp lệ (6-15 chữ số)");
      return;
    }
    setSaving(true);
    try {
      const res = await updateContact({ country, phoneNumber: phone });
      notifyUserChanged(res.user);
      setUser(res.user);
      toast.success("Đã lưu số điện thoại liên hệ");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-2xl shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2">
          <Phone className="size-5 text-slate-500" />
          Thông tin liên hệ
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <p className={TEXT_SUB}>
          Hubsell dùng số này để liên hệ khi gian hàng gặp sự cố hoặc khi bạn cần
          hỗ trợ. Số cũng dùng để liên hệ qua Zalo.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email đăng nhập</Label>
              <p id="contact-email" className="truncate text-sm text-muted-foreground">
                {user?.email ?? user?.staffUsername ?? user?.username ?? "—"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Số điện thoại</Label>
              <PhoneInput
                country={country}
                phone={phone}
                onCountryChange={setCountry}
                onPhoneChange={setPhone}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !dirty}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {user?.phone ? "Lưu số mới" : "Lưu số điện thoại"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
