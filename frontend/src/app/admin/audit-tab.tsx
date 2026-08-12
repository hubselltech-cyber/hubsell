"use client";

// TAB NHẬT KÝ THAO TÁC (GĐ4) — CHỈ CHỦ NỀN TẢNG: mọi thao tác GHI của khu
// điều hành (chăm sóc khách, duyệt lệnh rút, nhân sự HQ) đều để lại vết ở đây.
// Sổ append-only phía backend — trang này thuần đọc.

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlatformAuditLogsResponse } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatCount, pageCount } from "./shared";

/** Nhãn tiếng Việt cho mã hành động — mã lạ (phiên bản mới hơn) hiện thô. */
const ACTION_LABELS: Record<string, string> = {
  "care.update": "Cập nhật chăm sóc khách",
  "withdrawal.approve": "Duyệt chi trả lệnh rút",
  "withdrawal.reject": "Từ chối lệnh rút",
  "staff.create": "Tạo nhân viên điều hành",
  "staff.update": "Sửa nhân viên điều hành",
  "staff.delete": "Xoá nhân viên điều hành",
  "staff.reset-password": "Cấp lại mật khẩu nhân viên",
  "ledger.create": "Ghi bút toán sổ quỹ",
  "ledger.update": "Sửa bút toán sổ quỹ",
  "ledger.delete": "Xoá bút toán sổ quỹ",
};

/** Diễn giải detail JSON thành chuỗi ngắn dễ đọc. */
function describeDetail(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) =>
      Array.isArray(v) ? `${k}: ${v.length} mục` : `${k}: ${String(v)}`
    )
    .join(" · ");
}

export function AuditTab({
  data,
  loading,
  page,
  onPageChange,
}: {
  data: PlatformAuditLogsResponse | null;
  loading: boolean;
  page: number;
  onPageChange: (p: number) => void;
}) {
  if (loading && !data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Đang tải dữ liệu…
      </p>
    );
  }
  if (!data) return null;

  return (
    <Card>
      <CardContent className="p-0">
        {data.logs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Chưa có thao tác nào được ghi nhận.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Ai thao tác</TableHead>
                  <TableHead>Hành động</TableHead>
                  <TableHead>Đối tượng</TableHead>
                  <TableHead>Chi tiết</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {log.actorName}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ACTION_LABELS[log.action] ?? log.action}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.targetLabel ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                      {describeDetail(log.detail)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
              <span>
                {formatCount(data.total)} bản ghi · trang {data.page}/
                {pageCount(data.total, data.pageSize)}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => onPageChange(page - 1)}
                >
                  Trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount(data.total, data.pageSize) || loading}
                  onClick={() => onPageChange(page + 1)}
                >
                  Sau
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
