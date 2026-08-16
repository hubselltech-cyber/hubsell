"use client";

/**
 * DATA TABLE DÙNG CHUNG — Tầng 2 kế hoạch UI (bảng chuẩn ERP).
 *
 * Dựng trên @tanstack/react-table (headless), vẽ bằng đúng bộ Table gốc của
 * design system nên nhìn không khác bảng tay — chỉ thêm năng lực:
 * - Menu "Cột": ẩn/hiện + GHIM TRÁI từng cột (sticky khi cuộn ngang);
 *   trạng thái tự lưu theo `tableId`, phiên sau vào giữ nguyên.
 * - Menu "Chế độ xem": chụp cột + bộ lọc trang (viewExtras) thành view đặt
 *   tên, một cú bấm quay lại đúng cảnh làm việc.
 * - Chọn nhiều dòng: cột checkbox tích hợp, luôn ghim trái; trang giữ Set id
 *   và tự vẽ thanh bulk-action (khung chung ở bulk-bar.tsx).
 *
 * Quy ước cột: dùng `meta.label` (tên trong menu Cột), `meta.align`,
 * `size` (px — CHỈ ép khi cột được ghim, để offset sticky luôn khớp).
 * Virtualize CHƯA làm có chủ đích: mọi bảng đều phân trang server ≤100 dòng.
 */

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnPinningState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Pin,
  PinOff,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
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
  deleteView,
  loadAutoState,
  loadViews,
  saveAutoState,
  upsertView,
  type SavedTableView,
} from "@/lib/table-views";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- chữ ký generic do tanstack quy định
  interface ColumnMeta<TData, TValue> {
    /** Tên hiển thị trong menu Cột (header có thể là JSX nên cần bản chữ). */
    label?: string;
    align?: "left" | "right" | "center";
    headClassName?: string;
    cellClassName?: string;
  }
}

/** id cột checkbox nội bộ — không xuất hiện trong menu Cột. */
const SELECT_COL_ID = "__select";

export interface DataTableSelection {
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}

export interface DataTableViewExtras {
  /** Đóng gói bộ lọc hiện tại của trang để lưu vào view. */
  get: () => Record<string, unknown>;
  /** Áp bộ lọc từ view đã lưu ngược lại trang. */
  apply: (extras: Record<string, unknown>) => void;
}

