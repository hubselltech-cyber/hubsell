"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, MessageSquare, PackageX, Save } from "lucide-react";
import { toast } from "sonner";

import {
  fetchDeliveryFailConfig,
  fetchDeliveryFailLog,
  saveDeliveryFailConfig,
  type DeliveryFailChatStatus,
  type DeliveryFailConfigDTO,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { HintIcon } from "@/components/finance/hint-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TAB "CỨU ĐƠN GIAO THẤT BẠI" (anh Trung chốt tên 22/08).
 *
 * Worker backend quét Shopee mỗi giờ, đơn bị shipper báo giao thất bại 2 lượt
 * thì phát chuông + (tuỳ công tắc) tự nhắn khách qua cổng chat sẵn có. Tab này
 * chỉ là mặt cấu hình + nhật ký: 2 công tắc lưu ngay khi gạt, template chỉnh
 * xong bấm Lưu, bảng dưới là các đơn đã chạm ngưỡng.
 */

const TEMPLATE_VARS = ["{ten_khach}", "{ma_don}", "{ten_san_pham}"] as const;

const CHAT_STATUS_META: Record<
  DeliveryFailChatStatus,
  { label: string; className: string }
> = {
  NONE: { label: "Chưa nhắn", className: "bg-slate-100 text-slate-600" },
  SENT: { label: "Đã nhắn khách", className: "bg-emerald-100 text-emerald-700" },
  FAILED: { label: "Sàn từ chối", className: "bg-red-100 text-red-700" },
  SKIPPED: { label: "Bỏ qua", className: "bg-amber-100 text-amber-700" },
};

const QK_CONFIG = ["delivery-fail-config"] as const;
const QK_LOG = ["delivery-fail-log"] as const;

export function DeliveryFailTab() {
  const queryClient = useQueryClient();

  const configQuery = useApiQuery({
    queryKey: QK_CONFIG,
    queryFn: fetchDeliveryFailConfig,
  });
  const logQuery = useApiQuery({
    queryKey: QK_LOG,
    queryFn: fetchDeliveryFailLog,
    // Trang mở sẵn thì nhật ký tự tươi theo nhịp quét backend (mỗi giờ) —
    // poll thưa 5 phút là đủ, không cần nóng hơn.
    refetchInterval: 5 * 60 * 1000,
  });

  // Bản đang chỉnh trên màn — nạp từ server MỘT lần khi có data (không đè
  // template người dùng đang gõ dở mỗi lượt refetch nền).
  const [config, setConfig] = useState<DeliveryFailConfigDTO | null>(null);
  const loadedRef = useRef(false);
  useEffect(() => {
    if (configQuery.data && !loadedRef.current) {
      loadedRef.current = true;
      setConfig(configQuery.data);
    }
  }, [configQuery.data]);

  const [saving, setSaving] = useState(false);

  async function persist(next: DeliveryFailConfigDTO, successMessage: string) {
    setSaving(true);
    try {
      const saved = await saveDeliveryFailConfig(next);
      setConfig(saved);
      queryClient.setQueryData(QK_CONFIG, saved);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được cấu hình");
    } finally {
      setSaving(false);
    }
  }

  function toggleFlag(key: "alertEnabled" | "autoChatEnabled", value: boolean) {
    if (!config) return;
    const next = { ...config, [key]: value };
    setConfig(next);
    void persist(
      next,
      key === "alertEnabled"
        ? value
          ? "Đã BẬT cảnh báo giao thất bại — áp dụng từ lượt quét kế tiếp (mỗi giờ)."
          : "Đã tắt cảnh báo giao thất bại."
        : value
          ? "Đã BẬT tự nhắn khách khi phát hiện — dùng mẫu tin bên dưới."
          : "Đã tắt tự nhắn khách (chỉ còn cảnh báo)."
    );
  }

  function insertVar(v: string) {
    if (!config) return;
    setConfig({ ...config, chatTemplate: `${config.chatTemplate.trimEnd()} ${v}` });
  }

  const notices = logQuery.data?.notices ?? [];

  return (
    <div className="space-y-5">
      {/* ===== CẤU HÌNH: 2 CÔNG TẮC + MẪU TIN NHẮN =====
          (Tên + mô tả tính năng nằm ở nhãn tab — anh Trung chốt 22/08 bỏ khối
          header dài; ghi chú nợ tích hợp gói vào HintIcon cạnh switch chat.) */}
      <Card className="border-violet-200">
        <CardContent className="space-y-1">
          <div className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50">
            <BellRing className="mt-0.5 size-4.5 shrink-0 text-violet-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Cảnh báo cho chủ shop
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Phát chuông thông báo từng đơn ngay khi phát hiện + thẻ tổng hợp
                trên Trung tâm điều hành.
              </p>
            </div>
            <Switch
              checked={config?.alertEnabled ?? true}
              disabled={!config || saving}
              onCheckedChange={(v) => toggleFlag("alertEnabled", v)}
              aria-label="Bật/tắt cảnh báo giao thất bại"
            />
          </div>

          <div className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50">
            <MessageSquare className="mt-0.5 size-4.5 shrink-0 text-violet-600" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                Tự nhắn khách qua chat sàn
                {/* Bọc MỘT <span>: TooltipContent là inline-flex, fragment nhiều
                    mảnh sẽ bị xếp thành cột dọc vỡ bố cục. */}
                <HintIcon
                  hint={
                    <span>
                      Nợ tích hợp chờ làm: <b>Lazada</b> mới dừng ở cảnh báo —
                      sàn chưa có API cho shop chủ động nhắn nên chưa tự gửi tin
                      được; <b>TikTok Shop</b> chưa nối cảnh báo (chờ API). Sàn
                      mở API là cắm thêm vào đây.
                    </span>
                  }
                />
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Gửi mẫu tin bên dưới cho khách ngay khi phát hiện — chỉ Shopee.
                Khách chặn shop hoặc hết cửa sổ chat thì sàn từ chối — hệ thống
                ghi lại lý do và <b>không tự gửi lại</b>, chủ shop nhắn tay.
              </p>
            </div>
            <Switch
              checked={config?.autoChatEnabled ?? false}
              disabled={!config || saving}
              onCheckedChange={(v) => toggleFlag("autoChatEnabled", v)}
              aria-label="Bật/tắt tự nhắn khách khi giao thất bại"
            />
          </div>

          {/* ----- Mẫu tin nhắn ----- */}
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">Mẫu tin nhắn gửi khách</p>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVar(v)}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-slate-700 transition-colors hover:bg-violet-100"
                    title={`Chèn biến ${v} vào cuối mẫu`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={config?.chatTemplate ?? ""}
              onChange={(e) =>
                config && setConfig({ ...config, chatTemplate: e.target.value })
              }
              rows={3}
              disabled={!config}
              aria-label="Mẫu tin nhắn gửi khách khi giao thất bại"
              className="w-full rounded-lg border border-input bg-background p-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <div className="flex items-center gap-2">
              <p className={cn(TEXT_SUB, "flex-1")}>
                Xoá trắng rồi Lưu để quay về mẫu mặc định.
              </p>
              <Button
                size="sm"
                disabled={!config || saving}
                onClick={() =>
                  config && void persist(config, "Đã lưu mẫu tin nhắn giao thất bại.")
                }
              >
                <Save className="size-4" />
                Lưu mẫu tin
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== NHẬT KÝ ĐƠN ĐÃ CHẠM NGƯỠNG ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageX className="size-4.5 text-red-500" />
            Nhật ký đơn giao thất bại
          </CardTitle>
          <CardDescription>
            Mỗi đơn chỉ cảnh báo một lần, mới nhất xếp trên. Cột trạng thái cho
            biết hệ thống đã nhắn được khách hay chưa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logQuery.loading ? (
            <p className={TEXT_SUB}>Đang tải nhật ký…</p>
          ) : notices.length === 0 ? (
            <p className={TEXT_SUB}>
              Chưa có đơn nào chạm ngưỡng 2 lần giao không thành công — tin tốt!
              Danh sách sẽ tự cập nhật theo lượt quét mỗi giờ.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Đơn hàng</th>
                    <th className="py-2 pr-3 font-medium">Khách</th>
                    <th className="py-2 pr-3 font-medium">Gian</th>
                    <th className="py-2 pr-3 text-center font-medium">Lượt hỏng</th>
                    <th className="py-2 pr-3 font-medium">Phát hiện lúc</th>
                    <th className="py-2 font-medium">Nhắn khách</th>
                  </tr>
                </thead>
                <tbody>
                  {notices.map((n) => {
                    const meta = CHAT_STATUS_META[n.chatStatus];
                    return (
                      <tr key={n.id} className="border-b last:border-0 align-top">
                        <td className="py-2.5 pr-3 font-mono text-xs font-medium text-slate-900">
                          {n.orderCode}
                        </td>
                        <td className="py-2.5 pr-3">{n.customerName}</td>
                        <td className="py-2.5 pr-3 text-slate-600">{n.shopName}</td>
                        <td className="py-2.5 pr-3 text-center font-semibold tabular-nums text-red-600">
                          {/* 0 = sàn kết luận thất bại nhưng không cho số lượt (Lazada) */}
                          {n.failCount > 0 ? (
                            n.failCount
                          ) : (
                            <span
                              className="text-xs font-medium text-amber-700"
                              title="Sàn báo giao không thành công — Lazada không cung cấp số lượt giao"
                            >
                              Sàn báo
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums text-slate-600">
                          {formatDateTime(n.detectedAt)}
                        </td>
                        <td className="py-2.5">
                          <Badge className={cn("font-medium", meta.className)}>
                            {meta.label}
                          </Badge>
                          {n.chatStatus === "FAILED" && n.chatError ? (
                            <p className="mt-1 max-w-64 text-xs text-red-600">
                              {n.chatError}
                            </p>
                          ) : null}
                          {n.chatStatus === "SKIPPED" && n.chatError ? (
                            <p className="mt-1 text-xs text-slate-500">{n.chatError}</p>
                          ) : null}
                          {n.chatStatus === "SENT" && n.sentMessage ? (
                            <p
                              className="mt-1 max-w-64 truncate text-xs text-slate-500"
                              title={n.sentMessage}
                            >
                              “{n.sentMessage}”
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
