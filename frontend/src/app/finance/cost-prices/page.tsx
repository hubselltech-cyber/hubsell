"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  ImageIcon,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  SearchX,
  X,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { BulkApplyCost } from "@/components/finance/bulk-apply-cost";
import { ImportCostDialog } from "@/components/finance/import-cost-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  fetchSkuProducts,
  getStoredUser,
  getToken,
  syncProductsFromChannels,
  updateSkuCostPrice,
  type ChannelName,
  type SkuChannelFilter,
  type SkuProduct,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { exportCostPricesToExcel } from "@/lib/excel";
import { formatVND, formatNumber } from "@/lib/format";
import { normalizeText } from "@/lib/text";
import { cn } from "@/lib/utils";
import { groupVariants, variantGroupKey } from "@/lib/variant-group";

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
  const [syncing, setSyncing] = useState(false);

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
   * Gom các dòng cùng một mẫu hàng (size M/L/XL của cùng cái áo) để biết dòng
   * nào có "anh em" mà hiện nút áp dụng hàng loạt.
   * Cố ý gom trên TOÀN BỘ items chứ không phải filteredItems: đang lọc "chưa
   * nhập giá vốn" thì các phân loại đã có giá bị ẩn khỏi bảng, nhưng chúng vẫn
   * là anh em và vẫn phải nằm trong danh sách xác nhận.
   */
  const variantGroups = useMemo(
    () => groupVariants(items, (i) => i.productName),
    [items]
  );

  /**
   * Các phân loại khác của cùng mẫu hàng mà việc áp giá HÀNG LOẠT thật sự có
   * tác dụng.
   *
   * Loại bỏ những dòng cùng productId với chính nó: giá vốn được lưu trên sản
   * phẩm gốc, nên nhiều SKU sàn trỏ về cùng một sản phẩm vốn đã dùng chung một
   * giá — sửa dòng này là dòng kia tự đổi theo. Hiện nút cho những dòng đó chỉ
   * khiến người dùng bấm rồi thấy "đã cập nhật 1 phân loại" mà chẳng có gì đổi.
   */
  const bulkTargetsOf = useCallback(
    (item: SkuProduct): SkuProduct[] => {
      const group = variantGroups.get(variantGroupKey(item.productName)) ?? [];
      // Mỗi sản phẩm gốc chỉ cần một dòng đại diện: nhiều SKU sàn cùng trỏ về
      // một product thì cũng chỉ ghi được một giá vốn.
      const byProduct = new Map<string, SkuProduct>();
      for (const row of group) {
        if (!byProduct.has(row.productId)) byProduct.set(row.productId, row);
      }
      byProduct.set(item.productId, item); // luôn gồm chính dòng đang gõ
      return [...byProduct.values()];
    },
    [variantGroups]
  );

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

  // Chủ động quét sản phẩm mới từ các sàn về hệ thống
  async function handleSync() {
    setSyncing(true);
    toast.info(
      "Đang tiến hành đồng bộ sản phẩm từ các sàn, vui lòng đợi trong giây lát...",
      { duration: 4000 }
    );
    try {
      const res = await syncProductsFromChannels();
      await load(); // tải lại danh sách mới nhất
      toast.success(
        `Đồng bộ sản phẩm thành công! Thêm mới ${res.created} SKU, cập nhật ${res.updated} SKU.`,
        { duration: 6000 }
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không đồng bộ được sản phẩm"
      );
    } finally {
      setSyncing(false);
    }
  }

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

            <Button
              onClick={handleSync}
              disabled={syncing}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
              {syncing ? "Đang đồng bộ…" : "Đồng bộ từ sàn"}
            </Button>
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
            {loading ? (
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Ảnh</TableHead>
                    <TableHead>Tên sản phẩm</TableHead>
                    <TableHead>Phân loại</TableHead>
                    <TableHead>Mã SKU</TableHead>
                    <TableHead>Kênh bán</TableHead>
                    <TableHead className="text-right">Giá bán</TableHead>
                    <TableHead className="w-52 text-right">Giá vốn (VNĐ)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const meta = CHANNEL_META[item.channelName as ChannelName];
                    const missing = Number(item.costPrice) <= 0;
                    // Chỉ có ý nghĩa khi mẫu hàng trải trên từ 2 sản phẩm gốc
                    // trở lên — cùng một product thì giá vốn vốn đã dùng chung.
                    const bulkTargets = bulkTargetsOf(item);
                    return (
                      <TableRow key={item.skuId}>
                        <TableCell>
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.imageUrl}
                              alt={item.productName}
                              className="size-10 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <ImageIcon className="size-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {item.productName}
                        </TableCell>
                        <TableCell className="max-w-52 text-muted-foreground">
                          {item.variantName ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono">{item.sku}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                          >
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatVND(item.sellingPrice)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <CurrencyInput
                              className={cn(
                                "w-32 text-right tabular-nums",
                                missing && "border-amber-400 bg-amber-50"
                              )}
                              placeholder="Nhập giá vốn"
                              aria-label={`Giá vốn của ${item.sku}`}
                              value={drafts[item.skuId] ?? ""}
                              onValueChange={(digits) =>
                                setDrafts((d) => ({ ...d, [item.skuId]: digits }))
                              }
                              onBlur={() => handleBlur(item)}
                            />

                            {/* Chỉ hiện khi mẫu hàng này thật sự có phân loại khác */}
                            {bulkTargets.length > 1 && (
                              <BulkApplyCost
                                targets={bulkTargets}
                                costDigits={drafts[item.skuId] ?? ""}
                                onApplied={load}
                              />
                            )}

                            {savingId === item.skuId ? (
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            ) : savedId === item.skuId ? (
                              <Check className="size-4 text-emerald-600" />
                            ) : (
                              <span className="size-4" />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
