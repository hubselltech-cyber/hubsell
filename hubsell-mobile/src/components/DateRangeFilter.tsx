import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  RANGE_PRESETS,
  dateToKey,
  formatDayVN,
  formatRangeLabel,
  keyToDate,
  matchPreset,
  type DateRange,
} from "@/lib/dates";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { PickChip } from "@/components/FilterChips";
import { TABULAR } from "@/theme/tokens";

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/**
 * BỘ LỌC NGÀY CHUẨN của app (anh Trung 04/10) — cùng mốc với DateRangePicker
 * của web: một nút hiện kỳ đang xem, bấm mở hộp gồm các mốc chọn nhanh + LỊCH
 * tự chọn từ ngày – đến ngày, lùi được từng tháng và từng năm. Trang nào cần
 * lọc ngày thì dùng component này, không tự chế dãy nút riêng.
 */
export function DateRangeFilter({
  value,
  onChange,
  className = "",
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        className={`flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 active:opacity-70 dark:border-slate-700 dark:bg-slate-900 ${className}`}
        onPress={() => {
          hapticTap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Kỳ đang xem: ${formatRangeLabel(value)}. Bấm để đổi`}
      >
        <Ionicons name="calendar-outline" size={16} color="#64748b" />
        <Text
          className="flex-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100"
          style={TABULAR}
          numberOfLines={1}
        >
          {formatRangeLabel(value)}
        </Text>
        {matchPreset(value) && value.from !== value.to ? (
          <Text className="text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
            {formatDayVN(value.from).slice(0, 5)} - {formatDayVN(value.to).slice(0, 5)}
          </Text>
        ) : null}
        <Ionicons name="chevron-down" size={14} color="#94a3b8" />
      </Pressable>
      <DateRangeSheet
        visible={open}
        value={value}
        onClose={() => setOpen(false)}
        onApply={(r) => {
          setOpen(false);
          onChange(r);
        }}
      />
    </>
  );
}

function DateRangeSheet({
  visible,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  value: DateRange;
  onClose: () => void;
  onApply: (range: DateRange) => void;
}) {
  // Nháp trong hộp, bấm Áp dụng mới đổ ra ngoài — cùng nết với các hộp lọc khác.
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState<string | null>(value.to);
  const [cursor, setCursor] = useState(() => monthStart(keyToDate(value.to)));
  const todayKey = dateToKey(new Date());
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setFrom(value.from);
      setTo(value.to);
      setCursor(monthStart(keyToDate(value.to)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const draft: DateRange | null = to ? { from, to } : null;
  const activePreset = draft ? matchPreset(draft)?.key : undefined;
  const thisMonth = monthStart(new Date());
  const atCurrentMonth = cursor.getTime() >= thisMonth.getTime();

  const shift = (months: number) => {
    hapticSelect();
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
    // Không lật quá tháng hiện tại — chưa có số liệu tương lai.
    setCursor(next.getTime() > thisMonth.getTime() ? thisMonth : next);
  };

  const pickDay = (key: string) => {
    hapticSelect();
    if (to !== null) {
      // Đang có đủ khoảng → chạm là bắt đầu chọn khoảng mới.
      setFrom(key);
      setTo(null);
    } else if (key < from) {
      // Chạm ngược (ngày sau trước ngày đầu) → tự đảo.
      setTo(from);
      setFrom(key);
    } else {
      setTo(key);
    }
  };

  return (
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          // Đáy chừa thêm phần nút điều hướng / vạch vuốt của máy — không thì nút Áp dụng bị che.
          // Modal đặt statusBarTranslucent + navigationBarTranslucent để LUÔN vẽ tràn viền: có
          // máy tự dừng trên nút điều hướng, có máy vẽ đè lên — ép một kiểu thì phần chừa mới đúng.
          style={{ maxHeight: "92%", paddingBottom: 20 + insets.bottom }}
        >
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chọn khoảng thời gian
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
            <View className="mb-3 flex-row flex-wrap gap-1.5">
              {RANGE_PRESETS.map((p) => (
                <PickChip
                  key={p.key}
                  label={p.label}
                  active={activePreset === p.key}
                  onPress={() => {
                    hapticSelect();
                    const r = p.resolve();
                    setFrom(r.from);
                    setTo(r.to);
                    setCursor(monthStart(keyToDate(r.to)));
                  }}
                />
              ))}
            </View>

            {/* Thanh lật: « năm · ‹ tháng · Tháng m/yyyy · tháng › · năm » */}
            <View className="mb-1 flex-row items-center justify-between">
              <View className="flex-row">
                <NavButton icon="play-back" label="Lùi một năm" onPress={() => shift(-12)} />
                <NavButton icon="chevron-back" label="Lùi một tháng" onPress={() => shift(-1)} />
              </View>
              <Text className="text-sm font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
                Tháng {cursor.getMonth() + 1}/{cursor.getFullYear()}
              </Text>
              <View className="flex-row">
                <NavButton
                  icon="chevron-forward"
                  label="Tới một tháng"
                  disabled={atCurrentMonth}
                  onPress={() => shift(1)}
                />
                <NavButton
                  icon="play-forward"
                  label="Tới một năm"
                  disabled={atCurrentMonth}
                  onPress={() => shift(12)}
                />
              </View>
            </View>

            <View className="flex-row">
              {WEEKDAYS.map((w) => (
                <Text
                  key={w}
                  className="flex-1 py-1 text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500"
                >
                  {w}
                </Text>
              ))}
            </View>
            {/* Lưới 7 cột chia theo tỉ lệ — màn 320 hay 430 đều tự vừa. */}
            <View className="flex-row flex-wrap">
              {cells.map((key, i) => {
                if (!key) return <View key={`e${i}`} style={{ width: `${100 / 7}%` }} className="h-10" />;
                const future = key > todayKey;
                const isEdge = key === from || key === to;
                const inRange = to !== null && key > from && key < to;
                return (
                  <Pressable
                    key={key}
                    style={{ width: `${100 / 7}%` }}
                    className={`h-10 items-center justify-center ${
                      inRange ? "bg-emerald-50 dark:bg-emerald-500/15" : ""
                    }`}
                    disabled={future}
                    onPress={() => pickDay(key)}
                  >
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-full ${
                        isEdge ? "bg-emerald-500" : ""
                      }`}
                    >
                      <Text
                        className={`text-[13px] ${
                          isEdge
                            ? "font-bold text-white"
                            : future
                              ? "text-slate-300 dark:text-slate-700"
                              : key === todayKey
                                ? "font-bold text-emerald-600 dark:text-emerald-400"
                                : "text-slate-800 dark:text-slate-200"
                        }`}
                        style={TABULAR}
                      >
                        {Number(key.slice(8, 10))}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <Text
            className="mt-3 text-center text-[13px] text-slate-600 dark:text-slate-300"
            style={TABULAR}
          >
            {to
              ? from === to
                ? `Ngày ${formatDayVN(from)}`
                : `Từ ${formatDayVN(from)} đến ${formatDayVN(to)}`
              : `Từ ${formatDayVN(from)} — chạm ngày kết thúc`}
          </Text>
          <Pressable
            className={`mt-2 items-center rounded-xl bg-slate-900 py-3 active:opacity-80 dark:bg-slate-700 ${
              draft ? "" : "opacity-40"
            }`}
            disabled={!draft}
            onPress={() => {
              if (draft) {
                hapticSelect();
                onApply(draft);
              }
            }}
          >
            <Text className="text-sm font-semibold text-white">Áp dụng</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function NavButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      className={`h-10 w-10 items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800 ${
        disabled ? "opacity-30" : ""
      }`}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color="#64748b" />
    </Pressable>
  );
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Các ô của một tháng, tuần bắt đầu Thứ 2; ô trống đầu tháng là null. */
function monthCells(first: Date): (string | null)[] {
  const lead = (first.getDay() + 6) % 7; // CN=0 → 6, T2=1 → 0
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) {
    cells.push(dateToKey(new Date(first.getFullYear(), first.getMonth(), d)));
  }
  return cells;
}
