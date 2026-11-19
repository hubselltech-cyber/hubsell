import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { pipelineCounts, type SelectionCounts } from "@/lib/fulfill";
import { TABULAR } from "@/theme/tokens";
import { Sheet } from "@/components/Sheet";

// ============================================================
// HỘP "XỬ LÝ ĐƠN" (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 2) — MỘT cửa cho
// cả dây chuyền của đơn trên app: Chuẩn bị hàng → In phiếu → Đóng gói → Chờ giao. Mỗi công
// đoạn một dòng: bao nhiêu đơn đang nằm ở đó + đúng một nút làm việc của công đoạn.
//
// HAI CÁCH CHỌN ĐƠN (anh Trung 19/11: "thêm dấu tích để tích trực tiếp vào các đơn hàng →
// ấn Xử lý đơn"):
//   - CÓ đơn đang tích ngoài danh sách → hộp làm đúng các đơn đó; số ở hai bước Chuẩn bị
//     hàng / In phiếu là số đơn ĐÃ TÍCH thuộc bước ấy.
//   - KHÔNG tích đơn nào → hộp làm cả nhóm trong phạm vi đang lọc (sàn / gian / hãng / từ
//     khóa); số lấy từ bảng đếm của màn Đơn hàng nên mở hộp không tốn lượt gọi nào.
//
// Vì sao là một hộp chứ không rải nút lên màn Đơn hàng: màn đó đã có ô tìm, nút Đóng gói,
// hàng chip sàn, Bộ lọc, Thống kê — thêm hai nút nữa là rối; và người bán nghĩ theo THỨ TỰ
// việc ("xong bước này tới bước nào"), không theo danh sách nút.
// ============================================================

export type ProcessStage = "arrange" | "print" | "pack" | "packed";

interface StepDef {
  key: ProcessStage;
  title: string;
  /** Câu mô tả khi có đơn / khi trống — theo cả nhóm đang lọc. */
  some: (n: string) => string;
  none: string;
  /** Câu mô tả khi đang làm theo đơn đã tích (chỉ hai bước đầu). */
  picked?: (n: string) => string;
  pickedNone?: string;
  action: string | null;
  icon: keyof typeof Ionicons.glyphMap;
}

const STEPS: StepDef[] = [
  {
    key: "arrange",
    title: "Chuẩn bị hàng",
    some: (n) => `${n} đơn chờ xử lý`,
    none: "Không có đơn mới chờ xử lý",
    picked: (n) => `${n} đơn đã chọn đang chờ xử lý`,
    pickedNone: "Không có đơn đã chọn nào chờ xử lý",
    action: "Chuẩn bị",
    icon: "cube-outline",
  },
  {
    key: "print",
    title: "In phiếu",
    some: (n) => `${n} đơn chưa in phiếu`,
    none: "Không có đơn chờ in phiếu",
    picked: (n) => `${n} đơn đã chọn chưa in phiếu`,
    pickedNone: "Không có đơn đã chọn nào chờ in phiếu",
    action: "In phiếu",
    icon: "print-outline",
  },
  {
    key: "pack",
    title: "Đóng gói",
    some: (n) => `${n} đơn chờ đóng gói`,
    none: "Không có đơn chờ đóng gói",
    action: "Quét",
    icon: "qr-code-outline",
  },
  {
    key: "packed",
    title: "Chờ giao",
    some: (n) => `${n} đơn đã đóng gói, chờ đơn vị vận chuyển lấy`,
    none: "Chưa có kiện nào đã đóng gói",
    action: null,
    icon: "car-outline",
  },
];

