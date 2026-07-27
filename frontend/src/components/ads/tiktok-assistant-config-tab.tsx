"use client";

import { BellRing, ScanSearch, ShieldX } from "lucide-react";

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

import {
  NumberInput,
  RuleRow,
  VndInput,
} from "@/components/ads/tiktok-assistant-rule-fields";
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
            <span className="text-sm font-medium text-slate-700">
              {config.enabled ? "Đang bật" : "Đang tắt"}
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Khối còn lại mờ đi khi tắt trợ lý — vẫn xem được luật nhưng biết là không chạy */}
      <div className={cn("space-y-5", off && "pointer-events-none opacity-50")}>
        {/* ===== SÀN DỮ LIỆU (Lớp 1) ===== */}
        <Card>
          <CardHeader>
            <CardTitle>Sàn dữ liệu — chưa đủ thì không phán xét</CardTitle>
            <CardDescription>
              GMV Max luôn cần thời gian test video mới. Đặt sàn để trợ lý không
              giết nhầm video chưa kịp có dữ liệu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuleRow>
              <span>Chỉ xét video đã tiêu tối thiểu</span>
              <VndInput
                value={config.dataFloor.minSpend}
                onChange={(minSpend) =>
                  onChange({ ...config, dataFloor: { ...config.dataFloor, minSpend } })
                }
                disabled={off}
                ariaLabel="Sàn chi tiêu tối thiểu"
              />
              <span>và đã chạy đủ</span>
              <NumberInput
                value={config.dataFloor.minHours}
                onChange={(minHours) =>
                  onChange({ ...config, dataFloor: { ...config.dataFloor, minHours } })
                }
                disabled={off}
                ariaLabel="Số giờ chạy tối thiểu"
                suffix="giờ"
              />
            </RuleRow>
          </CardContent>
        </Card>

        {/* ===== NHÓM QUY TẮC 1: LOẠI TRỪ THẲNG TAY ===== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldX className="size-4.5 text-red-500" />
              Quy tắc 1 — Tự động loại trừ thẳng tay
            </CardTitle>
            <CardDescription>
              Video vi phạm BẤT KỲ điều kiện nào dưới đây sẽ bị trợ lý tự chuyển
              sang trạng thái &quot;Đã loại trừ&quot; (kèm lý do, khôi phục được).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuleRow>
              <span>Chi tiêu vượt</span>
              <VndInput
                value={config.hard.spendNoOrder}
                onChange={(spendNoOrder) =>
                  onChange({ ...config, hard: { ...config.hard, spendNoOrder } })
                }
                disabled={off}
                ariaLabel="Ngưỡng chi tiêu khi chưa có đơn"
              />
              <span>
                mà vẫn <b>0 đơn hàng</b>
              </span>
            </RuleRow>
            <RuleRow>
              <span>ROAS thấp hơn</span>
              <NumberInput
                value={config.hard.minRoas}
                onChange={(minRoas) =>
                  onChange({ ...config, hard: { ...config.hard, minRoas } })
                }
                disabled={off}
                ariaLabel="ROAS tối thiểu"
                step={0.1}
                suffix="x"
              />
            </RuleRow>
            <RuleRow>
              <span>Chi phí mỗi đơn (CPA) vượt trần</span>
              <VndInput
                value={config.hard.maxCpa}
                onChange={(maxCpa) =>
                  onChange({ ...config, hard: { ...config.hard, maxCpa } })
                }
                disabled={off}
                ariaLabel="Trần chi phí mỗi đơn"
              />
            </RuleRow>
          </CardContent>
        </Card>

        {/* ===== NHÓM QUY TẮC 2: GỬI CẢNH BÁO PHÊ DUYỆT ===== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="size-4.5 text-amber-500" />
              Quy tắc 2 — Gửi cảnh báo chờ phê duyệt
            </CardTitle>
            <CardDescription>
              Video vẫn ra đơn đều (chuyển đổi tốt) nhưng giá mỗi đơn quá đắt —
              trợ lý KHÔNG tự loại mà đưa vào danh sách chờ, Seller quyết định
              giữ lại hay loại trừ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuleRow>
              <span>Video có từ</span>
              <NumberInput
                value={config.review.minOrders}
                onChange={(minOrders) =>
                  onChange({ ...config, review: { ...config.review, minOrders } })
                }
                disabled={off}
                ariaLabel="Số đơn tối thiểu để coi là chuyển đổi tốt"
                suffix="đơn"
              />
              <span>trở lên, nhưng CPA vượt</span>
              <NumberInput
                value={config.review.overPct}
                onChange={(overPct) =>
                  onChange({ ...config, review: { ...config.review, overPct } })
                }
                disabled={off}
                ariaLabel="Phần trăm vượt CPA mục tiêu"
                suffix="%"
              />
              <span>so với CPA mục tiêu</span>
              <VndInput
                value={config.review.targetCpa}
                onChange={(targetCpa) =>
                  onChange({ ...config, review: { ...config.review, targetCpa } })
                }
                disabled={off}
                ariaLabel="CPA mục tiêu"
              />
            </RuleRow>
          </CardContent>
        </Card>
      </div>

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
