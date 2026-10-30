"use client";

// ============================================================
// Tab "Sao chép": Bước 1 chọn nguồn (gian đã nối / kho Hubsell) + Bước 2 chọn gian đích
// → "Xem trước" tạo đợt (POST /batches). Giữ state dùng chéo hai bước (gian nguồn, sản
// phẩm đã tick, gian đích). Soạn sản phẩm từ đầu nằm ở Hàng hóa → /products/new.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Store, Warehouse } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { apiErrorMessage, createCopyListingBatch, fetchCopyListingChannels, type ChannelName, type CopyListingSource } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { StepTitle } from "./primitives";
import { PLATFORM_ORDER } from "./shared";
import { SourcePicker } from "./source-picker";
import { TargetPicker } from "./target-picker";

type SourceType = "CHANNEL" | "PRODUCT";

export function NewCopyStep({ onCreated }: { onCreated: (batchId: string) => void }) {
  const [sourceType, setSourceType] = useState<SourceType>("CHANNEL");
  const [sourceChannelId, setSourceChannelId] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState<ChannelName | "">("");
  /** Sản phẩm đã tick, giữ qua các trang / lần tìm. */
  const [picked, setPicked] = useState<Map<string, CopyListingSource>>(new Map());
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const invalidate = useInvalidate();

  const channelsQ = useApiQuery({ queryKey: qk.copyListingChannels(), queryFn: fetchCopyListingChannels });
  const channels = useMemo(
    () =>
      [...(channelsQ.data?.items ?? [])].sort(
        (a, b) => PLATFORM_ORDER.indexOf(a.channelName) - PLATFORM_ORDER.indexOf(b.channelName) || a.shopName.localeCompare(b.shopName)
      ),
    [channelsQ.data]
  );
  const platformsPresent = PLATFORM_ORDER.filter((p) => channels.some((c) => c.channelName === p));
  const targetChannels = channels.filter((c) => !(sourceType === "CHANNEL" && c.id === sourceChannelId));

  // Gian nguồn mặc định = gian đầu có sản phẩm.
  useEffect(() => {
    if (!sourceChannelId && channels.length > 0) {
      const first = channels.find((c) => c.productCount > 0) ?? channels[0];
      setSourceChannelId(first.id);
      setSourcePlatform(first.channelName);
    }
  }, [channels, sourceChannelId]);

  function pickSourceChannel(id: string) {
    setSourceChannelId(id);
    setPicked(new Map());
    setTargets((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function changeSourceType(type: SourceType) {
    setSourceType(type);
    setPicked(new Map());
  }

  const canCreate = picked.size > 0 && targets.size > 0;

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const batch = await createCopyListingBatch({
        sourceType,
        sourceChannelId: sourceType === "CHANNEL" ? sourceChannelId : undefined,
        sourceKeys: [...picked.keys()],
        targetChannelIds: [...targets],
      });
      if (batch.errors.length > 0) toast.warning(`${batch.errors.length} sản phẩm không đọc được nguồn, đã bỏ qua.`);
      // Tab Lịch sử đang đệm trang cũ → làm tươi để đợt vừa tạo hiện ngay.
      await invalidate(qk.copyListingBatchesAll());
      onCreated(batch.id);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Bước 1 — nguồn */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <StepTitle n={1}>Chọn sản phẩm nguồn</StepTitle>
            <Segmented<SourceType>
              ariaLabel="Nguồn sản phẩm"
              value={sourceType}
              onChange={changeSourceType}
              items={[
                { key: "CHANNEL", label: "Từ gian hàng đã nối", icon: <Store className="size-4" /> },
                { key: "PRODUCT", label: "Từ kho Hubsell", icon: <Warehouse className="size-4" /> },
              ]}
            />
            {/* Soạn sản phẩm từ đầu đã chuyển về Hàng hóa (anh chốt 30/10) — để lối đi cho khách quen chỗ cũ. */}
            <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/products/new" />}>
              <Plus className="size-4" />
              Tạo sản phẩm mới ở Hàng hóa
            </Button>
            {picked.size > 0 && (
              <span className="ml-auto inline-flex items-center gap-2 text-sm text-slate-700">
                Đã chọn <span className="font-semibold text-slate-900 tabular-nums">{picked.size}</span> sản phẩm
                <Button size="xs" variant="ghost" onClick={() => setPicked(new Map())}>
                  Bỏ chọn
                </Button>
              </span>
            )}
          </div>

          <SourcePicker
            key={sourceType}
            sourceType={sourceType}
            channels={channels}
            platformsPresent={platformsPresent}
            sourcePlatform={sourcePlatform}
            sourceChannelId={sourceChannelId}
            onPlatformChange={setSourcePlatform}
            onPickChannel={pickSourceChannel}
            picked={picked}
            onPickedChange={setPicked}
          />
        </CardContent>
      </Card>

      {/* Bước 2 — gian đích */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StepTitle n={2}>Chọn gian đích</StepTitle>
            <span className={TEXT_SUB}>được nhiều gian, nhiều sàn</span>
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
            <TargetPicker channels={targetChannels} platformsPresent={platformsPresent} targets={targets} onChange={setTargets} />
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className={cn(TEXT_SUB, "tabular-nums")}>
              {picked.size} sản phẩm × {targets.size} gian đích = {picked.size * targets.size} lượt đăng
            </span>
            <Button disabled={!canCreate || creating} onClick={create}>
              {creating ? "Đang chuẩn bị…" : "Xem trước"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
