"use client";

import { ScanSearch } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AssistantRuleFields } from "@/components/ads/tiktok-assistant-rule-fields";
import type {
  AssistantConfig,
  AssistantSummary,
} from "@/components/ads/tiktok-assistant";

/**
 * TAB "CẤU HÌNH TRỢ LÝ TỰ ĐỘNG" — bộ luật MẶC ĐỊNH HỆ THỐNG của rule engine
 * 2 lớp (logic ở tiktok-assistant.ts): chiến dịch nào KHÔNG bật quy tắc riêng
 * (override trong modal phân tích) sẽ kế thừa bộ luật này. UI thuần điều
 * khiển: mọi thay đổi áp NGAY vào bộ quét — khối "Với cấu hình hiện tại" đổi
 * số theo từng phím gõ để Seller thấy luật của mình bắt trúng bao nhiêu video.
 */

interface TiktokAssistantConfigTabProps {
  config: AssistantConfig;
  onChange: (next: AssistantConfig) => void;
  summary: AssistantSummary;
  /** Tên các chiến dịch đang dùng quy tắc riêng (không ăn theo cấu hình này) */
  customCampaignNames: string[];
}

export function TiktokAssistantConfigTab({
  config,
  onChange,
  summary,
  customCampaignNames,
}: TiktokAssistantConfigTabProps) {
  const off = !config.enabled;

  return (
    <div className="space-y-5">
      {/* ===== SWITCH TỔNG ===== */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <ScanSearch className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Bật trợ lý tối ưu tự động
              </p>
              <p className="mt-0.5 max-w-xl text-xs text-slate-500">
                Trợ lý quét toàn bộ video trong các chiến dịch GMV Max theo luật
                bên dưới và gọi API &quot;Loại trừ&quot; của TikTok với video vi
                phạm. Tắt đi thì mọi cờ đang gắn sẽ được gỡ, không quét nữa.
              </p>
              <p className="mt-1.5 max-w-xl text-xs text-slate-500">
                Đây là <b>Cấu hình Mặc định hệ thống</b> — chiến dịch có{" "}
                <b>quy tắc riêng</b> (bật trong modal Phân tích kế hoạch quảng
                cáo) sẽ ưu tiên quy tắc riêng của nó, vì mỗi sản phẩm có giá bán
                và biên lãi khác nhau.
                {customCampaignNames.length > 0 && (
                  <>
                    {" "}
                    Đang có quy tắc riêng:{" "}
                    <b>{customCampaignNames.join(", ")}</b>.
                  </>
                )}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => onChange({ ...config, enabled })}
              aria-label="Bật trợ lý tối ưu tự động"
            />
            <span className="text-sm text-slate-900">
              {config.enabled ? "Đang bật" : "Đang tắt"}
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Khối luật mờ đi khi tắt trợ lý — vẫn xem được luật nhưng biết là không chạy.
          TRỌN BỘ Sàn dữ liệu + Quy tắc 1–4 dùng chung AssistantRuleFields với
          modal chiến dịch — sửa khuôn nhập một chỗ, hai nơi cùng nhận. */}
      <Card className={cn(off && "pointer-events-none opacity-50")}>
        <CardHeader>
          <CardTitle>Bộ quy tắc mặc định hệ thống</CardTitle>
          <CardDescription>
            Mỗi quy tắc có switch bật/tắt riêng. Chiến dịch bật &quot;Quy tắc
            riêng&quot; trong modal sẽ ghi đè trọn bộ này.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssistantRuleFields
            rules={config}
            onChange={(next) => onChange({ ...config, ...next })}
            disabled={off}
          />
        </CardContent>
      </Card>

      {/* ===== PREVIEW SỐNG: LUẬT HIỆN TẠI BẮT ĐƯỢC GÌ ===== */}
      <Card className={cn(off && "opacity-60")}>
        <CardContent className="p-5">
          <p className="text-sm font-semibold text-slate-900">
            Với cấu hình hiện tại
          </p>
          {off ? (
            <p className="mt-1 text-sm text-slate-500">
              Trợ lý đang tắt — không video nào bị quét hay gắn cờ.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
              <span className="text-red-500">
                <b>{formatNumber(summary.autoExclude)}</b> video chờ loại trừ
              </span>
              <span className="text-amber-600">
                <b>{formatNumber(summary.needsReview)}</b> video chờ Seller duyệt
              </span>
              <span className="text-slate-500">
                <b>{formatNumber(summary.insufficient)}</b> video chưa đủ dữ liệu
                (đứng ngoài)
              </span>
              <span className="text-violet-600">
                <b>{formatNumber(summary.watching)}</b> video Seller đang theo dõi
                thêm
              </span>
              <span className="text-slate-500">
                <b>{formatNumber(summary.excluded)}</b> video đã loại trừ
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
