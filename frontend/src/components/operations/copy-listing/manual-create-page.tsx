"use client";

// ============================================================
// TẠO SẢN PHẨM MỚI — trang /products/new (30/10/2026 anh chốt: nút "Thêm sản phẩm mới" cũ
// ở Hàng hóa bỏ; luồng "Tạo sản phẩm mới" của Sao chép sản phẩm chuyển về đây vì khách tìm
// việc tạo hàng ở khu Hàng hóa). Bước 1 soạn sản phẩm đủ chuẩn 3 sàn (manual-product-form),
// bước 2 chọn gian đích → tạo lượt (POST /jobs MANUAL) → mở đợt ở Sao chép sản phẩm để bổ
// sung danh mục / thuộc tính từng gian rồi Đăng (khi Đăng mới ghi Tổng kho — docs mục 24).
// 05/11/2026 (anh mở lại việc gác ở mục 30): nút "Chỉ lưu vào Tổng kho" — không chọn gian,
// ghi SKU kho ngay (POST /warehouse-only), không đăng, về Hàng hóa (docs mục 33).
// 05/11/2026 (tiếp, docs mục 34): CHẾ ĐỘ SAO CHÉP TỪ SÀN — ?fromChannel=&item= (từ hộp chọn
// ở menu "Tạo sản phẩm kho" của Tổng kho): hỏi sàn lấy bản nháp đầy đủ, đổ vào cùng form,
// khách đặt mã SKU còn thiếu rồi "Lưu vào Tổng kho" thành SKU ĐỘC LẬP (không nối gian, không
// đăng; bước 2 gian đích ẩn). Anh chốt: "ở Tổng kho sản phẩm độc lập trước, nối sau".
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import {
  apiErrorMessage,
  createCopyListingManualJob,
  fetchCopyListingChannels,
  fetchCopyListingSourceDraft,
  getStoredUser,
  saveCopyListingWarehouseOnly,
  type CopyListingManualPayload,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { canSeeFinancials } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { TEXT_PAGE_TITLE, TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { ManualProductForm, type ManualFormSummary } from "./manual-product-form";
import { StepTitle } from "./primitives";
import { PLATFORM_ORDER } from "./shared";
import { TargetPicker } from "./target-picker";

interface CopyOrigin {
  channelId: string;
  item: string;
}

export function ManualCreatePage() {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [savingWarehouse, setSavingWarehouse] = useState(false);
  /** Payload hợp lệ (null = chưa gửi được) + tóm tắt từ form. */
  const [manual, setManual] = useState<{ payload: CopyListingManualPayload | null; summary: ManualFormSummary }>({
    payload: null,
    summary: { variantCount: 0, blocker: "Nhập tên sản phẩm" },
  });

  // Chế độ sao chép: đọc query MỘT LẦN lúc mount (cùng cách Tổng kho — không cần useSearchParams).
  // null = chưa đọc; { origin: null } = tạo mới thường.
  const [mode, setMode] = useState<{ origin: CopyOrigin | null } | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const channelId = p.get("fromChannel")?.trim();
    const item = p.get("item")?.trim();
    setMode({ origin: channelId && item ? { channelId, item } : null });
  }, []);
  const origin = mode?.origin ?? null;

  const channelsQ = useApiQuery({ queryKey: qk.copyListingChannels(), queryFn: fetchCopyListingChannels });
  const draftQ = useApiQuery({
    queryKey: qk.copyListingSourceDraft(origin?.channelId ?? "", origin?.item ?? ""),
    queryFn: () => fetchCopyListingSourceDraft(origin!.channelId, origin!.item),
    enabled: Boolean(origin),
    // Bản nháp hỏi sàn một lần cho một lần mở trang — không làm mới nền kẻo khách đang sửa bị đổ lại.
    staleTime: Infinity,
  });
  const channels = useMemo(
    () =>
      [...(channelsQ.data?.items ?? [])].sort(
        (a, b) => PLATFORM_ORDER.indexOf(a.channelName) - PLATFORM_ORDER.indexOf(b.channelName) || a.shopName.localeCompare(b.shopName)
      ),
    [channelsQ.data]
  );
  const platformsPresent = PLATFORM_ORDER.filter((p) => channels.some((c) => c.channelName === p));
  const canCreate = Boolean(manual.payload) && targets.size > 0;
  const busy = creating || savingWarehouse;

  /** Chỉ lưu vào Tổng kho: không gian đích, không hàng đợi — ghi SKU kho rồi về Tổng kho. */
  async function saveWarehouseOnly() {
    if (!manual.payload) return;
    setSavingWarehouse(true);
    try {
      const r = await saveCopyListingWarehouseOnly(manual.payload, origin ? { channelId: origin.channelId, itemId: origin.item } : undefined);
      await invalidate(["products"], qk.copyListingBatchesAll());
      toast.success(
        r.created > 0
          ? origin
            ? `Đã lưu ${r.created} SKU vào Tổng kho${r.skipped > 0 ? ` (bỏ qua ${r.skipped} mã đã có)` : ""} — độc lập, chưa nối gian. Muốn đồng bộ tồn thì vào Sản phẩm trên sàn bấm Tự khớp.`
            : `Đã lưu ${r.created} SKU vào Tổng kho${r.skipped > 0 ? ` (bỏ qua ${r.skipped} mã đã có)` : ""} — chưa đăng gian nào, muốn đăng thì dùng Sao chép sản phẩm › Từ kho Hubsell.`
          : "Các mã này đã có sẵn trong Tổng kho — không tạo thêm."
      );
      router.push("/products");
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setSavingWarehouse(false);
    }
  }

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

  const draft = draftQ.data ?? null;
  const copyTitle = origin ? "Sao chép sản phẩm từ sàn" : "Tạo sản phẩm mới";

  return (
    <div className="space-y-5 pb-10">
      <PageHeaderBand className="pb-4">
        <div className="space-y-1">
          <Link href="/products" className={cn(TEXT_SUB, "inline-flex items-center gap-1 hover:text-foreground")}>
            <ArrowLeft className="size-3.5" />
            Tổng kho
          </Link>
          <h1 className={TEXT_PAGE_TITLE}>{copyTitle}</h1>
          {origin ? (
            <p className={TEXT_SUB}>
              {draft ? (
                <>
                  Từ gian <b className="text-foreground">{CHANNEL_META[draft.channel.channelName].label} · {draft.channel.shopName}</b>. Kiểm tra lại, đặt mã SKU
                  còn thiếu rồi lưu — mỗi phân loại thành một SKU <b className="text-foreground">độc lập</b> trong Tổng kho, chưa nối gian; sản phẩm trên sàn giữ nguyên.
                </>
              ) : (
                <>Đang lấy sản phẩm từ sàn… Lưu xong là SKU kho độc lập, chưa nối gian; nối sau ở Sản phẩm trên sàn.</>
              )}
            </p>
          ) : (
            <p className={TEXT_SUB}>
              Soạn một lần đủ chuẩn 3 sàn, chọn gian đích rồi đăng; khi Đăng, mỗi phân loại thành một SKU trong Tổng kho. Chưa muốn
              đăng gian nào thì bấm Chỉ lưu vào Tổng kho. Muốn chép sản phẩm đã có trên gian thì dùng Tạo sản phẩm kho › Sao chép sản phẩm từ sàn.
            </p>
          )}
        </div>
      </PageHeaderBand>

      {channelsQ.denied ? (
        <p className="text-sm text-slate-500">Tài khoản chưa có quyền Sao chép sản phẩm — nhờ chủ shop gán quyền ở trang Nhân viên.</p>
      ) : mode === null ? null : origin ? (
        // ===================== CHẾ ĐỘ SAO CHÉP TỪ SÀN (docs mục 34) =====================
        draftQ.error ? (
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="text-sm text-rose-700">Không lấy được sản phẩm từ sàn: {draftQ.error}</p>
              <p className={TEXT_SUB}>Thường do gian hết hạn ủy quyền hoặc sàn đang bận. Thử lại, hoặc về Tổng kho chọn sản phẩm khác.</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void draftQ.refetch()}>
                  Thử lại
                </Button>
                <Button variant="ghost" nativeButton={false} render={<Link href="/products" />}>
                  Về Tổng kho
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : !draft ? (
          <p className="inline-flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Đang lấy tên, ảnh, mô tả, phân loại từ sàn…
          </p>
        ) : (
          <Card>
            <CardContent className="space-y-4 p-5">
              <StepTitle n={1}>Kiểm tra sản phẩm & đặt mã SKU</StepTitle>
              <ManualProductForm
                key={`${origin.channelId}:${origin.item}`}
                mode="copy"
                initial={draft.listing}
                canSeeCost={canSeeFinancials(getStoredUser())}
                onChange={(payload, summary) => setManual({ payload, summary })}
              />
              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <span className={cn(TEXT_SUB, "tabular-nums")}>
                  {manual.summary.blocker ? `Chưa lưu được: ${manual.summary.blocker}` : `${manual.summary.variantCount} SKU sẽ vào Tổng kho — độc lập, chưa nối gian`}
                </span>
                <Button disabled={!manual.payload || busy} onClick={saveWarehouseOnly}>
                  {savingWarehouse ? "Đang lưu…" : "Lưu vào Tổng kho"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        // ===================== TẠO MỚI THƯỜNG =====================
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
                <span className={TEXT_SUB}>được nhiều gian, nhiều sàn — hoặc để trống và chỉ lưu vào Tổng kho</span>
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
                <p className="text-sm text-slate-500">Chưa có gian nào để đăng — nối gian ở trang Kênh bán, hoặc chỉ lưu vào Tổng kho bên dưới.</p>
              ) : (
                <TargetPicker channels={channels} platformsPresent={platformsPresent} targets={targets} onChange={setTargets} />
              )}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className={cn(TEXT_SUB, "tabular-nums")}>
                  {manual.summary.blocker
                    ? `Sản phẩm mới: ${manual.summary.blocker}`
                    : targets.size > 0
                      ? `1 sản phẩm (${manual.summary.variantCount} phân loại) × ${targets.size} gian đích`
                      : `1 sản phẩm (${manual.summary.variantCount} phân loại) · chưa chọn gian — chỉ lưu vào Tổng kho`}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" disabled={!manual.payload || busy} onClick={saveWarehouseOnly}>
                    {savingWarehouse ? "Đang lưu…" : "Chỉ lưu vào Tổng kho"}
                  </Button>
                  <Button disabled={!canCreate || busy} onClick={create}>
                    {creating ? "Đang chuẩn bị…" : "Tiếp: xem trước theo gian"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
