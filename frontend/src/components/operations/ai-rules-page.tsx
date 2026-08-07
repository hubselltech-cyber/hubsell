"use client";

import { useState } from "react";
import { BellRing, Bot, MessageSquare, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { OperationsFrame } from "@/components/operations/operations-frame";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { TEXT_SUB } from "@/lib/typography";

/**
 * CẤU HÌNH KỊCH BẢN AI — MÀN HÌNH MOCKUP (PREVIEW)
 *
 * Nơi bật/tắt từng kịch bản tự động hoá CSKH và chỉnh giọng điệu thương hiệu.
 * Trạng thái chỉ nằm trong state client (mock) — khi làm thật sẽ lưu vào
 * cấu hình theo user, cùng khuôn với Trợ lý quảng cáo TikTok.
 */

interface AiRule {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_RULES: AiRule[] = [
  {
    id: "auto-5-star",
    icon: Star,
    title: "Tự động trả lời đánh giá 5 sao",
    description:
      "AI gửi lời cảm ơn theo giọng điệu thương hiệu ngay khi có đánh giá 5 sao, không cần người duyệt.",
    enabled: true,
  },
  {
    id: "classify-bad",
    icon: Bot,
    title: "Phân loại lỗi đánh giá 1–3 sao",
    description:
      "AI phân tích nội dung đánh giá xấu và gắn nhãn nguyên nhân (Vận chuyển / Hàng vỡ / Chất lượng SP) kèm câu trả lời gợi ý — luôn chờ người duyệt trước khi gửi.",
    enabled: true,
  },
  {
    id: "chat-copilot",
    icon: MessageSquare,
    title: "AI Copilot trong khung chat",
    description:
      "Gợi ý câu trả lời theo ngữ cảnh hội thoại và đơn hàng liên quan; nhân viên bấm một nút để dùng.",
    enabled: true,
  },
  {
    id: "alert-bad-review",
    icon: BellRing,
    title: "Cảnh báo đánh giá tiêu cực",
    description:
      "Đánh giá 1–2 sao vừa xuất hiện sẽ bắn thông báo ngay cho đội CSKH để xử lý trong giờ vàng.",
    enabled: false,
  },
];

export function OperationsAiRulesPage() {
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [tone, setTone] = useState("FRIENDLY");

  function toggleRule(id: string, enabled: boolean) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }

  return (
    <OperationsFrame>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ----- DANH SÁCH KỊCH BẢN ----- */}
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="flex items-start gap-3.5 py-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                  <rule.icon className="size-5 text-violet-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {rule.title}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {rule.description}
                  </p>
                </div>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(v) => toggleRule(rule.id, v)}
                  aria-label={`Bật/tắt: ${rule.title}`}
                />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ----- GIỌNG ĐIỆU THƯƠNG HIỆU ----- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Giọng điệu thương hiệu</CardTitle>
            <CardDescription>
              AI dùng giọng điệu này cho mọi câu trả lời tự động và gợi ý.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <NativeSelect
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              aria-label="Chọn giọng điệu"
            >
              <option value="FRIENDLY">Thân thiện, gần gũi (mặc định)</option>
              <option value="FORMAL">Trang trọng, chuyên nghiệp</option>
              <option value="PLAYFUL">Trẻ trung, có emoji</option>
            </NativeSelect>
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm text-slate-900">
              {tone === "FORMAL"
                ? "Kính chào Quý khách, chúng tôi chân thành cảm ơn Quý khách đã tin tưởng lựa chọn sản phẩm của cửa hàng…"
                : tone === "PLAYFUL"
                  ? "Hihi cảm ơn bạn iu đã ủng hộ shop nha 🥰 Có gì cần cứ nhắn shop liền nè!"
                  : "Chào bạn, shop cảm ơn bạn đã tin tưởng và ủng hộ ạ! Có bất kỳ điều gì cần hỗ trợ bạn cứ nhắn shop ngay nha."}
            </div>
            <p className={TEXT_SUB}>
              Xem trước cách AI mở đầu câu trả lời với giọng điệu đã chọn.
            </p>
            <Button className="w-full" disabled>
              Lưu cấu hình (chờ nối API)
            </Button>
          </CardContent>
        </Card>
      </div>
    </OperationsFrame>
  );
}
