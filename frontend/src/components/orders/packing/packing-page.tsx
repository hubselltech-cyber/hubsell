"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Loader2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/shell/app-shell";
import { ScanCodeBox } from "@/components/shared/scan-code-box";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import {
  ApiError,
  scanPacking,
  unmarkPacking,
  type PackingScanResponse,
} from "@/lib/api";
import { beep } from "@/lib/beep";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useInvalidate } from "@/lib/use-api-query";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * MÀN QUÉT ĐÓNG GÓI (01/11/2026, anh Trung chốt luồng gọn)
 *
 * Chỉ một việc: in phiếu xong, gói xong, cầm điện thoại / máy quét bắn lại
 * từng kiện → đơn nhảy sang chip "Đã đóng gói" ở trang Đơn hàng; đơn ĐÃ HỦY bị
 * chặn ngay để bỏ kiện lại, không đưa ship. Biên bản bàn giao KHÔNG lập ở đây:
 * về trang Đơn hàng → chip Đã đóng gói → tích tất cả → "Tạo biên bản bàn giao".
 *
 * Khung kết quả to + tiếng bíp vì người gói nhìn kiện, không nhìn màn hình.
 */

interface ScanLog {
  at: string;
  code: string;
  res: PackingScanResponse | null;
  error?: string;
}

type Kind = "ok" | "warn" | "dup" | "reject";

const RESULT_STYLE: Record<
  Kind,
  {
    box: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  ok: {
    box: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100",
    label: "ĐÃ ĐÓNG GÓI",
    icon: CheckCircle2,
  },
  warn: {
    box: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
    label: "ĐÃ ĐÓNG GÓI · CÓ LƯU Ý",
    icon: AlertTriangle,
  },
  dup: {
    box: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
    label: "KIỆN NÀY ĐÃ QUÉT RỒI",
    icon: AlertTriangle,
  },
  reject: {
    box: "border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100",
    label: "KHÔNG ĐƯA SHIP",
    icon: Ban,
  },
};

function kindOf(res: PackingScanResponse): Kind {
  if (res.result === "REJECTED") return "reject";
  if (res.result === "ALREADY_PACKED") return "dup";
  return res.warnings.length > 0 ? "warn" : "ok";
}

