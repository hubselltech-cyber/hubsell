"use client";

import { useEffect, useState } from "react";
import { BellRing, Bot, MessageSquare, RotateCcw, Save, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { OperationsFrame } from "@/components/operations/operations-frame";
import {
  DEFAULT_REPLY_TEMPLATES,
  loadReplyTemplates,
  saveReplyTemplates,
  TEMPLATE_VARS,
  type ReplyTemplates,
  type StarLevel,
} from "@/components/operations/reply-templates";
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
import { cn } from "@/lib/utils";

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

  // ── Bộ mẫu câu phản hồi đánh giá (randomizer) ──
  // Khởi tạo bằng mặc định rồi nạp bản đã lưu ở useEffect: localStorage chỉ
  // có ở client, đọc thẳng lúc render đầu sẽ lệch SSR/CSR.
  const [templates, setTemplates] = useState<ReplyTemplates>(DEFAULT_REPLY_TEMPLATES);
  const [editingStar, setEditingStar] = useState<StarLevel>("5");
  useEffect(() => {
    setTemplates(loadReplyTemplates());
  }, []);

  function changeTemplate(index: number, value: string) {
    setTemplates((prev) => {
      const list = [...prev[editingStar]];
      while (list.length < 5) list.push("");
      list[index] = value;
      return { ...prev, [editingStar]: list };
    });
  }

  function handleSaveTemplates() {
    saveReplyTemplates(templates);
    toast.success("Đã lưu bộ mẫu câu phản hồi (áp dụng ngay cho trang Phản hồi đánh giá).");
  }

  function handleRestoreDefaults() {
    setTemplates(DEFAULT_REPLY_TEMPLATES);
    saveReplyTemplates(DEFAULT_REPLY_TEMPLATES);
    toast.success("Đã khôi phục bộ mẫu câu mặc định.");
  }

  function toggleRule(id: string, enabled: boolean) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }

  // 5 ô mẫu của mức sao đang chỉnh (đắp chuỗi rỗng cho đủ 5 ô)
  const editingList = [...templates[editingStar]];
  while (editingList.length < 5) editingList.push("");

  return (
    <OperationsFrame>
      {/* ===== MẪU CÂU PHẢN HỒI ĐÁNH GIÁ (RANDOMIZER CHỐNG SPAM TRÙNG) ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Star className="size-4.5 text-amber-500" />
            Mẫu câu phản hồi đánh giá theo số sao
          </CardTitle>
          <CardDescription>
            Mỗi mức sao có 5 mẫu — khi gửi phản hồi (kể cả hàng loạt), hệ thống
            bốc ngẫu nhiên 1 mẫu để sàn không quét trùng nội dung. Biến khả dụng:{" "}
            {TEMPLATE_VARS.map((v, i) => (
              <span key={v}>
                {i > 0 && ", "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{v}</code>
              </span>
            ))}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              className="w-40"
              value={editingStar}
              onChange={(e) => setEditingStar(e.target.value as StarLevel)}
              aria-label="Chọn mức sao để chỉnh mẫu"
            >
              {(["5", "4", "3", "2", "1"] as StarLevel[]).map((s) => (
                <option key={s} value={s}>
                  Mẫu cho {s} sao
                </option>
              ))}
            </NativeSelect>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRestoreDefaults}>
                <RotateCcw className="size-4" />
                Khôi phục mặc định
              </Button>
              <Button size="sm" onClick={handleSaveTemplates}>
                <Save className="size-4" />
                Lưu bộ mẫu
              </Button>
            </div>
          </div>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {editingList.map((tpl, i) => (
              <textarea
                key={`${editingStar}-${i}`}
                value={tpl}
                onChange={(e) => changeTemplate(i, e.target.value)}
                rows={3}
                placeholder={`Mẫu ${i + 1} cho ${editingStar} sao (bỏ trống nếu không dùng)`}
                aria-label={`Mẫu ${i + 1} cho ${editingStar} sao`}
                className="w-full rounded-lg border border-input bg-background p-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            ))}
          </div>
          <p className={cn(TEXT_SUB)}>
            Lưu tại trình duyệt này (localStorage) — sẽ chuyển vào cấu hình tài
            khoản khi module có DB riêng.
          </p>
        </CardContent>
      </Card>

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
