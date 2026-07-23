"use client";

import { Bell, Puzzle, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsShell } from "@/components/settings/settings-shell";
import { TEXT_SUB } from "@/lib/typography";

/**
 * CẤU HÌNH KHÁC — thông báo, tích hợp, bảo mật… (đang dựng khung).
 */
export default function SettingsOtherPage() {
  const rows = [
    {
      icon: Bell,
      label: "Thông báo",
      hint: "Kênh nhận cảnh báo vận hành (email, Zalo, Telegram) và ngưỡng nhắc.",
    },
    {
      icon: Puzzle,
      label: "Tích hợp & Webhook",
      hint: "Kết nối bên thứ ba, khóa API, webhook đồng bộ đơn/tồn.",
    },
    {
      icon: ShieldCheck,
      label: "Bảo mật",
      hint: "Đổi mật khẩu, phiên đăng nhập, nhật ký truy cập.",
    },
  ];

  return (
    <SettingsShell
      title="Cấu hình khác"
      description="Các thiết lập nâng cao và tiện ích mở rộng."
    >
      <Card className="max-w-2xl shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="size-5 text-slate-500" />
            Nâng cao &amp; Tiện ích
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              Đang dựng khung
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y pt-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start gap-3 py-3">
              <r.icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-800">{r.label}</p>
                <p className={TEXT_SUB}>{r.hint}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </SettingsShell>
  );
}
