"use client";

// ============================================================
// SAO CHÉP SẢN PHẨM — trang làm việc (docs/SAO-CHEP-SAN-PHAM.md mục 6, 9)
//
// Tab "Sao chép": Bước 1 tick N sản phẩm nguồn (gian đã nối / kho Hubsell), hoặc
// "Tạo mới" soạn một sản phẩm từ đầu (manual-product-form.tsx, docs mục 24) →
// Bước 2 tick M gian đích (nhiều sàn, có TikTok) → "Xem trước" tạo một ĐỢT →
// bảng mỗi sản phẩm một khối, mỗi gian một dòng (danh mục gợi ý, ô còn thiếu
// tô vàng, giá/tồn), sửa một gian rồi "Áp cho sản phẩm còn lại" → "Đăng tất cả
// đủ điều kiện" → hàng đợi đăng lần lượt, trạng thái từng dòng tự cập nhật.
// Tab "Lịch sử": các đợt đã tạo, bấm mở lại.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronUp, Pencil, RefreshCw, Search } from "lucide-react";

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
  createCopyListingManualJob,
  getStoredUser,
  type CopyListingManualPayload,
  fetchCopyListingBatch,
  fetchCopyListingBatches,
  fetchCopyListingCategoryTree,
  fetchCopyListingChannels,
  fetchCopyListingSources,
  submitCopyListingBatch,
  syncCopyListingSources,
  updateCopyListingSource,
  updateCopyListingTarget,
  type ChannelName,
  type CopyListingBatch,
  type CopyListingCategoryNode,
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

import { canSeeFinancials } from "@/lib/permissions";

import { BrandCombobox } from "./brand-combobox";
import { ManualProductForm, type ManualFormSummary } from "./manual-product-form";
import { activeVariantsOf, JOB_STATUS, missingLabel, splitListingError, TARGET_STATUS, WARNING_LABELS, type MissingContext } from "./labels";

type Tab = "new" | "history";
type SourceType = "CHANNEL" | "PRODUCT" | "MANUAL";

const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"];

/**
 * Phân tầng vùng đang làm việc trong bảng đợt (anh góp ý "giao diện phẳng, khó nhìn khi
 * một sản phẩm đi nhiều gian"): dòng đang mở + khung sửa cùng nhận vạch trái accent
 * (`border-l-primary` → tự theo 3 theme) trên nền slate-100; khung sửa là thẻ trắng
 * nổi bên trong để tách khỏi các dòng gian không làm.
 */
