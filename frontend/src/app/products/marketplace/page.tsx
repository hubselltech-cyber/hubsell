"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { ChannelProductsPage } from "@/components/products/channel-products/channel-products-page";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import { fetchProducts, getStoredUser, type Product } from "@/lib/api";
import { canManageShop } from "@/lib/permissions";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * SẢN PHẨM TRÊN SÀN — trang riêng từ 05/11/2026 (anh Trung nâng cấp Quản lý kho,
 * docs/QUAN-LY-KHO-TAI-CAU-TRUC.md): trước là tab thứ hai của hub Hàng hóa, nay là
 * mục sidebar đứng ngay dưới "Tổng kho". Thân trang là ChannelProductsPage — thiết kế lại
 * cùng ngày (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md): hàng đợi theo SẢN PHẨM sàn, dải 4 số,
 * ngăn kéo nối. Trang CHỈ NỐI, không tạo sản phẩm kho (anh Trung 05/11: sản phẩm kho quản ở Tổng kho). CHỈ CHỦ SHOP — nhân viên gõ URL thì về Tổng kho
 * (sidebar đã ẩn mục, API cũng chặn adminOnly độc lập).
 *
 * Query string (đến từ "Nối thêm gian cho SKU này" ở bảng Tổng kho):
 *   ?search=   từ khoá mồi (4 chữ đầu tên SP kho)
 *   ?target=   id SKU kho ĐÍCH + ?targetSku= mã của nó — chưa có GET /api/products/:id
 *              nên tìm lại qua danh sách theo mã rồi khớp id; không thấy thì bỏ qua đích,
 *              vẫn mở trang với từ khoá.
 * Route cũ /mappings và /products?tab=links đều chuyển về đây.
 */
export default function MarketplaceProductsPage() {
  const router = useRouter();
  const isAdmin = canManageShop(getStoredUser());

  // Đọc query MỘT LẦN lúc mount (cùng cách Tổng kho — không cần useSearchParams/Suspense).
  const [init, setInit] = useState<{ search?: string; target: Product | null } | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/products");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const search = params.get("search")?.trim() || undefined;
    const targetId = params.get("target")?.trim();
    const targetSku = params.get("targetSku")?.trim();
    if (!targetId || !targetSku) {
      setInit({ search, target: null });
      return;
    }
    let cancelled = false;
    fetchProducts({ search: targetSku, page: 1, pageSize: 20, status: "all" })
      .then((res) => {
        if (cancelled) return;
        const found = res.items.find((p) => p.id === targetId) ?? null;
        setInit({ search, target: found });
      })
      .catch(() => {
        if (!cancelled) setInit({ search, target: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [target, setTarget] = useState<Product | null>(null);
  useEffect(() => {
    if (init) setTarget(init.target);
  }, [init]);

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeaderBand className="pb-4">
          {/* MỘT dòng nguyên tắc (anh Trung nhấn mạnh 06/09; trước nằm trong dải kể chuyện của khối 3 bước —
              khối đó tạm ẩn 05/11). Cách làm việc thì bảng bên dưới tự nói bằng nút. */}
          <p className={cn(TEXT_SUB, "flex items-center gap-1.5")}>
            <Lightbulb className="size-3.5 shrink-0" />
            Nối từng phân loại trên sàn về một SKU <b>Tổng kho</b> thì đơn về trừ đúng tồn và tồn được đẩy lên mọi gian. Cùng một sản
            phẩm bán nhiều shop: đặt <b>cùng mã SKU</b> trên sàn để Hubsell tự khớp.
          </p>
        </PageHeaderBand>

        {init && isAdmin && (
          <ChannelProductsPage
            key={`${init.search ?? "all"}:${init.target?.id ?? ""}`}
            initialSearch={init.search}
            targetProduct={target}
            onClearTarget={() => setTarget(null)}
          />
        )}
      </div>
    </AppShell>
  );
}
