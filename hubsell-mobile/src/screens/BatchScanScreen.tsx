import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import { Ionicons } from "@expo/vector-icons";
import { lookupOrder } from "@/api/orders";
import { ApiError } from "@/api/client";
import { BatchSheet, carrierLabelOf, type BatchTab } from "@/components/BatchSheet";
import { CameraPermissionPrompt, SCANNABLE } from "@/components/ScanChrome";
import { FLASH_STYLE, ScanFlashOverlay, vibrateScan } from "@/components/ScanFlash";
import { ScanTopBar } from "@/components/ScanTopBar";
import { flashOfBatchError, flashOfBatchScan, summarizeBatch } from "@/lib/batch-scan";
import { batchStore, useBatch } from "@/lib/batch-scan-store";
import { groupVN } from "@/lib/format";
import { PackScanGate } from "@/lib/pack-scan-gate";
import { isNetworkFailure, type PackFlash } from "@/lib/pack-scan-feedback";
import { playScanSound } from "@/lib/scan-sounds";
import { useKeyboardLift } from "@/lib/useKeyboardLift";
import { TABULAR } from "@/theme/tokens";

/**
 * MÀN QUÉT NHIỀU ĐƠN (12/11/2026) — chế độ thứ ba của tab QR giữa, cạnh Xem đơn và Đóng
 * gói. Quét liên tục một XẤP KIỆN rồi xem thống kê của đúng xấp đó: bao nhiêu kiện, theo
 * sàn / hãng, cộng lại là những món gì. CHỈ XEM — không đổi trạng thái đơn nào.
 *
 * Việc khách cần (shop có shipper TikTok ghé lấy giữa ngày): lô giao buổi trưa là một xấp
 * kiện cụ thể; quét cả xấp để biết lô gồm gì trước khi giao, và để chắc không có kiện ĐÃ
 * HỦY lẫn vào (kêu còi + màn đỏ như Quét đóng gói).
 *
 * Dùng lại nguyên bộ máy của Quét đóng gói: cửa chống bắn lặp (lib/pack-scan-gate.ts),
 * màn báo + rung (components/ScanFlash), âm (lib/scan-sounds). Khác ở ba chỗ:
 *   · gọi tra đơn `fast` — máy chủ chỉ đọc DB, không hỏi sàn (mã phân tuyến trên tem không
 *     được kích một lượt đồng bộ);
 *   · lô nằm ở lib/batch-scan-store.ts, không mất khi đổi chế độ hay rời tab;
 *   · dải đáy là ba con số của LÔ (đếm từ danh sách), bấm vào mở hộp Lô đã quét.
 */

/** Lượt gọi quá chừng này coi là mất mạng — cùng mức với Quét đóng gói. Mặc định tự chọn. */
const REQUEST_TIMEOUT_MS = 8000;
/** Mã KHÔNG ra đơn do camera đọc: hoãn báo lỗi chừng này, chờ mã vận đơn của cùng tem. Mặc định tự chọn. */
const UNKNOWN_GRACE_MS = 700;

