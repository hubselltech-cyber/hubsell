import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ApiError } from "@/api/client";
import { fetchLabelPreview, fetchLabelTemplates, saveLabelTemplate } from "@/api/label-template";
import {
  sameTemplate,
  stepZone,
  toggleColumn,
  type LabelTemplate,
  type LabelTemplateSettings,
  type TemplatePlatform,
} from "@/lib/label-template";
import { CHANNEL_LABEL } from "@/lib/labels";
import { hapticTap } from "@/lib/haptics";
import { printPdf, printSupport, sharePdf } from "@/lib/print-labels";
import { useKeyboardScroll } from "@/lib/useKeyboardScroll";
import { TABULAR } from "@/theme/tokens";
import { Card } from "@/components/Card";
import { LabelPreview } from "@/components/LabelPreview";
import { SegmentedTabs } from "@/components/SegmentedTabs";

// ============================================================
// MÀN "TÙY CHỈNH PHIẾU IN" (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 5)
//
// Một việc: thay BẢNG SẢN PHẨM của sàn trên vận đơn bằng bảng gọn của Hubsell (SKU · phân
// loại · số lượng) + một dòng nhắn của shop. Phần vận chuyển của sàn không đổi. Mẫu lưu
// theo chủ shop + sàn, áp ở máy chủ lúc dựng tệp in → web và app in ra cùng một phiếu.
//
// Bố cục: chọn sàn → công tắc chính → khung xem trước đổi theo từng công tắc → các tùy
// chọn → Lưu. Sàn chưa đo phiếu thật (Shopee, Lazada) nói rõ là chưa có, không giả vờ.
// ============================================================

/**
 * Chiều cao vùng chèn điền sẵn khi máy chủ không tự dò. Căn cứ: đo trên ảnh tem TikTok – J&T
 * khách gửi 19/11/2026 (bảng sản phẩm bắt đầu ở khoảng 69 % chiều cao tem tính từ trên →
 * ~46 mm từ đáy tem 148 mm). MỘT mẫu tem, chưa đo hãng khác — vì thế màn hình nhắc in thử.
 */
const DEFAULT_ZONE_MM = 46;
/** Nấc chỉnh chiều cao vùng chèn (mm). */
const ZONE_STEP_MM = 2;

const PLATFORM_TABS: { key: TemplatePlatform; label: string }[] = [
  { key: "TIKTOK", label: "TikTok" },
  { key: "SHOPEE", label: "Shopee" },
  { key: "LAZADA", label: "Lazada" },
];

