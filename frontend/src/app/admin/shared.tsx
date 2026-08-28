// Đồ dùng chung của KHU ĐIỀU HÀNH (/admin/*) — các trang con cùng một kiểu
// thẻ số liệu, định dạng số, bảng màu trạng thái chăm sóc và một hook nạp dữ
// liệu chuẩn (401 → login, 403 → AccessDenied), không bao giờ lệch nhau.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ApiError,
  getToken,
  type ConsultLeadStatus,
  type PlatformCareStatus,
} from "@/lib/api";

/**
 * Hook nạp dữ liệu chuẩn của một trang /admin/*: gọi `fetcher` (bọc useCallback
 * ở trang — đổi bộ lọc là tự nạp lại), quy đổi lỗi về 3 trạng thái quen thuộc.
 */
export function useAdminPage<T>(fetcher: () => Promise<T>) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fetcher());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "Chưa kết nối được máy chủ (backend). Hãy chắc chắn backend đang chạy ở cổng 4000."
      );
    } finally {
      setLoading(false);
    }
  }, [fetcher, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, denied, error, reload };
}

/** Dòng đầu trang: mô tả + nút Tải lại — mọi trang điều hành cùng một kiểu. */
export function AdminPageHeader(props: {
  description: string;
  loading: boolean;
  onReload: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-muted-foreground">{props.description}</p>
      <Button variant="outline" onClick={props.onReload} disabled={props.loading}>
        {props.loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCcw className="size-4" />
        )}
        Tải lại
      </Button>
    </div>
  );
}

/** Thông báo lỗi kết nối — hộp vàng giữa trang. */
export function AdminError({ message }: { message: string }) {
  return (
    <Card>
      <CardContent>
        <p className="py-6 text-center text-sm text-amber-700">{message}</p>
      </CardContent>
    </Card>
  );
}

export function formatCount(n: number): string {
  return n.toLocaleString("vi-VN");
}

export function formatMoney(n: number): string {
  return `${n.toLocaleString("vi-VN")}₫`;
}

export const pageCount = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize));

/** Thẻ số liệu to — dùng cho các tab tổng quan. */
export function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-muted-foreground">{props.label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{props.value}</p>
        {props.hint && (
          <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Nhãn + màu huy hiệu cho từng trạng thái chăm sóc (CRM nội bộ). */
export const CARE_STATUS_META: Record<
  PlatformCareStatus,
  { label: string; className: string }
> = {
  NEW: {
    label: "Mới đăng ký",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  CONTACTED: {
    label: "Đang tư vấn",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  ACTIVE: {
    label: "Đang dùng ổn định",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  CHURN_RISK: {
    label: "Nguy cơ rời bỏ",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  CHURNED: {
    label: "Đã rời bỏ",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

export const CARE_STATUSES = Object.keys(CARE_STATUS_META) as PlatformCareStatus[];

/** Nhãn + màu huy hiệu cho từng trạng thái LEAD TƯ VẤN từ landing. */
export const LEAD_STATUS_META: Record<
  ConsultLeadStatus,
  { label: string; className: string }
> = {
  NEW: {
    label: "Chưa gọi",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  CONTACTED: {
    label: "Đang tư vấn",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  CONVERTED: {
    label: "Đã chốt",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  DROPPED: {
    label: "Không chốt",
    className: "border-slate-200 bg-slate-50 text-slate-500",
  },
};

export const LEAD_STATUSES = Object.keys(LEAD_STATUS_META) as ConsultLeadStatus[];

/** Nhãn nguồn lead — khách bấm nút nào trên landing. */
export const LEAD_SOURCE_LABEL: Record<string, string> = {
  "pricing-enterprise": "Bảng giá — Enterprise",
  "floating-consult": "Nút tư vấn nổi",
};
