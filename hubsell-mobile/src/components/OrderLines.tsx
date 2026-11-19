import React, { useState } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { OrderItemDto } from "@/types/api";
import { formatMoney, groupVN } from "@/lib/format";
import { hapticTap } from "@/lib/haptics";
import { groupOrderLines, lineTotals, type LineText } from "@/lib/order-lines";
import { TABULAR } from "@/theme/tokens";

/**
 * DANH SÁCH HÀNG CỦA MỘT ĐƠN — dùng chung cho màn quét chi tiết đơn, hộp chi tiết đơn và
 * phiếu quét đơn hoàn (19/11/2026).
 *
 * Luật chữ (lib/order-lines.ts): tên sản phẩm / TÊN PHÂN LOẠI đậm, không cắt / "SKU" chỉ khi
 * là mã người bán tự đặt. Khách không đặt SKU không còn thấy dãy id của sàn.
 *
 * Đơn nhiều phân loại (tới 20 dòng): các phân loại CÙNG sản phẩm gom dưới một tên — tên dài
 * in một lần, bên dưới mỗi phân loại một dòng ngắn có ảnh riêng (màu nào ảnh nấy) và số
 * lượng thẳng một cột bên phải để kho liếc dọc là soi được. KHÔNG gấp bớt dòng: người đóng
 * hàng phải thấy đủ. Số lượng từ 2 trở lên tô đỏ đặc — chỗ hay nhặt thiếu nhất.
 *
 * Chạm ảnh nhỏ → phóng to ảnh của đúng phân loại đó (anh Trung 19/11: "click vào avatar của
 * phân loại sẽ phóng to ảnh phân loại đó lên để xem") — ảnh 36 px không đủ để phân biệt hai
 * màu gần nhau. Chạm bất kỳ đâu để đóng.
 */

interface Zoom {
  url: string;
  title: string;
  sub: string | null;
}

export function OrderLines({ items, showPrice = false }: { items: OrderItemDto[]; showPrice?: boolean }) {
  const groups = groupOrderLines(items);
  const totals = lineTotals(items);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const openZoom = (it: OrderItemDto, baseName: string, text: LineText) => {
    const url = it.imageUrl ?? it.product?.imageUrl;
    if (!url) return;
    hapticTap();
    // Tiêu đề = thứ kho đang soi: tên phân loại; sản phẩm đơn thì tên sản phẩm.
    setZoom({ url, title: text.variantName ?? baseName, sub: text.variantName ? baseName : null });
  };
  return (
    <View>
      {items.length > 1 ? (
        <Text className="mb-2 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
          {groupVN(totals.lines)} dòng hàng · {groupVN(totals.qty)} món
        </Text>
      ) : null}
      {groups.map((g, gi) => {
        const last = gi === groups.length - 1;
        const frame = `${last ? "" : "mb-2.5 border-b border-slate-200 pb-2.5 dark:border-slate-800"}`;
        if (g.lines.length === 1) {
          const it = g.lines[0];
          return (
            <View key={g.key} className={`flex-row items-start gap-3 ${frame}`}>
              <Thumb url={it.imageUrl ?? it.product?.imageUrl} size={48} onPress={() => openZoom(it, g.baseName, it.text)} />
              <View className="min-w-0 flex-1">
                {/* Không tách được phân loại (đơn cũ mà danh mục sàn không khớp) thì phân loại vẫn nằm ở
                    ĐUÔI tên → KHÔNG cắt ở 2 dòng, kẻo mất đúng thứ kho cần đọc như trước 19/11. */}
                <Text
                  className="text-[13px] font-medium text-slate-900 dark:text-slate-100"
                  numberOfLines={it.text.variantName ? 2 : 6}
                >
                  {g.baseName}
                </Text>
                {it.text.variantName ? (
                  <Text className="mt-0.5 text-[13px] font-bold text-slate-900 dark:text-slate-100">
                    {it.text.variantName}
                  </Text>
                ) : null}
                <Meta text={it.text} price={showPrice ? it.price : undefined} />
              </View>
              <Qty n={it.quantity} />
            </View>
          );
        }
        return (
          <View key={g.key} className={frame}>
            <Text className="text-[13px] font-medium text-slate-900 dark:text-slate-100" numberOfLines={2}>
              {g.baseName}
            </Text>
            <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
              {groupVN(g.lines.length)} phân loại · {groupVN(g.qty)} món
            </Text>
            {g.lines.map((it) => (
              <View key={it.id} className="mt-2 flex-row items-center gap-2.5">
                <Thumb url={it.imageUrl ?? it.product?.imageUrl} size={36} onPress={() => openZoom(it, g.baseName, it.text)} />
                <View className="min-w-0 flex-1">
                  <Text className="text-[13px] font-bold text-slate-900 dark:text-slate-100">
                    {it.text.variantName}
                  </Text>
                  <Meta text={it.text} price={showPrice ? it.price : undefined} />
                </View>
                <Qty n={it.quantity} />
              </View>
            ))}
          </View>
        );
      })}
      <ZoomModal zoom={zoom} onClose={() => setZoom(null)} />
    </View>
  );
}

