"use client";

import { useEffect, useState } from "react";
import { Bot, RotateCcw, Save, Star } from "lucide-react";
import { toast } from "sonner";

import { DeliveryFailTab } from "@/components/operations/delivery-fail-tab";
import { OperationsFrame } from "@/components/operations/operations-frame";
import {
  DEFAULT_AUTO_REPLY_STARS,
  DEFAULT_REPLY_TEMPLATES,
  loadAutoReplyStars,
  loadReplyTemplates,
  saveAutoReplyStars,
  saveReplyTemplates,
  TEMPLATE_VARS,
  type AutoReplyStars,
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
 * CẤU HÌNH TỰ ĐỘNG HÓA CSKH
 *
 * Hai tab: (1) Phản hồi đánh giá — bộ mẫu câu theo số sao + công tắc tự động
 * gửi từng mức sao (trang Phản hồi đánh giá đọc và gửi thật lên sàn);
 * (2) Cứu đơn giao thất bại. 09/09/2026: bỏ danh sách "kịch bản AI" và khối
 * "giọng điệu thương hiệu" — chúng chỉ là công tắc mock trong state client,
 * không nối vào đâu; production không bày công tắc không có tác dụng.
 */

/** Thứ tự hiển thị + chấm màu mức độ rủi ro khi bật tự động từng mức sao. */
const STAR_SWITCH_ROWS: { star: StarLevel; dot: string; note?: string }[] = [
  { star: "5", dot: "bg-emerald-500" },
  { star: "4", dot: "bg-emerald-500" },
  { star: "3", dot: "bg-amber-400", note: "Nên duyệt tay nếu shop hay có khiếu nại." },
  { star: "2", dot: "bg-red-500", note: "Rủi ro: đánh giá xấu thường cần câu trả lời riêng." },
  { star: "1", dot: "bg-red-500", note: "Rủi ro: đánh giá xấu thường cần câu trả lời riêng." },
];

/** Hai tab của màn Cấu hình kịch bản AI (pill-tab tự làm — app chưa có ui/tabs). */
type AiRulesTab = "reviews" | "delivery-fail";

const TAB_ITEMS: { id: AiRulesTab; label: string }[] = [
  { id: "reviews", label: "Phản hồi đánh giá" },
  { id: "delivery-fail", label: "Cứu đơn giao thất bại" },
];

export function OperationsAiRulesPage() {
  // Tab đang mở. Deep-link ?tab=delivery-fail (chuông + thẻ Trung tâm điều
  // hành trỏ tới) đọc ở effect — search param chỉ có phía client, đọc lúc
  // render đầu sẽ lệch SSR/CSR.
  const [tab, setTab] = useState<AiRulesTab>("reviews");
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "delivery-fail") setTab("delivery-fail");
  }, []);

  // ── Cờ tự động phản hồi theo số sao (CẤU HÌNH THẬT — reviews-page đọc) ──
  // Nạp bản đã lưu ở useEffect (tránh lệch SSR/CSR như templates bên dưới);
  // gạt switch là ghi localStorage ngay, không cần nút Lưu riêng.
  const [autoStars, setAutoStars] = useState<AutoReplyStars>(DEFAULT_AUTO_REPLY_STARS);
  useEffect(() => {
    setAutoStars(loadAutoReplyStars());
  }, []);

  function toggleAutoStar(star: StarLevel, enabled: boolean) {
    setAutoStars((prev) => {
      const next = { ...prev, [star]: enabled };
      saveAutoReplyStars(next);
      return next;
    });
    toast.success(
      enabled
        ? `Đã BẬT tự động phản hồi đánh giá ${star} sao — áp dụng từ lượt quét kế tiếp của trang Phản hồi đánh giá.`
        : `Đã tắt tự động phản hồi đánh giá ${star} sao.`
    );
  }

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

  // 5 ô mẫu của mức sao đang chỉnh (đắp chuỗi rỗng cho đủ 5 ô)
  const editingList = [...templates[editingStar]];
  while (editingList.length < 5) editingList.push("");

  return (
    <OperationsFrame>
      {/* ===== THANH PILL-TAB: Phản hồi đánh giá | Giao không thành công ===== */}
      <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        {TAB_ITEMS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-background text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "delivery-fail" ? (
        <DeliveryFailTab />
      ) : (
        <>
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

      <div>
        <div className="space-y-3">
          {/* ===== 5 CÔNG TẮC TỰ ĐỘNG PHẢN HỒI THEO SỐ SAO (CẤU HÌNH THẬT) =====
              Thay cho rule mock "tự động trả lời 5 sao" cũ: bật mức nào thì
              trang Phản hồi đánh giá TỰ GỬI THẬT phản hồi lên sàn cho đánh giá
              chưa trả lời ở mức đó (quét mỗi 5 phút khi trang đang mở). */}
          <Card className="border-violet-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4.5 text-violet-600" />
                Tự động phản hồi đánh giá theo số sao
              </CardTitle>
              <CardDescription>
                Bật mức sao nào, hệ thống tự gửi phản hồi <b>thật</b> sang sàn cho
                đánh giá mới ở mức đó. Hiệu lực khi trang Phản hồi đánh giá đang
                mở (tự quét đánh giá mới 5 phút/lần); mức đang tắt vẫn được soạn
                sẵn câu trả lời chờ nhân viên duyệt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {STAR_SWITCH_ROWS.map(({ star, dot, note }) => (
                <div
                  key={star}
                  className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      Tự động trả lời Đánh giá {star} sao
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Khi bật, hệ thống tự chọn 1 mẫu câu trong bộ mẫu [{star} sao]
                      để gửi phản hồi trực tiếp sang sàn.
                      {note ? <span className="text-amber-700"> {note}</span> : null}
                    </p>
                  </div>
                  {/* KHÔNG bọc Switch trong <label> — từng dính bug double-toggle */}
                  <Switch
                    checked={autoStars[star]}
                    onCheckedChange={(v) => toggleAutoStar(star, v)}
                    aria-label={`Bật/tắt tự động trả lời đánh giá ${star} sao`}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
        </>
      )}
    </OperationsFrame>
  );
}
