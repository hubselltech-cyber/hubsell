"use client";

import { Building2, Globe, Clock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { ChangePasswordSection } from "@/components/settings/change-password-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { TEXT_SUB } from "@/lib/typography";

/**
 * CẤU HÌNH CHUNG — Giao diện hệ thống (đa theme, chạy thật) + thông tin doanh
 * nghiệp, khu vực, định dạng (đang dựng khung).
 */
export default function SettingsGeneralPage() {
  const rows = [
    {
      icon: Building2,
      label: "Thông tin doanh nghiệp",
      hint: "Tên shop, mã số thuế, địa chỉ xuất hóa đơn — sẽ dùng chung cho toàn hệ thống.",
    },
    {
      icon: Globe,
      label: "Ngôn ngữ & Khu vực",
      hint: "Ngôn ngữ hiển thị, đơn vị tiền tệ, định dạng ngày giờ.",
    },
    {
      icon: Clock,
      label: "Múi giờ vận hành",
      hint: "Dùng để chốt mốc ngày cho báo cáo và nhật ký vận hành.",
    },
  ];

  return (
    <SettingsShell
      title="Cấu hình chung"
      description="Thiết lập cơ bản áp dụng cho toàn bộ hệ thống."
    >
      <AppearanceSection />

      <ChangePasswordSection />

      <Card className="max-w-2xl shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-slate-500" />
            Thiết lập cơ bản
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
