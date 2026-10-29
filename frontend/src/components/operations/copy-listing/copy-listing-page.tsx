"use client";

// ============================================================
// SAO CHÉP SẢN PHẨM — trang làm việc (docs/SAO-CHEP-SAN-PHAM.md mục 6, 9)
//
// Tab "Sao chép": Bước 1 tick N sản phẩm nguồn (gian đã nối / kho Hubsell) →
// Bước 2 tick M gian đích (nhiều sàn, có TikTok) → "Xem trước" tạo một ĐỢT →
// bảng mỗi sản phẩm một khối, mỗi gian một dòng (danh mục gợi ý, ô còn thiếu
// tô vàng, giá/tồn), sửa một gian rồi "Áp cho sản phẩm còn lại" → "Đăng tất cả
// đủ điều kiện" → hàng đợi đăng lần lượt, trạng thái từng dòng tự cập nhật.
// Tab "Lịch sử": các đợt đã tạo, bấm mở lại.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Search } from "lucide-react";

import { OperationsFrame } from "@/components/operations/operations-frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeaderBand, PageTabs, type PageTabItem } from "@/components/ui/page-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Refreshing } from "@/components/shared/refreshing";
import {
  ApiError,
  applyCopyListingTargetToBatch,
  createCopyListingBatch,
  fetchCopyListingBatch,
  fetchCopyListingBatches,
  fetchCopyListingBrands,
  fetchCopyListingCategories,
  fetchCopyListingChannels,
  fetchCopyListingSources,
  submitCopyListingBatch,
  updateCopyListingSource,
  updateCopyListingTarget,
  type ChannelName,
  type CopyListingBatch,
  type CopyListingChannel,
  type CopyListingJob,
  type CopyListingSource,
  type CopyListingTarget,
  type CopyListingTargetPatch,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { JOB_STATUS, missingLabel, TARGET_STATUS } from "./labels";

type Tab = "new" | "history";
type SourceType = "CHANNEL" | "PRODUCT";

const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"];

function ChannelChip({ channelName, className }: { channelName: ChannelName; className?: string }) {
  const meta = CHANNEL_META[channelName];
  return (
    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium", meta.className, className)}>
      {meta.label}
    </span>
  );
}

function StatusChip({ label, className }: { label: string; className: string }) {
  return <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium", className)}>{label}</span>;
}

function Thumb({ src, alt, size = "size-10" }: { src: string | null; alt: string; size?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={cn("shrink-0 rounded-md border border-slate-200 object-cover", size)} />
  ) : (
    <div className={cn("shrink-0 rounded-md border border-dashed border-slate-200 bg-slate-50", size)} />
  );
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
}

function isOpen(t: CopyListingTarget): boolean {
  return t.status === "PENDING" || t.status === "FAILED";
}

export function CopyListingPage() {
  const [tab, setTab] = useState<Tab>("new");
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  const tabs: PageTabItem<Tab>[] = [
    { key: "new", label: "Sao chép" },
    { key: "history", label: "Lịch sử" },
  ];

  return (
    <OperationsFrame>
      <PageHeaderBand>
        <PageTabs
          ariaLabel="Khu vực Sao chép sản phẩm"
          className="border-b-0"
          tabs={tabs}
          value={tab}
          onChange={(key) => {
            setTab(key);
            setOpenBatchId(null);
          }}
        />
      </PageHeaderBand>

      {openBatchId ? (
        <BatchView batchId={openBatchId} onBack={() => setOpenBatchId(null)} />
      ) : tab === "new" ? (
        <NewCopy onCreated={(id) => setOpenBatchId(id)} />
      ) : (
        <History onOpen={(id) => setOpenBatchId(id)} />
      )}
    </OperationsFrame>
  );
}

// ---------------------------------------------------------------- Bước 1 + 2

function NewCopy({ onCreated }: { onCreated: (batchId: string) => void }) {
  const [sourceType, setSourceType] = useState<SourceType>("CHANNEL");
  const [sourceChannelId, setSourceChannelId] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  /** Số sản phẩm mỗi trang — khẩu vị bảng chuẩn: chọn được 10/20/50/100. */
  const [pageSize, setPageSize] = useState(20);
  /** Sản phẩm đã tick, giữ qua các trang / lần tìm. */
  const [picked, setPicked] = useState<Map<string, CopyListingSource>>(new Map());
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const channelsQ = useApiQuery({ queryKey: qk.copyListingChannels(), queryFn: fetchCopyListingChannels });
  const channels = useMemo(
    () =>
      [...(channelsQ.data?.items ?? [])].sort(
        (a, b) => PLATFORM_ORDER.indexOf(a.channelName) - PLATFORM_ORDER.indexOf(b.channelName) || a.shopName.localeCompare(b.shopName)
      ),
    [channelsQ.data]
  );

  useEffect(() => {
    if (!sourceChannelId && channels.length > 0) {
      const first = channels.find((c) => c.productCount > 0) ?? channels[0];
      setSourceChannelId(first.id);
    }
  }, [channels, sourceChannelId]);

  const sourceParams = {
    type: sourceType === "CHANNEL" ? ("channel" as const) : ("product" as const),
    channelId: sourceType === "CHANNEL" ? sourceChannelId : undefined,
    search: debounced,
    page,
    pageSize,
  };
  const sourcesQ = useApiQuery({
    queryKey: qk.copyListingSources(sourceParams),
    queryFn: () => fetchCopyListingSources(sourceParams),
    enabled: sourceType === "PRODUCT" || Boolean(sourceChannelId),
  });

  const targetChannels = channels.filter((c) => !(sourceType === "CHANNEL" && c.id === sourceChannelId));
  const pageCount = sourcesQ.data ? Math.max(1, Math.ceil(sourcesQ.data.total / sourcesQ.data.pageSize)) : 1;
  const pageItems = sourcesQ.data?.items ?? [];
  const allOnPagePicked = pageItems.length > 0 && pageItems.every((s) => picked.has(s.key));

  function togglePick(s: CopyListingSource) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(s.key)) next.delete(s.key);
      else next.set(s.key, s);
      return next;
    });
  }

  function resetSource(type: SourceType) {
    setSourceType(type);
    setPicked(new Map());
    setPage(1);
  }

  async function create() {
    if (picked.size === 0) return;
    setCreating(true);
    try {
      const batch = await createCopyListingBatch({
        sourceType,
        sourceChannelId: sourceType === "CHANNEL" ? sourceChannelId : undefined,
        sourceKeys: [...picked.keys()],
        targetChannelIds: [...targets],
      });
      if (batch.errors.length > 0) {
        toast.warning(`${batch.errors.length} sản phẩm không đọc được nguồn, đã bỏ qua.`);
      }
      onCreated(batch.id);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Bước 1 — nguồn */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-slate-900">1. Chọn sản phẩm nguồn (tick được nhiều)</div>
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              {(
                [
                  ["CHANNEL", "Từ gian hàng đã nối"],
                  ["PRODUCT", "Từ kho Hubsell"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => resetSource(key)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm transition-colors",
                    sourceType === key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {picked.size > 0 && (
              <span className="ml-auto inline-flex items-center gap-2 text-sm text-slate-700">
                Đã chọn <span className="font-semibold text-slate-900 tabular-nums">{picked.size}</span> sản phẩm
                <Button size="xs" variant="ghost" onClick={() => setPicked(new Map())}>
                  Bỏ chọn
                </Button>
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {sourceType === "CHANNEL" && (
              <NativeSelect
                className="w-72"
                value={sourceChannelId}
                onChange={(e) => {
                  setSourceChannelId(e.target.value);
                  setPicked(new Map());
                  setPage(1);
                  setTargets((prev) => {
                    const next = new Set(prev);
                    next.delete(e.target.value);
                    return next;
                  });
                }}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {CHANNEL_META[c.channelName].label} · {c.shopName} ({formatNumber(c.productCount)} SP)
                  </option>
                ))}
              </NativeSelect>
            )}
            <div className="relative w-80">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Tìm theo tên hoặc mã SKU"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <Refreshing active={sourcesQ.refreshing}>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[4%]">
                      <input
                        type="checkbox"
                        className="size-4 accent-slate-900"
                        aria-label="Chọn tất cả sản phẩm trên trang"
                        checked={allOnPagePicked}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Map(prev);
                            if (allOnPagePicked) pageItems.forEach((s) => next.delete(s.key));
                            else pageItems.forEach((s) => next.set(s.key, s));
                            return next;
                          })
                        }
                      />
                    </TableHead>
                    <TableHead className="w-[56%]">Sản phẩm</TableHead>
                    <TableHead className="w-[12%] text-right">Phân loại</TableHead>
                    <TableHead className="w-[28%] text-right">Giá</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((s) => {
                    const active = picked.has(s.key);
                    return (
                      <TableRow
                        key={s.key}
                        className={cn("cursor-pointer", active && "bg-slate-50")}
                        onClick={() => togglePick(s)}
                      >
                        <TableCell>
                          <span
                            className={cn(
                              "flex size-4 items-center justify-center rounded border",
                              active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
                            )}
                          >
                            {active && <Check className="size-3" />}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Thumb src={s.imageUrl} alt={s.title} />
                            <div className="min-w-0">
                              <div className="truncate text-sm text-slate-900">{s.title}</div>
                              <div className={cn(TEXT_SUB, "flex items-center gap-1 truncate")}>
                                <span className="truncate">{s.skus.slice(0, 3).join(" · ")}</span>
                                {s.skus.length > 3 && <span>+{s.skus.length - 3}</span>}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.variantCount}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.minPrice === s.maxPrice ? (
                            <Money value={s.minPrice} />
                          ) : (
                            <span>
                              <Money value={s.minPrice} /> – <Money value={s.maxPrice} />
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {sourcesQ.data && pageItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                        Không có sản phẩm nào khớp.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Refreshing>
          <PagerFooter
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            total={sourcesQ.data?.total ?? 0}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      {/* Bước 2 — gian đích */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="text-sm font-semibold text-slate-900">2. Chọn gian đích (được nhiều gian, nhiều sàn)</div>
          {targetChannels.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có gian nào khác để đăng — nối thêm gian ở trang Kênh bán.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {targetChannels.map((c) => (
                <TargetRow
                  key={c.id}
                  channel={c}
                  checked={targets.has(c.id)}
                  onToggle={() => {
                    setTargets((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className={TEXT_SUB}>
              {picked.size} sản phẩm × {targets.size} gian đích = {picked.size * targets.size} lượt đăng
            </span>
            <Button disabled={picked.size === 0 || targets.size === 0 || creating} onClick={create}>
              {creating ? "Đang chuẩn bị…" : "Xem trước"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** Chân bảng: trái = số dòng/trang + tổng, phải = Trang x/y Trước · Sau — luôn hiện. */
function PagerFooter({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {onPageSize && (
          <>
            <span className={TEXT_SUB}>Hiển thị</span>
            <NativeSelect className="w-24" value={String(pageSize)} onChange={(e) => onPageSize(Number(e.target.value))}>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / trang
                </option>
              ))}
            </NativeSelect>
          </>
        )}
        <span className={cn(TEXT_SUB, "tabular-nums")}>Tổng {formatNumber(total)} sản phẩm</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn(TEXT_SUB, "tabular-nums")}>
          Trang {page}/{pageCount}
        </span>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Trước
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  );
}

function TargetRow({ channel, checked, onToggle }: { channel: CopyListingChannel; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <input type="checkbox" className="size-4 accent-slate-900" checked={checked} onChange={onToggle} />
      <ChannelChip channelName={channel.channelName} />
      <span className="text-sm text-slate-900">{channel.shopName}</span>
      <span className={cn(TEXT_SUB, "ml-auto tabular-nums")}>
        {formatNumber(channel.productCount)} SP đang có{channel.apiConnected ? "" : " · gian giả lập"}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- Đợt: xem trước + kết quả

function BatchView({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const invalidate = useInvalidate();
  const batchQ = useApiQuery({
    queryKey: qk.copyListingBatch(batchId),
    queryFn: () => fetchCopyListingBatch(batchId),
    staleTime: 0,
  });
  const batch = batchQ.data;
  const allTargets = useMemo(() => batch?.jobs.flatMap((j) => j.targets) ?? [], [batch]);
  const running = allTargets.some((t) => t.status === "QUEUED" || t.status === "RUNNING");

  const refetch = batchQ.refetch;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refetch(), 2000);
    return () => clearInterval(t);
  }, [running, refetch]);

  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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
      await invalidate(qk.copyListingBatch(batch!.id), qk.copyListingBatches(1));
    } catch (err) {
      toast.error(errorText(err));
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
          {counts.review > 0 && (
            <StatusChip label={`Chờ sàn duyệt ${counts.review}`} className={TARGET_STATUS.PENDING_REVIEW.className} />
          )}
          {counts.failed > 0 && <StatusChip label={`Lỗi ${counts.failed}`} className={TARGET_STATUS.FAILED.className} />}
          <span className={TEXT_SUB}>{ready.length} lượt đủ điều kiện</span>
          <Button disabled={ready.length === 0 || submitting || running} onClick={submit}>
            {submitting ? "Đang gửi…" : running ? "Đang đăng…" : `Đăng ${ready.length} lượt đủ điều kiện`}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[22%]">Sản phẩm · Gian hàng</TableHead>
                <TableHead className="w-[24%]">Danh mục sàn đích</TableHead>
                <TableHead className="w-[26%]">Còn thiếu</TableHead>
                <TableHead className="w-[12%] text-right">Giá · Tồn</TableHead>
                <TableHead className="w-[11%]">Trạng thái</TableHead>
                <TableHead className="w-[5%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.jobs.map((job) => (
                <JobRows
                  key={job.id}
                  batch={batch}
                  job={job}
                  expanded={expanded}
                  onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Một sản phẩm trong đợt: dòng tiêu đề (ảnh, tên, SKU, sửa tên/mô tả) + mỗi gian một dòng. */
function JobRows({
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
  const running = job.targets.some((t) => t.status === "QUEUED" || t.status === "RUNNING");
  const editable = !running && job.targets.some(isOpen);
  const s = job.source;
  return (
    <>
      <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
        <TableCell colSpan={5}>
          <div className="flex items-center gap-3">
            <Thumb src={job.sourceImageUrl} alt={job.sourceTitle} size="size-9" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{s.title}</div>
              <div className={cn(TEXT_SUB, "flex flex-wrap items-center gap-x-2")}>
                {job.sourceChannel ? (
                  <span>
                    {CHANNEL_META[job.sourceChannel.channelName].label} · {job.sourceChannel.shopName}
                  </span>
                ) : (
                  <span>Kho Hubsell</span>
                )}
                <span>
                  · {s.variants.length} phân loại · {s.images.length} ảnh
                </span>
                {s.options.length > 0 && <span>· {s.options.map((o) => `${o.name}: ${o.values.join("/")}`).join(" · ")}</span>}
                <span className="inline-flex items-center gap-1 font-mono">
                  {s.variants[0]?.sku}
                  {s.variants[0]?.sku && <CopyIconButton value={s.variants[0].sku} what="mã SKU" />}
                </span>
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="icon"
            aria-label={expanded === sourceKey ? "Thu gọn" : "Sửa tên và mô tả"}
            onClick={() => onToggle(sourceKey)}
          >
            {expanded === sourceKey ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </TableCell>
      </TableRow>
      {expanded === sourceKey && (
        <TableRow>
          <TableCell colSpan={6} className="bg-slate-50/40 p-0">
            <SourceEditor job={job} batchId={batch.id} editable={editable} />
          </TableCell>
        </TableRow>
      )}
      {job.targets.map((t) => (
        <TargetRows
          key={t.id}
          batch={batch}
          job={job}
          target={t}
          expanded={expanded === t.id}
          onToggle={() => onToggle(t.id)}
        />
      ))}
    </>
  );
}

function SourceEditor({ job, batchId, editable }: { job: CopyListingJob; batchId: string; editable: boolean }) {
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(job.source.title);
  const [description, setDescription] = useState(job.source.description);
  const [saving, setSaving] = useState(false);
  const dirty = title !== job.source.title || description !== job.source.description;

  async function save() {
    setSaving(true);
    try {
      await updateCopyListingSource(job.id, { title, description });
      toast.success("Đã cập nhật tên và mô tả cho mọi gian đích của sản phẩm này.");
      await invalidate(qk.copyListingBatch(batchId));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-1">
        <div className={TEXT_TABLE_HEAD}>Tên sản phẩm ({title.trim().length} ký tự)</div>
        <Input value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <div className={TEXT_TABLE_HEAD}>Mô tả ({description.trim().length} ký tự)</div>
        <textarea
          className="min-h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          rows={2}
          value={description}
          disabled={!editable}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex items-end">
        {editable && (
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "Đang lưu…" : "Lưu tên & mô tả"}
          </Button>
        )}
      </div>
    </div>
  );
}

function TargetRows({
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
  const minPrice = Math.min(...job.source.variants.map((v) => v.price));
  const adjusted = Math.round((minPrice * (1 + t.priceAdjustPercent / 100)) / 100) * 100;
  const stock = t.stock ?? Math.min(...job.source.variants.map((v) => v.stock));

  return (
    <>
      <TableRow className={cn(expanded && "bg-slate-50/60")}>
        <TableCell>
          <div className="flex items-center gap-2 pl-6">
            <ChannelChip channelName={t.channel.channelName} />
            <span className="truncate text-sm text-slate-900">{t.channel.shopName}</span>
          </div>
        </TableCell>
        <TableCell>
          {t.categoryName ? (
            <div className="min-w-0">
              <div className="truncate text-sm text-slate-900">{t.categoryName}</div>
              {t.categoryConfidence != null && (
                <div className={TEXT_SUB}>Gợi ý · độ khớp {Math.round(t.categoryConfidence * 100)}%</div>
              )}
            </div>
          ) : (
            <span className="text-sm text-amber-700">Chưa chọn</span>
          )}
        </TableCell>
        <TableCell>
          {t.missing.length === 0 ? (
            isOpen(t) ? (
              <span className="text-sm text-emerald-500">Đủ điều kiện</span>
            ) : (
              <span className={TEXT_SUB}>—</span>
            )
          ) : (
            <div className="flex flex-wrap gap-1">
              {t.missing.map((m) => (
                <span key={m} className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                  {missingLabel(m, attrName)}
                </span>
              ))}
            </div>
          )}
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
          <Button variant="ghost" size="icon" aria-label={expanded ? "Thu gọn" : "Mở"} onClick={onToggle}>
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </TableCell>
      </TableRow>
      {t.error && (
        <TableRow>
          <TableCell colSpan={6} className="bg-rose-50/60 py-2 pl-10 text-sm text-red-500">
            {t.error}
          </TableCell>
        </TableRow>
      )}
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-slate-50/60 p-0">
            <TargetEditor batch={batch} job={job} target={t} canEdit={canEdit} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TargetEditor({
  batch,
  job,
  target: t,
  canEdit,
}: {
  batch: CopyListingBatch;
  job: CopyListingJob;
  target: CopyListingTarget;
  canEdit: boolean;
}) {
  const invalidate = useInvalidate();
  const [categories, setCategories] = useState<{ id: string; name: string; path: string[] }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<CopyListingTargetPatch>({});

  useEffect(() => {
    let alive = true;
    fetchCopyListingCategories(job.id, t.id, "")
      .then((r) => alive && setCategories(r.items))
      .catch(() => undefined);
    fetchCopyListingBrands(job.id, t.id, "", t.categoryId)
      .then((r) => alive && setBrands(r.items))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [job.id, t.id, t.categoryId]);

  const value = <K extends keyof CopyListingTargetPatch>(k: K): CopyListingTargetPatch[K] =>
    draft[k] !== undefined ? draft[k] : (t as unknown as CopyListingTargetPatch)[k];
  const attrs = { ...t.attributes, ...(draft.attributes ?? {}) };
  const dims = draft.dimensionsCm !== undefined ? draft.dimensionsCm : t.dimensionsCm;
  const logistics = draft.logisticIds ?? t.logisticIds;
  const req = t.requirements;
  const dirty = Object.keys(draft).length > 0;
  /** Số gian cùng gian hàng ở sản phẩm khác trong đợt còn chờ — nút "Áp cho sản phẩm còn lại". */
  const siblings = batch.jobs
    .filter((j) => j.id !== job.id)
    .flatMap((j) => j.targets)
    .filter((x) => x.channel.id === t.channel.id && isOpen(x)).length;

  async function save() {
    setSaving(true);
    try {
      await updateCopyListingTarget(job.id, t.id, draft);
      setDraft({});
      await invalidate(qk.copyListingBatch(batch.id));
      toast.success(`Đã lưu ${t.channel.shopName}.`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function applyToOthers() {
    setApplying(true);
    try {
      if (dirty) await updateCopyListingTarget(job.id, t.id, draft);
      setDraft({});
      const r = await applyCopyListingTargetToBatch(batch.id, t.id);
      await invalidate(qk.copyListingBatch(batch.id));
      toast.success(`Đã áp danh mục, thuộc tính, cân nặng… cho ${r.applied} sản phẩm còn lại trên ${t.channel.shopName}.`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setApplying(false);
    }
  }

  const missing = new Set(t.missing);
  const field = (label: string, code: string, node: React.ReactNode) => (
    <div className="space-y-1">
      <div className={cn(TEXT_TABLE_HEAD, missing.has(code) && "text-amber-700")}>
        {label}
        {missing.has(code) && " · còn thiếu"}
      </div>
      {node}
    </div>
  );
  const inputCls = (code: string) => cn(missing.has(code) && "border-amber-300 bg-amber-50/40");

  return (
    <div className="space-y-4 px-5 py-4 pl-10">
      <div className="grid gap-4 md:grid-cols-3">
        {field(
          "Danh mục",
          "category",
          <NativeSelect
            className={inputCls("category")}
            value={String(value("categoryId") ?? "")}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value || null }))}
          >
            <option value="">— Chọn danh mục —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path.join(" > ")}
              </option>
            ))}
          </NativeSelect>
        )}
        {(req?.brandRequired || t.brandId) &&
          field(
            "Thương hiệu",
            "brand",
            <NativeSelect
              className={inputCls("brand")}
              value={String(value("brandId") ?? "")}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, brandId: e.target.value || null }))}
            >
              <option value="">— Chọn thương hiệu —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          )}
        {field(
          "Cân nặng (gram)",
          "weight",
          <Input
            type="number"
            min={0}
            className={inputCls("weight")}
            value={value("weightGrams") ?? ""}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, weightGrams: e.target.value === "" ? null : Number(e.target.value) }))}
          />
        )}
        {field(
          "Kích thước kiện D × R × C (cm)",
          "dimensions",
          <div className="flex gap-2">
            {(["length", "width", "height"] as const).map((k) => (
              <Input
                key={k}
                type="number"
                min={0}
                className={inputCls("dimensions")}
                placeholder={k === "length" ? "Dài" : k === "width" ? "Rộng" : "Cao"}
                value={dims?.[k] || ""}
                disabled={!canEdit}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    dimensionsCm: {
                      length: dims?.length ?? 0,
                      width: dims?.width ?? 0,
                      height: dims?.height ?? 0,
                      [k]: Number(e.target.value) || 0,
                    },
                  }))
                }
              />
            ))}
          </div>
        )}
        {field(
          "Điều chỉnh giá so với nguồn (%)",
          "price",
          <Input
            type="number"
            min={-50}
            max={100}
            value={value("priceAdjustPercent") ?? 0}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, priceAdjustPercent: Number(e.target.value) || 0 }))}
          />
        )}
        {field(
          "Tồn đăng mỗi phân loại (trống = theo nguồn)",
          "stock",
          <Input
            type="number"
            min={0}
            value={value("stock") ?? ""}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value === "" ? null : Number(e.target.value) }))}
          />
        )}
        {t.attributeDefs.map((def) =>
          field(
            `${def.name}${def.required ? " *" : ""}`,
            `attr:${def.id}`,
            def.type === "select" ? (
              <NativeSelect
                className={inputCls(`attr:${def.id}`)}
                value={attrs[def.id] ?? ""}
                disabled={!canEdit}
                onChange={(e) => setDraft((d) => ({ ...d, attributes: { ...(d.attributes ?? {}), [def.id]: e.target.value } }))}
              >
                <option value="">— Chọn —</option>
                {(def.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                type={def.type === "number" ? "number" : "text"}
                className={inputCls(`attr:${def.id}`)}
                value={attrs[def.id] ?? ""}
                disabled={!canEdit}
                onChange={(e) => setDraft((d) => ({ ...d, attributes: { ...(d.attributes ?? {}), [def.id]: e.target.value } }))}
              />
            )
          )
        )}
      </div>
      {t.logisticOptions.length > 0 && (
        <div className="space-y-1">
          <div className={cn(TEXT_TABLE_HEAD, missing.has("logistics") && "text-amber-700")}>Kênh vận chuyển</div>
          <div className="flex flex-wrap gap-3">
            {t.logisticOptions.map((o) => (
              <label key={o.id} className={cn("flex items-center gap-1.5 text-sm", !o.enabled && "text-slate-400")}>
                <input
                  type="checkbox"
                  className="size-4 accent-slate-900"
                  disabled={!canEdit || !o.enabled}
                  checked={logistics.includes(o.id)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      logisticIds: e.target.checked ? [...logistics, o.id] : logistics.filter((x) => x !== o.id),
                    }))
                  }
                />
                {o.name}
                {!o.enabled && " (chưa bật trên sàn)"}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={TEXT_SUB}>
          Giới hạn sàn: tên {req?.titleMin ?? "?"}–{req?.titleMax ?? "?"} ký tự · tối đa {req?.maxImages ?? "?"} ảnh ·{" "}
          {req?.maxOptions ?? "?"} nhóm phân loại · {req?.maxVariants ?? "?"} phân loại. Video, bảng size, chứng chỉ: bổ sung trên
          sàn sau khi đăng.
        </span>
        {canEdit && (
          <div className="flex items-center gap-2">
            {siblings > 0 && (
              <Button size="sm" variant="outline" disabled={applying || saving} onClick={applyToOthers}>
                {applying ? "Đang áp…" : `Áp cho ${siblings} sản phẩm còn lại`}
              </Button>
            )}
            <Button size="sm" disabled={!dirty || saving || applying} onClick={save}>
              {saving ? "Đang lưu…" : "Lưu gian này"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Lịch sử (theo đợt)

function History({ onOpen }: { onOpen: (batchId: string) => void }) {
  const [page, setPage] = useState(1);
  const q = useApiQuery({ queryKey: qk.copyListingBatches(page), queryFn: () => fetchCopyListingBatches(page, 20) });
  const data = q.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <CardContent className="p-0">
        <Refreshing active={q.refreshing}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Đợt sao chép</TableHead>
                <TableHead className="w-[32%]">Gian đích</TableHead>
                <TableHead className="w-[14%]">Trạng thái</TableHead>
                <TableHead className="w-[14%] text-right">Thời gian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((b) => (
                <TableRow key={b.id} className="cursor-pointer" onClick={() => onOpen(b.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Thumb src={b.firstImageUrl} alt={b.firstTitle} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-900">
                          {b.firstTitle}
                          {b.productCount > 1 && <span className="text-slate-500"> +{b.productCount - 1} sản phẩm</span>}
                        </div>
                        <div className={TEXT_SUB}>
                          {b.sourceType === "CHANNEL" ? "Từ gian hàng" : "Từ kho Hubsell"} · {b.productCount} sản phẩm ×{" "}
                          {b.channelCount} gian
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {b.targets.map((t, i) => (
                        <span
                          key={i}
                          className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]", TARGET_STATUS[t.status].className)}
                        >
                          {CHANNEL_META[t.channelName].label} · {t.shopName}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusChip {...JOB_STATUS[b.status]} />
                  </TableCell>
                  <TableCell className={cn("text-right", TEXT_SUB)}>{formatDateTime(b.createdAt)}</TableCell>
                </TableRow>
              ))}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    Chưa có đợt sao chép nào.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Refreshing>
        <div className="border-t border-slate-100 px-5 py-3">
          <PagerFooter page={page} pageCount={pageCount} pageSize={20} total={data?.total ?? 0} onPage={setPage} />
        </div>
      </CardContent>
    </Card>
  );
}
