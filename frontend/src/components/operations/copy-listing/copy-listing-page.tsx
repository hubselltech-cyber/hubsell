"use client";

// ============================================================
// SAO CHÉP SẢN PHẨM — trang làm việc (docs/SAO-CHEP-SAN-PHAM.md mục 6)
//
// Tab "Sao chép": Bước 1 chọn nguồn (gian đã nối / kho Hubsell) → Bước 2 tick
// gian đích → "Xem trước" → bảng mỗi gian một dòng (danh mục gợi ý, ô còn thiếu
// tô vàng, giá/tồn) → "Đăng lên N gian" → trạng thái từng gian tự cập nhật.
// Tab "Lịch sử": các lượt đã chép, bấm mở lại bảng kết quả.
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
  createCopyListingJob,
  fetchCopyListingBrands,
  fetchCopyListingCategories,
  fetchCopyListingChannels,
  fetchCopyListingJob,
  fetchCopyListingJobs,
  fetchCopyListingSources,
  submitCopyListingJob,
  updateCopyListingSource,
  updateCopyListingTarget,
  type ChannelName,
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

export function CopyListingPage() {
  const [tab, setTab] = useState<Tab>("new");
  const [openJobId, setOpenJobId] = useState<string | null>(null);

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
            setOpenJobId(null);
          }}
        />
      </PageHeaderBand>

      {openJobId ? (
        <JobView jobId={openJobId} onBack={() => setOpenJobId(null)} />
      ) : tab === "new" ? (
        <NewCopy onCreated={(id) => setOpenJobId(id)} />
      ) : (
        <History onOpen={(id) => setOpenJobId(id)} />
      )}
    </OperationsFrame>
  );
}

// ---------------------------------------------------------------- Bước 1 + 2