const ROW_ACTIVE = "border-l-[3px] border-l-primary bg-slate-100/80 hover:bg-slate-100/80";
// whitespace-normal: ô bảng mặc định nowrap → mọi dòng dài trong khung sửa (17 màu, ghi chú) phải xuống dòng,
// không vẽ tràn ra ngoài làm bảng đợt sinh cuộn ngang (soi 30/10 ở 1280: tràn 555px).
const PANEL_CELL = "p-3 pl-9 whitespace-normal";
const PANEL = "rounded-xl border border-slate-200/80 bg-card p-5 shadow-sm whitespace-normal";

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
  /** Lọc gian: nguồn chọn sàn → gian; đích lọc theo sàn + tìm tên (khách nhiều gian). */
  const [sourcePlatform, setSourcePlatform] = useState<ChannelName | "">("");
  const [targetPlatform, setTargetPlatform] = useState<ChannelName | "ALL">("ALL");
  const [targetSearch, setTargetSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  /** Nguồn "Tạo mới": payload hợp lệ (null = chưa gửi được) + tóm tắt từ form. */
  const [manual, setManual] = useState<{ payload: CopyListingManualPayload | null; summary: ManualFormSummary }>({
    payload: null,
    summary: { variantCount: 0, blocker: "Nhập tên sản phẩm" },
  });
  const seesFinancials = canSeeFinancials(getStoredUser());
  const invalidate = useInvalidate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /** Kéo danh mục gian nguồn về ngay rồi nạp lại bảng (sản phẩm vừa đăng trên sàn). */
  async function syncSourceChannel() {
    if (!sourceChannelId) return;
    setSyncing(true);
    try {
      const r = await syncCopyListingSources(sourceChannelId);
      await invalidate(qk.copyListingChannels(), qk.copyListingSources({}).slice(0, 1));
      if (r.skipped) toast.info("Gian này vừa được kéo chưa tới 2 phút — danh sách đã là mới nhất.");
      else toast.success(`Đã lấy từ sàn: ${formatNumber(r.scanned)} sản phẩm, ${formatNumber(r.created)} mới, ${formatNumber(r.updated)} cập nhật.`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSyncing(false);
    }
  }

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
      setSourcePlatform(first.channelName);
    }
  }, [channels, sourceChannelId]);

  const platformsPresent = PLATFORM_ORDER.filter((p) => channels.some((c) => c.channelName === p));
  const sourceChoices = channels.filter((c) => !sourcePlatform || c.channelName === sourcePlatform);

  function pickSourceChannel(id: string) {
    setSourceChannelId(id);
    setPicked(new Map());
    setPage(1);
    setTargets((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

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
    enabled: sourceType === "PRODUCT" || (sourceType === "CHANNEL" && Boolean(sourceChannelId)),
  });

  const targetChannels = channels.filter((c) => !(sourceType === "CHANNEL" && c.id === sourceChannelId));
  const targetQ = targetSearch.trim().toLowerCase();
  const targetShown = targetChannels.filter(
    (c) => (targetPlatform === "ALL" || c.channelName === targetPlatform) && (!targetQ || c.shopName.toLowerCase().includes(targetQ))
  );
  const allShownTargeted = targetShown.length > 0 && targetShown.every((c) => targets.has(c.id));
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
    if (sourceType === "MANUAL" ? !manual.payload : picked.size === 0) return;
    setCreating(true);
    try {
      if (sourceType === "MANUAL") {
        const job = await createCopyListingManualJob({ listing: manual.payload!, targetChannelIds: [...targets] });
        onCreated(job.batchId);
        return;
      }
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
            <div className="text-sm font-semibold text-slate-900">
              {sourceType === "MANUAL" ? "1. Soạn sản phẩm mới" : "1. Chọn sản phẩm nguồn (tick được nhiều)"}
            </div>
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              {(
                [
                  ["CHANNEL", "Từ gian hàng đã nối"],
                  ["PRODUCT", "Từ kho Hubsell"],
                  ["MANUAL", "Tạo mới"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => resetSource(key)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm transition-colors",
                    sourceType === key ? "bg-primary text-primary-foreground" : "text-slate-700 hover:bg-slate-100"
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

          {sourceType === "MANUAL" ? (
            <ManualProductForm canSeeCost={seesFinancials} onChange={(payload, summary) => setManual({ payload, summary })} />
          ) : (
            <>
          <div className="flex flex-wrap gap-3">
            {sourceType === "CHANNEL" && (
              <>
                <NativeSelect
                  className="w-40"
                  aria-label="Chọn sàn nguồn"
                  value={sourcePlatform}
                  onChange={(e) => {
                    const p = e.target.value as ChannelName | "";
                    setSourcePlatform(p);
                    const first = channels.find((c) => (!p || c.channelName === p) && c.id === sourceChannelId) ?? channels.find((c) => !p || c.channelName === p);
                    if (first && first.id !== sourceChannelId) pickSourceChannel(first.id);
                  }}
                >
                  <option value="">Mọi sàn</option>
                  {platformsPresent.map((p) => (
                    <option key={p} value={p}>
                      {CHANNEL_META[p].label}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect className="w-72" aria-label="Chọn gian nguồn" value={sourceChannelId} onChange={(e) => pickSourceChannel(e.target.value)}>
                  {sourceChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {sourcePlatform ? "" : `${CHANNEL_META[c.channelName].label} · `}
                      {c.shopName} ({formatNumber(c.productCount)} SP)
                    </option>
                  ))}
                </NativeSelect>
                {/* Danh mục gian chỉ tự làm mới mỗi đêm → sản phẩm vừa đăng trên sàn phải bấm mới có (anh hỏi 30/10). */}
                <Button
                  variant="outline"
                  disabled={!sourceChannelId || syncing}
                  title="Sản phẩm mới đăng trên sàn tự về Hubsell mỗi đêm (3–5 giờ sáng). Vừa đăng xong thì bấm để lấy ngay."
                  onClick={syncSourceChannel}
                >
                  <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                  {syncing ? "Đang lấy…" : "Lấy sản phẩm mới từ sàn"}
                </Button>
              </>
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
                        className="size-4 accent-primary"
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
                              active ? "border-primary bg-primary text-primary-foreground" : "border-slate-300"
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
            </>
          )}
        </CardContent>
      </Card>

      {/* Bước 2 — gian đích */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-slate-900">2. Chọn gian đích (được nhiều gian, nhiều sàn)</div>
            {targets.size > 0 && (
              <span className="ml-auto inline-flex items-center gap-2 text-sm text-slate-700">
                Đã chọn <span className="font-semibold text-slate-900 tabular-nums">{targets.size}</span> gian
                <Button size="xs" variant="ghost" onClick={() => setTargets(new Set())}>
                  Bỏ chọn
                </Button>
              </span>
            )}
          </div>
          {targetChannels.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có gian nào khác để đăng — nối thêm gian ở trang Kênh bán.</p>
          ) : (
            <>
              {/* Lọc sàn → gian: khách nhiều gian không phải dò cả danh sách. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 p-0.5">
                  {(["ALL", ...platformsPresent] as const).map((p) => {
                    const n = p === "ALL" ? targetChannels.length : targetChannels.filter((c) => c.channelName === p).length;
                    if (n === 0) return null;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setTargetPlatform(p)}
                        className={cn(
                          "rounded-md px-3 py-1 text-sm transition-colors tabular-nums",
                          targetPlatform === p ? "bg-primary text-primary-foreground" : "text-slate-700 hover:bg-slate-100"
                        )}
                      >
                        {p === "ALL" ? "Tất cả" : CHANNEL_META[p].label} ({n})
                      </button>
                    );
                  })}
                </div>
                {targetChannels.length > 5 && (
                  <div className="relative w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input className="pl-8" placeholder="Tìm tên gian" value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                <label className="flex cursor-pointer items-center gap-3 bg-slate-50/60 px-4 py-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label="Chọn tất cả gian đang hiện"
                    checked={allShownTargeted}
                    disabled={targetShown.length === 0}
                    onChange={() =>
                      setTargets((prev) => {
                        const next = new Set(prev);
                        if (allShownTargeted) targetShown.forEach((c) => next.delete(c.id));
                        else targetShown.forEach((c) => next.add(c.id));
                        return next;
                      })
                    }
                  />
                  <span className={cn(TEXT_TABLE_HEAD, "tabular-nums")}>
                    Chọn tất cả {targetShown.length} gian đang hiện
                  </span>
                </label>
                {targetShown.length === 0 && (
                  <p className="px-4 py-3 text-sm text-slate-500">Không có gian nào khớp.</p>
                )}
                {targetShown.map((c) => (
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
            </>
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className={cn(TEXT_SUB, "tabular-nums")}>
              {sourceType === "MANUAL"
                ? manual.summary.blocker
                  ? `Sản phẩm mới: ${manual.summary.blocker}`
                  : `1 sản phẩm (${manual.summary.variantCount} phân loại) × ${targets.size} gian đích`
                : `${picked.size} sản phẩm × ${targets.size} gian đích = ${picked.size * targets.size} lượt đăng`}
            </span>
            <Button disabled={(sourceType === "MANUAL" ? !manual.payload : picked.size === 0) || targets.size === 0 || creating} onClick={create}>
              {creating ? "Đang chuẩn bị…" : sourceType === "MANUAL" ? "Tiếp: xem trước theo gian" : "Xem trước"}
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
            <NativeSelect className="w-32" value={String(pageSize)} onChange={(e) => onPageSize(Number(e.target.value))}>
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
      <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={onToggle} />
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
          {/* Anh chốt 30/10: nút sửa phải NỔI BẬT — còn sửa được thì nút đặc, chỉ "Xem" mới viền. */}
          <Button variant={sourceOpen ? "secondary" : editable ? "default" : "outline"} size="sm" className="whitespace-nowrap" onClick={() => onToggle(sourceKey)}>
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

/**
 * Khung "Sửa bài đăng": ảnh (bìa + phụ) bên trái · tên + mô tả rộng bên phải · bảng phân loại
 * bên dưới — xem tổng quát cả bài một lần rồi sửa. Giới hạn tên/mô tả gom từ luật các sàn đích.
 */
function SourceEditor({ job, batchId, editable }: { job: CopyListingJob; batchId: string; editable: boolean }) {
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(job.source.title);
  const [description, setDescription] = useState(job.source.description);
  /**
   * Giá / tồn / mã SKU / bỏ đăng từng phân loại đang sửa, theo vị trí trong source.variants (chỉ ô khách đã gõ).
   * 30/10: mã SKU sửa được (nguồn sàn không có mã người bán → "Thiếu SKU" mà khách không điền được);
   * ô Đăng bỏ bớt phân loại khi vượt trần sàn đích (17 màu × 3 = 51 > 50 của Shopee).
   */
  type VariantEdit = { price?: number; stock?: number; sku?: string; excluded?: boolean };
  const [variantEdits, setVariantEdits] = useState<Record<number, VariantEdit>>({});
  const [saving, setSaving] = useState(false);
  const s = job.source;
  const variantPatch = Object.entries(variantEdits)
    .map(([i, e]) => ({ index: Number(i), ...e }))
    .filter(
      (e) =>
        (e.price !== undefined && e.price !== s.variants[e.index]?.price) ||
        (e.stock !== undefined && e.stock !== s.variants[e.index]?.stock) ||
        (e.sku !== undefined && e.sku.trim() !== s.variants[e.index]?.sku) ||
        (e.excluded !== undefined && e.excluded !== Boolean(s.variants[e.index]?.excluded))
    );
  const dirty = title !== job.source.title || description !== job.source.description || variantPatch.length > 0;
  const setVariant = (i: number, k: "price" | "stock", raw: string) =>
    setVariantEdits((m) => ({ ...m, [i]: { ...(m[i] ?? {}), [k]: raw === "" ? 0 : Math.max(0, Number(raw) || 0) } }));
  const setVariantSku = (i: number, raw: string) => setVariantEdits((m) => ({ ...m, [i]: { ...(m[i] ?? {}), sku: raw } }));
  const variantExcluded = (i: number) => variantEdits[i]?.excluded ?? Boolean(s.variants[i]?.excluded);
  const toggleExcluded = (i: number) => setVariantEdits((m) => ({ ...m, [i]: { ...(m[i] ?? {}), excluded: !variantExcluded(i) } }));
  const variantSku = (i: number) => variantEdits[i]?.sku ?? s.variants[i]?.sku ?? "";
  const activeCount = s.variants.filter((_, i) => !variantExcluded(i)).length;
  const skuMissingCount = s.variants.filter((_, i) => !variantExcluded(i) && !variantSku(i).trim()).length;
  const skuDuplicate = (() => {
    const seen = new Set<string>();
    for (let i = 0; i < s.variants.length; i++) {
      if (variantExcluded(i)) continue;
      const k = variantSku(i).trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  })();
  /**
   * Tự đặt mã cho phân loại chưa có: chữ cái đầu các từ trong tên (≤6 ký tự, không dấu) + số thứ tự,
   * vd "TKBTNC-07". Khách sửa lại từng ô được; mã trùng gian đích thì bước xem trước vẫn báo.
   */
  function autoFillSkus() {
    const initials = title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join("")
      .slice(0, 6);
    const prefix = initials || "SP";
    const taken = new Set(s.variants.map((_, i) => variantSku(i).trim().toLowerCase()).filter(Boolean));
    setVariantEdits((m) => {
      const next = { ...m };
      let n = 0;
      s.variants.forEach((v, i) => {
        if ((next[i]?.sku ?? v.sku).trim()) return;
        let code: string;
        do {
          n += 1;
          code = `${prefix}-${String(n).padStart(2, "0")}`;
        } while (taken.has(code.toLowerCase()));
        taken.add(code.toLowerCase());
        next[i] = { ...(next[i] ?? {}), sku: code };
      });
      return next;
    });
  }
  const reqs = job.targets.map((t) => t.requirements).filter((r): r is NonNullable<typeof r> => r != null);
  const titleMin = reqs.length ? Math.max(...reqs.map((r) => r.titleMin)) : null;
  const titleMax = reqs.length ? Math.min(...reqs.map((r) => r.titleMax)) : null;
  const descMax = reqs.length ? Math.min(...reqs.map((r) => r.descriptionMax)) : null;
  const maxImages = reqs.length ? Math.min(...reqs.map((r) => r.maxImages)) : null;
  const titleLen = title.trim().length;
  const descLen = description.trim().length;
  const titleBad = (titleMin != null && titleLen < titleMin) || (titleMax != null && titleLen > titleMax);
  const descBad = descMax != null && descLen > descMax;

  async function save() {
    setSaving(true);
    try {
      await updateCopyListingSource(job.id, { title, description, ...(variantPatch.length ? { variants: variantPatch } : {}) });
      toast.success("Đã cập nhật bài đăng cho mọi gian đích của sản phẩm này.");
      await invalidate(qk.copyListingBatch(batchId));
      setVariantEdits({});
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
        {/* Ảnh bài đăng: ảnh đầu = bìa, các ảnh sau = ảnh phụ (lấy nguyên từ nguồn). */}
        <div className="space-y-2">
          <div className={TEXT_TABLE_HEAD}>
            Ảnh ({s.images.length}
            {maxImages != null && s.images.length > maxImages ? ` · sàn nhận ${maxImages} ảnh đầu` : ""})
          </div>
          {s.images.length === 0 ? (
            <p className="text-sm text-amber-700">Chưa có ảnh — sàn sẽ từ chối.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {s.images.slice(0, 9).map((url, i) => (
                <div key={url + i} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Ảnh ${i + 1}`} className="size-full object-cover" loading="lazy" />
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">Bìa</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {s.images.length > 9 && <div className={TEXT_SUB}>+{s.images.length - 9} ảnh nữa</div>}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2")}>
              <span>Tên sản phẩm</span>
              <span className={cn("font-normal tabular-nums", titleBad ? "text-amber-700" : "text-slate-500")}>
                {titleLen} ký tự{titleMin != null && titleMax != null ? ` · sàn đích nhận ${titleMin}–${titleMax}` : ""}
              </span>
            </div>
            <Input
              className={cn(titleBad && "border-amber-300 bg-amber-50/40")}
              value={title}
              disabled={!editable}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2")}>
              <span>Mô tả</span>
              <span className={cn("font-normal tabular-nums", descBad ? "text-amber-700" : "text-slate-500")}>
                {formatNumber(descLen)} ký tự{descMax != null ? ` · tối đa ${formatNumber(descMax)}` : ""}
              </span>
            </div>
            <textarea
              className={cn(
                "min-h-9 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
                descBad && "border-amber-300 bg-amber-50/40"
              )}
              rows={Math.min(14, Math.max(6, description.split("\n").length + 1))}
              value={description}
              disabled={!editable}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className={TEXT_SUB}>
              Shopee nhận chữ thuần; TikTok, Lazada giữ xuống dòng. Video không chép theo — bổ sung trên sàn sau khi đăng.
            </p>
          </div>
          {/* Ảnh chèn trong mô tả của nguồn: chép theo, ghép vào CUỐI mô tả trên gian đích. */}
          {s.descriptionImages.length > 0 && (
            <div className="space-y-1">
              <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2")}>
                <span>Ảnh trong mô tả ({s.descriptionImages.length})</span>
                <span className="font-normal text-slate-500">
                  chép theo, xếp cuối mô tả trên gian đích
                  {s.descriptionImages.length > 12 ? " · sàn nhận 12 ảnh đầu" : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {s.descriptionImages.slice(0, 12).map((url, i) => (
                  <div key={url + i} className="size-16 overflow-hidden rounded-lg border border-slate-200 bg-card">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Ảnh mô tả ${i + 1}`} className="size-full object-cover" loading="lazy" />
                  </div>
                ))}
                {s.descriptionImages.length > 12 && (
                  <div className={cn(TEXT_SUB, "flex size-16 items-center justify-center rounded-lg border border-dashed border-slate-200")}>
                    +{s.descriptionImages.length - 12}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Phân loại: SKU giữ nguyên (luật khớp mã); giá / tồn nguồn SỬA ĐƯỢC từng dòng (anh 29/10) — % giá và Tồn đăng ở dòng gian áp chồng lên. */}
      <div className="space-y-1">
        <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-x-2")}>
          <span>
            Phân loại ({activeCount} đăng{activeCount < s.variants.length ? ` · ${s.variants.length - activeCount} bỏ` : ""})
          </span>
          {s.options.length > 0 && (
            <span className="font-normal text-slate-500">{s.options.map((o) => `${o.name}: ${o.values.join(" / ")}`).join(" · ")}</span>
          )}
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={TEXT_SUB}>
              Gõ thẳng vào ô Mã SKU / Giá / Tồn để sửa. Bỏ tick cột Đăng để không đưa phân loại đó lên gian đích (khi vượt trần phân loại của sàn).
            </span>
            {skuMissingCount > 0 && (
              <span className="inline-flex items-center gap-2 text-sm text-amber-700">
                {skuMissingCount} phân loại chưa có mã SKU
                <Button size="xs" variant="outline" onClick={autoFillSkus}>
                  Tự đặt mã cho phân loại thiếu
                </Button>
              </span>
            )}
            {skuDuplicate && (
              <span className="text-sm text-amber-700" title={WARNING_LABELS.sku_duplicate.detail}>
                Có mã SKU trùng nhau — Shopee/TikTok vẫn đăng được, Lazada từ chối; nối kho từng phân loại cần mã riêng.
              </span>
            )}
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {editable && <TableHead className="w-[6%]">Đăng</TableHead>}
                <TableHead className={editable ? "w-[34%]" : "w-[40%]"}>Phân loại</TableHead>
                <TableHead className="w-[28%]">Mã SKU</TableHead>
                <TableHead className="w-[16%] text-right">Giá nguồn</TableHead>
                <TableHead className="w-[16%] text-right">Tồn nguồn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(editable ? s.variants : s.variants.slice(0, 12)).map((v, i) => {
                const price = variantEdits[i]?.price ?? v.price;
                const stock = variantEdits[i]?.stock ?? v.stock;
                const excluded = variantExcluded(i);
                const sku = variantSku(i);
                return (
                  <TableRow key={i} className={cn(excluded && "opacity-50")}>
                    {editable && (
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={`Đăng phân loại ${v.name ?? i + 1}`}
                          checked={!excluded}
                          onChange={() => toggleExcluded(i)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-normal text-sm text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        {/* Ảnh riêng của phân loại (ảnh màu) — chép sang gian đích: Shopee tier 1, TikTok sku_img, Lazada ảnh SKU. */}
                        {v.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.imageUrl} alt="" className="size-8 shrink-0 rounded border border-slate-200 object-cover" loading="lazy" />
                        )}
                        {v.name ?? "Sản phẩm đơn"}
                        {excluded && <span className={TEXT_SUB}>· không đăng</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      {editable && !excluded ? (
                        <Input
                          className={cn("h-8 w-full max-w-56 font-mono", !sku.trim() && "border-amber-300 bg-amber-50/40")}
                          placeholder="Nhập mã SKU"
                          value={sku}
                          onChange={(e) => setVariantSku(i, e.target.value)}
                        />
                      ) : v.sku ? (
                        <span className="inline-flex items-center gap-1 font-mono text-sm">
                          {v.sku}
                          <CopyIconButton value={v.sku} what="mã SKU" />
                        </span>
                      ) : (
                        <span className="text-sm text-amber-700">Thiếu SKU</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {editable && !excluded ? (
                        <Input
                          type="number"
                          min={0}
                          step={1000}
                          className={cn("ml-auto h-8 w-32 text-right", price <= 0 && "border-amber-300 bg-amber-50/40")}
                          value={price}
                          onChange={(e) => setVariant(i, "price", e.target.value)}
                        />
                      ) : (
                        <Money value={price} />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {editable && !excluded ? (
                        <Input
                          type="number"
                          min={0}
                          className="ml-auto h-8 w-24 text-right"
                          value={stock}
                          onChange={(e) => setVariant(i, "stock", e.target.value)}
                        />
                      ) : (
                        formatNumber(stock)
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!editable && s.variants.length > 12 && (
                <TableRow>
                  <TableCell colSpan={editable ? 5 : 4} className={cn(TEXT_SUB, "py-2 text-center")}>
                    +{s.variants.length - 12} phân loại nữa
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {s.attributes.length > 0 && (
        <div className="space-y-1">
          <div className={TEXT_TABLE_HEAD}>Thuộc tính nguồn (điền sẵn sang gian đích khi trùng tên)</div>
          <div className="flex flex-wrap gap-1.5">
            {s.attributes.map((a) => (
              <span key={a.name} className="rounded-md border border-slate-200 bg-card px-2 py-0.5 text-xs text-slate-900">
                <span className="text-slate-500">{a.name}:</span> {a.value}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className={cn(TEXT_SUB, "whitespace-normal")}>
          Tên, mô tả, giá và tồn sửa ở đây áp cho MỌI gian đích của sản phẩm này; muốn giá / tồn khác cho riêng một gian thì
          dùng % điều chỉnh giá và Tồn đăng ở dòng gian đó.
        </span>
        {editable && (
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "Đang lưu…" : "Lưu bài đăng"}
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
              {t.categoryConfidence != null && (
                <div className={TEXT_SUB}>Gợi ý · độ khớp {Math.round(t.categoryConfidence * 100)}%</div>
              )}
            </div>
          ) : (
            <span className="text-sm text-amber-700">Chưa chọn</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1 whitespace-normal">
            {t.missing.length === 0 ? (
              isOpen(t) ? (
                <span className="text-sm text-emerald-500">Đủ điều kiện</span>
              ) : (
                <span className={TEXT_SUB}>—</span>
              )
            ) : (
              t.missing.map((m) => (
                <span key={m} className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] leading-snug text-amber-800">
                  {missingLabel(m, attrName, missingCtx)}
                </span>
              ))
            )}
            {isOpen(t) &&
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
          {/* Nút chữ rõ: còn sửa được → nút ĐẶC "Bổ sung"/"Sửa" (anh chốt 30/10: nổi bật); đã đăng → "Xem" viền. */}
          <Button
            variant={expanded ? "secondary" : canEdit ? "default" : "outline"}
            size="sm"
            className="whitespace-nowrap"
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
      {t.error && (
        <TableRow className={cn("hover:bg-transparent", expanded && ROW_ACTIVE)}>
          <TableCell colSpan={6} className="bg-rose-50/60 py-2 pl-10">
            {/* Dòng 1 tiếng Việt nói rõ sửa gì; nguyên văn sàn để nhỏ, mờ — khách gửi cho hỗ trợ khi cần. */}
            {(() => {
              const { text, detail } = splitListingError(t.error);
              return (
                <>
                  <div className="whitespace-normal text-sm leading-snug text-red-500">{text}</div>
                  {detail && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer select-none text-[11px] text-slate-500">Chi tiết kỹ thuật sàn trả về</summary>
                      <div className="mt-0.5 whitespace-normal break-all font-mono text-[11px] text-slate-500">{detail}</div>
                    </details>
                  )}
                </>
              );
            })()}
          </TableCell>
        </TableRow>
      )}
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
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<CopyListingTargetPatch>({});
  /** Kênh vận chuyển: mặc định theo cài đặt gian, chỉ xổ khi khách muốn tuỳ chỉnh hoặc đang thiếu. */
  const [logisticsOpen, setLogisticsOpen] = useState(false);

  const value = <K extends keyof CopyListingTargetPatch>(k: K): CopyListingTargetPatch[K] =>
    draft[k] !== undefined ? draft[k] : (t as unknown as CopyListingTargetPatch)[k];
  const attrs = { ...t.attributes, ...(draft.attributes ?? {}) };
  const dims = draft.dimensionsCm !== undefined ? draft.dimensionsCm : t.dimensionsCm;
  const logistics = draft.logisticIds ?? t.logisticIds;
  const logisticEnabled = t.logisticOptions.filter((o) => o.enabled);
  const logisticsOn = logisticEnabled.filter((o) => logistics.includes(o.id)).length;
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
      // Nạp lại đợt XONG mới xoá nháp — tránh ô danh mục nháy về giá trị cũ một nhịp.
      await invalidate(qk.copyListingBatch(batch.id));
      setDraft({});
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
      const r = await applyCopyListingTargetToBatch(batch.id, t.id);
      await invalidate(qk.copyListingBatch(batch.id));
      setDraft({});
      toast.success(`Đã áp danh mục, thuộc tính, cân nặng… cho ${r.applied} sản phẩm còn lại trên ${t.channel.shopName}.`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setApplying(false);
    }
  }

  const missing = new Set(t.missing);
  /**
   * Ô nhập: nhãn + viên "Bắt buộc" (sàn không cho đăng nếu trống) + ghi chú ngắn nói điền gì.
   * Thiếu → nhãn vàng "còn thiếu" + viền vàng (đồng bộ cột Còn thiếu ở dòng gian).
   */
  const field = (label: string, code: string, node: React.ReactNode, opts?: { required?: boolean; hint?: string }) => (
    <div key={code} className="space-y-1">
      <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-1.5", missing.has(code) && "text-amber-700")}>
        <span>{label}</span>
        {opts?.required && (
          <span className="rounded border border-rose-200 bg-rose-50 px-1 py-px text-[10px] font-medium normal-case tracking-normal text-red-500">
            Bắt buộc
          </span>
        )}
        {missing.has(code) && <span className="font-normal normal-case">· còn thiếu</span>}
      </div>
      {node}
      {/* Ô nằm trong TableCell (whitespace-nowrap) → ép xuống dòng, không tràn sang cột bên. */}
      {opts?.hint && <div className={cn(TEXT_SUB, "whitespace-normal leading-snug")}>{opts.hint}</div>}
    </div>
  );
  const inputCls = (code: string) => cn(missing.has(code) && "border-amber-300 bg-amber-50/40");
  // Thuộc tính bắt buộc lên đầu để khách thấy ngay phải điền gì; tuỳ chọn xếp sau.
  const attributeDefs = [...t.attributeDefs].sort((a, b) => Number(b.required) - Number(a.required));
  const requiredAttrCount = attributeDefs.filter((d) => d.required).length;
  const platformLabel = CHANNEL_META[t.channel.channelName].label;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-1.5", missing.has("category") && "text-amber-700")}>
          <span>Danh mục trên {platformLabel}</span>
          <span className="rounded border border-rose-200 bg-rose-50 px-1 py-px text-[10px] font-medium normal-case tracking-normal text-red-500">
            Bắt buộc
          </span>
          {missing.has("category") && <span className="font-normal normal-case">· còn thiếu</span>}
          {t.categoryConfidence != null && draft.categoryId === undefined && (
            <span className="ml-2 font-normal normal-case text-slate-500">Hubsell gợi ý · độ khớp {Math.round(t.categoryConfidence * 100)}%</span>
          )}
        </div>
        <CategoryCascade
          jobId={job.id}
          targetId={t.id}
          value={value("categoryId") ?? null}
          disabled={!canEdit}
          invalid={missing.has("category")}
          onChange={(id) => setDraft((d) => ({ ...d, categoryId: id }))}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(req?.brandRequired || t.brandId) &&
          field(
            "Thương hiệu",
            "brand",
            <BrandCombobox
              jobId={job.id}
              targetId={t.id}
              categoryId={value("categoryId") ?? null}
              value={(() => {
                const id = value("brandId");
                if (!id) return null;
                return { id, name: draft.brandId !== undefined ? (draft.brandName ?? id) : (t.brandName ?? id) };
              })()}
              disabled={!canEdit}
              invalid={missing.has("brand")}
              onChange={(b) => setDraft((d) => ({ ...d, brandId: b?.id ?? null, brandName: b?.name ?? null }))}
            />,
            { required: Boolean(req?.brandRequired), hint: "Gõ vài chữ đầu để tìm. Hàng không có thương hiệu thì chọn Không có thương hiệu (No Brand)." }
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
          />,
          { required: req?.weightRequired ?? true, hint: "Cân nặng cả gói hàng, tính phí ship. Ví dụ áo thun: 250." }
        )}
        {field(
          "Kích thước kiện hàng (cm)",
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
                  setDraft((d) => {
                    const next = {
                      length: dims?.length ?? 0,
                      width: dims?.width ?? 0,
                      height: dims?.height ?? 0,
                      [k]: Number(e.target.value) || 0,
                    };
                    // Xóa hết 3 ô → null (không gửi sàn); sàn từ chối nếu nhận số 0.
                    const empty = next.length <= 0 && next.width <= 0 && next.height <= 0;
                    return { ...d, dimensionsCm: empty ? null : next };
                  })
                }
              />
            ))}
          </div>,
          {
            required: Boolean(req?.dimensionsRequired),
            hint: req?.dimensionsRequired
              ? "Dài × Rộng × Cao của gói hàng khi gửi, đủ cả 3 số."
              : "Không bắt buộc. Nếu nhập thì phải đủ cả 3 số Dài × Rộng × Cao; để trống cả 3 nếu không rõ.",
          }
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
          />,
          { hint: "0 = giữ giá nguồn. Ví dụ 10 = đắt hơn 10%, −5 = rẻ hơn 5%." }
        )}
        {field(
          "Tồn đăng mỗi phân loại",
          "stock",
          <Input
            type="number"
            min={0}
            value={value("stock") ?? ""}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value === "" ? null : Number(e.target.value) }))}
          />,
          { hint: "Để trống = lấy số tồn của nguồn." }
        )}
      </div>
      {attributeDefs.length > 0 && (
        <div className={cn(TEXT_SUB, "whitespace-normal pt-1 leading-snug")}>
          Thông tin {platformLabel} hỏi thêm cho danh mục này
          {requiredAttrCount > 0
            ? ` — ${requiredAttrCount} ô có nhãn Bắt buộc phải điền mới đăng được; các ô còn lại để trống vẫn đăng được, có thì khách dễ tìm thấy hàng hơn.`
            : " — không có ô bắt buộc; điền được ô nào thì khách dễ tìm thấy hàng hơn."}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {attributeDefs.map((def) =>
          field(
            def.name,
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
                placeholder={def.type === "number" ? "Nhập số" : "Nhập chữ"}
                onChange={(e) => setDraft((d) => ({ ...d, attributes: { ...(d.attributes ?? {}), [def.id]: e.target.value } }))}
              />
            ),
            { required: def.required }
          )
        )}
      </div>
      {logisticEnabled.length > 0 && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(TEXT_TABLE_HEAD, missing.has("logistics") && "text-amber-700")}>Kênh vận chuyển</span>
            {req?.logisticsRequired && (
              <span className="rounded border border-rose-200 bg-rose-50 px-1 py-px text-[10px] font-medium text-red-500">Bắt buộc</span>
            )}
            <span className={cn(TEXT_SUB, "tabular-nums")}>
              {logisticsOn === logisticEnabled.length
                ? `theo cài đặt gian — ${logisticEnabled.length} kênh đang bật trên sàn`
                : `${logisticsOn}/${logisticEnabled.length} kênh đang bật trên sàn`}
            </span>
            {canEdit && (
              <Button size="xs" variant="ghost" onClick={() => setLogisticsOpen((v) => !v)}>
                {logisticsOpen || missing.has("logistics") ? "Thu gọn" : "Tuỳ chỉnh"}
              </Button>
            )}
          </div>
          {(logisticsOpen || missing.has("logistics")) && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
              {logisticEnabled.map((o) => (
                <label key={o.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    disabled={!canEdit}
                    checked={logistics.includes(o.id)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        logisticIds: e.target.checked ? [...logistics, o.id] : logistics.filter((x) => x !== o.id),
                      }))
                    }
                  />
                  {o.name}
                </label>
              ))}
            </div>
          )}
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

/**
 * Chọn danh mục xổ cha → con theo cây của CHÍNH sàn đích (mỗi sàn một cây khác
 * nhau). Mỗi cấp một ô; chọn tới lá mới tính là xong (onChange(id)), chọn nút
 * giữa chừng → onChange(null) để ô báo "còn thiếu".
 */
function CategoryCascade({
  jobId,
  targetId,
  value,
  disabled,
  invalid,
  onChange,
}: {
  jobId: string;
  targetId: string;
  value: string | null;
  disabled: boolean;
  invalid: boolean;
  onChange: (id: string | null) => void;
}) {
  const [levels, setLevels] = useState<CopyListingCategoryNode[][]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Giá trị đã nạp lần cuối — đổi từ ngoài (lưu xong, "Áp cho sản phẩm còn lại") thì nạp lại. */
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (loadedFor !== undefined && (value === loadedFor || path[path.length - 1] === value)) return;
    let alive = true;
    setLoading(true);
    fetchCopyListingCategoryTree(jobId, targetId, { selectedId: value })
      .then((r) => {
        if (!alive) return;
        setLevels(r.levels);
        setPath(r.path);
        setLoadedFor(value);
        setError(null);
      })
      .catch((err) => alive && setError(errorText(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      // Lượt nạp bị huỷ giữa chừng (giá trị đổi tiếp) thì không được kẹt "đang tải".
      setLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, targetId, value]);

  async function pick(level: number, id: string) {
    const node = levels[level]?.find((n) => n.id === id);
    const nextPath = [...path.slice(0, level), ...(id ? [id] : [])];
    const nextLevels = levels.slice(0, level + 1);
    setPath(nextPath);
    setLevels(nextLevels);
    // Ghi loadedFor TRƯỚC khi báo lên cha: giá trị mới (lá hoặc null khi chọn dở)
    // khớp loadedFor nên effect không nạp lại và không xoá các ô đang chọn.
    setLoadedFor(node?.leaf ? id : null);
    if (!node) {
      onChange(null);
      return;
    }
    if (node.leaf) {
      onChange(id);
      return;
    }
    onChange(null);
    try {
      const r = await fetchCopyListingCategoryTree(jobId, targetId, { parentId: id });
      setLevels([...nextLevels, r.levels[0] ?? []]);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const names = path.map((id, i) => levels[i]?.find((n) => n.id === id)?.name ?? id);
  const done = path.length > 0 && levels[path.length - 1]?.find((n) => n.id === path[path.length - 1])?.leaf;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {levels.map((nodes, i) => (
          <NativeSelect
            key={i}
            className={cn("w-56", invalid && !done && "[&>select]:border-amber-300 [&>select]:bg-amber-50/40")}
            aria-label={`Danh mục cấp ${i + 1}`}
            value={path[i] ?? ""}
            disabled={disabled || loading}
            onChange={(e) => void pick(i, e.target.value)}
          >
            <option value="">— Cấp {i + 1} —</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.leaf ? "" : " ›"}
              </option>
            ))}
          </NativeSelect>
        ))}
        {loading && levels.length === 0 && <span className={TEXT_SUB}>Đang tải cây danh mục…</span>}
      </div>
      {error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : names.length > 0 ? (
        <div className={TEXT_SUB}>
          {names.join(" › ")}
          {!done && " · chọn tiếp tới cấp cuối"}
        </div>
      ) : null}
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
                          {b.sourceType === "CHANNEL" ? "Từ gian hàng" : b.sourceType === "MANUAL" ? "Tạo mới" : "Từ kho Hubsell"} · {b.productCount} sản phẩm ×{" "}
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
