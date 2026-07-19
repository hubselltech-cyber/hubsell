"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  PackageSearch,
  Search,
  SearchX,
  X,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import {
  CostPriceTable,
  type ProductGroup,
} from "@/components/finance/cost-price-table";
import { ImportCostDialog } from "@/components/finance/import-cost-dialog";
import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import { Refreshing } from "@/components/refreshing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  fetchSkuProducts,
  getStoredUser,
  getToken,
  updateSkuCostPrice,
  type SkuChannelFilter,
  type SkuProduct,
} from "@/lib/api";
import { exportCostPricesToExcel } from "@/lib/excel";
import { formatVND, formatNumber } from "@/lib/format";
import { normalizeText } from "@/lib/text";
import { cn } from "@/lib/utils";
import { baseProductName, variantGroupKey } from "@/lib/variant-group";

// Trạng thái giá vốn để lọc
type CostStatusFilter = "all" | "missing" | "filled";

const STATUS_OPTIONS: { value: CostStatusFilter; label: string }[] = [
  { value: "all", label: "Tất cả sản phẩm" },
  { value: "missing", label: "Chưa nhập giá vốn" },
  { value: "filled", label: "Đã nhập giá vốn" },
];

// Các tab lọc theo sàn
const TABS: { key: SkuChannelFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "shopee", label: "Shopee" },
  { key: "tiktok", label: "TikTok Shop" },
  { key: "lazada", label: "Lazada" },
  { key: "offline", label: "Offline" },
];

