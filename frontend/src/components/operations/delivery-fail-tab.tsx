"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  MessageSquare,
  PackageCheck,
  PackageX,
  Save,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import {
  fetchDeliveryFailConfig,
  fetchDeliveryFailLog,
  saveDeliveryFailConfig,
  type DeliveryFailChatStatus,
  type DeliveryFailConfigDTO,
  type DeliveryFailOutcome,
} from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { CHANNEL_META } from "@/lib/channel-meta";
import { StatCard } from "@/components/dashboard/stat-card";
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
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TAB "CỨU ĐƠN GIAO THẤT BẠI" (anh Trung chốt tên 22/08).
 *
 * Worker backend quét Shopee mỗi giờ, đơn bị shipper báo giao KHÔNG thành công
 * (từ lượt đầu — 25/08 hạ ngưỡng: kiện SPX hay quay đầu ngay sau 1 lượt)
 * thì phát chuông + (tuỳ công tắc) tự nhắn khách qua cổng chat sẵn có. Tab này
 * là mặt cấu hình + báo cáo: dải StatCard (cùng khuôn thẻ chỉ số Tổng quan),
 * 2 công tắc lưu ngay khi gạt, mẫu tin chỉnh xong bấm Lưu, nhật ký dùng bộ
 * Table quy chuẩn — mọi thứ ăn theo design system, không tự chế kiểu riêng.
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