/** Ảnh nhỏ của dòng hàng. Có ảnh thì chạm được (phóng to); không có ảnh thì chỉ là ô trống. */
function Thumb({ url, size, onPress }: { url: string | null | undefined; size: number; onPress: () => void }) {
  const box = "items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800";
  if (!url) {
    return (
      <View className={box} style={{ width: size, height: size }}>
        <Ionicons name="cube-outline" size={size > 40 ? 18 : 15} color="#94a3b8" />
      </View>
    );
  }
  return (
    <Pressable
      className={`${box} active:opacity-70`}
      style={{ width: size, height: size }}
      // Ảnh 36 px nhỏ hơn cỡ ngón tay → nới vùng chạm, không đổi bố cục.
      hitSlop={6}
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel="Phóng to ảnh sản phẩm"
    >
      <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="cover" />
    </Pressable>
  );
}

/**
 * Ảnh phóng to trên nền tối, kèm tên phân loại để chắc mình đang xem đúng dòng. Chạm bất kỳ đâu
 * để đóng. `contentFit="contain"`: thấy trọn ảnh, không cắt mất mép (màu / họa tiết ở rìa).
 * statusBarTranslucent + navigationBarTranslucent: Android không để hở dải trên / dưới (bẫy 04/10).
 */
function ZoomModal({ zoom, onClose }: { zoom: Zoom | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const side = Math.max(160, Math.min(width - 24, height - 220, 560));
  return (
    <Modal
      visible={zoom !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 items-center justify-center bg-black/90 px-3"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Đóng ảnh"
      >
        {zoom ? (
          <>
            <Image
              source={{ uri: zoom.url }}
              style={{ width: side, height: side, borderRadius: 12 }}
              contentFit="contain"
              transition={120}
            />
            <Text className="mt-4 text-center text-base font-bold text-white">{zoom.title}</Text>
            {zoom.sub ? (
              <Text className="mt-1 text-center text-xs text-slate-300" numberOfLines={2}>
                {zoom.sub}
              </Text>
            ) : null}
            <View className="mt-5 flex-row items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2">
              <Ionicons name="close" size={15} color="#ffffff" />
              <Text className="text-xs font-semibold text-white">Chạm để đóng</Text>
            </View>
          </>
        ) : null}
      </Pressable>
    </Modal>
  );
}

/** Dòng phụ nhỏ: "SKU: … · giá". Không có gì để in thì không chiếm chỗ. */
function Meta({ text, price }: { text: LineText; price?: string | number }) {
  const parts = [text.sellerSku ? `SKU: ${text.sellerSku}` : null, price !== undefined ? formatMoney(price) : null].filter(
    Boolean
  );
  if (parts.length === 0) return null;
  return (
    <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" style={TABULAR}>
      {parts.join(" · ")}
    </Text>
  );
}

/** Số lượng một cột bên phải; từ 2 món tô đỏ đặc để không nhặt thiếu. */
function Qty({ n }: { n: number }) {
  const many = n >= 2;
  return (
    <View
      className={`min-w-[38px] items-center rounded-lg px-1.5 py-1 ${
        many ? "bg-red-500 dark:bg-red-500" : "bg-slate-200 dark:bg-slate-800"
      }`}
    >
      <Text
        className={`text-[14px] font-bold ${many ? "text-white" : "text-slate-700 dark:text-slate-200"}`}
        style={TABULAR}
      >
        ×{groupVN(n)}
      </Text>
    </View>
  );
}
