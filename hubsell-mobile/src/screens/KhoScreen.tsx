import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { StockPage } from "@/screens/StockPage";
import { WarehouseHubPage } from "@/screens/WarehouseHubPage";

type KhoTab = "stock" | "returns";

/**
 * KHO — một tab ở thanh dưới (anh Trung 04/10), hai tab con:
 *   Tồn kho (chính)  — nhập thêm / xuất bớt từng SKU;
 *   Đơn hoàn (phụ)   — số đếm, danh sách và nút quét nhận đơn hoàn.
 * Dùng chung cho chủ shop và nhân viên kho: tab con hiện theo quyền, chỉ có
 * một quyền thì không hiện thanh chọn.
 */
export function KhoScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const admin = user?.role === "ADMIN";
  const perms = user?.permissions ?? [];
  // Cùng cửa với backend: /api/products + /api/inventory mở cho "warehouse.products" hoặc "orders".
  const canStock =
    admin || hasPermission(perms, "warehouse.products") || hasPermission(perms, "orders");
  const canReturns = admin || hasPermission(perms, "warehouse.returns");
  const [tab, setTab] = useState<KhoTab>(canStock ? "stock" : "returns");

  // Thẻ "đơn hoàn đang xử lý" ở Tổng quan nhảy thẳng vào tab con Đơn hoàn.
  useEffect(() => {
    if (params.tab === "returns" && canReturns) setTab("returns");
    else if (params.tab === "stock" && canStock) setTab("stock");
  }, [params.tab, canReturns, canStock]);

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-4 pb-3">
        <Text className="mb-2.5 text-xl font-bold text-slate-900 dark:text-slate-100">Kho</Text>
        {canStock && canReturns ? (
          <SegmentedTabs
            options={[
              { key: "stock", label: "Tồn kho" },
              { key: "returns", label: "Đơn hoàn" },
            ]}
            value={tab}
            onChange={setTab}
          />
        ) : null}
      </View>
      {tab === "stock" && canStock ? <StockPage /> : <WarehouseHubPage />}
    </View>
  );
}