/** Nhãn + màu cho cột Kết quả của từng đơn từng bị cảnh báo. */
const OUTCOME_META: Record<DeliveryFailOutcome, { label: string; className: string }> = {
  saved: { label: "✓ Đã cứu", className: "bg-emerald-100 text-emerald-700" },
  lost: { label: "Hoàn/hủy", className: "bg-red-100 text-red-700" },
  pending: { label: "Đang giao lại", className: "bg-amber-100 text-amber-700" },
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

  // Tách BẢN SERVER (cfg — công tắc + template đã lưu) khỏi BẢN NHÁP template
  // đang gõ: gạt công tắc chỉ lưu cờ kèm template ĐÃ LƯU, không âm thầm lưu
  // luôn đoạn đang gõ dở; nút "Lưu mẫu tin" chỉ sáng khi nháp khác bản lưu.
  const [cfg, setCfg] = useState<DeliveryFailConfigDTO | null>(null);
  const [template, setTemplate] = useState("");
  const loadedRef = useRef(false);
  useEffect(() => {
    if (configQuery.data && !loadedRef.current) {
      loadedRef.current = true;
      setCfg(configQuery.data);
      setTemplate(configQuery.data.chatTemplate);
    }
  }, [configQuery.data]);

  const [saving, setSaving] = useState(false);
  const templateDirty = cfg !== null && template.trim() !== cfg.chatTemplate.trim();

  /** Lưu một bản cấu hình đầy đủ; trả bản server đã chốt (null nếu lỗi). */
  async function persist(
    next: DeliveryFailConfigDTO,
    successMessage: string
  ): Promise<DeliveryFailConfigDTO | null> {
    setSaving(true);
    try {
      const saved = await saveDeliveryFailConfig(next);
      setCfg(saved);
      queryClient.setQueryData(QK_CONFIG, saved);
      toast.success(successMessage);
      return saved;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lưu được cấu hình");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function toggleFlag(key: "alertEnabled" | "autoChatEnabled", value: boolean) {
    if (!cfg) return;
    const before = cfg;
    setCfg({ ...cfg, [key]: value }); // optimistic — switch nảy ngay
    const saved = await persist(
      { ...before, [key]: value },
      key === "alertEnabled"
        ? value
          ? "Đã bật cảnh báo giao thất bại — áp dụng từ lượt quét kế tiếp (mỗi giờ)."
          : "Đã tắt cảnh báo giao thất bại."
        : value
          ? "Đã bật tự nhắn khách — dùng mẫu tin bên dưới."
          : "Đã tắt tự nhắn khách (chỉ còn cảnh báo)."
    );
    if (!saved) setCfg(before); // lỗi mạng → trả switch về trạng thái cũ
  }

  async function saveTemplate() {
    if (!cfg) return;
    const saved = await persist(
      { ...cfg, chatTemplate: template },
      template.trim()
        ? "Đã lưu mẫu tin nhắn."
        : "Đã quay về mẫu tin mặc định."
    );
    if (saved) setTemplate(saved.chatTemplate);
  }

  function insertVar(v: string) {
    setTemplate((prev) => `${prev.trimEnd()} ${v}`.trimStart());
  }

  const notices = logQuery.data?.notices ?? [];
  const summary = logQuery.data?.summary;
  // Tỷ lệ cứu tính trên đơn ĐÃ NGÃ NGŨ (cứu + mất) — đơn đang giao chưa biết.
  const decided = (summary?.saved ?? 0) + (summary?.lost ?? 0);
  const saveRate =
    summary && decided > 0 ? Math.round((summary.saved / decided) * 100) : null;

  return (
    <div className="space-y-5">
      {/* ===== BÁO CÁO KẾT QUẢ CỨU ĐƠN — cùng khuôn thẻ chỉ số Tổng quan ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Đơn được cảnh báo"
          value={summary ? formatNumber(summary.total) : "—"}
          icon={BellRing}
          tone="neutral"
          subtitle="Toàn bộ lịch sử — mỗi đơn cảnh báo một lần"
        />
        <StatCard
          label="Cứu được"
          value={summary ? formatNumber(summary.saved) : "—"}
          icon={PackageCheck}
          tone="positive"
          colorValue
          subtitle={
            // Trung thực với công của mình (anh Trung 26/08): tách rõ phần đã
            // nhắn khách — phần còn lại là shipper tự giao lại thành công.
            saveRate !== null
              ? `Tỷ lệ cứu ${saveRate}% — đã nhắn khách ${formatNumber(summary?.savedMessaged ?? 0)}/${formatNumber(summary?.saved ?? 0)} đơn`
              : "Giao thành công, không hoàn (số tham khảo)"
          }
        />
        <StatCard
          label="Mất đơn"
          value={summary ? formatNumber(summary.lost) : "—"}
          icon={PackageX}
          tone="negative"
          colorValue
          subtitle={
            summary && summary.pending > 0
              ? `Hoàn hoặc hủy — còn ${formatNumber(summary.pending)} đơn đang giao lại`
              : "Hoàn hoặc hủy sau cảnh báo"
          }
        />
        <StatCard
          label="Doanh thu giữ lại"
          value={summary ? <Money value={summary.savedRevenue} /> : "—"}
          icon={Wallet}
          tone="positive"
          subtitle="Tổng giá trị các đơn cứu được"
        />
      </div>

      {/* ===== CẤU HÌNH: 2 CÔNG TẮC + MẪU TIN NHẮN =====
          (Tên + mô tả tính năng nằm ở nhãn tab — anh Trung chốt 22/08 bỏ khối
          header dài; ghi chú nợ tích hợp gói vào HintIcon cạnh switch chat.) */}
      <Card>
        <CardContent className="space-y-1">
          <div className="flex items-start gap-3.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
              <BellRing className="size-5 text-violet-600" />
            </div>
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
              checked={cfg?.alertEnabled ?? true}
              disabled={!cfg || saving}
              onCheckedChange={(v) => void toggleFlag("alertEnabled", v)}
              aria-label="Bật/tắt cảnh báo giao thất bại"
            />
          </div>

          <div className="flex items-start gap-3.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
              <MessageSquare className="size-5 text-violet-600" />
            </div>
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
              checked={cfg?.autoChatEnabled ?? false}
              disabled={!cfg || saving}
              onCheckedChange={(v) => void toggleFlag("autoChatEnabled", v)}
              aria-label="Bật/tắt tự nhắn khách khi giao thất bại"
            />
          </div>

          {/* ----- Mẫu tin nhắn ----- */}
          <div className="mt-1 space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">
                Mẫu tin nhắn gửi khách
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className={TEXT_SUB}>Chèn biến:</span>
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVar(v)}
                    disabled={!cfg}
                    className="rounded-md border border-slate-200 bg-background px-1.5 py-0.5 font-mono text-[11px] text-slate-700 shadow-xs transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    title={`Chèn biến ${v} vào cuối mẫu`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={3}
              disabled={!cfg}
              aria-label="Mẫu tin nhắn gửi khách khi giao thất bại"
              className="w-full resize-y rounded-lg border border-input bg-background p-2.5 text-sm leading-relaxed shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <div className="flex items-center gap-2">
              <p className={cn(TEXT_SUB, "flex-1")}>
                {templateDirty
                  ? "Mẫu tin có thay đổi chưa lưu."
                  : "Xoá trắng rồi Lưu để quay về mẫu mặc định."}
              </p>
              <Button
                size="sm"
                disabled={!cfg || saving || !templateDirty}
                onClick={() => void saveTemplate()}
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
            Mỗi đơn chỉ cảnh báo một lần, mới nhất xếp trên — bấm chuông thông
            báo cũng dẫn về đây.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {logQuery.loading ? (
            // Skeleton 3 dòng — giữ chiều cao ổn định, không nhảy layout
            <div className="space-y-2 px-5 pb-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : notices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 pt-2 pb-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50">
                <PackageCheck className="size-6 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-slate-900">
                Chưa có đơn nào giao thất bại
              </p>
              <p className={cn(TEXT_SUB, "max-w-sm")}>
                Hệ thống đang canh mỗi giờ. Đơn chạm ngưỡng sẽ hiện ở đây kèm
                chuông thông báo — anh chị không cần mở trang chờ.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Đơn hàng</TableHead>
                  <TableHead>Gian hàng</TableHead>
                  <TableHead>Khách</TableHead>
                  <TableHead className="text-center">Lượt hỏng</TableHead>
                  <TableHead>Phát hiện lúc</TableHead>
                  <TableHead>Kết quả</TableHead>
                  <TableHead>Nhắn khách</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notices.map((n) => {
                  const chat = CHAT_STATUS_META[n.chatStatus];
                  const outcome = OUTCOME_META[n.outcome];
                  const channel = CHANNEL_META[n.channelName];
                  return (
                    <TableRow key={n.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {n.orderCode}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={channel.className}>
                            {channel.label}
                          </Badge>
                          <span className="text-slate-600">{n.shopName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {n.customerName}
                      </TableCell>
                      <TableCell className="text-center">
                        {/* 0 = sàn kết luận thất bại nhưng không cho số lượt (Lazada) */}
                        {n.failCount > 0 ? (
                          <span className="font-semibold tabular-nums text-red-600">
                            {n.failCount}
                          </span>
                        ) : (
                          <span
                            className="text-xs font-medium text-amber-700"
                            title="Sàn báo giao không thành công — Lazada không cung cấp số lượt giao"
                          >
                            Sàn báo
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-slate-600">
                        {formatDateTime(n.detectedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge className={outcome.className}>{outcome.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Badge className={chat.className}>{chat.label}</Badge>
                        {n.chatStatus === "FAILED" && n.chatError ? (
                          <p className="mt-1 max-w-64 text-xs text-red-600">
                            {n.chatError}
                          </p>
                        ) : null}
                        {n.chatStatus === "SKIPPED" && n.chatError ? (
                          <p className="mt-1 max-w-64 text-xs text-slate-500">
                            {n.chatError}
                          </p>
                        ) : null}
                        {n.chatStatus === "SENT" && n.sentMessage ? (
                          <p
                            className="mt-1 max-w-64 truncate text-xs text-slate-500"
                            title={n.sentMessage}
                          >
                            “{n.sentMessage}”
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
