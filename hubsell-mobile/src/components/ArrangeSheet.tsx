import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "@/api/client";
import type { OrdersFilter } from "@/api/orders";
import {
  fetchProcessQueue,
  fetchShippingOptions,
  isNoReadyOrders,
  runBulkConfirm,
  type BulkConfirmResult,
  type FulfillChoice,
  type ProcessQueue,
  type ShippingOptionGroup,
} from "@/api/fulfill";
import { choiceProblem, confirmView, initialChoice, isRunnable, selectedOrderIds } from "@/lib/fulfill";
import { CHANNEL_LABEL } from "@/lib/labels";
import { groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { useChannelColors } from "@/theme/channel-colors";
import { TABULAR } from "@/theme/tokens";
import { Sheet, SheetButton } from "@/components/Sheet";

// ============================================================
// HỘP "CHUẨN BỊ HÀNG" TRÊN APP (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 3)
//
// Cùng việc với hộp Chuẩn bị hàng của web: báo sàn SẮP XẾP VẬN CHUYỂN thật, chạy nền theo
// mẻ trên máy chủ. Khác web ở cách chọn đơn: app không tích từng dòng — mở từ hộp Xử lý
// đơn là làm MỌI đơn Chờ xử lý trong phạm vi đang lọc (tối đa 200 / lượt, hỏa tốc trước);
// mở từ chi tiết một đơn là làm riêng đơn đó. Mỗi gian một thẻ, bỏ tích được cả gian.
//
// Ba màn trong một hộp: chọn (gian + cách giao) → đang chạy (thanh tiến độ) → kết quả
// (sàn nhận bao nhiêu, đơn nào bị từ chối vì sao, nút đi tiếp sang In phiếu).
//
// Màn gọi đổi `key` mỗi lần MỞ hộp → trạng thái bên trong luôn bắt đầu sạch từ useState,
// không phải đặt lại trong effect.
// ============================================================

type Phase = "loading" | "ready" | "running" | "done" | "error";

export function ArrangeSheet({
  visible,
  scope,
  orderIds,
  canPrint,
  onClose,
  onDone,
  onPrint,
}: {
  visible: boolean;
  /** Phạm vi lọc của màn Đơn hàng — dùng khi làm cả nhóm. */
  scope: OrdersFilter;
  /** Có = chỉ làm đúng các đơn này (mở từ chi tiết một đơn, hoặc các đơn đang tích ngoài danh sách). */
  orderIds?: string[];
  /** Máy này in được (bản app có module in) → màn kết quả có nút "In phiếu". */
  canPrint: boolean;
  onClose: () => void;
  /** Sàn đã nhận ít nhất một đơn (hoặc trạng thái đơn đã đổi) → màn ngoài tải lại. */
  onDone: () => void;
  /** Đi tiếp sang In phiếu cho đúng các đơn sàn vừa nhận. */
  onPrint: (orderIds: string[]) => void;
}) {
  const channelColors = useChannelColors();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<ProcessQueue | null>(null);
  const [groups, setGroups] = useState<ShippingOptionGroup[]>([]);
  const [unpaid, setUnpaid] = useState(0);
  const [choices, setChoices] = useState<Record<string, FulfillChoice>>({});
  /** Gian người dùng bỏ tích. */
  const [off, setOff] = useState<Set<string>>(new Set());
  /** Gian đang mở phần đổi cách giao. */
  const [editing, setEditing] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reattached, setReattached] = useState(false);
  const [result, setResult] = useState<BulkConfirmResult | null>(null);
  /** id đơn của từng gian (chế độ một đơn: không có hàng chờ, dùng thẳng orderIds). */
  const idsByChannel = useRef<Map<string, string[]>>(new Map());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const single = Boolean(orderIds && orderIds.length > 0);
  const orderIdsKey = orderIds?.join(",") ?? "";

  useEffect(() => {
    if (!visible) return;
    let stale = false;
    (async () => {
      let ids = orderIds ?? [];
      let q: ProcessQueue | null = null;
      if (!single) {
        q = await fetchProcessQueue("ARRANGE", scope);
        ids = selectedOrderIds(q.groups, new Set());
        for (const g of q.groups) {
          idsByChannel.current.set(
            g.channelId,
            g.carriers.flatMap((c) => c.orderIds)
          );
        }
      }
      if (stale) return;
      setQueue(q);
      if (ids.length === 0) {
        setUnpaid(q?.unpaid ?? 0);
        setPhase("ready");
        return;
      }
      const opts = await fetchShippingOptions(ids);
      if (stale) return;
      const init: Record<string, FulfillChoice> = {};
      for (const g of opts.groups) {
        if (g.mode === "PLATFORM" && g.methods.length > 0) init[g.channelId] = initialChoice(g);
      }
      // Xếp gian theo đúng thứ tự của hàng chờ (Shopee → TikTok → Lazada, rồi tên) — cùng thứ
      // tự với cây gian ở hộp In phiếu; máy chủ trả theo thứ tự nó hỏi sàn.
      const rank = new Map((q?.groups ?? []).map((g, i) => [g.channelId, i]));
      setGroups(
        [...opts.groups].sort(
          (a, b) => (rank.get(a.channelId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.channelId) ?? Number.MAX_SAFE_INTEGER)
        )
      );
      setChoices(init);
      // Hàng chờ đã bỏ đơn chưa thanh toán và đếm riêng; chế độ một đơn thì máy chủ báo ở đây.
      setUnpaid(q ? q.unpaid : opts.unpaidCount);
      setPhase("ready");
    })().catch((err) => {
      if (stale) return;
      setError(err instanceof ApiError ? err.message : "Không hỏi được sàn phương án vận chuyển");
      setPhase("error");
    });
    return () => {
      stale = true;
    };
    // scope dựng mới mỗi render — nạp lại khi MỞ hộp hoặc đổi đơn là đủ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, orderIdsKey]);

  const expressOf = (channelId: string) => queue?.groups.find((g) => g.channelId === channelId)?.express ?? 0;
  const active = groups.filter((g) => isRunnable(g) && !off.has(g.channelId));
  const blocking = active.map((g) => choiceProblem(g, choices[g.channelId])).find(Boolean) ?? null;
  const runCount = active.reduce((s, g) => s + g.orderCount, 0);
  const skippedGroups = groups.filter((g) => !isRunnable(g));

  const setChoice = (channelId: string, patch: Partial<FulfillChoice>) =>
    setChoices((prev) => ({ ...prev, [channelId]: { ...prev[channelId], ...patch } }));

  const run = async () => {
    hapticTap();
    const ids = single
      ? (orderIds ?? [])
      : active.flatMap((g) => idsByChannel.current.get(g.channelId) ?? []);
    setPhase("running");
    setProgress(null);
    try {
      const res = await runBulkConfirm(
        ids,
        choices,
        (done, total) => {
          if (alive.current) setProgress({ done, total });
        },
        () => {
          if (alive.current) setReattached(true);
        }
      );
      if (!alive.current) return;
      setResult(res);
      setPhase("done");
      onDone();
    } catch (err) {
      if (!alive.current) return;
      // Không còn đơn nào ở Chờ xử lý (thường là sàn đã nhận ở lượt trước): câu của máy chủ
      // đã nói rõ; màn ngoài tải lại để danh sách không còn đơn cũ.
      if (isNoReadyOrders(err)) onDone();
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra khi chuẩn bị hàng");
      setPhase("error");
    }
  };

  // Số đơn chỉ nằm trên tiêu đề ở màn CHỌN — sang màn đang chạy / kết quả thì con số đúng là
  // số trong thân hộp (người dùng có thể đã bỏ tích bớt gian).
  const title =
    phase !== "ready"
      ? "Chuẩn bị hàng"
      : single
        ? (orderIds?.length ?? 0) > 1
          ? `Chuẩn bị hàng · ${groupVN(orderIds!.length)} đơn đã chọn`
          : "Chuẩn bị hàng"
        : queue && queue.total > 0
          ? `Chuẩn bị hàng · ${groupVN(queue.total)} đơn`
          : "Chuẩn bị hàng";

  return (
    <Sheet visible={visible} title={title} onClose={onClose} locked={phase === "running"}>
      {phase === "loading" ? (
        <View className="items-center py-10">
          <ActivityIndicator size="large" color="#64748b" />
          <Text className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Đang hỏi sàn phương án vận chuyển…
          </Text>
        </View>
      ) : null}

      {phase === "error" ? (
        <View className="py-2">
          <Notice tone="danger" text={error} />
          <View className="mt-3 flex-row">
            <SheetButton label="Đóng" tone="plain" onPress={onClose} />
          </View>
        </View>
      ) : null}

      {phase === "ready" ? (
        groups.length === 0 ? (
          <View className="py-2">
            <View className="items-center py-6">
              <Ionicons name="checkmark-circle-outline" size={32} color="#94a3b8" />
              <Text className="mt-2 text-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                Không có đơn nào chuẩn bị được lúc này
              </Text>
              {unpaid > 0 ? (
                <Text className="mt-1 text-center text-xs leading-[18px] text-slate-400 dark:text-slate-500">
                  {groupVN(unpaid)} đơn đang chờ khách thanh toán — sàn chỉ cho chuẩn bị sau khi khách trả tiền.
                </Text>
              ) : null}
            </View>
            <View className="flex-row">
              <SheetButton label="Đóng" tone="plain" onPress={onClose} />
            </View>
          </View>
        ) : (
          <>
            <ScrollView showsVerticalScrollIndicator={false} className="shrink">
              <Text className="mb-2 text-xs leading-[18px] text-slate-500 dark:text-slate-400">
                Hubsell báo sàn sắp xếp vận chuyển cho từng đơn, như bấm trên app của sàn. Sàn nhận rồi thì
                không hoàn tác được.
              </Text>
              {queue?.truncated ? (
                <Notice
                  tone="info"
                  text={`Mỗi lượt tối đa ${groupVN(queue.max)} đơn (hỏa tốc và đơn cũ trước). Còn ${groupVN(
                    queue.total - queue.taken
                  )} đơn — làm tiếp sau lượt này.`}
                />
              ) : null}
              {unpaid > 0 ? (
                <Notice
                  tone="warn"
                  text={`${groupVN(unpaid)} đơn khách chưa thanh toán không nằm trong lượt này — sàn chỉ cho chuẩn bị sau khi khách trả tiền.`}
                />
              ) : null}
              {groups.map((g) => {
                const runnable = isRunnable(g);
                const checked = runnable && !off.has(g.channelId);
                const choice = choices[g.channelId];
                const problem = checked ? choiceProblem(g, choice) : null;
                const express = expressOf(g.channelId);
                const canEdit = g.mode === "PLATFORM" && g.methods.length > 0 && Boolean(choice);
                const open = editing === g.channelId;
                return (
                  <View
                    key={g.channelId}
                    className={`mb-2 rounded-2xl border p-3 ${
                      g.mode === "ERROR"
                        ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
                        : g.mode === "UNSUPPORTED"
                          ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                          : "border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <Pressable
                      className="flex-row items-center gap-2.5"
                      disabled={!runnable || single || groups.length === 1}
                      onPress={() => {
                        hapticTap();
                        setOff((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.channelId)) next.delete(g.channelId);
                          else next.add(g.channelId);
                          return next;
                        });
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={`Gian ${g.shopName}`}
                    >
                      {single || groups.length === 1 || !runnable ? null : <CheckBox checked={checked} />}
                      <View
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: channelColors[g.channelName] ?? channelColors.OFFLINE }}
                      />
                      <View className="min-w-0 flex-1">
                        <Text className="text-[13px] font-bold text-slate-900 dark:text-slate-100" numberOfLines={1}>
                          {g.shopName}
                        </Text>
                        <Text className="text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
                          {CHANNEL_LABEL[g.channelName] ?? g.channelName} · {groupVN(g.orderCount)} đơn
                          {express > 0 ? (
                            <Text className="font-bold text-red-500 dark:text-red-400">
                              {" "}
                              · ⚡ {groupVN(express)} hỏa tốc
                            </Text>
                          ) : null}
                        </Text>
                      </View>
                    </Pressable>

                    {canEdit && choice ? (
                      <>
                        {/* Dòng tóm tắt cách giao đã điền sẵn (lần trước của gian / mặc định của sàn). */}
                        <Pressable
                          className="mt-2 flex-row items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 active:opacity-70 dark:bg-slate-800"
                          onPress={() => {
                            hapticTap();
                            setEditing(open ? null : g.channelId);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Đổi cách giao hàng"
                        >
                          <Ionicons
                            name={choice.method === "PICKUP" ? "bicycle-outline" : "storefront-outline"}
                            size={15}
                            color="#64748b"
                          />
                          <Text className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-200" numberOfLines={2}>
                            {choiceSummary(g, choice)}
                          </Text>
                          <Text className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                            {open ? "Xong" : "Đổi"}
                          </Text>
                        </Pressable>
                        {open ? (
                          <ChoiceEditor group={g} choice={choice} onChange={(p) => setChoice(g.channelId, p)} />
                        ) : null}
                      </>
                    ) : null}

                    {problem ? (
                      <Text className="mt-2 text-xs leading-[17px] text-rose-600 dark:text-rose-400">{problem}</Text>
                    ) : null}
                    {g.note ? (
                      <Text
                        className={`mt-2 text-xs leading-[17px] ${
                          g.mode === "ERROR"
                            ? "text-rose-700 dark:text-rose-300"
                            : g.mode === "UNSUPPORTED"
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {g.note}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              {skippedGroups.length > 0 ? (
                <Text className="mb-1 text-[11px] text-slate-400 dark:text-slate-500">
                  Gian có ghi chú đỏ / vàng sẽ bị bỏ qua ở lượt này.
                </Text>
              ) : null}
            </ScrollView>
            <View className="mt-2 flex-row gap-2">
              <SheetButton
                label={runCount > 0 ? `Chuẩn bị ${groupVN(runCount)} đơn` : "Chưa chọn gian nào"}
                icon="cube-outline"
                disabled={runCount === 0 || Boolean(blocking)}
                onPress={() => void run()}
              />
            </View>
          </>
        )
      ) : null}

      {phase === "running" ? (
        <View className="py-6">
          <View className="items-center">
            <ActivityIndicator size="large" color="#10b981" />
            <Text className="mt-3 text-sm font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
              {progress
                ? `Sàn đã sắp xếp ${groupVN(progress.done)}/${groupVN(progress.total)} đơn`
                : "Đang gửi lệnh tới sàn…"}
            </Text>
          </View>
          <View className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <View
              className="h-2 rounded-full bg-emerald-500"
              style={{
                width: `${progress && progress.total > 0 ? Math.max(4, (progress.done / progress.total) * 100) : 4}%`,
              }}
            />
          </View>
          <Text className="mt-3 text-center text-[11px] leading-4 text-slate-400 dark:text-slate-500">
            {reattached
              ? "Lượt trước vẫn đang chạy — đang theo dõi tiếp lượt đó."
              : "Máy chủ đang chạy lượt này; lỡ thoát app thì máy chủ vẫn làm tiếp."}
          </Text>
        </View>
      ) : null}

      {phase === "done" && result ? <ResultView result={result} canPrint={canPrint} onClose={onClose} onPrint={onPrint} /> : null}
    </Sheet>
  );
}

/** Một dòng tóm tắt cách giao của gian: "Shipper tới lấy · Hôm nay, 14:00 – 18:00 · Kho chính…". */
function choiceSummary(g: ShippingOptionGroup, c: FulfillChoice): string {
  if (c.method === "DROPOFF") {
    const branch = g.dropoffBranches.find((b) => b.id === c.branchId);
    return branch ? `Tự mang ra bưu cục · ${branch.label}` : "Tự mang ra bưu cục";
  }
  const addr = g.pickupAddresses.find((a) => a.id === c.addressId);
  const slot = addr?.timeSlots.find((s) => s.id === c.pickupTimeId);
  return ["Shipper tới lấy", slot?.label, addr?.label].filter(Boolean).join(" · ");
}

/** Phần đổi cách giao của một gian: cách giao → địa chỉ → khung giờ / bưu cục. */
function ChoiceEditor({
  group: g,
  choice,
  onChange,
}: {
  group: ShippingOptionGroup;
  choice: FulfillChoice;
  onChange: (patch: Partial<FulfillChoice>) => void;
}) {
  const address = g.pickupAddresses.find((a) => a.id === choice.addressId);
  return (
    <View className="mt-2">
      {g.methods.length > 1 ? (
        <View className="mb-2 flex-row gap-2">
          {g.methods.includes("PICKUP") ? (
            <Pill label="Shipper tới lấy" active={choice.method === "PICKUP"} onPress={() => onChange({ method: "PICKUP" })} />
          ) : null}
          {g.methods.includes("DROPOFF") ? (
            <Pill
              label="Tự mang ra bưu cục"
              active={choice.method === "DROPOFF"}
              onPress={() => onChange({ method: "DROPOFF" })}
            />
          ) : null}
        </View>
      ) : null}
      {choice.method === "PICKUP" && g.pickupAddresses.length > 0 ? (
        <>
          <FieldLabel text="Địa chỉ lấy hàng" />
          {g.pickupAddresses.map((a) => (
            <RadioRow
              key={a.id}
              label={a.label}
              active={a.id === choice.addressId}
              onPress={() => onChange({ addressId: a.id, pickupTimeId: a.timeSlots[0]?.id })}
            />
          ))}
        </>
      ) : null}
      {choice.method === "PICKUP" && address && address.timeSlots.length > 0 ? (
        <>
          <FieldLabel text="Khung giờ lấy hàng" />
          <View className="flex-row flex-wrap gap-1.5">
            {address.timeSlots.map((s) => (
              <Pill
                key={s.id}
                label={s.label}
                active={s.id === choice.pickupTimeId}
                onPress={() => onChange({ pickupTimeId: s.id })}
              />
            ))}
          </View>
        </>
      ) : null}
      {choice.method === "DROPOFF" && g.dropoffBranches.length > 0 ? (
        <>
          <FieldLabel text="Bưu cục gửi" />
          {g.dropoffBranches.map((b) => (
            <RadioRow
              key={b.id}
              label={b.label}
              active={b.id === choice.branchId}
              onPress={() => onChange({ branchId: b.id })}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function ResultView({
  result,
  canPrint,
  onClose,
  onPrint,
}: {
  result: BulkConfirmResult;
  canPrint: boolean;
  onClose: () => void;
  onPrint: (orderIds: string[]) => void;
}) {
  const view = confirmView(result);
  const color = view.tone === "ok" ? "#10b981" : view.tone === "partial" ? "#f59e0b" : "#ef4444";
  const icon = view.tone === "ok" ? "checkmark-circle" : view.tone === "partial" ? "alert-circle" : "close-circle";
  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} className="shrink">
        <View className="items-center py-4">
          <Ionicons name={icon} size={40} color={color} />
          <Text className="mt-2 text-center text-base font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
            {view.title}
          </Text>
          {view.tone !== "fail" ? (
            <Text className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
              Đơn đã sang Đã xử lý · Chưa in phiếu.
            </Text>
          ) : null}
        </View>
        {view.notes.map((n) => (
          <Notice key={n} tone="info" text={n} />
        ))}
        {view.problems.length > 0 ? (
          <View className="mb-2 rounded-2xl border border-rose-200 p-3 dark:border-rose-500/30">
            <Text className="mb-1 text-xs font-bold text-rose-600 dark:text-rose-400">
              Sàn từ chối — đơn vẫn ở Chờ xử lý
            </Text>
            {view.problems.map((p) => (
              <View key={p.orderCode} className="border-t border-slate-100 py-1.5 dark:border-slate-800">
                <Text selectable className="text-xs font-semibold text-slate-900 dark:text-slate-100" style={TABULAR}>
                  {p.orderCode}
                </Text>
                <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{p.reason}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {(result.notes ?? []).map((n) => (
          <Notice key={n.orderCode} tone="info" text={`${n.orderCode}: ${n.note}`} />
        ))}
      </ScrollView>
      <View className="mt-2 flex-row gap-2">
        <SheetButton label="Xong" tone="plain" onPress={onClose} />
        {canPrint && result.confirmedIds.length > 0 ? (
          <SheetButton
            label={`In phiếu ${groupVN(result.confirmedIds.length)} đơn`}
            icon="print-outline"
            onPress={() => onPrint(result.confirmedIds)}
          />
        ) : null}
      </View>
    </>
  );
}

// ───────── mảnh nhỏ dùng chung trong hộp (PrintSheet dùng lại CheckBox + Notice) ─────────

export function CheckBox({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <View
      className={`h-5 w-5 items-center justify-center rounded-md border ${
        checked || partial
          ? "border-emerald-500 bg-emerald-500"
          : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
      }`}
    >
      {checked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      {!checked && partial ? <View className="h-0.5 w-2.5 rounded bg-white" /> : null}
    </View>
  );
}

export function Notice({ tone, text }: { tone: "info" | "warn" | "danger"; text: string }) {
  const box =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
        : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800";
  const ink =
    tone === "danger"
      ? "text-rose-700 dark:text-rose-300"
      : tone === "warn"
        ? "text-amber-800 dark:text-amber-200"
        : "text-slate-600 dark:text-slate-300";
  return (
    <View className={`mb-2 flex-row gap-2 rounded-xl border px-3 py-2 ${box}`}>
      <Ionicons
        name={tone === "info" ? "information-circle-outline" : "alert-circle-outline"}
        size={15}
        color={tone === "danger" ? "#e11d48" : tone === "warn" ? "#d97706" : "#64748b"}
        style={{ marginTop: 1 }}
      />
      <Text className={`min-w-0 flex-1 text-xs leading-[17px] ${ink}`}>{text}</Text>
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <Text className="mb-1 mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{text}</Text>;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      className={`rounded-full px-3 py-1.5 ${active ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-100 dark:bg-slate-800"}`}
      onPress={() => {
        hapticTap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        className={`text-xs font-semibold ${active ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function RadioRow({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      className="flex-row items-start gap-2 py-1.5 active:opacity-70"
      onPress={() => {
        hapticTap();
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
    >
      <Ionicons
        name={active ? "radio-button-on" : "radio-button-off"}
        size={16}
        color={active ? "#10b981" : "#94a3b8"}
        style={{ marginTop: 1 }}
      />
      <Text className="min-w-0 flex-1 text-xs leading-[17px] text-slate-700 dark:text-slate-200">{label}</Text>
    </Pressable>
  );
}