export function LabelTemplateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { scrollRef, onInputFocus } = useKeyboardScroll();
  const support = printSupport();
  const [settings, setSettings] = useState<LabelTemplateSettings | null>(null);
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState<TemplatePlatform>("TIKTOK");
  /** Bản đang chỉnh của từng sàn (chưa lưu). */
  const [drafts, setDrafts] = useState<Partial<Record<TemplatePlatform, LabelTemplate>>>({});
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  /** Tăng lên để tải lại (nút Thử lại). */
  const [loadSeq, setLoadSeq] = useState(0);
  useEffect(() => {
    let stale = false;
    fetchLabelTemplates()
      .then((res) => {
        if (stale) return;
        setSettings(res);
        setDrafts(Object.fromEntries(res.platforms.map((p) => [p.platform, p.template])));
      })
      .catch((err) => {
        if (!stale) setError(err instanceof ApiError ? err.message : "Không tải được mẫu phiếu in");
      });
    return () => {
      stale = true;
    };
  }, [loadSeq]);
  const retry = () => {
    setError("");
    setLoadSeq((n) => n + 1);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate("/(admin)/orders");
  };

  const entry = settings?.platforms.find((p) => p.platform === platform) ?? null;
  const draft = drafts[platform] ?? entry?.template ?? null;
  const canEdit = Boolean(settings?.canEdit);
  // Máy chủ cũ không trả cờ này → coi như có tự dò (hành vi trước đó).
  const autoDetect = settings?.autoDetect !== false;
  const dirty = Boolean(entry && draft && !sameTemplate(entry.template, draft));

  const patch = (next: LabelTemplate) => {
    setMessage(null);
    setDrafts((d) => ({ ...d, [platform]: next }));
  };

  const save = async () => {
    if (!draft || !entry) return;
    hapticTap();
    setBusy("save");
    setMessage(null);
    try {
      const res = await saveLabelTemplate(platform, { ...draft, note: draft.note.trim() });
      setSettings((s) =>
        s
          ? { ...s, platforms: s.platforms.map((p) => (p.platform === platform ? { ...p, template: res.template } : p)) }
          : s
      );
      setDrafts((d) => ({ ...d, [platform]: res.template }));
      setMessage({
        tone: "ok",
        text: res.template.enabled
          ? `Đã lưu. Từ lượt in tới, vận đơn ${CHANNEL_LABEL[platform]} dùng bảng gọn — trên app lẫn web.`
          : `Đã lưu. Vận đơn ${CHANNEL_LABEL[platform]} in nguyên phiếu của sàn.`,
      });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Chưa lưu được — thử lại" });
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    if (!draft) return;
    hapticTap();
    setBusy("preview");
    setMessage(null);
    try {
      const bytes = await fetchLabelPreview(platform, draft);
      // Hộp in của máy có sẵn khung xem tệp; máy không in được thì mở bảng chia sẻ để xem.
      if (support.print) await printPdf(bytes, "phieu-mau.pdf");
      else await sharePdf(bytes, "phieu-mau.pdf");
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error && err.message ? err.message : "Chưa dựng được phiếu mẫu",
      });
    } finally {
      setBusy(null);
    }
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
        <Text className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Tùy chỉnh phiếu in</Text>
      </View>

      {!settings ? (
        <View className="items-center px-6 py-16">
          {error ? (
            <>
              <Text className="text-center text-sm text-red-500 dark:text-red-400">{error}</Text>
              <Pressable className="mt-3 rounded-xl bg-slate-900 px-4 py-2.5 dark:bg-slate-700" onPress={retry}>
                <Text className="text-xs font-bold text-white">Thử lại</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator size="large" color="#64748b" />
          )}
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            <SegmentedTabs className="mb-3" options={PLATFORM_TABS} value={platform} onChange={setPlatform} />

            {!entry?.supported || !draft ? (
              <Card className="p-4">
                <View className="flex-row gap-3">
                  <Ionicons name="time-outline" size={20} color="#94a3b8" />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Vận đơn {CHANNEL_LABEL[platform]} đang in nguyên phiếu của sàn
                    </Text>
                    <Text className="mt-1 text-xs leading-[18px] text-slate-500 dark:text-slate-400">
                      Ô sản phẩm trên vận đơn {CHANNEL_LABEL[platform]} nằm sát dòng tiền thu hộ và mã phân
                      tuyến. Hubsell phải đo trên phiếu thật trước khi cho thay, để không che nhầm phần đơn vị
                      vận chuyển cần đọc.
                    </Text>
                  </View>
                </View>
              </Card>
            ) : (
              <>
                {!canEdit ? (
                  <View className="mb-3 flex-row gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <Ionicons name="lock-closed-outline" size={14} color="#64748b" style={{ marginTop: 1 }} />
                    <Text className="min-w-0 flex-1 text-xs leading-[17px] text-slate-600 dark:text-slate-300">
                      Chỉ chủ shop đổi được mẫu phiếu in. Bạn đang xem mẫu hiện dùng.
                    </Text>
                  </View>
                ) : null}

                <Card className="p-4">
                  <View className="flex-row items-center gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-bold text-slate-900 dark:text-slate-100">Bảng sản phẩm gọn</Text>
                      <Text className="mt-0.5 text-xs leading-[17px] text-slate-500 dark:text-slate-400">
                        Thay bảng sản phẩm của {CHANNEL_LABEL[platform]} bằng bảng của Hubsell: mỗi món một dòng,
                        đơn nhiều món vẫn gọn trong một tờ.
                      </Text>
                    </View>
                    <Switch
                      value={draft.enabled}
                      disabled={!canEdit}
                      onValueChange={(on) =>
                        patch({
                          ...draft,
                          enabled: on,
                          // Máy chủ không tự dò thì mẫu phải có chiều cao vùng chèn mới chèn được.
                          manualZoneMm:
                            on && !autoDetect && draft.manualZoneMm === null ? DEFAULT_ZONE_MM : draft.manualZoneMm,
                        })
                      }
                      trackColor={{ true: "#10b981" }}
                      accessibilityLabel="Bật bảng sản phẩm gọn"
                    />
                  </View>

                  <View className="mt-4 items-center">
                    <LabelPreview template={draft} />
                    <Text className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
                      {draft.enabled ? "Xem trước — đổi theo từng công tắc bên dưới" : "Đang tắt — phiếu in như của sàn"}
                    </Text>
                  </View>
                </Card>

                {draft.enabled ? (
                  <>
                    <SectionTitle text="Mỗi dòng in gì" />
                    <Card className="px-4">
                      <ToggleRow
                        title="Mã SKU"
                        hint="Mã bạn tự đặt cho sản phẩm trên sàn"
                        value={draft.showSku}
                        disabled={!canEdit}
                        onToggle={() => patch(toggleColumn(draft, "showSku"))}
                      />
                      <ToggleRow
                        title="Tên phân loại"
                        hint="Màu, cỡ… của món hàng"
                        value={draft.showVariant}
                        disabled={!canEdit}
                        onToggle={() => patch(toggleColumn(draft, "showVariant"))}
                        border
                      />
                      <ToggleRow
                        title="Tên sản phẩm"
                        hint="Tắt khi không muốn tên sản phẩm hiện trên kiện hàng"
                        value={draft.showName}
                        disabled={!canEdit}
                        onToggle={() => patch(toggleColumn(draft, "showName"))}
                        border
                      />
                    </Card>

                    <SectionTitle text="Dòng nhắn của shop" />
                    <Card className="p-3">
                      <TextInput
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        placeholder="VD: Gọi shop 09xx xxx xxx trước khi hoàn hàng"
                        placeholderTextColor="#94a3b8"
                        value={draft.note}
                        editable={canEdit}
                        maxLength={settings.limits.noteMax}
                        onFocus={onInputFocus}
                        onChangeText={(text) => patch({ ...draft, note: text.replace(/\n/g, " ") })}
                        returnKeyType="done"
                        accessibilityLabel="Dòng nhắn của shop"
                      />
                      <View className="mt-1.5 flex-row justify-between">
                        <Text className="min-w-0 flex-1 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                          In đậm trên đầu bảng. Để trống nếu không cần.
                        </Text>
                        <Text className="text-[11px] text-slate-400 dark:text-slate-500" style={TABULAR}>
                          {[...draft.note].length}/{settings.limits.noteMax}
                        </Text>
                      </View>
                    </Card>

                    <SectionTitle text="Giấy in" />
                    <Card className="px-4">
                      <ToggleRow
                        title="Mỗi đơn một tờ"
                        hint="Bỏ tờ thứ hai của bảng sản phẩm sàn"
                        value={draft.onePage}
                        disabled={!canEdit}
                        onToggle={() => patch({ ...draft, onePage: !draft.onePage })}
                      />
                    </Card>

                    {autoDetect ? (
                      <>
                        <Pressable
                          className="mt-4 flex-row items-center gap-1 px-1 active:opacity-60"
                          onPress={() => setAdvanced((v) => !v)}
                          accessibilityRole="button"
                        >
                          <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400">Nâng cao</Text>
                          <Ionicons name={advanced ? "chevron-up" : "chevron-down"} size={12} color="#94a3b8" />
                        </Pressable>
                        {advanced ? (
                          <ZoneCard
                            className="mt-2"
                            autoDetect
                            draft={draft}
                            canEdit={canEdit}
                            limits={settings.limits}
                            onChange={patch}
                          />
                        ) : null}
                      </>
                    ) : (
                      <>
                        <SectionTitle text="Vùng chèn bảng" />
                        <ZoneCard
                          autoDetect={false}
                          draft={draft}
                          canEdit={canEdit}
                          limits={settings.limits}
                          onChange={patch}
                        />
                      </>
                    )}
                  </>
                ) : null}

                <Text className="mt-4 px-1 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                  Mẫu áp cho mọi gian {CHANNEL_LABEL[platform]} của shop, khi in trên app lẫn trên web. Mã vạch,
                  mã phân tuyến và địa chỉ trên vận đơn luôn là của sàn.
                </Text>
              </>
            )}
          </ScrollView>

          {entry?.supported && draft ? (
            <View
              className="border-t border-slate-200 bg-white px-4 pt-3 dark:border-slate-800 dark:bg-slate-900"
              style={{ paddingBottom: 12 + insets.bottom }}
            >
              {message ? (
                <Text
                  className={`mb-2 text-xs leading-[17px] ${
                    message.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
                  }`}
                >
                  {message.text}
                </Text>
              ) : null}
              <View className="flex-row gap-2">
                {support.print || support.share ? (
                  <Pressable
                    className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-3 active:opacity-80 dark:bg-slate-800 ${
                      busy || !draft.enabled ? "opacity-50" : ""
                    }`}
                    disabled={busy !== null || !draft.enabled}
                    onPress={() => void preview()}
                    accessibilityRole="button"
                  >
                    {busy === "preview" ? (
                      <ActivityIndicator size="small" color="#64748b" />
                    ) : (
                      <Ionicons name="eye-outline" size={16} color="#64748b" />
                    )}
                    <Text className="text-sm font-bold text-slate-600 dark:text-slate-300">Xem phiếu mẫu</Text>
                  </Pressable>
                ) : null}
                {canEdit ? (
                  <Pressable
                    className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-3 active:opacity-80 ${
                      busy || !dirty ? "opacity-50" : ""
                    }`}
                    disabled={busy !== null || !dirty}
                    onPress={() => void save()}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy !== null || !dirty }}
                  >
                    {busy === "save" ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text className="text-sm font-bold text-white">{dirty ? "Lưu" : "Đã lưu"}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * Thẻ "Vùng chèn bảng". Máy chủ có tự dò: chọn Tự dò / Tự đặt (nằm trong Nâng cao). Máy chủ
 * không tự dò: chỉ còn ô chiều cao — đó là số quyết định bảng nằm đâu, nên nằm ở phần chính.
 */
function ZoneCard({
  autoDetect,
  draft,
  canEdit,
  limits,
  onChange,
  className = "",
}: {
  autoDetect: boolean;
  draft: LabelTemplate;
  canEdit: boolean;
  limits: LabelTemplateSettings["limits"];
  onChange: (next: LabelTemplate) => void;
  className?: string;
}) {
  const mm = draft.manualZoneMm;
  const step = (delta: number) =>
    onChange({ ...draft, manualZoneMm: stepZone(mm ?? DEFAULT_ZONE_MM, delta, limits) });
  return (
    <Card className={`p-4 ${className}`}>
      {autoDetect ? (
        <>
          <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">Vùng chèn bảng</Text>
          <Text className="mt-0.5 text-xs leading-[17px] text-slate-500 dark:text-slate-400">
            Hubsell tự dò chỗ bảng sản phẩm trên từng vận đơn. Phiếu nào không dò được thì in nguyên phiếu sàn
            — trừ khi bạn tự đặt chiều cao vùng chèn tính từ đáy tem.
          </Text>
          <View className="mt-3 flex-row gap-2">
            <ChoicePill
              label="Tự dò"
              active={mm === null}
              disabled={!canEdit}
              onPress={() => onChange({ ...draft, manualZoneMm: null })}
            />
            <ChoicePill
              label="Tự đặt"
              active={mm !== null}
              disabled={!canEdit}
              onPress={() => onChange({ ...draft, manualZoneMm: mm ?? DEFAULT_ZONE_MM })}
            />
          </View>
        </>
      ) : (
        <Text className="text-xs leading-[17px] text-slate-500 dark:text-slate-400">
          Bảng gọn phủ lên phần đáy tem, cao bằng số dưới đây. {DEFAULT_ZONE_MM} mm khớp tem TikTok – J&T; hãng
          khác có thể lệch vài mm.
        </Text>
      )}
      {mm !== null ? (
        <>
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-xs text-slate-600 dark:text-slate-300">Cao từ đáy tem</Text>
            <View className="flex-row items-center gap-3">
              <StepButton icon="remove" disabled={!canEdit} onPress={() => step(-ZONE_STEP_MM)} />
              <Text className="min-w-14 shrink-0 text-center text-sm font-bold text-slate-900 dark:text-slate-100" numberOfLines={1} style={TABULAR}>
                {mm} mm
              </Text>
              <StepButton icon="add" disabled={!canEdit} onPress={() => step(ZONE_STEP_MM)} />
            </View>
          </View>
          <Text className="mt-2 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
            Phần tem nằm trong vùng này bị phủ trắng. In thử một đơn thật, kiểm mã vạch và mã phân tuyến còn đủ
            rồi mới in hàng loạt.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <Text className="mb-1.5 mt-4 px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{text}</Text>;
}

function ToggleRow({
  title,
  hint,
  value,
  onToggle,
  disabled,
  border = false,
}: {
  title: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
  disabled: boolean;
  border?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 py-3 ${border ? "border-t border-slate-100 dark:border-slate-800" : ""}`}
    >
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</Text>
        <Text className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onToggle}
        trackColor={{ true: "#10b981" }}
        accessibilityLabel={title}
      />
    </View>
  );
}

function ChoicePill({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`rounded-full px-4 py-2 ${active ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-100 dark:bg-slate-800"}`}
      disabled={disabled}
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

function StepButton({
  icon,
  disabled,
  onPress,
}: {
  icon: "add" | "remove";
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="h-9 w-9 items-center justify-center rounded-full bg-slate-100 active:opacity-60 dark:bg-slate-800"
      disabled={disabled}
      onPress={() => {
        hapticTap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={icon === "add" ? "Tăng chiều cao vùng chèn" : "Giảm chiều cao vùng chèn"}
    >
      <Ionicons name={icon} size={18} color="#64748b" />
    </Pressable>
  );
}