export function BatchScanScreen({
  onClose,
  modeSwitch,
}: {
  onClose?: () => void;
  /** Công tắc chế độ của tab QR giữa. */
  modeSwitch?: React.ReactNode;
}) {
  useKeepAwake(); // gom lô có thể kéo dài — không để màn hình tự tắt
  const isWeb = Platform.OS === "web";
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  /** Màn báo đang hiện; `id` đổi mỗi lượt để hai kết quả giống nhau liên tiếp vẫn hẹn giờ lại. */
  const [flash, setFlash] = useState<(PackFlash & { id: number }) | null>(null);
  /** Kết quả gần nhất — nằm lại ở dải đáy sau khi màn báo tắt. */
  const [last, setLast] = useState<PackFlash | null>(null);
  const [sheet, setSheet] = useState<BatchTab | null>(null);
  /** Tab đang xem của hộp — giữ lại khi đóng để lần mở sau không nhảy lung tung. */
  const [tab, setTab] = useState<BatchTab>("goods");

  const entries = useBatch();
  const summary = useMemo(() => summarizeBatch(entries.map((e) => e.order), carrierLabelOf), [entries]);

  const rootRef = useRef<View>(null);
  const { kbLift, kbOpen } = useKeyboardLift(rootRef);

  // useState (không useRef): tạo MỘT lần cho cả đời màn, đọc được lúc render.
  const [gate] = useState(() => new PackScanGate());
  const flashSeq = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
    };
  }, []);

  /** Hiện màn báo + kêu + rung. */
  const announce = useCallback((f: PackFlash) => {
    if (!alive.current) return;
    playScanSound(f.sound);
    vibrateScan(f.haptic);
    setLast(f);
    const id = ++flashSeq.current;
    setFlash({ ...f, id });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      if (alive.current) setFlash((cur) => (cur?.id === id ? null : cur));
    }, f.holdMs);
  }, []);

  /** Tra một mã. `fromCamera` = qua cửa chống bắn lặp, áp luật im lặng / hoãn báo. */
  const submit = useCallback(
    async (code: string, fromCamera: boolean) => {
      setBusy(true);
      try {
        const res = await Promise.race([
          lookupOrder(code, { fast: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new ApiError("Máy chủ trả lời quá chậm", 408, null)), REQUEST_TIMEOUT_MS)
          ),
        ]);
        const order = res.order;
        const seen = gate.resolved(code, order.id, Date.now());
        // Đã ra đơn → báo lỗi "không thấy mã" đang hoãn (mã vạch khác của cùng tem) là oan.
        if (graceTimer.current) {
          clearTimeout(graceTimer.current);
          graceTimer.current = null;
        }
        const already = !batchStore.add(order, Date.now());
        // Mã vạch khác của tem ĐANG nằm trong khung → kiện này vừa báo xong, im.
        if (already && fromCamera && seen === "alias") return;
        const meta = [order.channel.shopName, carrierLabelOf(order)].filter(Boolean).join(" · ") || null;
        announce(flashOfBatchScan(order, meta, already));
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        const message = err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại";
        const f = flashOfBatchError(code, status, message);
        if (isNetworkFailure(status)) {
          gate.networkFailed(code, Date.now());
          announce(f);
        } else {
          gate.unknown(code);
          if (fromCamera) {
            if (graceTimer.current) clearTimeout(graceTimer.current);
            graceTimer.current = setTimeout(() => {
              graceTimer.current = null;
              announce(f);
            }, UNKNOWN_GRACE_MS);
          } else {
            announce(f);
          }
        }
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [announce, gate]
  );

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      const code = data.trim();
      if (!code) return;
      if (gate.admit(code, Date.now()) !== "fire") return;
      void submit(code, true);
    },
    [gate, submit]
  );

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    Keyboard.dismiss();
    // Máy chủ khớp chính xác, hoặc khớp một phần từ 6 ký tự (ít hơn là ra quá nhiều đơn).
    if (code.length < 6) {
      announce(flashOfBatchError(code, 400, "Gõ đủ mã, hoặc ít nhất 6 ký tự cuối của mã vận đơn / mã đơn"));
      return;
    }
    if (!gate.admitManual(code)) return; // đang có lượt gọi — giữ nguyên chữ để bấm lại
    setManual("");
    void submit(code, false);
  };

  const openSheet = (t: BatchTab) => {
    Keyboard.dismiss();
    setTab(t);
    setSheet(t);
  };

  // ----- Quyền camera (chỉ trên máy thật) -----
  if (!isWeb) {
    if (!permission) return <View className="flex-1 bg-slate-950" />;
    if (!permission.granted) {
      return <CameraPermissionPrompt permission={permission} onRequest={() => void requestPermission()} />;
    }
  }

  const live = summary.parcels - summary.cancelled;
  const empty = summary.parcels === 0;

  return (
    <View ref={rootRef} collapsable={false} className="flex-1 bg-slate-950">
      {/* Nền: camera thật trên máy — placeholder trên web (giả lập). Hộp Lô đã quét đang mở
          thì ngừng đọc mã, kẻo vừa xem danh sách vừa bị thêm kiện. */}
      {!isWeb ? (
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...SCANNABLE] }}
          onBarcodeScanned={sheet ? undefined : onBarcodeScanned}
        />
      ) : (
        <View className="flex-1 items-center justify-center" style={{ paddingBottom: 200 }}>
          <Ionicons name="barcode-outline" size={64} color="#334155" />
          <Text className="mt-3 px-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Camera quét chạy trên điện thoại.{"\n"}Bản web: gõ mã ở ô bên dưới để thử luồng.
          </Text>
        </View>
      )}

      {/* Chạm vào vùng camera = hạ bàn phím (bàn phím mở thì che thanh tab). */}
      {!isWeb && kbOpen ? (
        <Pressable className="absolute inset-0" onPress={() => Keyboard.dismiss()} accessibilityLabel="Đóng bàn phím" />
      ) : null}

      <ScanFlashOverlay flash={flash} />

      <ScanTopBar
        title="Quét nhiều đơn"
        subtitle="Quét cả xấp, xem tổng hàng — không đổi đơn"
        embedded
        onClose={onClose}
        modeSwitch={modeSwitch}
        torch={torch}
        onToggleTorch={() => setTorch((t) => !t)}
        showViewfinder={!flash}
        viewfinderBottom={210}
      />

      {/* DẢI ĐÁY cố định: kết quả gần nhất + ba con số của lô + nút Xem hàng + ô gõ tay. */}
      {/* Màn này luôn nằm trong tab QR giữa → thanh tab đã chừa đáy máy, không cộng thêm. */}
      <View className="absolute inset-x-0 px-3" style={{ bottom: kbLift, paddingBottom: 10 }}>
        <View className="rounded-2xl bg-slate-900/90 p-3">
          <View className="flex-row items-center gap-2">
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: last ? FLASH_STYLE[last.kind].dot : "#475569" }}
            />
            <Text className="flex-1 text-[13px] text-slate-200" numberOfLines={1}>
              {last ? (
                <>
                  <Text className="font-bold text-white" style={TABULAR}>
                    {last.code}
                  </Text>
                  {" — "}
                  {last.short}
                </>
              ) : empty ? (
                "Chưa quét kiện nào — đưa tem vào khung"
              ) : (
                `Lô đang có ${groupVN(summary.parcels)} kiện — quét tiếp`
              )}
            </Text>
            {busy ? <Text className="text-[11px] text-slate-400">đang tra…</Text> : null}
          </View>

          <View className="mt-2.5 flex-row gap-2">
            <BatchTile
              label="Kiện"
              value={live}
              color="#34d399"
              onPress={empty ? undefined : () => openSheet("parcels")}
            />
            <BatchTile
              label="Đơn hủy"
              value={summary.cancelled}
              color="#f87171"
              onPress={summary.cancelled > 0 ? () => openSheet("parcels") : undefined}
            />
            <BatchTile
              // "Món" (không phải "Sản phẩm"): ô chia ba, số 4 chữ số + nhãn dài là tràn ở máy 360 px.
              label="Món"
              value={summary.qty}
              color="#e2e8f0"
              onPress={empty ? undefined : () => openSheet("goods")}
            />
          </View>

          <Pressable
            className={`mt-2.5 flex-row items-center justify-center gap-2 rounded-xl py-3 ${
              empty ? "bg-slate-800" : "bg-emerald-500 active:opacity-80"
            }`}
            onPress={() => openSheet("goods")}
            disabled={empty}
            accessibilityRole="button"
            accessibilityLabel="Xem hàng trong lô"
          >
            <Ionicons name="list" size={17} color={empty ? "#64748b" : "#ffffff"} />
            <Text className={`text-sm font-bold ${empty ? "text-slate-500" : "text-white"}`} style={TABULAR}>
              {empty ? "Xem hàng trong lô" : `Xem hàng trong lô · ${groupVN(summary.bySku.length)} SKU`}
            </Text>
          </Pressable>

          {/* Gõ tay — tem nhăn / rách là chuyện hằng ngày ở kho */}
          <View className="mt-2.5 flex-row items-center gap-2">
            <TextInput
              className="flex-1 rounded-xl bg-slate-800 px-3 py-2.5 text-sm text-white"
              // minWidth 0: ô nhập trên web có bề rộng tối thiểu riêng, không ép thì đẩy nút ra ngoài màn hẹp.
              style={{ minWidth: 0 }}
              placeholder="Tem rách? Gõ mã vận đơn / mã đơn…"
              placeholderTextColor="#94a3b8"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              value={manual}
              onChangeText={setManual}
              onSubmitEditing={submitManual}
            />
            <Pressable
              className={`rounded-xl px-4 py-2.5 ${manual.trim() ? "bg-emerald-500 active:opacity-80" : "bg-slate-700"}`}
              onPress={submitManual}
              disabled={!manual.trim()}
              accessibilityRole="button"
              accessibilityLabel="Thêm mã vừa gõ vào lô"
            >
              <Text className="text-sm font-bold text-white">Thêm</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <BatchSheet
        visible={sheet !== null}
        entries={entries}
        tab={tab}
        onTab={setTab}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

/** Một con số của lô — bấm được khi có gì để xem. */
function BatchTile({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  value: number;
  color: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      className={`flex-1 flex-row items-baseline justify-center gap-1.5 rounded-xl bg-slate-800 py-1.5 ${
        onPress ? "active:opacity-70" : ""
      }`}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={onPress ? `${label}: ${value}, bấm để xem` : undefined}
    >
      <Text className="text-lg font-extrabold" style={[TABULAR, { color }]}>
        {groupVN(value)}
      </Text>
      <Text className="text-[11px] font-medium text-slate-300" numberOfLines={1}>
        {label}
      </Text>
      {onPress ? <Ionicons name="chevron-forward" size={11} color="#94a3b8" /> : null}
    </Pressable>
  );
}