export function PackingPage() {
  const [logs, setLogs] = React.useState<ScanLog[]>([]);
  const [unmarking, setUnmarking] = React.useState<string | null>(null);
  const invalidate = useInvalidate();

  const packedCount = logs.filter((l) => l.res?.result === "PACKED").length;
  const last = logs[0];

  const onScan = React.useCallback(
    async (code: string) => {
      const at = new Date().toISOString();
      try {
        const res = await scanPacking(code);
        const kind = kindOf(res);
        if (kind === "reject") beep.error();
        else if (kind === "dup") beep.dup();
        else beep.ok();
        setLogs((prev) => [{ at, code, res }, ...prev].slice(0, 50));
        if (res.result === "PACKED") void invalidate(["orders"]);
      } catch (err) {
        beep.error();
        const message =
          err instanceof ApiError ? err.message : "Không quét được";
        setLogs((prev) =>
          [{ at, code, res: null, error: message }, ...prev].slice(0, 50),
        );
        throw err;
      }
    },
    [invalidate],
  );

  /** Quét nhầm kiện → bỏ dấu ngay tại dòng vừa quét (chỉ khi chưa lên biên bản). */
  async function handleUnmark(log: ScanLog) {
    const o = log.res?.order;
    if (!o) return;
    setUnmarking(o.id);
    try {
      await unmarkPacking(o.id);
      toast.success(`Đã bỏ dấu đóng gói đơn ${o.orderCode}`);
      setLogs((prev) => prev.filter((l) => l !== log));
      void invalidate(["orders"]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không bỏ dấu được");
    } finally {
      setUnmarking(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeaderBand className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              In phiếu xong, gói xong thì <b>quét lại từng kiện</b> — đơn nhảy
              sang <b>Đã đóng gói</b>, đơn đã hủy bị chặn ngay để bỏ lại. Lập
              biên bản bàn giao ở trang Đơn hàng: chip Đã đóng gói → tích tất cả
              → Tạo biên bản bàn giao.
            </p>
            <Link
              href="/orders?tab=processed"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <ArrowLeft className="size-4" />
              Về Đơn hàng
            </Link>
          </div>
        </PageHeaderBand>

        <Card className="shadow-sm">
          <CardContent className="py-1">
            <ScanCodeBox
              onScan={onScan}
              keepCameraOpen
              ariaLabel="Quét mã kiện đã đóng gói"
              placeholder="Bắn máy quét vào đây, hoặc gõ mã vận đơn / mã đơn rồi Enter…"
              hint="Máy quét bắn xong là tự ghi — không cần bấm gì. Camera điện thoại quét liên tục, không phải bật lại mỗi kiện. Tiếng bíp cao = đã ghi, hai tiếng trầm = KHÔNG đưa ship."
            />
          </CardContent>
        </Card>

        {last && <LastScanPanel log={last} />}

        {logs.length > 0 && (
          <Card className="shadow-sm">
            <CardContent className="py-1">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">Lượt quét gần đây</p>
                <p className={TEXT_SUB}>
                  {formatNumber(packedCount)} kiện ghi được từ khi mở trang
                </p>
              </div>
              <ul className="divide-y text-sm">
                {logs.slice(0, 30).map((l, i) => {
                  const kind = l.res ? kindOf(l.res) : "reject";
                  const Icon = RESULT_STYLE[kind].icon;
                  const o = l.res?.order;
                  return (
                    <li
                      key={`${l.at}-${i}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
                    >
                      <span className={cn(TEXT_SUB, "w-12 tabular-nums")}>
                        {formatDateTime(l.at).slice(0, 5)}
                      </span>
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          kind === "ok"
                            ? "text-emerald-600"
                            : kind === "reject"
                              ? "text-rose-600"
                              : "text-amber-600",
                        )}
                      />
                      <span className="font-mono font-medium">
                        {o?.orderCode ?? l.code}
                      </span>
                      <span className={cn(TEXT_SUB, "min-w-0 flex-1 truncate")}>
                        {l.res
                          ? (l.res.reasonText ??
                            (kind === "dup"
                              ? `đã quét lúc ${o?.packingDoneAt ? formatDateTime(o.packingDoneAt) : "trước đó"}`
                              : `${o?.carrierLabel} · ${o?.customerName}`))
                          : l.error}
                      </span>
                      {l.res?.result === "PACKED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={unmarking !== null}
                          onClick={() => handleUnmark(l)}
                          title="Quét nhầm — bỏ dấu đã đóng gói"
                        >
                          {unmarking === o?.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Undo2 className="size-4" />
                          )}
                          Bỏ dấu
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function LastScanPanel({ log }: { log: ScanLog }) {
  const kind: Kind = log.res ? kindOf(log.res) : "reject";
  const style = RESULT_STYLE[kind];
  const Icon = style.icon;
  const o = log.res?.order;
  return (
    <div
      className={cn("rounded-xl border-2 px-5 py-4", style.box)}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Icon className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">
            {log.res ? style.label : "KHÔNG QUÉT ĐƯỢC"}
          </p>
          {o ? (
            <p className="mt-0.5 text-base">
              <span className="font-mono font-semibold">{o.orderCode}</span>
              {" · "}
              {CHANNEL_META[o.channel.channelName]?.label ??
                o.channel.channelName}{" "}
              {o.channel.shopName}
              {" · "}
              {o.carrierLabel}
              {o.trackingCode ? ` · ${o.trackingCode}` : ""}
              {" · "}
              {o.customerName}
            </p>
          ) : (
            <p className="mt-0.5 text-base">
              Mã <span className="font-mono font-semibold">{log.code}</span> —{" "}
              {log.error}
            </p>
          )}
          {log.res?.reasonText && (
            <p className="mt-1 text-base font-semibold">{log.res.reasonText}</p>
          )}
          {log.res?.result === "ALREADY_PACKED" && o?.packingDoneAt && (
            <p className="mt-1 text-sm">
              Đã quét lúc {formatDateTime(o.packingDoneAt)}.
            </p>
          )}
          {log.res && log.res.warningTexts.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
              {log.res.warningTexts.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
