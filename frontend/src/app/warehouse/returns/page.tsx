"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Construction, PackageSearch, ScanLine, Timer } from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { getStoredUser, getToken } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * ĐỐI SOÁT ĐƠN HOÀN (RTS Reconciliation) — KHUNG TRANG, CHƯA NỐI LOGIC.
 *
 * Trang này là góc nhìn của KHO lên toàn bộ hàng đang hoàn về, khác với tab
 * "Hủy / Hoàn" ở /orders (góc nhìn xử lý từng đơn). Phần thật sự mới ở đây là
 * lớp ĐỐI SOÁT: so danh sách sàn báo hoàn với danh sách kho đã nhận được, để
 * lòi ra những kiện đi lạc.
 *
 * Ba việc sẽ làm khi nối logic:
 *  1. Đồng bộ đơn sàn báo "Đang hoàn / Trả hàng hoàn tiền" về danh sách chờ.
 *  2. Quét mã → chuyển "Hoàn thành công" + cộng tồn kho nếu hàng nguyên vẹn.
 *  3. Quá 7–14 ngày kho chưa quét trúng → tự gắn cờ "Chưa về tay" làm căn cứ
 *     khiếu nại bưu cục.
 *
 * ⚠️ Khi nối logic PHẢI DÙNG LẠI `POST /api/orders/:id/return` đã có, KHÔNG
 * viết lại phép cộng kho ở đây. Cộng kho có chốt chặn `Order.stockRestoredAt`
 * chống cộng trùng; viết một đường cộng kho thứ hai là mở lại đúng cái lỗ hổng
 * vừa bịt — kho phình ảo mà không có thông báo lỗi nào.
 */
export default function WarehouseReturnsPage() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (getStoredUser()?.role === "STAFF") {
      setDenied(true);
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;
  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <p className="text-muted-foreground">
          Đối chiếu danh sách sàn báo hoàn với hàng kho thực nhận, để phát hiện
          kiện đi lạc và làm căn cứ khiếu nại bưu cục.
        </p>

        {/* Trạng thái thật của trang: khung đã dựng, logic chưa nối */}
        <Card className="border-amber-300 bg-amber-50/60 shadow-sm">
          <CardContent className="flex items-start gap-3 py-1">
            <Construction className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-medium text-amber-900">
                Khung trang đã dựng — chưa nối dữ liệu
              </p>
              <p className="text-sm text-amber-800">
                Router và vị trí trong menu đã sẵn sàng. Ba phần logic bên dưới
                sẽ được nối ở bước tiếp theo.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Ba khối logic đã thống nhất, để soát lại kế hoạch trước khi code */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: PackageSearch,
              title: "1 · Đồng bộ từ sàn",
              body: "Kéo về các đơn sàn báo “Đang hoàn / Trả hàng hoàn tiền”, xếp vào danh sách chờ kho nhận.",
            },
            {
              icon: ScanLine,
              title: "2 · Quét mã nhận hàng",
              body: "Bắn mã vận đơn → chuyển “Hoàn thành công”, cộng lại tồn kho nếu hàng nguyên vẹn.",
            },
            {
              icon: Timer,
              title: "3 · Phát hiện lệch",
              body: "Quá 7–14 ngày kho chưa quét trúng → gắn cờ “Chưa về tay” làm căn cứ khiếu nại bưu cục.",
            },
          ].map((b) => (
            <Card key={b.title} className="shadow-sm">
              <CardContent className="space-y-2 py-1">
                <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <b.icon className="size-5" />
                </div>
                <p className="font-semibold">{b.title}</p>
                <p className={TEXT_SUB}>{b.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Chỉ đường sang chỗ đang dùng được, để không ai tưởng tính năng bị mất */}
        <Card className="shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-1">
            <div>
              <p className="font-medium">Cần xử lý hàng hoàn ngay bây giờ?</p>
              <p className={cn(TEXT_SUB, "mt-0.5")}>
                Việc quét mã và cộng lại tồn kho đã chạy được ở tab “Đơn hủy /
                Hoàn trả” trong Quản lý đơn hàng.
              </p>
            </div>
            <Link
              href="/orders"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Mở trang Đơn hàng
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Quản lý Kho — Đối soát đơn hoàn
        </p>
      </div>
    </AppShell>
  );
}