function NewCopy({ onCreated }: { onCreated: (jobId: string) => void }) {
  const [sourceType, setSourceType] = useState<SourceType>("CHANNEL");
  const [sourceChannelId, setSourceChannelId] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<CopyListingSource | null>(null);
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

  // Mặc định chọn gian nguồn đầu tiên có sản phẩm.
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
    pageSize: 10,
  };
  const sourcesQ = useApiQuery({
    queryKey: qk.copyListingSources(sourceParams),
    queryFn: () => fetchCopyListingSources(sourceParams),
    enabled: sourceType === "PRODUCT" || Boolean(sourceChannelId),
  });

  const targetChannels = channels.filter((c) => !(sourceType === "CHANNEL" && c.id === sourceChannelId));
  const pageCount = sourcesQ.data ? Math.max(1, Math.ceil(sourcesQ.data.total / sourcesQ.data.pageSize)) : 1;

  async function create() {
    if (!picked) return;
    setCreating(true);
    try {
      const job = await createCopyListingJob({
        sourceType,
        sourceChannelId: sourceType === "CHANNEL" ? sourceChannelId : undefined,
        sourceItemId: sourceType === "CHANNEL" ? picked.key : undefined,
        sourceGroupKey: sourceType === "PRODUCT" ? picked.key : undefined,
        targetChannelIds: [...targets],
      });
      onCreated(job.id);
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
            <div className="text-sm font-semibold text-slate-900">1. Chọn sản phẩm nguồn</div>
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
                  onClick={() => {
                    setSourceType(key);
                    setPicked(null);
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm transition-colors",
                    sourceType === key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {sourceType === "CHANNEL" && (
              <NativeSelect
                className="w-72"
                value={sourceChannelId}
                onChange={(e) => {
                  setSourceChannelId(e.target.value);
                  setPicked(null);
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
                    <TableHead className="w-[4%]" />
                    <TableHead className="w-[56%]">Sản phẩm</TableHead>
                    <TableHead className="w-[12%] text-right">Phân loại</TableHead>
                    <TableHead className="w-[28%] text-right">Giá</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sourcesQ.data?.items ?? []).map((s) => {
                    const active = picked?.key === s.key;
                    return (
                      <TableRow
                        key={s.key}
                        className={cn("cursor-pointer", active && "bg-slate-50")}
                        onClick={() => setPicked(s)}
                      >
                        <TableCell>
                          <span
                            className={cn(
                              "flex size-4 items-center justify-center rounded-full border",
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
                  {sourcesQ.data && sourcesQ.data.items.length === 0 && (
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
          {sourcesQ.data && sourcesQ.data.total > sourcesQ.data.pageSize && (
            <div className="flex items-center justify-end gap-2">
              <span className={TEXT_SUB}>
                Trang {page}/{pageCount} · {formatNumber(sourcesQ.data.total)} sản phẩm
              </span>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Trước
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Sau
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bước 2 — gian đích */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="text-sm font-semibold text-slate-900">2. Chọn gian đích (được nhiều gian, nhiều sàn)</div>
          {targetChannels.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có gian nào khác để đăng — nối thêm gian ở trang Gian hàng.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {targetChannels.map((c) => (
                <TargetRow key={c.id} channel={c} checked={targets.has(c.id)} onToggle={() => {
                  setTargets((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                }} />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className={TEXT_SUB}>
              {picked ? `Nguồn: ${picked.title}` : "Chưa chọn sản phẩm nguồn"} · {targets.size} gian đích
            </span>
            <Button disabled={!picked || targets.size === 0 || creating} onClick={create}>
              {creating ? "Đang chuẩn bị…" : "Xem trước"}
            </Button>
          </div>
        </CardContent>
      </Card>
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

// ---------------------------------------------------------------- Xem trước + kết quả

function JobView({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const invalidate = useInvalidate();
  const jobQ = useApiQuery({ queryKey: qk.copyListingJob(jobId), queryFn: () => fetchCopyListingJob(jobId), staleTime: 0 });
  const job = jobQ.data;
  const running = Boolean(job?.targets.some((t) => t.status === "QUEUED" || t.status === "RUNNING"));

  // Đang đăng → hỏi lại mỗi 2 giây cho tới khi mọi gian có kết quả.
  const refetch = jobQ.refetch;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refetch(), 2000);
    return () => clearInterval(t);
  }, [running, refetch]);

  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!job) {
    return <p className="text-sm text-slate-500">{jobQ.error ? errorText(jobQ.error) : "Đang tải…"}</p>;
  }

  const ready = job.targets.filter((t) => (t.status === "PENDING" || t.status === "FAILED") && t.missing.length === 0);
  // Sửa tên/mô tả khi không gian nào đang đăng và còn gian chờ/lỗi (khớp luật backend).
  const editable = !running && job.targets.some((t) => t.status === "PENDING" || t.status === "FAILED");

  async function submit() {
    setSubmitting(true);
    try {
      const r = await submitCopyListingJob(job!.id);
      if (r.skipped.length > 0) {
        toast.warning(`Đã gửi ${r.queued} gian; ${r.skipped.length} gian còn thiếu thông tin nên chưa đăng.`);
      } else {
        toast.success(`Đã gửi đăng lên ${r.queued} gian.`);
      }
      await invalidate(qk.copyListingJob(job!.id), qk.copyListingJobs(1));
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
        <StatusChip {...JOB_STATUS[job.status]} />
        <span className={TEXT_SUB}>Tạo lúc {formatDateTime(job.createdAt)}</span>
      </div>

      <SourceCard job={job} editable={editable} />

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="text-sm font-semibold text-slate-900">Gian đích ({job.targets.length})</div>
            <div className="flex items-center gap-3">
              <span className={TEXT_SUB}>{ready.length} gian đủ điều kiện</span>
              <Button disabled={ready.length === 0 || submitting || running} onClick={submit}>
                {submitting ? "Đang gửi…" : running ? "Đang đăng…" : `Đăng lên ${ready.length} gian`}
              </Button>
            </div>
          </div>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[20%]">Gian hàng</TableHead>
                <TableHead className="w-[26%]">Danh mục sàn đích</TableHead>
                <TableHead className="w-[26%]">Còn thiếu</TableHead>
                <TableHead className="w-[12%] text-right">Giá · Tồn</TableHead>
                <TableHead className="w-[11%]">Trạng thái</TableHead>
                <TableHead className="w-[5%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {job.targets.map((t) => (
                <TargetRows
                  key={t.id}
                  job={job}
                  target={t}
                  expanded={expanded === t.id}
                  onToggle={() => setExpanded((cur) => (cur === t.id ? null : t.id))}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SourceCard({ job, editable }: { job: CopyListingJob; editable: boolean }) {
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(job.source.title);
  const [description, setDescription] = useState(job.source.description);
  const [saving, setSaving] = useState(false);
  const dirty = title !== job.source.title || description !== job.source.description;

  async function save() {
    setSaving(true);
    try {
      await updateCopyListingSource(job.id, { title, description });
      toast.success("Đã cập nhật tên và mô tả cho mọi gian đích.");
      await invalidate(qk.copyListingJob(job.id));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const s = job.source;
  return (
    <Card>
      <CardContent className="flex gap-5 p-5">
        <Thumb src={job.sourceImageUrl} alt={job.sourceTitle} size="size-24" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Nguồn</span>
            {job.sourceChannel ? (
              <>
                <ChannelChip channelName={job.sourceChannel.channelName} />
                <span className="text-sm text-slate-700">{job.sourceChannel.shopName}</span>
              </>
            ) : (
              <span className="text-sm text-slate-700">Kho Hubsell</span>
            )}
            <span className={TEXT_SUB}>
              · {s.variants.length} phân loại · {s.images.length} ảnh
              {s.options.length > 0 && ` · ${s.options.map((o) => `${o.name}: ${o.values.length}`).join(", ")}`}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s.variants.slice(0, 8).map((v) => (
              <span key={v.sku} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-700">
                {v.name ? `${v.name} · ` : ""}
                <span className="font-mono">{v.sku}</span>
                <CopyIconButton value={v.sku} what="mã SKU" />
              </span>
            ))}
            {s.variants.length > 8 && <span className={TEXT_SUB}>+{s.variants.length - 8} phân loại</span>}
            {editable && dirty && (
              <Button size="sm" className="ml-auto" disabled={saving} onClick={save}>
                {saving ? "Đang lưu…" : "Lưu tên & mô tả"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TargetRows({
  job,
  target: t,
  expanded,
  onToggle,
}: {
  job: CopyListingJob;
  target: CopyListingTarget;
  expanded: boolean;
  onToggle: () => void;
}) {
  const attrName = (id: string) => t.attributeDefs.find((d) => d.id === id)?.name;
  const canEdit = t.status === "PENDING" || t.status === "FAILED";
  const minPrice = Math.min(...job.source.variants.map((v) => v.price));
  const adjusted = Math.round((minPrice * (1 + t.priceAdjustPercent / 100)) / 100) * 100;
  const stock = t.stock ?? Math.min(...job.source.variants.map((v) => v.stock));

  return (
    <>
      <TableRow className={cn(expanded && "bg-slate-50/60")}>
        <TableCell>
          <div className="flex items-center gap-2">
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
            <span className="text-sm text-emerald-500">Đủ điều kiện</span>
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
          <TableCell colSpan={6} className="bg-rose-50/60 py-2 text-sm text-red-500">
            {t.error}
          </TableCell>
        </TableRow>
      )}
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-slate-50/60 p-0">
            <TargetEditor job={job} target={t} canEdit={canEdit} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TargetEditor({ job, target: t, canEdit }: { job: CopyListingJob; target: CopyListingTarget; canEdit: boolean }) {
  const invalidate = useInvalidate();
  const [categories, setCategories] = useState<{ id: string; name: string; path: string[] }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
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

  const value = <K extends keyof CopyListingTargetPatch>(k: K): CopyListingTargetPatch[K] | CopyListingTarget[K & keyof CopyListingTarget] =>
    draft[k] !== undefined ? draft[k] : (t as unknown as CopyListingTargetPatch)[k];
  const attrs = { ...t.attributes, ...(draft.attributes ?? {}) };
  const dims = draft.dimensionsCm !== undefined ? draft.dimensionsCm : t.dimensionsCm;
  const logistics = draft.logisticIds ?? t.logisticIds;
  const req = t.requirements;
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    try {
      await updateCopyListingTarget(job.id, t.id, draft);
      setDraft({});
      await invalidate(qk.copyListingJob(job.id));
      toast.success(`Đã lưu ${t.channel.shopName}.`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
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
    <div className="space-y-4 px-5 py-4">
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
                    dimensionsCm: { length: dims?.length ?? 0, width: dims?.width ?? 0, height: dims?.height ?? 0, [k]: Number(e.target.value) || 0 },
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
      <div className="flex items-center justify-between">
        <span className={TEXT_SUB}>
          Giới hạn sàn: tên {req?.titleMin ?? "?"}–{req?.titleMax ?? "?"} ký tự · tối đa {req?.maxImages ?? "?"} ảnh ·{" "}
          {req?.maxOptions ?? "?"} nhóm phân loại · {req?.maxVariants ?? "?"} phân loại. Video, bảng size, chứng chỉ: bổ sung trên sàn sau khi đăng.
        </span>
        {canEdit && (
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "Đang lưu…" : "Lưu gian này"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Lịch sử

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const q = useApiQuery({ queryKey: qk.copyListingJobs(page), queryFn: () => fetchCopyListingJobs(page, 20) });
  const data = q.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <CardContent className="p-0">
        <Refreshing active={q.refreshing}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Sản phẩm nguồn</TableHead>
                <TableHead className="w-[32%]">Gian đích</TableHead>
                <TableHead className="w-[14%]">Trạng thái</TableHead>
                <TableHead className="w-[14%] text-right">Thời gian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((j) => (
                <TableRow key={j.id} className="cursor-pointer" onClick={() => onOpen(j.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Thumb src={j.sourceImageUrl} alt={j.sourceTitle} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-900">{j.sourceTitle}</div>
                        <div className={TEXT_SUB}>{j.sourceType === "CHANNEL" ? "Từ gian hàng" : "Từ kho Hubsell"}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {j.targets.map((t, i) => (
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
                    <StatusChip {...JOB_STATUS[j.status]} />
                  </TableCell>
                  <TableCell className={cn("text-right", TEXT_SUB)}>{formatDateTime(j.createdAt)}</TableCell>
                </TableRow>
              ))}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    Chưa có lượt sao chép nào.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Refreshing>
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-end gap-2 px-5 py-3">
            <span className={TEXT_SUB}>
              Trang {page}/{pageCount}
            </span>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Trước
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Sau
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