export function ProcessSheet({
  visible,
  counts,
  scopeLabel,
  selection,
  onClose,
  onAction,
  onView,
  onReprint,
  onLabelTemplate,
  onClearSelection,
}: {
  visible: boolean;
  /** Bảng đếm của màn Đơn hàng (đã theo phạm vi lọc). */
  counts: Record<string, number>;
  /** "Tất cả gian hàng" / "Shopee · ANO Official Store"… — nói rõ đang làm trên phạm vi nào. */
  scopeLabel: string;
  /** Số đơn đang tích ngoài danh sách theo từng bước; null / total 0 = làm cả nhóm đang lọc. */
  selection: SelectionCounts | null;
  onClose: () => void;
  /** Bấm nút việc của một công đoạn. */
  onAction: (stage: "arrange" | "print" | "pack") => void;
  /** Bấm phần chữ của một công đoạn → xem danh sách đơn đang ở công đoạn đó. */
  onView: (stage: ProcessStage) => void;
  onReprint: () => void;
  onLabelTemplate: () => void;
  onClearSelection: () => void;
}) {
  const n = pipelineCounts(counts);
  const picking = selection !== null && selection.total > 0;
  return (
    <Sheet
      visible={visible}
      title="Xử lý đơn"
      subtitle={picking ? `${groupVN(selection.total)} đơn đã chọn` : scopeLabel}
      onClose={onClose}
    >
      {picking ? (
        <Pressable
          className="mb-2 flex-row items-center gap-1.5 self-start rounded-full bg-slate-100 px-2.5 py-1 active:opacity-70 dark:bg-slate-800"
          onPress={() => {
            hapticTap();
            onClearSelection();
          }}
          accessibilityRole="button"
        >
          <Ionicons name="close" size={12} color="#64748b" />
          <Text className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Bỏ chọn — làm cả nhóm đang lọc
          </Text>
        </Pressable>
      ) : null}
      <View className="pb-1 pt-1">
        {STEPS.map((step, i) => {
          // Hai bước đầu theo đơn đã tích (nếu có); Đóng gói / Chờ giao luôn là số của cả nhóm.
          const byPick = picking && (step.key === "arrange" || step.key === "print");
          const count = byPick ? selection[step.key as "arrange" | "print"] : n[step.key];
          const has = count > 0;
          const last = i === STEPS.length - 1;
          const text = has
            ? byPick
              ? step.picked!(groupVN(count))
              : step.some(groupVN(count))
            : byPick
              ? step.pickedNone!
              : step.none;
          return (
            <View key={step.key} className="flex-row">
              {/* Cột mốc: vòng số + đường nối xuống công đoạn kế. */}
              <View className="w-9 items-center">
                <View
                  className={`h-7 w-7 items-center justify-center rounded-full ${
                    has ? "bg-emerald-500" : "bg-slate-100 dark:bg-slate-800"
                  }`}
                >
                  <Ionicons name={step.icon} size={14} color={has ? "#fff" : "#94a3b8"} />
                </View>
                {last ? null : <View className="w-px flex-1 bg-slate-200 dark:bg-slate-700" />}
              </View>
              <View className={`min-w-0 flex-1 flex-row items-center gap-2 ${last ? "pb-1" : "pb-4"}`}>
                <Pressable
                  className="min-w-0 flex-1 active:opacity-60"
                  onPress={() => {
                    hapticTap();
                    onView(step.key);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Xem đơn ở bước ${step.title}`}
                >
                  <View className="flex-row items-center gap-1">
                    <Text className="text-sm font-bold text-slate-900 dark:text-slate-100">{step.title}</Text>
                    <Ionicons name="chevron-forward" size={12} color="#94a3b8" />
                  </View>
                  <Text
                    className={`text-xs leading-[17px] ${
                      has ? "text-slate-600 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"
                    }`}
                    style={TABULAR}
                  >
                    {text}
                  </Text>
                </Pressable>
                {step.action ? (
                  <Pressable
                    className={`min-w-[84px] items-center rounded-xl px-3 py-2 active:opacity-80 ${
                      has ? "bg-emerald-500" : "bg-slate-100 dark:bg-slate-800"
                    }`}
                    // Đóng gói luôn bấm được: quét là tra theo từng kiện, không phụ thuộc số đếm.
                    disabled={!has && step.key !== "pack"}
                    onPress={() => {
                      hapticTap();
                      onAction(step.key as "arrange" | "print" | "pack");
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !has && step.key !== "pack" }}
                    accessibilityLabel={step.title}
                  >
                    <Text
                      className={`text-xs font-bold ${has ? "text-white" : "text-slate-400 dark:text-slate-500"}`}
                    >
                      {step.action}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* Việc phụ của khâu in — ít dùng nên nằm dưới đường kẻ, không tranh chỗ với bốn bước. */}
      <View className="mt-2 flex-row gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <FootLink
          icon="refresh-outline"
          label={
            picking && selection.reprint > 0
              ? `In lại ${groupVN(selection.reprint)} phiếu đã chọn`
              : "In lại phiếu đã in"
          }
          onPress={onReprint}
        />
        <FootLink icon="options-outline" label="Tùy chỉnh phiếu in" onPress={onLabelTemplate} />
      </View>
    </Sheet>
  );
}

function FootLink({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 active:opacity-70 dark:border-slate-700"
      onPress={() => {
        hapticTap();
        onPress();
      }}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={14} color="#64748b" />
      <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
