import React, { useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hapticSelect } from "@/lib/haptics";
import { OverviewPage } from "@/screens/OverviewPage";
import { FinancePage } from "@/screens/FinancePage";
import { WarehouseHubPage } from "@/screens/WarehouseHubPage";

// react-native-pager-view KHÔNG có bản web — giả lập web chuyển trang bằng tap.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PagerView = Platform.OS === "web" ? null : require("react-native-pager-view").default;

const SECTIONS = ["Tổng quan", "Tài chính", "Kho"];

/**
 * TRANG CHỦ chủ shop = 3 trang VUỐT NGANG: Tổng quan → Tài chính → Kho
 * (chốt thiết kế 13/08 — học bố cục "hôm nay" của Salework nhưng giữ nguyên
 * nguyên tắc tách vai: nhân viên kho không bao giờ thấy trang này).
 */
export default function AdminHome() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const pagerRef = useRef<{ setPage: (i: number) => void } | null>(null);

  const go = (i: number) => {
    if (i !== page) hapticSelect();
    setPage(i);
    pagerRef.current?.setPage(i);
  };

  const pages = [
    <OverviewPage key="overview" goWarehouse={() => go(2)} />,
    <FinancePage key="finance" />,
    <WarehouseHubPage key="warehouse" />,
  ];

  return (
    <View className="flex-1 bg-slate-50" style={{ paddingTop: insets.top + 10 }}>
      {/* Thanh mục + chấm chỉ báo trang */}
      <View className="flex-row items-center gap-1 px-4 pb-2">
        {SECTIONS.map((label, i) => (
          <Pressable
            key={label}
            className={`rounded-full px-3.5 py-1.5 ${
              page === i ? "bg-slate-900" : ""
            }`}
            onPress={() => go(i)}
          >
            <Text
              className={`text-sm font-semibold ${
                page === i ? "text-white" : "text-slate-400"
              }`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
        <View className="flex-1" />
        <View className="flex-row gap-1.5 pr-1">
          {SECTIONS.map((_, i) => (
            <View
              key={i}
              className={`h-1.5 rounded-full ${
                page === i ? "w-4 bg-slate-900" : "w-1.5 bg-slate-300"
              }`}
            />
          ))}
        </View>
      </View>

      {PagerView ? (
        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={0}
          onPageSelected={(e: { nativeEvent: { position: number } }) =>
            setPage(e.nativeEvent.position)
          }
        >
          {pages.map((p, i) => (
            <View key={i} style={{ flex: 1 }} collapsable={false}>
              {p}
            </View>
          ))}
        </PagerView>
      ) : (
        <View style={{ flex: 1 }}>{pages[page]}</View>
      )}
    </View>
  );
}
