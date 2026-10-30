"use client";

// ============================================================
// ĐỢT: xem trước + kết quả. Bảng phân tầng: dòng sản phẩm (dải xám, nút Sửa bài đăng →
// source-editor.tsx) + mỗi gian một dòng (danh mục, chip còn thiếu / cảnh báo, giá·tồn,
// trạng thái, nút Bổ sung / Sửa / Xem → target-editor.tsx). Đang đăng thì tự nạp lại 2 giây.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ChevronUp, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorMessage, fetchCopyListingBatch, submitCopyListingBatch, type CopyListingBatch, type CopyListingJob, type CopyListingTarget } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ChannelChip, EDIT_BTN_RED, PANEL, PANEL_CELL, ROW_ACTIVE, StatusChip, Thumb } from "./primitives";
import { activeVariantsOf, anyRunning, isOpen, missingLabel, splitListingError, TARGET_STATUS, WARNING_LABELS, type MissingContext } from "./shared";
import { SourceEditor } from "./source-editor";
import { TargetEditor } from "./target-editor";

const POLL_MS = 2000;

export function BatchView({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const invalidate = useInvalidate();
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const batchQ = useApiQuery({
    queryKey: qk.copyListingBatch(batchId),
    queryFn: () => fetchCopyListingBatch(batchId),
    staleTime: 0,
    refetchInterval: running ? POLL_MS : undefined,
  });
  const batch = batchQ.data;
  const allTargets = useMemo(() => batch?.jobs.flatMap((j) => j.targets) ?? [], [batch]);
  // Còn gian đang đăng → bật poll 2 giây (refetchInterval ở trên), xong thì tắt.
  const nowRunning = anyRunning(allTargets);
  useEffect(() => setRunning(nowRunning), [nowRunning]);

  if (!batch) {
    return <p className="text-sm text-slate-500">{batchQ.error ? batchQ.error : "Đang tải…"}</p>;
  }

  const ready = allTargets.filter((t) => isOpen(t) && t.missing.length === 0);
  const counts = {
    listed: allTargets.filter((t) => t.status === "LISTED").length,
    review: allTargets.filter((t) => t.status === "PENDING_REVIEW").length,
    failed: allTargets.filter((t) => t.status === "FAILED").length,
  };

  async function submit() {
    setSubmitting(true);
    try {
      const r = await submitCopyListingBatch(batch!.id);
      if (r.skipped.length > 0) {
        toast.warning(`Đã gửi ${r.queued} lượt; ${r.skipped.length} lượt còn thiếu thông tin nên chưa đăng.`);
      } else {
        toast.success(`Đã gửi đăng ${r.queued} lượt.`);
      }
      await invalidate(qk.copyListingBatch(batch!.id), qk.copyListingBatchesAll());
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" /> Quay lại
        </Button>
        <span className="text-sm text-slate-900">
          Đợt {batch.jobs.length} sản phẩm × {new Set(allTargets.map((t) => t.channel.id)).size} gian ={" "}
          <span className="font-semibold tabular-nums">{allTargets.length}</span> lượt đăng
        </span>
        <span className={TEXT_SUB}>· tạo lúc {formatDateTime(batch.createdAt)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {counts.listed > 0 && <StatusChip label={`Đã đăng ${counts.listed}`} className={TARGET_STATUS.LISTED.className} />}
          {counts.review > 0 && <StatusChip label={`Chờ sàn duyệt ${counts.review}`} className={TARGET_STATUS.PENDING_REVIEW.className} />}
          {counts.failed > 0 && <StatusChip label={`Lỗi ${counts.failed}`} className={TARGET_STATUS.FAILED.className} />}
          <span className={TEXT_SUB}>{ready.length} lượt đủ điều kiện</span>
          <Button disabled={ready.length === 0 || submitting || nowRunning} onClick={submit}>
            {submitting ? "Đang gửi…" : nowRunning ? "Đang đăng…" : `Đăng ${ready.length} lượt đủ điều kiện`}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[20%]">Sản phẩm · Gian hàng</TableHead>
                <TableHead className="w-[21%]">Danh mục sàn đích</TableHead>
                <TableHead className="w-[22%]">Còn thiếu</TableHead>
                <TableHead className="w-[11%] text-right">Giá · Tồn</TableHead>
                <TableHead className="w-[11%]">Trạng thái</TableHead>
                {/* 15%: nút "Sửa bài đăng" ~130px — 12% ở 1280 (113px) tràn 19px làm bảng cuộn ngang (đo 30/10). */}
                <TableHead className="w-[15%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.jobs.map((job) => (
                <BatchJobRows key={job.id} batch={batch} job={job} expanded={expanded} onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Một sản phẩm trong đợt: dòng tiêu đề (ảnh, tên, SKU, Sửa bài đăng) + mỗi gian một dòng. */
function BatchJobRows({
  batch,
  job,
  expanded,
  onToggle,
}: {
  batch: CopyListingBatch;
  job: CopyListingJob;
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  const sourceKey = `src:${job.id}`;
  const editable = !anyRunning(job.targets) && job.targets.some(isOpen);
  const s = job.source;
  const sourceOpen = expanded === sourceKey;
  return (
    <>
      {/* Dòng sản phẩm = dải tiêu đề đậm hơn các dòng gian; đang sửa bài → vạch trái accent. */}
      <TableRow className={cn("border-t-2 border-t-slate-200 bg-slate-100/70 hover:bg-slate-100/70", sourceOpen && ROW_ACTIVE)}>
        {/* whitespace-normal: ô bảng mặc định nowrap → dòng phân loại dài (17 màu) vẽ tràn sang cột bên, bảng sinh cuộn ngang (soi 30/10 ở 1280). */}
        <TableCell colSpan={5} className="whitespace-normal">
          <div className="flex items-center gap-3">
            <Thumb src={job.sourceImageUrl} alt={job.sourceTitle} size="size-9" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{s.title}</div>
              <div className={cn(TEXT_SUB, "flex flex-wrap items-center gap-x-2")}>
                {job.sourceChannel ? (
                  <span>
                    {CHANNEL_META[job.sourceChannel.channelName].label} · {job.sourceChannel.shopName}
                  </span>
                ) : (
                  <span>{job.sourceType === "MANUAL" ? "Tạo mới trong Hubsell" : "Kho Hubsell"}</span>
                )}
                <span>
                  · {s.variants.length} phân loại · {s.images.length} ảnh
                </span>
                {/* Nhóm đông giá trị (17 màu) chỉ ghi số lượng — chi tiết xem trong Sửa bài đăng. */}
                {s.options.length > 0 && (
                  <span>· {s.options.map((o) => `${o.name}: ${o.values.length > 4 ? `${o.values.length} giá trị` : o.values.join("/")}`).join(" · ")}</span>
                )}
                <span className="inline-flex items-center gap-1 font-mono">
                  {s.variants[0]?.sku}
                  {s.variants[0]?.sku && <CopyIconButton value={s.variants[0].sku} what="mã SKU" />}
                </span>
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right">
          {/* Anh chốt 30/10 ("chưa đủ độ, phải cho đỏ lên"): còn sửa được → nút ĐỎ đặc; chỉ "Xem" mới viền. */}
          <Button
            variant={sourceOpen ? "secondary" : editable ? "default" : "outline"}
            size="sm"
            className={cn("whitespace-nowrap", !sourceOpen && editable && EDIT_BTN_RED)}
            onClick={() => onToggle(sourceKey)}
          >
            {sourceOpen ? (
              <>
                <ChevronUp data-icon="inline-start" /> Thu gọn
              </>
            ) : (
              <>
                <Pencil data-icon="inline-start" /> {editable ? "Sửa bài đăng" : "Xem bài đăng"}
              </>
            )}
          </Button>
        </TableCell>
      </TableRow>
      {sourceOpen && (
        <TableRow className={cn("hover:bg-transparent", ROW_ACTIVE)}>
          <TableCell colSpan={6} className={PANEL_CELL}>
            <div className={PANEL}>
              <SourceEditor job={job} batchId={batch.id} editable={editable} />
            </div>
          </TableCell>
        </TableRow>
      )}
      {job.targets.map((t) => (
        <BatchTargetRows key={t.id} batch={batch} job={job} target={t} expanded={expanded === t.id} onToggle={() => onToggle(t.id)} />
      ))}
    </>
  );
}

function BatchTargetRows({
  batch,
  job,
  target: t,
  expanded,
  onToggle,
}: {
  batch: CopyListingBatch;
  job: CopyListingJob;
  target: CopyListingTarget;
  expanded: boolean;
  onToggle: () => void;
}) {
  const attrName = (id: string) => t.attributeDefs.find((d) => d.id === id)?.name;
  const canEdit = isOpen(t);
  const active = activeVariantsOf(job.source.variants);
  const priced = active.length ? active : job.source.variants;
  const minPrice = Math.min(...priced.map((v) => v.price));
  const adjusted = Math.round((minPrice * (1 + t.priceAdjustPercent / 100)) / 100) * 100;
  const stock = t.stock ?? Math.min(...priced.map((v) => v.stock));
  /** Số liệu cho nhãn "còn thiếu" (bao nhiêu / trần bao nhiêu) — luật mặc định sàn khi chưa có danh mục. */
  const req = t.requirements;
  const missingCtx: MissingContext = {
    variantCount: active.length,
    maxVariants: req?.maxVariants,
    optionCount: job.source.options.length,
    maxOptions: req?.maxOptions,
    maxOptionValues: req?.maxOptionValues,
    widestOption: Math.max(0, ...job.source.options.map((o) => o.values.length)),
    skuMissing: active.filter((v) => !v.sku.trim()).length,
  };

  return (
    <>
      <TableRow className={cn(expanded && ROW_ACTIVE)}>
        <TableCell>
          <div className="flex items-center gap-2 pl-6">
            <ChannelChip channelName={t.channel.channelName} />
            <span className={cn("truncate text-sm text-slate-900", expanded && "font-medium")}>{t.channel.shopName}</span>
          </div>
        </TableCell>
        <TableCell>
          {t.categoryName ? (
            <div className="min-w-0">
              <div className="truncate text-sm text-slate-900">{t.categoryName}</div>
              {t.categoryConfidence != null && <div className={TEXT_SUB}>Gợi ý · độ khớp {Math.round(t.categoryConfidence * 100)}%</div>}
            </div>
          ) : (
            <span className="text-sm text-amber-700">Chưa chọn</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1 whitespace-normal">
            {t.missing.length === 0 ? (
              canEdit ? <span className="text-sm text-emerald-500">Đủ điều kiện</span> : <span className={TEXT_SUB}>—</span>
            ) : (
              t.missing.map((m) => (
                <span key={m} className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] leading-snug text-amber-800">
                  {missingLabel(m, attrName, missingCtx)}
                </span>
              ))
            )}
            {canEdit &&
              (t.warnings ?? []).map((w) => (
                <span
                  key={w}
                  title={WARNING_LABELS[w]?.detail}
                  className="cursor-help rounded-md border border-dashed border-slate-300 bg-muted/60 px-1.5 py-0.5 text-[11px] leading-snug text-muted-foreground"
                >
                  {WARNING_LABELS[w]?.label ?? w}
                </span>
              ))}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <div className="text-sm">
            <Money value={adjusted} />
            {t.priceAdjustPercent !== 0 && (
              <span className={cn(TEXT_SUB, "ml-1")}>
                ({t.priceAdjustPercent > 0 ? "+" : ""}
                {t.priceAdjustPercent}%)
              </span>
            )}
          </div>
          <div className={TEXT_SUB}>Tồn {formatNumber(stock)}</div>
        </TableCell>
        <TableCell>
          <StatusChip {...TARGET_STATUS[t.status]} />
          {t.remoteItemId && <div className={cn(TEXT_SUB, "mt-1 font-mono")}>{t.remoteItemId}</div>}
        </TableCell>
        <TableCell className="text-right">
          {/* Còn thiếu thông tin → "Bổ sung" ĐỎ đặc (cùng độ nổi với Sửa bài đăng); đủ → "Sửa" đặc; đã đăng → "Xem" viền. */}
          <Button
            variant={expanded ? "secondary" : canEdit ? "default" : "outline"}
            size="sm"
            className={cn("whitespace-nowrap", !expanded && canEdit && t.missing.length > 0 && EDIT_BTN_RED)}
            onClick={onToggle}
          >
            {expanded ? (
              <>
                <ChevronUp data-icon="inline-start" /> Thu gọn
              </>
            ) : (
              <>
                <Pencil data-icon="inline-start" /> {canEdit ? (t.missing.length > 0 ? "Bổ sung" : "Sửa") : "Xem"}
              </>
            )}
          </Button>
        </TableCell>
      </TableRow>
      {t.error && <TargetErrorRow error={t.error} expanded={expanded} />}
      {expanded && (
        <TableRow className={cn("hover:bg-transparent", ROW_ACTIVE)}>
          <TableCell colSpan={6} className={PANEL_CELL}>
            <div className={PANEL}>
              <TargetEditor batch={batch} job={job} target={t} canEdit={canEdit} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** Dòng 1 tiếng Việt nói rõ sửa gì; nguyên văn sàn để nhỏ, mờ — khách gửi cho hỗ trợ khi cần. */
function TargetErrorRow({ error, expanded }: { error: string; expanded: boolean }) {
  const { text, detail } = splitListingError(error);
  return (
    <TableRow className={cn("hover:bg-transparent", expanded && ROW_ACTIVE)}>
      <TableCell colSpan={6} className="bg-rose-50/60 py-2 pl-10">
        <div className="whitespace-normal text-sm leading-snug text-red-500">{text}</div>
        {detail && (
          <details className="mt-0.5">
            <summary className="cursor-pointer select-none text-[11px] text-slate-500">Chi tiết kỹ thuật sàn trả về</summary>
            <div className="mt-0.5 whitespace-normal break-all font-mono text-[11px] text-slate-500">{detail}</div>
          </details>
        )}
      </TableCell>
    </TableRow>
  );
}
