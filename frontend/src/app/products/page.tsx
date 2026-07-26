"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Money } from "@/components/ui/money";
import { SyncChannelProductsButton } from "@/components/channels/sync-channel-products-button";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { AdjustStockDialog } from "@/components/products/adjust-stock-dialog";
import { ImportExcelDialog } from "@/components/products/import-excel-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchProducts,
  getStoredUser,
  getToken,
  ApiError,
  type Product,
} from "@/lib/api";
import { exportAllProducts } from "@/lib/excel";
import { formatNumber, formatDateTime } from "@/lib/format";
import { canManageShop, canSeeFinancials } from "@/lib/permissions";
import { TEXT_NUMBER_MUTED } from "@/lib/typography";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;
const LOW_STOCK_THRESHOLD = 10;

const columnHelper = createColumnHelper<Product>();

export default function ProductsPage() {
  const router = useRouter();

  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Hộp thoại nhập/xuất kho đang mở cho sản phẩm nào
  const [adjusting, setAdjusting] = useState<{
    product: Product;
    type: "IMPORT" | "EXPORT";
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProducts({ page, pageSize: PAGE_SIZE, search });
      setItems(res.items);
      setTotal(res.total);
      setPageCount(res.pageCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 409) return; // chưa có kênh — overlay xử lý
      setError(
        err instanceof ApiError
          ? err.message
          : "Chưa kết nối được máy chủ (backend). Hãy chắc chắn backend đang chạy ở cổng 4000."
      );
    } finally {
      setLoading(false);
    }
  }, [page, search, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load();
  }, [load, router]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportAllProducts(seesCost);
      if (count === 0) {
        toast.info("Chưa có sản phẩm nào để xuất");
      } else {
        toast.success(`Đã xuất ${count} sản phẩm ra file Excel`);
      }
    } catch {
      toast.error("Không xuất được file Excel");
    } finally {
      setExporting(false);
    }
  }

  // Nhân viên (SALES/WAREHOUSE) không được biết giá vốn — backend đã cắt hẳn
  // trường này khỏi dữ liệu trả về, ở đây bỏ luôn cột để bảng không có ô trống.
  const seesCost = canSeeFinancials(getStoredUser()?.role);

  const columns = useMemo(
    () => [
      columnHelper.accessor("skuCode", {
        header: "Mã SKU",
        cell: (info) => (
          <span className="font-mono text-sm font-medium">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("productName", {
        header: "Tên sản phẩm",
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      ...(seesCost
        ? [
            columnHelper.accessor("costPrice", {
              header: () => <div className="text-right">Giá vốn</div>,
              cell: (info) => (
                <div className="text-right">
                  <Money
                    value={info.getValue() ?? 0}
                    className={TEXT_NUMBER_MUTED}
                  />
                </div>
              ),
            }),
          ]
        : []),
      columnHelper.accessor("sellingPrice", {
        header: () => <div className="text-right">Giá bán</div>,
        cell: (info) => (
          <div className="text-right">
            <Money
              value={info.getValue()}
              className="font-medium text-slate-900"
            />
          </div>
        ),
      }),
      columnHelper.accessor("quantityInStock", {
        header: () => <div className="text-center">Tồn kho</div>,
        cell: (info) => {
          const qty = info.getValue();
          return (
            <div className="text-center">
              <span
                className={cn(
                  "inline-flex min-w-12 items-center justify-center rounded-full border px-2.5 py-0.5 text-sm font-semibold",
                  qty === 0
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : qty < LOW_STOCK_THRESHOLD
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                )}
              >
                {formatNumber(qty)}
              </span>
            </div>
          );
        },
      }),
      columnHelper.accessor("createdAt", {
        header: () => <div className="text-right">Ngày tạo</div>,
        cell: (info) => (
          <div className="text-right text-sm text-muted-foreground">
            {formatDateTime(info.getValue())}
          </div>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <div className="text-center">Nhập / Xuất kho</div>,
        cell: ({ row }) => (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-emerald-700 hover:bg-emerald-50"
              onClick={() =>
                setAdjusting({ product: row.original, type: "IMPORT" })
              }
            >
              <ArrowDownToLine className="size-4" />
              Nhập
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-rose-700 hover:bg-rose-50"
              disabled={row.original.quantityInStock === 0}
              onClick={() =>
                setAdjusting({ product: row.original, type: "EXPORT" })
              }
            >
              <ArrowUpFromLine className="size-4" />
              Xuất
            </Button>
          </div>
        ),
      }),
    ],
    [seesCost]
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount,
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Kho vật lý — SKU nội bộ, tồn kho
            {seesCost ? " và giá vốn" : ""} ({formatNumber(total)} sản phẩm).
            Sản phẩm từ sàn được nối về đây tại trang Liên kết SP vào kho vật lý.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Kéo danh mục sàn về tầng đệm rồi đưa thẳng sang trang Liên kết
                SP vào kho vật lý để nối — bước 2 của luồng "kho có trước". */}
            {canManageShop(getStoredUser()?.role) && (
              <SyncChannelProductsButton
                label="Kéo sản phẩm từ sàn về"
                onSynced={() => router.push("/mappings")}
              />
            )}
            <ImportExcelDialog onImported={load} />
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Xuất Excel
            </Button>
            <ProductFormDialog onCreated={load} />
          </div>
        </div>

        {/* Thanh tìm kiếm */}
        <form onSubmit={handleSearch} className="flex max-w-md gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Tìm theo mã SKU hoặc tên sản phẩm…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Tìm kiếm
          </Button>
        </form>

        <Card>
          <CardContent className="p-0">
            {error ? (
              <p className="py-10 text-center text-sm text-amber-700">{error}</p>
            ) : loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {search
                  ? `Không tìm thấy sản phẩm nào khớp với "${search}".`
                  : "Chưa có sản phẩm nào. Bấm “Thêm sản phẩm mới” để bắt đầu."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id}>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Phân trang */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Trang {page} / {pageCount}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                Trang trước
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Trang sau
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Hộp thoại nhập/xuất kho */}
      {adjusting && (
        <AdjustStockDialog
          product={adjusting.product}
          type={adjusting.type}
          open={true}
          onOpenChange={(open) => {
            if (!open) setAdjusting(null);
          }}
          onDone={load}
        />
      )}
    </AppShell>
  );
}