export function DataTable<TData>({
  tableId,
  columns,
  data,
  getRowId,
  selection,
  viewExtras,
  initialPinning,
  striped = true,
  toolbar,
  rowClassName,
}: {
  /** Khóa lưu trạng thái cột + view — đặt cố định, đổi là người dùng mất cấu hình. */
  tableId: string;
  columns: ColumnDef<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  selection?: DataTableSelection;
  viewExtras?: DataTableViewExtras;
  /** Cột ghim sẵn lúc đầu (chưa tính lựa chọn người dùng), vd ["orderCode"]. */
  initialPinning?: { left?: string[]; right?: string[] };
  /** Kẻ sọc ngựa vằn dòng chẵn (mặc định bật). */
  striped?: boolean;
  /** Nội dung bên TRÁI hàng nút Cột/Chế độ xem (vd tổng số dòng). */
  toolbar?: React.ReactNode;
  rowClassName?: (row: TData, index: number) => string | undefined;
}) {
  const defaultPinning = React.useMemo<ColumnPinningState>(
    () => ({
      left: [
        ...(selection ? [SELECT_COL_ID] : []),
        ...(initialPinning?.left ?? []),
      ],
      right: initialPinning?.right ?? [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cấu hình khởi tạo, không đổi giữa chừng
    []
  );

  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnPinning, setColumnPinning] =
    React.useState<ColumnPinningState>(defaultPinning);
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([]);
  // Kéo-thả tiêu đề cột: id cột đang kéo + id cột đang rê qua (vẽ vạch đích)
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);

  // Nạp trạng thái đã lưu SAU khi mount (đọc localStorage lúc render đầu sẽ
  // lệch với bản SSR → lỗi hydration). `loaded` chặn việc auto-save đè bản
  // lưu bằng state mặc định trước khi kịp nạp.
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    const saved = loadAutoState(tableId);
    if (saved) {
      setColumnVisibility(saved.columnVisibility ?? {});
      setColumnPinning({
        left: [
          ...(selection ? [SELECT_COL_ID] : []),
          ...(saved.columnPinning?.left ?? []).filter(
            (id) => id !== SELECT_COL_ID
          ),
        ],
        right: saved.columnPinning?.right ?? [],
      });
      setColumnOrder(saved.columnOrder ?? []);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ nạp một lần theo tableId
  }, [tableId]);

  React.useEffect(() => {
    if (!loaded) return;
    saveAutoState(tableId, {
      columnVisibility,
      columnPinning: {
        left: (columnPinning.left ?? []).filter((id) => id !== SELECT_COL_ID),
        right: columnPinning.right ?? [],
      },
      columnOrder,
    });
  }, [tableId, loaded, columnVisibility, columnPinning, columnOrder]);

  // Cột checkbox chọn dòng — ghép vào đầu danh sách cột của trang.
  const allColumns = React.useMemo<ColumnDef<TData>[]>(() => {
    if (!selection) return columns;
    const selectCol: ColumnDef<TData> = {
      id: SELECT_COL_ID,
      size: 44,
      enableHiding: false,
      header: () => <SelectAllCheckbox data={data} selection={selection} getRowId={getRowId} />,
      cell: ({ row }) => (
        <RowCheckbox
          id={getRowId(row.original)}
          selection={selection}
        />
      ),
    };
    return [selectCol, ...columns];
  }, [columns, selection, data, getRowId]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    state: { columnVisibility, columnPinning, columnOrder },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnPinningChange: setColumnPinning,
    onColumnOrderChange: setColumnOrder,
    enableColumnPinning: true,
  });

  const resetColumns = () => {
    setColumnVisibility({});
    setColumnPinning(defaultPinning);
    setColumnOrder([]);
  };

  /**
   * ĐỔI VỊ TRÍ CỘT — dùng chung cho kéo-thả tiêu đề lẫn nút ▲▼ trong menu.
   * Chỉ đổi chỗ TRONG CÙNG VÙNG: cột ghim trái sắp theo mảng pinning.left,
   * cột thường sắp theo columnOrder — kéo chéo vùng thì ghim/bỏ ghim trước.
   */
  const moveColumn = (colId: string, targetId: string) => {
    if (colId === targetId) return;
    const col = table.getColumn(colId);
    const target = table.getColumn(targetId);
    if (!col || !target) return;
    const pinnedCol = col.getIsPinned();
    if (pinnedCol !== target.getIsPinned()) return; // khác vùng — bỏ qua

    if (pinnedCol === "left") {
      setColumnPinning((prev) => {
        const left = [...(prev.left ?? [])];
        const from = left.indexOf(colId);
        const to = left.indexOf(targetId);
        if (from < 0 || to < 0) return prev;
        left.splice(from, 1);
        left.splice(to, 0, colId);
        return { ...prev, left };
      });
      return;
    }
    // Vùng cột thường: dựng danh sách theo thứ tự ĐANG HIỂN THỊ rồi dời chỗ —
    // columnOrder chứa cả id cột ghim cũng vô hại (thứ tự vùng ghim do mảng
    // pinning quyết định).
    const ids = table.getAllLeafColumns().map((c) => c.id);
    const from = ids.indexOf(colId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, colId);
    setColumnOrder(ids);
  };

  return (
    <div>
      {/* Hàng công cụ của bảng: trái = chú thích trang, phải = 2 menu ERP */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2">
        <div className="min-w-0 text-sm text-muted-foreground">{toolbar}</div>
        <div className="flex items-center gap-1.5">
          <ViewsMenu
            tableId={tableId}
            snapshot={() => ({
              columns: {
                columnVisibility,
                columnPinning: {
                  left: (columnPinning.left ?? []).filter(
                    (id) => id !== SELECT_COL_ID
                  ),
                  right: columnPinning.right ?? [],
                },
                columnOrder,
              },
              extras: viewExtras?.get(),
            })}
            onApply={(view) => {
              setColumnVisibility(view.columns.columnVisibility ?? {});
              setColumnPinning({
                left: [
                  ...(selection ? [SELECT_COL_ID] : []),
                  ...(view.columns.columnPinning?.left ?? []),
                ],
                right: view.columns.columnPinning?.right ?? [],
              });
              setColumnOrder(view.columns.columnOrder ?? []);
              if (view.extras && viewExtras) viewExtras.apply(view.extras);
            }}
          />
          <ColumnsMenu
            table={table}
            onReset={resetColumns}
            onMove={moveColumn}
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => {
                const { className, style } = pinProps(header.column);
                const meta = header.column.columnDef.meta;
                const colId = header.column.id;
                // Kéo tiêu đề để đổi vị trí — cột ghim thì bỏ ghim trước
                // (vị trí vùng ghim đổi bằng ▲▼ trong menu Cột).
                const draggable =
                  colId !== SELECT_COL_ID && !header.column.getIsPinned();
                return (
                  <TableHead
                    key={header.id}
                    draggable={draggable}
                    onDragStart={
                      draggable
                        ? (e) => {
                            setDragId(colId);
                            e.dataTransfer.effectAllowed = "move";
                            // Firefox cần setData mới chịu bắt đầu kéo
                            e.dataTransfer.setData("text/plain", colId);
                          }
                        : undefined
                    }
                    onDragOver={(e) => {
                      // Nhận diện nguồn qua dataTransfer.types (không đọc được
                      // data lúc dragover theo spec) — không dựa state dragId
                      // vì có thể chưa kịp render giữa dragstart và dragover.
                      if (!draggable || !e.dataTransfer.types.includes("text/plain"))
                        return;
                      e.preventDefault(); // cho phép thả
                      e.dataTransfer.dropEffect = "move";
                      setDropTargetId(colId);
                    }}
                    onDragLeave={() => {
                      if (dropTargetId === colId) setDropTargetId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const sourceId =
                        e.dataTransfer.getData("text/plain") || dragId;
                      if (sourceId) moveColumn(sourceId, colId);
                      setDragId(null);
                      setDropTargetId(null);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTargetId(null);
                    }}
                    title={draggable ? "Kéo để đổi vị trí cột" : undefined}
                    className={cn(
                      className,
                      draggable && "cursor-grab active:cursor-grabbing",
                      dragId === colId && "opacity-40",
                      // Vạch đích bên trái cột đang rê tới — biết thả vào đâu
                      dropTargetId === colId &&
                        dragId !== colId &&
                        "shadow-[inset_2px_0_0_0_var(--color-primary)]",
                      meta?.align === "right" && "text-right",
                      meta?.align === "center" && "text-center",
                      meta?.headClassName
                    )}
                    style={style}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row, index) => {
            const checked = selection?.selectedIds.has(row.id) ?? false;
            return (
              <TableRow
                key={row.id}
                data-striped={striped && index % 2 === 1 ? "true" : undefined}
                data-selected={checked ? "true" : undefined}
                className={cn(
                  "transition-colors",
                  // Sọc ngựa vằn + hover đậm hơn hẳn sọc + dòng đang chọn có
                  // vạch màu trái — chuẩn hóa từ bảng Đơn hàng (chốt cũ).
                  striped && index % 2 === 1 && "bg-muted/40",
                  "hover:bg-primary/10",
                  checked &&
                    "bg-primary/15 hover:bg-primary/20 shadow-[inset_3px_0_0_0_var(--color-primary)]",
                  rowClassName?.(row.original, index)
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const { className, style } = pinProps(cell.column);
                  const meta = cell.column.columnDef.meta;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        className,
                        meta?.align === "right" && "text-right",
                        meta?.align === "center" && "text-center",
                        meta?.cellClassName
                      )}
                      style={style}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * class + style cho ô thuộc cột ghim. Cột ghim bị ÉP đúng `size` khai báo
 * (width/min/max) — offset sticky tính từ tổng size các cột ghim đứng trước,
 * để nội dung thật có dài hơn cũng không làm hai cột ghim chờm lên nhau.
 */
function pinProps<TData>(column: Column<TData, unknown>): {
  className?: string;
  style?: React.CSSProperties;
} {
  const pinned = column.getIsPinned();
  if (!pinned) return {};
  const size = column.getSize();
  const fixed = { width: size, minWidth: size, maxWidth: size };
  if (pinned === "left") {
    return {
      className: cn(
        "dt-pin",
        column.getIsLastColumn("left") && "dt-pin-left-last"
      ),
      style: { ...fixed, left: column.getStart("left") },
    };
  }
  return {
    className: cn(
      "dt-pin",
      column.getIsFirstColumn("right") && "dt-pin-right-first"
    ),
    style: { ...fixed, right: column.getAfter("right") },
  };
}

function SelectAllCheckbox<TData>({
  data,
  selection,
  getRowId,
}: {
  data: TData[];
  selection: DataTableSelection;
  getRowId: (row: TData) => string;
}) {
  const allChecked =
    data.length > 0 && data.every((r) => selection.selectedIds.has(getRowId(r)));
  return (
    <input
      type="checkbox"
      aria-label="Chọn tất cả dòng trên trang này"
      checked={allChecked}
      onChange={() => {
        const next = new Set(selection.selectedIds);
        if (allChecked) data.forEach((r) => next.delete(getRowId(r)));
        else data.forEach((r) => next.add(getRowId(r)));
        selection.onChange(next);
      }}
      className="size-4 cursor-pointer accent-primary"
    />
  );
}

function RowCheckbox({
  id,
  selection,
}: {
  id: string;
  selection: DataTableSelection;
}) {
  const checked = selection.selectedIds.has(id);
  return (
    <input
      type="checkbox"
      aria-label="Chọn dòng này"
      checked={checked}
      onChange={() => {
        const next = new Set(selection.selectedIds);
        if (checked) next.delete(id);
        else next.add(id);
        selection.onChange(next);
      }}
      className="size-4 cursor-pointer accent-primary"
    />
  );
}

/** Menu "Cột" — ẩn/hiện, ghim trái và đổi vị trí (▲▼) từng cột. */
function ColumnsMenu<TData>({
  table,
  onReset,
  onMove,
}: {
  table: TanstackTable<TData>;
  onReset: () => void;
  /** Đổi chỗ hai cột cùng vùng (dùng chung với kéo-thả tiêu đề). */
  onMove: (colId: string, targetId: string) => void;
}) {
  // Danh sách theo đúng thứ tự ĐANG HIỂN THỊ (đã tính ghim + columnOrder)
  const cols = table
    .getAllLeafColumns()
    .filter((c) => c.id !== SELECT_COL_ID);
  // Hàng xóm CÙNG VÙNG (cùng trạng thái ghim) — ▲▼ chỉ đổi chỗ trong vùng
  const neighbor = (index: number, dir: -1 | 1): string | null => {
    const me = cols[index];
    for (let i = index + dir; i >= 0 && i < cols.length; i += dir) {
      if (cols[i].getIsPinned() === me.getIsPinned()) return cols[i].id;
    }
    return null;
  };
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <Settings2 className="size-4" />
            Cột
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 gap-1 p-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
          Hiện / ẩn, ghim và sắp vị trí cột
        </p>
        {cols.map((col, index) => {
          const pinned = col.getIsPinned() === "left";
          const label = col.columnDef.meta?.label ?? col.id;
          const up = neighbor(index, -1);
          const down = neighbor(index, 1);
          return (
            <div
              key={col.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <input
                type="checkbox"
                id={`dt-col-${col.id}`}
                checked={col.getIsVisible()}
                disabled={!col.getCanHide()}
                onChange={(e) => col.toggleVisibility(e.target.checked)}
                className="size-4 cursor-pointer accent-primary"
              />
              <label
                htmlFor={`dt-col-${col.id}`}
                className="min-w-0 flex-1 cursor-pointer truncate text-sm"
              >
                {label}
              </label>
              {/* ▲▼ đổi vị trí — bản bàn phím/chuột của kéo-thả tiêu đề */}
              <button
                type="button"
                aria-label={`Chuyển cột ${label} lên trước`}
                disabled={!up}
                onClick={() => up && onMove(col.id, up)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Chuyển cột ${label} ra sau`}
                disabled={!down}
                onClick={() => down && onMove(col.id, down)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronDown className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={pinned ? `Bỏ ghim cột ${label}` : `Ghim trái cột ${label}`}
                title={pinned ? "Bỏ ghim" : "Ghim trái (dính khi cuộn ngang)"}
                onClick={() => col.pin(pinned ? false : "left")}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                  pinned
                    ? "bg-primary/10 text-primary"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                )}
              >
                {pinned ? (
                  <Pin className="size-3.5" />
                ) : (
                  <PinOff className="size-3.5" />
                )}
              </button>
            </div>
          );
        })}
        <p className="px-2 pt-1 text-[11px] leading-snug text-muted-foreground">
          Mẹo: kéo thả trực tiếp tiêu đề cột trên bảng để đổi vị trí.
        </p>
        <div className="mt-1 border-t pt-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={onReset}
          >
            <RotateCcw className="size-4" />
            Đặt lại mặc định
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Menu "Chế độ xem" — lưu/áp/xóa view đặt tên (cột + bộ lọc trang). */
function ViewsMenu({
  tableId,
  snapshot,
  onApply,
}: {
  tableId: string;
  snapshot: () => Omit<SavedTableView, "name">;
  onApply: (view: SavedTableView) => void;
}) {
  const [views, setViews] = React.useState<SavedTableView[]>([]);
  const [name, setName] = React.useState("");
  // Nạp khi mở menu (localStorage có thể đã đổi ở tab khác)
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (open) setViews(loadViews(tableId));
  }, [open, tableId]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setViews(upsertView(tableId, { name: trimmed, ...snapshot() }));
    setName("");
    toast.success(`Đã lưu chế độ xem "${trimmed}"`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <Bookmark className="size-4" />
            Chế độ xem
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 gap-1 p-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
          Chế độ xem đã lưu (cột + bộ lọc)
        </p>
        {views.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            Chưa có — chỉnh cột/bộ lọc như ý rồi đặt tên lưu lại bên dưới.
          </p>
        )}
        {views.map((v) => (
          <div
            key={v.name}
            className="flex items-center gap-1 rounded-md hover:bg-muted"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
              onClick={() => {
                onApply(v);
                setOpen(false);
              }}
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Xóa chế độ xem ${v.name}`}
              onClick={() => setViews(deleteView(tableId, v.name))}
              className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-red-500"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <form
          className="mt-1 flex items-center gap-1.5 border-t pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên chế độ xem mới…"
            className="h-8 flex-1 text-sm"
          />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            <BookmarkPlus className="size-4" />
            Lưu
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
