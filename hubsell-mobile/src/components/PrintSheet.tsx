import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "@/api/client";
import type { OrdersFilter } from "@/api/orders";
import {
  fetchLabelsPdf,
  fetchProcessQueue,
  markOrdersPrinted,
  waitForLabelsReady,
  type LabelSummary,
  type PrintChoice,
  type ProcessQueue,
} from "@/api/fulfill";
import { getItem, setItem } from "@/auth/storage";
import { carrierKey, groupCheck, selectedOrderIds, toggleCarrier, toggleGroup } from "@/lib/fulfill";
import { CHANNEL_LABEL } from "@/lib/labels";
import { groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { labelFileName, printPdf, printSupport, sharePdf } from "@/lib/print-labels";
import { primaryPrintVia, secondaryPrintVia, type PrintVia } from "@/lib/print-via";
import { useChannelColors } from "@/theme/channel-colors";
import { TABULAR } from "@/theme/tokens";
import { Sheet, SheetButton } from "@/components/Sheet";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { CheckBox, Notice } from "@/components/ArrangeSheet";

// ============================================================
// HỘP "IN PHIẾU" TRÊN APP (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 4)
//
// Chọn theo CỤM, không tích từng đơn: cây gian → hãng vận chuyển, mặc định tích hết — bấm
// một nút là in mọi đơn "Chưa in phiếu" trong phạm vi đang lọc. Bỏ tích một hãng khi hãng
// đó chưa tới lấy. Tab "Đã in" để in lại phiếu của đơn chưa đóng gói.
//
// Máy chủ trả MỘT tệp PDF khổ A6 (vận đơn chính chủ của sàn, đúng thứ tự cây). Tệp đi ra
// bằng hai lối (lib/print-labels) — app KHÔNG tự điều khiển máy in, KHÔNG chọn khổ giấy:
//   · "Mở bằng app máy in" (bảng chia sẻ → app của hãng máy in) — NÚT CHÍNH mặc định. Anh
//     Trung chốt 19/11 sau khi hỏi khách thật: ShipXanh, BigSeller, app TikTok Shop đều in
//     kiểu này; khổ A6 / A7 khách cài trong app máy in.
//   · "In qua Wi-Fi" (hộp in của điện thoại) — nút phụ, cho máy in nối Wi-Fi / LAN.
// App nhớ lối dùng gần nhất trên từng điện thoại (lib/print-via): shop in Wi-Fi bấm lối đó
// một lần là lần sau nó đứng làm nút chính.
//
// ĐÁNH DẤU ĐÃ IN: In qua Wi-Fi → hộp in mở được là đánh dấu (cùng luật với web; iPhone báo
// được "đóng mà không in" thì không đánh dấu). Mở bằng app máy in → hệ điều hành không cho
// biết tệp có được in hay không nên app HỎI lại một câu, không tự đánh dấu.
//
// Màn gọi đổi `key` mỗi lần MỞ hộp → trạng thái bên trong luôn bắt đầu sạch từ useState.
// ============================================================

export type PrintTarget =
  | { kind: "queue"; reprint: boolean }
  /** Đúng các đơn này (vừa chuẩn bị xong / mở từ chi tiết đơn). waitReady = đợi sàn cấp vận đơn. */
  | { kind: "orders"; orderIds: string[]; waitReady: boolean };

type Phase = "loading" | "ready" | "working" | "result" | "error";
type Via = PrintVia;

const PREF_KEY = "hubsell.print.choice";
/** Lối in dùng gần nhất trên điện thoại này ("share" | "print"). */
const VIA_KEY = "hubsell.print.via";
const VIA_LABEL: Record<Via, string> = { share: "Mở bằng app máy in", print: "In qua Wi-Fi" };
/** Chữ khi đứng làm NÚT PHỤ (ô hẹp, 112 px ở màn 320 px) — "Mở bằng app máy in" không vừa. */
const VIA_SHORT: Record<Via, string> = { share: "App máy in", print: "In qua Wi-Fi" };
const VIA_ICON: Record<Via, keyof typeof Ionicons.glyphMap> = { share: "print-outline", print: "wifi-outline" };
const DEFAULT_CHOICE: PrintChoice = { labels: true, pickList: false };

export function PrintSheet({
  visible,
  target,
  scope,
  onClose,
  onPrinted,
  onLabelTemplate,
}: {
  visible: boolean;
  target: PrintTarget;
  scope: OrdersFilter;
  onClose: () => void;
  /** Có đơn vừa được đánh dấu đã in → màn ngoài tải lại. */
  onPrinted: () => void;
  onLabelTemplate: () => void;
}) {
  const channelColors = useChannelColors();
  const support = printSupport();
  const [tab, setTab] = useState<"PRINT" | "REPRINT">(
    target.kind === "queue" && target.reprint ? "REPRINT" : "PRINT"
  );
  // Đã biết sẵn đơn nào cần in thì vào thẳng màn chọn loại phiếu, không có gì để tải.
  const [phase, setPhase] = useState<Phase>(target.kind === "orders" ? "ready" : "loading");
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<ProcessQueue | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<PrintChoice>(DEFAULT_CHOICE);
  const [step, setStep] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastVia, setLastVia] = useState<string | null>(null);
  const mainVia = primaryPrintVia(support, lastVia);
  const otherVia = secondaryPrintVia(support, mainVia);
  const [outcome, setOutcome] = useState<{
    via: Via;
    summary: LabelSummary | null;
    /** Đơn có vận đơn trong tệp — được phép đánh dấu đã in. */
    printable: string[];
    marked: number | null;
    cancelled: boolean;
  } | null>(null);
  /** Tệp vừa lấy — dùng lại cho "Chia sẻ tệp này" / "In lại", không gọi sàn lần hai. */
  const pdf = useRef<{ bytes: Uint8Array; name: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fixedIds = target.kind === "orders" ? target.orderIds : null;
  const targetKey = target.kind === "orders" ? `o:${target.orderIds.join(",")}` : `q:${target.reprint}`;

  // Mở hộp: nạp lựa chọn loại phiếu lần trước.
  useEffect(() => {
    if (!visible) return;
    void getItem(PREF_KEY).then((raw) => {
      if (!raw || !alive.current) return;
      try {
        const o = JSON.parse(raw) as Partial<PrintChoice>;
        setChoice({
          labels: typeof o.labels === "boolean" ? o.labels : DEFAULT_CHOICE.labels,
          pickList: typeof o.pickList === "boolean" ? o.pickList : DEFAULT_CHOICE.pickList,
        });
      } catch {
        // bản lưu hỏng — dùng mặc định
      }
    });
    void getItem(VIA_KEY).then((raw) => {
      if (alive.current) setLastVia(raw);
    });
  }, [visible]);

  useEffect(() => {
    if (!visible || fixedIds) return;
    let stale = false;
    fetchProcessQueue(tab, scope)
      .then((q) => {
        if (stale) return;
        setQueue(q);
        setPhase("ready");
      })
      .catch((err) => {
        if (stale) return;
        setError(err instanceof ApiError ? err.message : "Không tải được danh sách đơn cần in");
        setPhase("error");
      });
    return () => {
      stale = true;
    };
    // scope dựng mới mỗi render — nạp lại khi MỞ hộp hoặc đổi tab là đủ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tab, targetKey]);

  const ids = fixedIds ?? (queue ? selectedOrderIds(queue.groups, off) : []);
  const nothingChosen = !choice.labels && !choice.pickList;

  const saveChoice = (next: PrintChoice) => {
    setChoice(next);
    void setItem(PREF_KEY, JSON.stringify(next));
  };

  /** Đưa tệp ra máy in / bảng chia sẻ rồi ghi kết quả. Tệp đã có thì không tải lại. */
  const deliver = async (via: Via, summary: LabelSummary | null, printable: string[]) => {
    const file = pdf.current;
    if (!file) return;
    setStep(via === "print" ? "Đang mở hộp in…" : "Đang mở bảng chia sẻ…");
    let cancelled = false;
    if (via === "print") cancelled = (await printPdf(file.bytes, file.name)) === "cancelled";
    else await sharePdf(file.bytes, file.name);
    let marked: number | null = null;
    // Chỉ in phiếu xuất hàng thì KHÔNG tính là đã in vận đơn (cùng luật với web).
    if (via === "print" && !cancelled && choice.labels && printable.length > 0) {
      marked = (await markOrdersPrinted(printable)).markedPrinted;
      onPrinted();
    }
    // Nhớ lối vừa dùng (đóng hộp in mà không in thì không tính) → lần sau nó là nút chính.
    if (!cancelled) {
      void setItem(VIA_KEY, via);
      if (alive.current) setLastVia(via);
    }
    if (!alive.current) return;
    setOutcome({ via, summary, printable, marked, cancelled });
    setPhase("result");
  };

  const start = async (via: Via) => {
    hapticTap();
    setPhase("working");
    setError("");
    try {
      if (target.kind === "orders" && target.waitReady && choice.labels) {
        setStep("Đang chờ sàn cấp vận đơn…");
        await waitForLabelsReady(ids, (ready, total) => {
          if (alive.current) setStep(`Sàn đã cấp vận đơn ${groupVN(ready)}/${groupVN(total)}…`);
        });
      }
      setStep("Đang lấy vận đơn từ sàn…");
      const { bytes, summary } = await fetchLabelsPdf(ids, choice);
      pdf.current = { bytes, name: labelFileName(ids.length) };
      const failed = new Set(summary?.failedIds ?? []);
      await deliver(
        via,
        summary,
        ids.filter((id) => !failed.has(id))
      );
    } catch (err) {
      if (!alive.current) return;
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error && err.message
            ? err.message
            : "Không lấy được vận đơn"
      );
      setPhase("error");
    }
  };

  const again = async (via: Via) => {
    if (!outcome) return;
    hapticTap();
    setPhase("working");
    try {
      await deliver(via, outcome.summary, outcome.printable);
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error && err.message ? err.message : "Không mở được tệp vận đơn");
      setPhase("error");
    }
  };

  const markNow = async () => {
    if (!outcome) return;
    hapticTap();
    try {
      const res = await markOrdersPrinted(outcome.printable);
      onPrinted();
      if (alive.current) setOutcome({ ...outcome, marked: res.markedPrinted });
    } catch (err) {
      if (alive.current) setError(err instanceof ApiError ? err.message : "Chưa đánh dấu được — thử lại");
    }
  };

  const title =
    fixedIds !== null ? `In phiếu · ${groupVN(fixedIds.length)} đơn` : tab === "REPRINT" ? "In lại phiếu" : "In phiếu";

  return (
    <Sheet visible={visible} title={title} onClose={onClose} locked={phase === "working"}>
      {fixedIds === null && (phase === "ready" || phase === "loading") ? (
        <SegmentedTabs
          className="mb-2"
          options={[
            { key: "PRINT", label: "Chưa in" },
            { key: "REPRINT", label: "Đã in" },
          ]}
          value={tab}
          onChange={(next) => {
            if (next === tab) return;
            // Đổi tab = nạp hàng chờ khác: dọn cây cũ ngay trong lúc bấm, effect chỉ lo tải.
            setTab(next);
            setPhase("loading");
            setQueue(null);
            setOff(new Set());
          }}
        />
      ) : null}

      {phase === "loading" ? (
        <View className="items-center py-10">
          <ActivityIndicator size="large" color="#64748b" />
        </View>
      ) : null}

      {phase === "error" ? (
        <View className="py-2">
          <Notice tone="danger" text={error} />
          <View className="mt-1 flex-row gap-2">
            <SheetButton label="Đóng" tone="plain" onPress={onClose} />
          </View>
        </View>
      ) : null}

      {phase === "ready" ? (
        <>
          <ScrollView showsVerticalScrollIndicator={false} className="shrink">
            {!support.print && !support.share ? (
              <Notice
                tone="warn"
                text="Bản app đang cài chưa in được. Cập nhật Hubsell lên bản mới nhất trên App Store / CH Play để in phiếu ngay trên điện thoại."
              />
            ) : null}

            {queue && queue.groups.length === 0 ? (
              <View className="items-center px-4 py-8">
                <Ionicons name="checkmark-circle-outline" size={32} color="#94a3b8" />
                <Text className="mt-2 text-center text-sm font-semibold text-slate-600 dark:text-slate-300">
                  {tab === "PRINT" ? "Không có đơn nào chờ in phiếu" : "Không có đơn đã in nào chờ đóng gói"}
                </Text>
                <Text className="mt-1 text-center text-xs leading-[18px] text-slate-400 dark:text-slate-500">
                  {tab === "PRINT"
                    ? "Đơn vào đây sau khi chuẩn bị hàng. Phiếu đã in trên app của sàn thì Hubsell không biết — đơn vẫn nằm ở đây."
                    : "Đơn đã in phiếu và chưa quét đóng gói sẽ nằm ở đây để in lại khi phiếu hỏng."}
                </Text>
              </View>
            ) : null}

            {queue?.truncated ? (
              <Notice
                tone="info"
                text={`Mỗi lượt tối đa ${groupVN(queue.max)} đơn (hỏa tốc và đơn cũ trước). Còn ${groupVN(
                  queue.total - queue.taken
                )} đơn — in tiếp sau lượt này.`}
              />
            ) : null}

            {queue?.groups.map((g) => {
              const state = groupCheck(g, off);
              return (
                <View key={g.channelId} className="mb-2 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                  <Pressable
                    className="flex-row items-center gap-2.5"
                    onPress={() => {
                      hapticTap();
                      setOff((prev) => toggleGroup(g, prev));
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: state === "all" ? true : state === "some" ? "mixed" : false }}
                    accessibilityLabel={`Gian ${g.shopName}`}
                  >
                    <CheckBox checked={state === "all"} partial={state === "some"} />
                    <View
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: channelColors[g.channelName] ?? channelColors.OFFLINE }}
                    />
                    <View className="min-w-0 flex-1">
                      <Text className="text-[13px] font-bold text-slate-900 dark:text-slate-100" numberOfLines={1}>
                        {g.shopName}
                      </Text>
                      <Text className="text-[11px] text-slate-500 dark:text-slate-400">
                        {CHANNEL_LABEL[g.channelName] ?? g.channelName}
                      </Text>
                    </View>
                    <Text className="text-sm font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
                      {groupVN(g.count)}
                    </Text>
                  </Pressable>
                  {/* Hãng vận chuyển của gian — thụt vào thẳng cột tên gian. */}
                  <View className="ml-[30px] mt-1.5 border-l border-slate-200 pl-3 dark:border-slate-700">
                    {g.carriers.map((c) => {
                      const checked = state !== "none" && !off.has(carrierKey(g.channelId, c.key));
                      return (
                        <Pressable
                          key={c.key}
                          className="flex-row items-center gap-2.5 py-1.5 active:opacity-70"
                          onPress={() => {
                            hapticTap();
                            setOff((prev) => toggleCarrier(g, c.key, prev));
                          }}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                          accessibilityLabel={c.label}
                        >
                          <CheckBox checked={checked} />
                          <Text
                            className={`min-w-0 flex-1 text-xs ${
                              c.express
                                ? "font-bold text-red-500 dark:text-red-400"
                                : "text-slate-700 dark:text-slate-200"
                            }`}
                            numberOfLines={1}
                          >
                            {c.express ? "⚡ " : ""}
                            {c.label}
                          </Text>
                          <Text className="text-xs text-slate-500 dark:text-slate-400" style={TABULAR}>
                            {groupVN(c.count)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {ids.length > 0 || fixedIds ? (
              <>
                <Text className="mb-1.5 mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Loại phiếu (khổ A6)
                </Text>
                <OptionRow
                  title="Vận đơn của sàn"
                  hint="Tem chính chủ có mã vạch để dán kiện, shipper quét được"
                  checked={choice.labels}
                  onPress={() => saveChoice({ ...choice, labels: !choice.labels })}
                />
                <OptionRow
                  title="Phiếu xuất hàng"
                  hint="Phiếu của Hubsell cho kho nhặt hàng: mã đơn, SKU, số lượng"
                  checked={choice.pickList}
                  onPress={() => saveChoice({ ...choice, pickList: !choice.pickList })}
                />
                <View className="mt-1 flex-row gap-2">
                  <LinkRow icon="options-outline" label="Tùy chỉnh phiếu in" onPress={onLabelTemplate} />
                  <LinkRow
                    icon="help-circle-outline"
                    label="Nối máy in thế nào?"
                    onPress={() => setHelpOpen((v) => !v)}
                  />
                </View>
                {helpOpen ? <PrinterHelp /> : null}
              </>
            ) : null}
          </ScrollView>

          <View className="mt-2 flex-row items-center justify-between">
            <Text className="text-xs text-slate-500 dark:text-slate-400">Số đơn sẽ in</Text>
            <Text className="text-lg font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
              {groupVN(ids.length)}
            </Text>
          </View>
          {/* Nút phụ bên trái (hẹp), NÚT CHÍNH bên phải (rộng gấp rưỡi) — chữ nút chính dài
              nên cần chỗ; đo 320 px không cắt chữ. Máy chỉ đi được một lối thì còn một nút. */}
          <View className="mt-2 flex-row gap-2">
            {otherVia ? (
              <SheetButton
                label={VIA_SHORT[otherVia]}
                tone="plain"
                disabled={ids.length === 0 || nothingChosen}
                onPress={() => void start(otherVia)}
              />
            ) : null}
            <SheetButton
              label={mainVia ? VIA_LABEL[mainVia] : "In phiếu"}
              icon={mainVia ? VIA_ICON[mainVia] : "print-outline"}
              grow={otherVia ? 1.5 : 1}
              disabled={ids.length === 0 || nothingChosen || !mainVia}
              onPress={() => (mainVia ? void start(mainVia) : undefined)}
            />
          </View>
        </>
      ) : null}

      {phase === "working" ? (
        <View className="items-center py-10">
          <ActivityIndicator size="large" color="#10b981" />
          <Text className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100" style={TABULAR}>
            {step}
          </Text>
          <Text className="mt-1 text-center text-[11px] text-slate-400 dark:text-slate-500">
            Sàn dựng tệp vận đơn mất vài giây tới vài chục giây.
          </Text>
        </View>
      ) : null}

      {phase === "result" && outcome ? (
        <>
          <ScrollView showsVerticalScrollIndicator={false} className="shrink">
            <View className="items-center py-4">
              <Ionicons
                name={outcome.cancelled ? "close-circle-outline" : outcome.via === "print" ? "print" : "share-outline"}
                size={36}
                color={outcome.cancelled ? "#94a3b8" : "#10b981"}
              />
              <Text className="mt-2 text-center text-base font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
                {outcome.cancelled
                  ? "Chưa in — bạn đã đóng hộp in"
                  : outcome.via === "print"
                    ? `Đã gửi ${groupVN(outcome.summary?.pages ?? 0)} trang tới hộp in`
                    : `Đã đưa tệp ${groupVN(outcome.summary?.pages ?? 0)} trang sang app máy in`}
              </Text>
              {outcome.marked !== null ? (
                <Text className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400" style={TABULAR}>
                  {outcome.marked > 0
                    ? `${groupVN(outcome.marked)} đơn đã sang Chờ đóng gói.`
                    : "Các đơn này đã được đánh dấu in từ trước."}
                </Text>
              ) : null}
            </View>

            {/* Chia sẻ: hệ điều hành không báo tệp có được in không → hỏi, không tự đánh dấu. */}
            {outcome.via === "share" && outcome.marked === null && choice.labels && outcome.printable.length > 0 ? (
              <View className="mb-2 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                <Text className="text-xs leading-[18px] text-slate-600 dark:text-slate-300">
                  Phiếu ra giấy rồi thì đánh dấu để đơn sang Chờ đóng gói. Chưa in thì cứ để nguyên — đơn vẫn ở
                  Chưa in phiếu.
                </Text>
                <Pressable
                  className="mt-2 items-center rounded-xl bg-slate-900 py-2.5 active:opacity-80 dark:bg-slate-700"
                  onPress={() => void markNow()}
                  accessibilityRole="button"
                >
                  <Text className="text-xs font-bold text-white" style={TABULAR}>
                    Đã in xong {groupVN(outcome.printable.length)} đơn
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {error ? <Notice tone="danger" text={error} /> : null}

            {(outcome.summary?.overlay?.missed ?? 0) > 0 ? (
              <Notice
                tone="warn"
                text={`${groupVN(outcome.summary!.overlay!.missed)} vận đơn chưa chèn được bảng sản phẩm gọn nên in nguyên phiếu của sàn. Kiểm lại vùng chèn trong Tùy chỉnh phiếu in.`}
              />
            ) : null}

            {choice.labels && (outcome.summary?.failed.length ?? 0) > 0 ? (
              <View className="mb-2 rounded-2xl border border-amber-200 p-3 dark:border-amber-500/30">
                <Text className="mb-1 text-xs font-bold text-amber-700 dark:text-amber-300" style={TABULAR}>
                  {groupVN(outcome.summary!.failed.length)} đơn chưa có vận đơn của sàn — vẫn ở Chưa in phiếu
                </Text>
                {outcome.summary!.failed.map((f) => (
                  <View key={f.orderCode} className="border-t border-slate-100 py-1.5 dark:border-slate-800">
                    <Text selectable className="text-xs font-semibold text-slate-900 dark:text-slate-100" style={TABULAR}>
                      {f.orderCode}
                    </Text>
                    <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{f.reason}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View className="flex-row gap-2">
              {support.print ? (
                <LinkRow
                  icon="print-outline"
                  label={outcome.via === "print" && !outcome.cancelled ? "Mở lại hộp in" : "In qua Wi-Fi"}
                  onPress={() => void again("print")}
                />
              ) : null}
              {support.share ? (
                <LinkRow
                  icon="share-outline"
                  label={outcome.via === "share" ? "Mở lại app máy in" : "Mở app máy in"}
                  onPress={() => void again("share")}
                />
              ) : null}
            </View>
          </ScrollView>
          <View className="mt-2 flex-row gap-2">
            <SheetButton label="Xong" onPress={onClose} />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

function OptionRow({
  title,
  hint,
  checked,
  onPress,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`mb-1.5 flex-row items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
        checked
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
          : "border-slate-200 dark:border-slate-700"
      }`}
      onPress={() => {
        hapticTap();
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <CheckBox checked={checked} />
      <View className="min-w-0 flex-1">
        <Text className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{title}</Text>
        <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{hint}</Text>
      </View>
    </Pressable>
  );
}

function LinkRow({
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

/** Ba cách đưa phiếu ra máy in — nói đúng những gì app làm được ở bản này; máy Bluetooth đứng đầu vì nhiều shop dùng nhất. */
function PrinterHelp() {
  const rows: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
    {
      icon: "bluetooth-outline",
      title: "Máy in nhiệt Bluetooth",
      text: "Bấm Mở bằng app máy in → chọn app của hãng máy in (app đi kèm máy) → in tệp. Khổ giấy A6 / A7 chọn trong app đó.",
    },
    {
      icon: "wifi-outline",
      title: "Máy in nối Wi-Fi / mạng LAN",
      text: "Điện thoại và máy in cùng mạng. Bấm In qua Wi-Fi → chọn máy in và khổ giấy trong hộp in của điện thoại.",
    },
    {
      icon: "desktop-outline",
      title: "Máy in cắm USB vào máy tính",
      text: "In trên bản web của Hubsell, hoặc bấm Mở bằng app máy in rồi gửi tệp sang máy tính.",
    },
  ];
  return (
    <View className="mt-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
      {rows.map((r) => (
        <View key={r.title} className="flex-row gap-2.5 py-1.5">
          <Ionicons name={r.icon} size={16} color="#64748b" style={{ marginTop: 1 }} />
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-semibold text-slate-800 dark:text-slate-100">{r.title}</Text>
            <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{r.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
