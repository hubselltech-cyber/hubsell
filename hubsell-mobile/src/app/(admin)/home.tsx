import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { NotificationBell } from "@/components/NotificationBell";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { AssistantOrb } from "@/components/AssistantOrb";
import { PlanBanner } from "@/components/PlanBanner";
import { OverviewPage } from "@/screens/OverviewPage";
import { FinancePage } from "@/screens/FinancePage";
import { AdsPage } from "@/screens/AdsPage";
import { useAuth } from "@/auth/AuthContext";
import { accessOf, bellTabFor } from "@/lib/permissions";
import { RequireAccess } from "@/components/RequireAccess";

// react-native-pager-view KHÔNG có bản web — giả lập web chuyển trang bằng tap.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PagerView = Platform.OS === "web" ? null : require("react-native-pager-view").default;

/** Thứ tự cố định — `?page=` của thông báo đẩy đánh số theo danh sách ĐỦ này. */
const ALL_SECTIONS = [
  { key: "overview", label: "Tổng quan" },
  { key: "finance", label: "Tài chính" },
  { key: "ads", label: "Quảng cáo" },
] as const;

/**
 * TRANG CHỦ = 3 trang VUỐT NGANG: Tổng quan → Tài chính → Quảng cáo
 * (Trợ lý quảng cáo, thêm 04/10) — nơi XEM số
 * (chốt thiết kế 13/08, học bố cục "hôm nay" của Salework). Kho là nơi LÀM
 * VIỆC nên 04/10 đã dời xuống thanh tab dưới.
 * Nhân viên thấy đúng những trang được cấp quyền (23/11/2026): Tổng quan theo
 * quyền Tổng quan, Tài chính theo quyền Báo cáo dòng tiền, Quảng cáo theo quyền
 * Trợ lý quảng cáo. Chuông: chủ shop + nhân viên có quyền ứng với một mục thông
 * báo (23/11/2026, máy chủ lọc từng dòng). Trợ lý Hubsell vẫn chỉ chủ shop.
 */
export default function HomeTab() {
  return (
    <RequireAccess allow={(a) => a.home}>
      <Home />
    </RequireAccess>
  );
}

function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const access = accessOf(user);
  const sections = ALL_SECTIONS.filter((s) => access[s.key]);
  const [page, setPage] = useState(0);
  // Ba mục + chuông + dãy chấm không vừa màn hẹp — mục đang chọn đã tô đậm nên bỏ chấm dưới 420 px;
  // dưới 360 px (iPhone SE / 320) nhãn co chữ 13 px + đệm hẹp để chuông không bị đẩy ra ngoài.
  const { width } = useWindowDimensions();
  const showDots = width >= 420;
  const narrow = width < 360;
  const pagerRef = useRef<{ setPage: (i: number) => void } | null>(null);

  const go = (i: number) => {
    if (i !== page) hapticSelect();
    setPage(i);
    pagerRef.current?.setPage(i);
  };

  // Thông báo đẩy mở thẳng trang Tài chính / Quảng cáo: ?page=1|2.
  const { page: pageParam } = useLocalSearchParams<{ page?: string }>();
  useEffect(() => {
    const want = ALL_SECTIONS[Number(pageParam)];
    const i = want ? sections.findIndex((s) => s.key === want.key) : -1;
    if (i >= 0) go(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageParam]);

  const pages = sections.map((s) =>
    s.key === "overview" ? (
      <OverviewPage
        key="overview"
        goWarehouse={() => router.navigate("/(admin)/warehouse?tab=returns" as Href)}
      />
    ) : s.key === "finance" ? (
      <FinancePage key="finance" />
    ) : (
      <AdsPage key="ads" />
    )
  );

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 10 }}>
      {/* Thanh mục + chấm chỉ báo trang */}
      <View className="flex-row items-center gap-1 px-4 pb-2">
        {sections.map(({ key, label }, i) => (
          <Pressable
            key={key}
            className={`rounded-full py-1.5 ${narrow ? "px-2" : "px-3"} ${
              page === i ? "bg-slate-900 dark:bg-slate-100" : ""
            }`}
            onPress={() => go(i)}
          >
            <Text
              className={`font-semibold ${narrow ? "text-[13px]" : "text-sm"} ${
                page === i ? "text-white dark:text-slate-900" : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
        <View className="flex-1" />
        {showDots && sections.length > 1 ? (
          <View className="flex-row gap-1.5 pr-1">
            {sections.map((_, i) => (
              <View
                key={i}
                className={`h-1.5 rounded-full ${
                  page === i ? "w-4 bg-slate-900 dark:bg-slate-100" : "w-1.5 bg-slate-300 dark:bg-slate-700"
                }`}
              />
            ))}
          </View>
        ) : null}
        {bellTabFor(user) === "home" ? <NotificationBell /> : <View className="h-10" />}
      </View>

      {/* Dải nhắc gói: sắp hết hạn (vàng, tắt được) / hết hạn, vượt trần, khóa
          (đỏ, không tắt) — cùng luật PlanQuotaBanner web, chạm → trang gói web. */}
      <PlanBanner />

      {PagerView ? (
        <PagerView
          // Số trang đổi (chủ shop cấp thêm / rút quyền) thì dựng lại pager từ trang đầu.
          key={sections.map((s) => s.key).join("-")}
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
        <View style={{ flex: 1 }}>{pages[Math.min(page, pages.length - 1)]}</View>
      )}

      {/* Orb Trợ lý Hubsell nổi — bấm là mở chat hỏi số liệu (nói hoặc gõ),
          như bong bóng Intercom trên web. Chỉ Trang chủ, không che màn quét kho.
          Chỉ chủ shop: /api/assistant gác adminOnly. */}
      {access.owner ? (
      <Pressable
        onPress={() => {
          hapticTap();
          router.push("/assistant");
        }}
        accessibilityLabel="Mở Trợ lý Hubsell"
        className="absolute bottom-5 right-4 active:opacity-80"
        style={{
          shadowColor: "#10b981",
          shadowOpacity: 0.45,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 3 },
          elevation: 8,
        }}
      >
        <AssistantOrb size={52} />
      </Pressable>
      ) : null}
    </View>
  );
}