export default function CostPricesPage() {
  const router = useRouter();
  const [channel, setChannel] = useState<SkuChannelFilter>("all");
  const [items, setItems] = useState<SkuProduct[]>([]);
  const [missingCount, setMissingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // Giá trị đang gõ trong từng ô input (theo skuId)
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // skuId đang lưu / vừa lưu xong (để hiện spinner & dấu tick)
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // ----- Bộ lọc nâng cao -----
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CostStatusFilter>("all");

  // Lọc ngay tại màn hình → kết quả cập nhật tức thì khi gõ, không cần chờ API
  const filteredItems = useMemo(() => {
    const keyword = normalizeText(search.trim());
    return items.filter((item) => {
      // Lọc theo trạng thái giá vốn
      const cost = Number(item.costPrice);
      if (statusFilter === "missing" && cost > 0) return false;
      if (statusFilter === "filled" && cost <= 0) return false;

      // Lọc theo từ khoá: tên sản phẩm, mã SKU, hoặc tên phân loại trên sàn
      if (!keyword) return true;
      return (
        normalizeText(item.productName).includes(keyword) ||
        normalizeText(item.sku).includes(keyword) ||
        normalizeText(item.variantName ?? "").includes(keyword)
      );
    });
  }, [items, search, statusFilter]);

  const isFiltering = search.trim() !== "" || statusFilter !== "all";

  /**
   * Gom dòng đã lọc thành cây Sản phẩm cha → Biến thể con để đưa vào bảng.
   * Giữ nguyên thứ tự xuất hiện đầu tiên của mỗi mẫu, không sắp xếp lại, để
   * người dùng đổi bộ lọc mà các dòng không nhảy lung tung.
   */
  const groups = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, ProductGroup>();
    for (const item of filteredItems) {
      const key = variantGroupKey(item.productName);
      const existing = map.get(key);
      if (existing) {
        existing.variants.push(item);
        // Mẫu lấy ảnh của phân loại đầu tiên có ảnh
        if (!existing.imageUrl) existing.imageUrl = item.imageUrl;
      } else {
        map.set(key, {
          key,
          name: baseProductName(item.productName),
          imageUrl: item.imageUrl,
          variants: [item],
        });
      }
    }
    return [...map.values()];
  }, [filteredItems]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSkuProducts(channel);
      setItems(res.items);
      setMissingCount(res.missingCostCount);
      // Nạp giá vốn hiện tại vào ô nhập. Chưa có giá thì để TRỐNG chứ không
      // điền số 0 — để placeholder "Nhập giá vốn" hiện ra, nhìn là biết còn
      // thiếu, thay vì tưởng đã nhập giá vốn bằng 0.
      const next: Record<string, string> = {};
      for (const i of res.items) {
        const cost = Number(i.costPrice);
        next[i.skuId] = cost > 0 ? String(cost) : "";
      }
      setDrafts(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      // 409 (chưa có kênh) — AppShell overlay xử lý
    } finally {
      setLoading(false);
    }
  }, [channel, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (getStoredUser()?.role === "STAFF") {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  // Tự động lưu khi người dùng nhập xong và click ra ngoài ô input
  async function handleBlur(item: SkuProduct) {
    const raw = (drafts[item.skuId] ?? "").trim();
    const value = Number(raw);
    const current = Number(item.costPrice);
    const restore = () =>
      setDrafts((d) => ({
        ...d,
        [item.skuId]: current > 0 ? String(current) : "",
      }));

    if (raw === "") {
      // Ô trống là trạng thái hợp lệ của SKU chưa nhập giá — chỉ báo lỗi khi
      // người dùng xoá mất một giá vốn ĐÃ CÓ (nhiều khả năng là lỡ tay).
      if (current > 0) {
        toast.error("Giá vốn không được để trống");
        restore();
      }
      return;
    }
    if (Number.isNaN(value) || value < 0) {
      toast.error("Giá vốn phải là số không âm");
      restore();
      return;
    }
    if (value === current) return; // không đổi thì không gọi API

    setSavingId(item.skuId);
    try {
      await updateSkuCostPrice(item.skuId, value);
      toast.success(`Đã cập nhật giá vốn — ${item.sku}: ${formatVND(value)}`);
      setSavedId(item.skuId);
      setTimeout(() => setSavedId(null), 2000);
      // Cập nhật lại danh sách (một sản phẩm gốc có thể gắn nhiều SKU sàn)
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được giá vốn");
      restore();
    } finally {
      setSavingId(null);
    }
  }

  // Xuất đúng những dòng đang hiển thị theo bộ lọc — lọc "chưa nhập giá vốn"
  // rồi xuất ra là có ngay file chỉ chứa các mã còn thiếu để điền hàng loạt.
  function handleExport() {
    if (filteredItems.length === 0) {
      toast.error("Không có SKU nào để xuất");
      return;
    }
    exportCostPricesToExcel(filteredItems);
    toast.success(`Đã xuất ${formatNumber(filteredItems.length)} SKU ra Excel`);
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <p className="text-muted-foreground">
          Nhập giá vốn gốc cho từng SKU đã đồng bộ từ sàn. Giá vốn này dùng để tính
          lợi nhuận và cảnh báo đơn lỗ.
        </p>

        {/* Tabs lọc theo sàn + nút Đồng bộ từ sàn */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setChannel(t.key)}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  channel === t.key
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={loading || filteredItems.length === 0}
            >
              <Download className="size-4" />
              Xuất file Excel
            </Button>

            <ImportCostDialog onImported={load} />

            {/* Giữ nút ở đây để đang duyệt tài chính mà thiếu SKU thì đồng
                bộ tại chỗ. Dùng chung component với trang Sản phẩm. */}
            <SyncChannelProductsButton onSynced={load} />
          </div>
        </div>

        {/* Cảnh báo còn SKU chưa nhập giá vốn */}
        {!loading && missingCount > 0 && (
          <Card className="border-amber-300 bg-amber-50/70">
            <CardContent className="flex items-center gap-3 p-4 text-sm">
              <AlertTriangle className="size-5 shrink-0 text-amber-600" />
              <p className="text-amber-800">
                Còn <b>{formatNumber(missingCount)}</b> SKU chưa nhập giá vốn — báo
                cáo lợi nhuận của các đơn chứa SKU này sẽ chưa chính xác.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ===== THANH BỘ LỌC NÂNG CAO ===== */}
        {!loading && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Ô tìm kiếm real-time */}
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 pr-9"
                placeholder="Tìm theo tên sản phẩm hoặc mã SKU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Xoá từ khoá"
                  className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* Lọc theo trạng thái giá vốn */}
            <NativeSelect
              className="w-52"
              aria-label="Lọc theo trạng thái giá vốn"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as CostStatusFilter)
              }
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>

            {/* Số kết quả đang hiển thị */}
            {isFiltering && (
              <p className="text-sm text-muted-foreground">
                Hiển thị <b>{formatNumber(filteredItems.length)}</b>/
                {formatNumber(items.length)} SKU
              </p>
            )}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {/* Chỉ thay bảng bằng chữ "đang tải" ở LẦN ĐẦU. Mỗi lần lưu giá vốn
                đều gọi load() lại; nếu tháo bảng ra thì component mất trạng thái
                và mọi nhóm đang xổ sẽ tự thu lại — xổ nhóm, gõ giá, vừa rời ô là
                nhóm sập xuống, không thao tác tiếp được. */}
            {loading && items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải danh sách SKU…
              </p>
            ) : items.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <PackageSearch className="mx-auto mb-2 size-8" />
                Không có SKU nào ở kênh này. Hãy liên kết sản phẩm ở trang “Liên kết
                SP” trước, hoặc bấm “Đồng bộ từ sàn”.
              </div>
            ) : filteredItems.length === 0 && statusFilter === "missing" ? (
              // Empty state đặc biệt: đã nhập đủ giá vốn cho tất cả sản phẩm
              <div className="py-16 text-center">
                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-teal-100">
                  <CheckCircle2 className="size-9 text-teal-600" />
                </div>
                <p className="text-lg font-semibold text-teal-700">
                  Tuyệt vời! Toàn bộ sản phẩm của bạn đã được cấu hình giá vốn.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Báo cáo lợi nhuận và cảnh báo đơn lỗ giờ đã chính xác.
                </p>
              </div>
            ) : filteredItems.length === 0 ? (
              // Không tìm thấy kết quả khớp bộ lọc
              <div className="py-12 text-center">
                <SearchX className="mx-auto mb-3 size-9 text-muted-foreground" />
                <p className="font-medium">Không tìm thấy SKU nào phù hợp</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Thử đổi từ khoá tìm kiếm hoặc chọn lại trạng thái giá vốn.
                </p>
              </div>
            ) : (
              <Refreshing active={loading}>
                <CostPriceTable
                  groups={groups}
                  drafts={drafts}
                  onDraftChange={(skuId, digits) =>
                    setDrafts((d) => ({ ...d, [skuId]: digits }))
                  }
                  onVariantBlur={handleBlur}
                  savingId={savingId}
                  savedId={savedId}
                  onBulkApplied={load}
                />
              </Refreshing>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Cấu hình Giá vốn — nhập xong bấm ra ngoài ô là tự động lưu
        </p>
      </div>
    </AppShell>
  );
}
