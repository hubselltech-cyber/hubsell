"use client";

// ============================================================
// TẠO SẢN PHẨM MỚI — trang /products/new (30/10/2026 anh chốt: nút "Thêm sản phẩm mới" cũ
// ở Hàng hóa bỏ; luồng "Tạo sản phẩm mới" của Sao chép sản phẩm chuyển về đây vì khách tìm
// việc tạo hàng ở khu Hàng hóa). Bước 1 soạn sản phẩm đủ chuẩn 3 sàn (manual-product-form),
// bước 2 chọn gian đích → tạo lượt (POST /jobs MANUAL) → mở đợt ở Sao chép sản phẩm để bổ
// sung danh mục / thuộc tính từng gian rồi Đăng (khi Đăng mới ghi Tổng kho — docs mục 24).
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import { apiErrorMessage, createCopyListingManualJob, fetchCopyListingChannels, getStoredUser, type CopyListingManualPayload } from "@/lib/api";
import { canSeeFinancials } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { TEXT_PAGE_TITLE, TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ManualProductForm, type ManualFormSummary } from "./manual-product-form";
import { StepTitle } from "./primitives";
import { PLATFORM_ORDER } from "./shared";
import { TargetPicker } from "./target-picker";

export function ManualCreatePage() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  /** Payload hợp lệ (null = chưa gửi được) + tóm tắt từ form. */
  const [manual, setManual] = useState<{ payload: CopyListingManualPayload | null; summary: ManualFormSummary }>({
    payload: null,
    summary: { variantCount: 0, blocker: "Nhập tên sản phẩm" },
  });

  const channelsQ = useApiQuery({ queryKey: qk.copyListingChannels(), queryFn: fetchCopyListingChannels });
  const channels = useMemo(
    () =>
      [...(channelsQ.data?.items ?? [])].sort(
        (a, b) => PLATFORM_ORDER.indexOf(a.channelName) - PLATFORM_ORDER.indexOf(b.channelName) || a.shopName.localeCompare(b.shopName)
      ),
    [channelsQ.data]
  );
  const platformsPresent = PLATFORM_ORDER.filter((p) => channels.some((c) => c.channelName === p));
  const canCreate = Boolean(manual.payload) && targets.size > 0;

  async function create() {
    if (!manual.payload || targets.size === 0) return;
    setCreating(true);
    try {
      const job = await createCopyListingManualJob({ listing: manual.payload, targetChannelIds: [...targets] });
      await invalidate(qk.copyListingBatchesAll());
      router.push(`/operations-assistant/copy-listing?batch=${encodeURIComponent(job.batchId)}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <PageHeaderBand className="pb-4">
        <div className="space-y-1">
          <Link href="/products" className={cn(TEXT_SUB, "inline-flex items-center gap-1 hover:text-foreground")}>
            <ArrowLeft className="size-3.5" />
            Hàng hóa
          </Link>
          <h1 className={TEXT_PAGE_TITLE}>Tạo sản phẩm mới</h1>
          <p className={TEXT_SUB}>
            Soạn một lần đủ chuẩn 3 sàn, chọn gian đích rồi đăng; khi Đăng, mỗi phân loại thành một SKU trong Tổng kho. Muốn chép sản
            phẩm đã có trên gian / trong kho thì dùng Sao chép sản phẩm.
          </p>
        </div>
      </PageHeaderBand>

      {channelsQ.denied ? (
        <p className="text-sm text-slate-500">Tài khoản chưa có quyền Sao chép sản phẩm — nhờ chủ shop gán quyền ở trang Nhân viên.</p>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-4 p-5">
              <StepTitle n={1}>Soạn sản phẩm mới</StepTitle>
              <ManualProductForm canSeeCost={canSeeFinancials(getStoredUser())} onChange={(payload, summary) => setManual({ payload, summary })} />
            </CardContent>
          </Card>

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
              {channelsQ.data && channels.length === 0 ? (
                <p className="text-sm text-slate-500">Chưa có gian nào để đăng — nối gian ở trang Kênh bán trước.</p>
              ) : (
                <TargetPicker channels={channels} platformsPresent={platformsPresent} targets={targets} onChange={setTargets} />
              )}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className={cn(TEXT_SUB, "tabular-nums")}>
                  {manual.summary.blocker ? `Sản phẩm mới: ${manual.summary.blocker}` : `1 sản phẩm (${manual.summary.variantCount} phân loại) × ${targets.size} gian đích`}
                </span>
                <Button disabled={!canCreate || creating} onClick={create}>
                  {creating ? "Đang chuẩn bị…" : "Tiếp: xem trước theo gian"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
