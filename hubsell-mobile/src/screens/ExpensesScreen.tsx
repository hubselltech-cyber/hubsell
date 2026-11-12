import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import {
  createExpense,
  deleteExpense,
  fetchExpenses,
  type ExpenseCategory,
  type ExpenseDto,
} from "@/api/expenses";
import { fetchChannels } from "@/api/channels";
import { ApiError, isPlanLockedError } from "@/api/client";
import { Card } from "@/components/Card";
import { PlanLockedCard } from "@/components/PlanLockedCard";
import { ShopFilterField, type ShopScope } from "@/components/ShopFilter";
import { dateToKey, formatDayVN, keyToDate } from "@/lib/dates";
import { formatMoney, groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { CHANNEL_LABEL } from "@/lib/labels";
import { ICON_TINT, TABULAR, type IconTint } from "@/theme/tokens";
import type { ChannelListItem } from "@/types/api";

/**
 * MÀN CHI PHÍ VẬN HÀNH (12/11/2026, khách: "cập nhật được chi phí trên app"; anh Trung:
 * đặt ô ngay dưới Gian hàng ở Tổng quan). Nhập các khoản chi ngoài sàn — đóng gói, lương,
 * mặt bằng… — để Lãi ròng ở trang Tài chính trừ đủ. Cùng dữ liệu với web Tài chính → Chi phí.
 *
 * Gọn hơn web có chủ ý (luồng khách = ít ô nhất):
 *   · chỉ khoản CHI (khoản thu, gắn SKU làm trên web);
 *   · không hỏi "Cố định / Biến đổi" — suy từ nhóm (api/expenses.ts expenseTypeOf);
 *   · "Nội dung" bỏ trống thì lấy tên nhóm.
 * Xóa: bấm vào dòng → hộp chi tiết → Xóa (hỏi lại một lần). Backend không có sửa.
 */

const CATEGORIES: { key: ExpenseCategory; label: string; icon: keyof typeof Ionicons.glyphMap; tint: IconTint; hint: string }[] = [
  { key: "PACKAGING", label: "Đóng gói", icon: "cube-outline", tint: "amber", hint: "Thùng, băng keo, túi…" },
  { key: "SALARY", label: "Nhân viên", icon: "people-outline", tint: "sky", hint: "Lương tháng 11…" },
  { key: "RENT", label: "Mặt bằng", icon: "home-outline", tint: "violet", hint: "Thuê kho, điện nước…" },
  { key: "ADS", label: "Quảng cáo", icon: "megaphone-outline", tint: "red", hint: "Quảng cáo ngoài sàn…" },
  { key: "OTHER", label: "Khác", icon: "ellipsis-horizontal", tint: "slate", hint: "Khoản chi khác…" },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<ExpenseCategory, (typeof CATEGORIES)[number]>;

const WEEKDAY = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

function monthRange(first: Date): { from: string; to: string } {
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { from: dateToKey(first), to: dateToKey(last) };
}
function thisMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}
/** Ngày phát sinh (ISO của máy chủ) → khóa ngày theo đồng hồ máy. */
function dayKeyOf(iso: string): string {
  return dateToKey(new Date(iso));
}
function fundLabel(e: ExpenseDto): string {
  if (e.fundShopName) return e.fundShopName;
  if (e.fundPlatform) return `${CHANNEL_LABEL[e.fundPlatform] ?? e.fundPlatform} · tất cả shop`;
  return "Tất cả shop";
}

export function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [month, setMonth] = useState(thisMonth);
  const [rows, setRows] = useState<ExpenseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<ExpenseDto | null>(null);
  const reqSeq = useRef(0);

  const isCurrentMonth = month.getTime() === thisMonth().getTime();

  const load = useCallback(
    async (mode: "first" | "pull" | "silent" = "first") => {
      const seq = ++reqSeq.current;
      if (mode === "first") setLoading(true);
      else if (mode === "pull") setRefreshing(true);
      try {
        const { from, to } = monthRange(month);
        const res = await fetchExpenses(from, to);
        if (seq !== reqSeq.current) return;
        setRows(res);
        setError("");
        setLocked(null);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        if (isPlanLockedError(err)) setLocked(err.message);
        else if (mode !== "silent") setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại");
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [month]
  );

  useEffect(() => {
    // Lượt tải đẩy sang microtask để không setState thẳng trong effect (luật react-compiler).
    queueMicrotask(() => void load("first"));
  }, [load]);
  useEffect(() => {
    fetchChannels()
      .then(setChannels)
      .catch(() => {}); // hỏng thì form chỉ còn "Tất cả shop"
  }, []);

  // App chỉ làm khoản CHI; khoản thu nhập trên web vẫn nằm chung bảng → đếm để nói rõ.
  const expenses = useMemo(() => rows.filter((r) => r.direction === "EXPENSE"), [rows]);
  const incomeCount = rows.length - expenses.length;
  const total = useMemo(() => expenses.reduce((s, r) => s + r.amount, 0), [expenses]);

  const byCategory = useMemo(() => {
    const sum = new Map<ExpenseCategory, number>();
    for (const r of expenses) sum.set(r.category, (sum.get(r.category) ?? 0) + r.amount);
    return CATEGORIES.map((c) => ({ ...c, amount: sum.get(c.key) ?? 0 }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const days = useMemo(() => {
    const map = new Map<string, ExpenseDto[]>();
    for (const r of expenses) {
      const k = dayKeyOf(r.expenseDate);
      const list = map.get(k);
      if (list) list.push(r);
      else map.set(k, [r]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, items]) => ({ key, items, sum: items.reduce((s, r) => s + r.amount, 0) }));
  }, [expenses]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate("/(admin)/home");
  };
  const stepMonth = (delta: number) => {
    hapticTap();
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950" style={{ paddingTop: insets.top + 6 }}>
      <View className="mb-1 flex-row items-center gap-1 px-2">
        <Pressable
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
        >
          <Ionicons name="chevron-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Chi phí vận hành</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("pull")} />}
      >
        {/* THÁNG + TỔNG CHI */}
        <Card className="p-4">
          <View className="flex-row items-center justify-between">
            <Pressable
              className="h-9 w-9 items-center justify-center rounded-full bg-slate-100 active:opacity-60 dark:bg-slate-800"
              onPress={() => stepMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Tháng trước"
            >
              <Ionicons name="chevron-back" size={18} color="#64748b" />
            </Pressable>
            <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200" style={TABULAR}>
              Tháng {month.getMonth() + 1}/{month.getFullYear()}
            </Text>
            <Pressable
              className={`h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 ${
                isCurrentMonth ? "opacity-30" : "active:opacity-60"
              }`}
              onPress={() => stepMonth(1)}
              disabled={isCurrentMonth}
              accessibilityRole="button"
              accessibilityLabel="Tháng sau"
            >
              <Ionicons name="chevron-forward" size={18} color="#64748b" />
            </Pressable>
          </View>

          <Text className="mt-4 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Tổng chi trong tháng
          </Text>
          <Text
            className="mt-1 text-center text-3xl font-extrabold text-slate-900 dark:text-slate-50"
            style={TABULAR}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {locked || loading ? "—" : formatMoney(total)}
          </Text>

          {byCategory.length > 0 && !loading ? (
            <View className="mt-4 gap-2">
              {byCategory.map((c) => (
                <View key={c.key} className="flex-row items-center gap-2">
                  <Text className="w-[72px] text-xs text-slate-500 dark:text-slate-400" numberOfLines={1}>
                    {c.label}
                  </Text>
                  <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <View
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(3, Math.round((c.amount / total) * 100))}%`,
                        backgroundColor: ICON_TINT[c.tint].icon,
                      }}
                    />
                  </View>
                  <Text
                    className="w-[92px] text-right text-xs font-semibold text-slate-700 dark:text-slate-200"
                    style={TABULAR}
                    numberOfLines={1}
                  >
                    {formatMoney(c.amount)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        {loading ? (
          <View className="items-center py-14">
            <ActivityIndicator size="large" color="#64748b" />
          </View>
        ) : locked ? (
          <View className="mt-3">
            <PlanLockedCard message={locked} onRetry={() => void load("first")} />
          </View>
        ) : error ? (
          <Card className="mt-3 items-center p-6">
            <Text className="text-center text-sm text-red-600 dark:text-red-400">{error}</Text>
            <Pressable className="mt-3" onPress={() => void load("first")}>
              <Text className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Thử lại</Text>
            </Pressable>
          </Card>
        ) : days.length === 0 ? (
          <View className="items-center px-6 py-12">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Ionicons name="wallet-outline" size={26} color="#94a3b8" />
            </View>
            <Text className="text-center text-sm font-medium text-slate-700 dark:text-slate-200">
              Chưa có khoản chi nào trong tháng {month.getMonth() + 1}
            </Text>
            <Text className="mt-1 text-center text-xs leading-5 text-slate-400 dark:text-slate-500">
              Nhập tiền đóng gói, lương, mặt bằng… để Lãi ròng ở trang Tài chính trừ đủ chi phí.
            </Text>
          </View>
        ) : (
          days.map((d) => {
            const date = keyToDate(d.key);
            return (
              <View key={d.key} className="mt-4">
                <View className="mb-1.5 flex-row items-baseline justify-between px-1">
                  <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400" style={TABULAR}>
                    {WEEKDAY[date.getDay()]}, {formatDayVN(d.key).slice(0, 5)}
                  </Text>
                  {d.items.length > 1 ? (
                    <Text className="text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                      {formatMoney(d.sum)}
                    </Text>
                  ) : null}
                </View>
                <Card className="overflow-hidden">
                  {d.items.map((e, i) => (
                    <ExpenseRow key={e.id} e={e} first={i === 0} onPress={() => setViewing(e)} />
                  ))}
                </Card>
              </View>
            );
          })
        )}

        {incomeCount > 0 && !loading && !locked ? (
          <Text className="mt-4 px-1 text-center text-[11px] leading-4 text-slate-400 dark:text-slate-500">
            Tháng này còn {groupVN(incomeCount)} khoản thu nhập trên web — xem ở Tài chính → Chi phí trên máy tính.
          </Text>
        ) : null}
      </ScrollView>

      {/* NÚT THÊM — dính đáy, luôn trong tầm ngón cái */}
      {!locked ? (
        <View
          className="absolute inset-x-0 bottom-0 border-t border-slate-200/70 bg-slate-50/95 px-4 pt-3 dark:border-slate-800 dark:bg-slate-950/95"
          style={{ paddingBottom: 12 + insets.bottom }}
        >
          <Pressable
            className="flex-row items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 active:opacity-80"
            onPress={() => {
              hapticTap();
              setAdding(true);
            }}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={20} color="#ffffff" />
            <Text className="text-[15px] font-bold text-white">Thêm khoản chi</Text>
          </Pressable>
        </View>
      ) : null}

      {adding ? (
        <AddExpenseSheet
          channels={channels}
          onClose={() => setAdding(false)}
          onSaved={(dayKey) => {
            setAdding(false);
            // Khoản vừa nhập thuộc tháng khác tháng đang xem → nhảy sang tháng đó để thấy nó.
            const d = keyToDate(dayKey);
            const first = new Date(d.getFullYear(), d.getMonth(), 1);
            if (first.getTime() !== month.getTime()) setMonth(first);
            else void load("silent");
          }}
        />
      ) : null}

      {viewing ? (
        <ExpenseDetailSheet
          e={viewing}
          onClose={() => setViewing(null)}
          onDeleted={() => {
            setRows((prev) => prev.filter((r) => r.id !== viewing.id));
            setViewing(null);
          }}
        />
      ) : null}
    </View>
  );
}

function CategoryDisc({ category, size = 40 }: { category: ExpenseCategory; size?: number }) {
  const dark = useColorScheme().colorScheme === "dark";
  const c = CAT[category] ?? CAT.OTHER;
  const tint = ICON_TINT[c.tint];
  return (
    <View
      className="items-center justify-center rounded-xl"
      style={{ width: size, height: size, backgroundColor: dark ? tint.dark : tint.light }}
    >
      <Ionicons name={c.icon} size={Math.round(size / 2)} color={tint.icon} />
    </View>
  );
}

function ExpenseRow({ e, first, onPress }: { e: ExpenseDto; first: boolean; onPress: () => void }) {
  const c = CAT[e.category] ?? CAT.OTHER;
  return (
    <Pressable
      className={`flex-row items-center gap-3 px-3 py-3 active:bg-slate-50 dark:active:bg-slate-800 ${
        first ? "" : "border-t border-slate-100 dark:border-slate-800"
      }`}
      onPress={() => {
        hapticTap();
        onPress();
      }}
      accessibilityRole="button"
    >
      <CategoryDisc category={e.category} />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
          {e.name}
        </Text>
        <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
          {/* Nội dung bỏ trống thì tên = tên nhóm → không lặp lại nhóm ở dòng phụ. */}
          {e.name === c.label ? fundLabel(e) : `${c.label} · ${fundLabel(e)}`}
        </Text>
      </View>
      <Text className="text-sm font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
        {formatMoney(e.amount)}
      </Text>
    </Pressable>
  );
}

// ───────── Hộp chi tiết + xóa ─────────
function ExpenseDetailSheet({
  e,
  onClose,
  onDeleted,
}: {
  e: ExpenseDto;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = CAT[e.category] ?? CAT.OTHER;

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteExpense(e.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xóa được, thử lại");
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900" style={{ paddingBottom: 16 + insets.bottom }}>
          <View className="mb-3 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="flex-row items-center gap-3">
            <CategoryDisc category={e.category} size={48} />
            <View className="min-w-0 flex-1">
              <Text className="text-base font-bold leading-[22px] text-slate-900 dark:text-slate-100">{e.name}</Text>
              <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.label}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng">
              <Ionicons name="close" size={22} color="#64748b" />
            </Pressable>
          </View>

          <View className="mt-4 rounded-2xl bg-slate-50 px-3 py-1 dark:bg-slate-950">
            <DetailRow label="Số tiền" value={formatMoney(e.amount)} bold />
            <DetailRow label="Ngày phát sinh" value={formatDayVN(dayKeyOf(e.expenseDate))} />
            <DetailRow label="Áp dụng cho" value={fundLabel(e)} />
            {e.appliedSku ? <DetailRow label="Gắn vào SKU" value={e.appliedSku} /> : null}
            {e.note ? <DetailRow label="Ghi chú" value={e.note} wrap /> : null}
          </View>

          {error ? <Text className="mt-3 text-center text-xs text-red-600 dark:text-red-400">{error}</Text> : null}

          {confirm ? (
            <View className="mt-4">
              <Text className="mb-2 text-center text-[13px] text-slate-600 dark:text-slate-300">
                Xóa khoản chi này? Lãi ròng của tháng sẽ tính lại.
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  className="flex-1 items-center rounded-2xl bg-slate-100 py-3 active:opacity-70 dark:bg-slate-800"
                  onPress={() => setConfirm(false)}
                  disabled={busy}
                >
                  <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">Giữ lại</Text>
                </Pressable>
                <Pressable
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-red-600 py-3 active:opacity-80"
                  onPress={() => void remove()}
                  disabled={busy}
                >
                  {busy ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                  <Text className="text-sm font-bold text-white">Xóa</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              className="mt-4 flex-row items-center justify-center gap-2 rounded-2xl border border-red-200 py-3 active:opacity-70 dark:border-red-500/30"
              onPress={() => {
                hapticTap();
                setConfirm(true);
              }}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={16} color="#dc2626" />
              <Text className="text-sm font-semibold text-red-600 dark:text-red-400">Xóa khoản chi</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value, bold = false, wrap = false }: { label: string; value: string; bold?: boolean; wrap?: boolean }) {
  return (
    <View className="flex-row items-start justify-between gap-4 py-2">
      <Text className="text-[13px] text-slate-500 dark:text-slate-400">{label}</Text>
      <Text
        className={`flex-1 text-right text-[13px] text-slate-900 dark:text-slate-100 ${bold ? "font-bold" : "font-medium"}`}
        style={TABULAR}
        numberOfLines={wrap ? undefined : 1}
      >
        {value}
      </Text>
    </View>
  );
}

// ───────── Form thêm khoản chi ─────────
function AddExpenseSheet({
  channels,
  onClose,
  onSaved,
}: {
  channels: ChannelListItem[];
  onClose: () => void;
  /** Khóa ngày (yyyy-mm-dd) của khoản vừa lưu. */
  onSaved: (dayKey: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("PACKAGING");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<ShopScope>({ channelName: "", channelId: "" });
  // Số ngày lùi so với hôm nay (0 = hôm nay). Không cho chọn ngày tương lai.
  const [back, setBack] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const day = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - back);
    return d;
  }, [back]);
  const dayKey = dateToKey(day);
  const dayLabel = back === 0 ? "Hôm nay" : back === 1 ? "Hôm qua" : WEEKDAY[day.getDay()];

  const value = Number(amount || "0");
  const canSave = value > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      await createExpense({
        name: name.trim() || CAT[category].label,
        amount: value,
        category,
        // Hôm nay: để máy chủ lấy đúng giờ lưu (khoản mới nhất nằm trên cùng).
        expenseDate: back === 0 ? undefined : dayKey,
        fundChannelId: scope.channelId,
        fundPlatform: scope.channelName,
        note: note.trim(),
      });
      onSaved(dayKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không lưu được, thử lại");
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView className="flex-1 justify-end bg-black/40" behavior="padding">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="rounded-t-3xl bg-white px-4 pt-3 dark:bg-slate-900"
          style={{ maxHeight: "92%", paddingBottom: 16 + insets.bottom }}
        >
          <View className="mb-2 items-center">
            <View className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          </View>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-bold text-slate-900 dark:text-slate-100">Thêm khoản chi</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng">
              <Ionicons name="close" size={22} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* SỐ TIỀN — ô to nhất, bàn phím số mở sẵn */}
            <View className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Số tiền
              </Text>
              <View className="mt-1 flex-row items-baseline gap-2">
                <TextInput
                  className="flex-1 p-0 text-3xl font-extrabold text-slate-900 dark:text-slate-50"
                  style={[TABULAR, { minWidth: 0 }]}
                  placeholder="0"
                  placeholderTextColor="#cbd5e1"
                  keyboardType="number-pad"
                  autoFocus
                  value={amount ? groupVN(Number(amount)) : ""}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, "").replace(/^0+/, "").slice(0, 12))}
                  accessibilityLabel="Số tiền"
                />
                <Text className="text-lg font-bold text-slate-400 dark:text-slate-500">₫</Text>
              </View>
            </View>

            {/* NHÓM */}
            <FieldLabel>Nhóm chi phí</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const active = category === c.key;
                return (
                  <Pressable
                    key={c.key}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${
                      active
                        ? "border-emerald-600 bg-emerald-600"
                        : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    }`}
                    onPress={() => {
                      hapticTap();
                      setCategory(c.key);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Ionicons name={c.icon} size={14} color={active ? "#ffffff" : "#64748b"} />
                    <Text className={`text-[13px] font-semibold ${active ? "text-white" : "text-slate-700 dark:text-slate-200"}`}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* NỘI DUNG */}
            <FieldLabel>Nội dung (không bắt buộc)</FieldLabel>
            <TextInput
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder={CAT[category].hint}
              placeholderTextColor="#94a3b8"
              value={name}
              onChangeText={setName}
              maxLength={120}
              returnKeyType="done"
            />

            {/* NGÀY */}
            <FieldLabel>Ngày phát sinh</FieldLabel>
            <View className="flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              <Pressable
                className="h-9 w-9 items-center justify-center rounded-lg bg-slate-100 active:opacity-60 dark:bg-slate-800"
                onPress={() => {
                  hapticTap();
                  setBack((b) => Math.min(b + 1, 365));
                }}
                accessibilityRole="button"
                accessibilityLabel="Lùi một ngày"
              >
                <Ionicons name="chevron-back" size={16} color="#64748b" />
              </Pressable>
              <Text className="flex-1 text-center text-sm font-semibold text-slate-800 dark:text-slate-100" style={TABULAR}>
                {dayLabel}, {formatDayVN(dayKey)}
              </Text>
              <Pressable
                className={`h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 ${
                  back === 0 ? "opacity-30" : "active:opacity-60"
                }`}
                onPress={() => {
                  hapticTap();
                  setBack((b) => Math.max(b - 1, 0));
                }}
                disabled={back === 0}
                accessibilityRole="button"
                accessibilityLabel="Tới một ngày"
              >
                <Ionicons name="chevron-forward" size={16} color="#64748b" />
              </Pressable>
            </View>

            {/* GIAN ÁP DỤNG — chỉ hỏi khi shop có từ 2 gian; 1 gian thì "Tất cả shop" là đủ */}
            {channels.length > 1 ? (
              <>
                <FieldLabel>Áp dụng cho</FieldLabel>
                <ShopFilterField mode="scope" channels={channels} value={scope} onChange={setScope} />
              </>
            ) : null}

            {/* GHI CHÚ */}
            <FieldLabel>Ghi chú (không bắt buộc)</FieldLabel>
            <TextInput
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Ví dụ: chuyển khoản cho anh Nam"
              placeholderTextColor="#94a3b8"
              value={note}
              onChangeText={setNote}
              maxLength={300}
              returnKeyType="done"
            />

            {error ? <Text className="mt-3 text-center text-xs text-red-600 dark:text-red-400">{error}</Text> : null}
          </ScrollView>

          <Pressable
            className={`mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-3.5 ${
              canSave ? "bg-emerald-600 active:opacity-80" : "bg-slate-200 dark:bg-slate-800"
            }`}
            onPress={() => void save()}
            disabled={!canSave}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator size="small" color="#ffffff" /> : null}
            <Text className={`text-[15px] font-bold ${canSave ? "text-white" : "text-slate-400 dark:text-slate-500"}`}>
              {value > 0 ? `Lưu khoản chi ${formatMoney(value)}` : "Nhập số tiền để lưu"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mb-1.5 mt-4 text-xs font-semibold text-slate-500 dark:text-slate-400">{children}</Text>
  );
}
