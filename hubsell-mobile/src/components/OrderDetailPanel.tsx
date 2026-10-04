import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { OrderDto, OrderPaymentDto } from "@/types/api";
import {
  CARRIER_LABEL,
  CHANNEL_LABEL,
  RETURN_STATUS,
  SHIPPING_STATUS,
} from "@/lib/labels";
import { formatDateTime, formatMoney, groupVN } from "@/lib/format";
import { isExpressShipping } from "@/lib/shipping";
import { Badge } from "@/components/Badge";
import { useChannelColors } from "@/theme/channel-colors";
import { TABULAR } from "@/theme/tokens";

/**
 * CHI TIẾT ĐƠN HÀNG sau khi quét mã ở nút QR giữa thanh tab (anh Trung 04/10).
 * Khung theo Salework (Đơn hàng → Khách hàng → Sản phẩm và doanh thu), các dòng
 * tiền theo trang chi tiết đơn của Shopee. Chỉ để XEM, và KHÔNG có giá vốn /
 * lợi nhuận — màn quét ai cầm máy cũng xem được, kể cả nhân viên kho.
 */
export function OrderDetailPanel({
  order,
  payment,
}: {
  order: OrderDto;
  payment?: OrderPaymentDto;
}) {
  const ship = SHIPPING_STATUS[order.shippingStatus];
  const ret = order.returnStatus !== "NONE" ? RETURN_STATUS[order.returnStatus] : null;
  const express = isExpressShipping(order.shippingCarrierName);
  const carrier =
    order.shippingCarrierName ??
    (order.carrier ? (CARRIER_LABEL[order.carrier] ?? order.carrier) : null);
  const channel = CHANNEL_LABEL[order.channel.channelName] ?? order.channel.channelName;
  const channelColors = useChannelColors();
  const channelColor = channelColors[order.channel.channelName] ?? channelColors.OFFLINE;

  return (
    <View>
      {/* Tên sàn tô màu nhận diện của sàn — liếc là biết đơn sàn nào (anh Trung 04/10) */}
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100">
          Đơn hàng <Text style={{ color: channelColor }}>{channel}</Text>
        </Text>
        <Text className="text-xs text-slate-400 dark:text-slate-500" style={TABULAR}>
          {formatDateTime(order.createdAt)}
        </Text>
      </View>

      <View className="mt-2">
        <Row label="Shop" value={order.channel.shopName} accent />
        <Row label="Mã đơn hàng" value={order.orderCode} selectable bold />
        <View className="flex-row items-center justify-between gap-3 py-[3px]">
          <Text className="text-[13px] text-slate-500 dark:text-slate-400">Trạng thái</Text>
          <View className="flex-row flex-wrap justify-end gap-1">
            <Badge label={ship.label} bg={ship.bg} text={ship.text} />
            {ret ? <Badge label={ret.label} bg={ret.bg} text={ret.text} /> : null}
          </View>
        </View>
        <Row label="Đơn vị vận chuyển" value={carrier ?? "—"} danger={express} />
        <Row label="Khách hàng" value={order.customerName || "—"} />
      </View>

      <Section title="Sản phẩm và doanh thu" icon="cart-outline">
        {order.items.map((it) => {
          const img = it.imageUrl ?? it.product?.imageUrl;
          return (
            <View key={it.id} className="mb-2.5 flex-row items-start gap-3">
              <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                {img ? (
                  <Image source={{ uri: img }} style={{ width: 48, height: 48 }} contentFit="cover" />
                ) : (
                  <Ionicons name="cube-outline" size={18} color="#94a3b8" />
                )}
              </View>
              <View className="flex-1">
                <Text
                  className="text-[13px] font-medium text-slate-900 dark:text-slate-100"
                  numberOfLines={2}
                >
                  {it.productName}
                </Text>
                {it.channelSku ? (
                  <Text className="text-[11px] text-slate-400 dark:text-slate-500">
                    SKU: {it.channelSku}
                  </Text>
                ) : null}
                <Text
                  className="text-[13px] font-semibold text-slate-700 dark:text-slate-200"
                  style={TABULAR}
                >
                  SL: {it.quantity} × {formatMoney(it.price)}
                </Text>
              </View>
            </View>
          );
        })}

        <View className="mt-1 border-t border-slate-200 pt-2 dark:border-slate-700">
          <Row
            label="Tổng tiền sản phẩm"
            value={formatMoney(payment?.productTotal ?? order.totalAmount)}
            bold
          />
          {payment && payment.status !== "none" ? (
            <>
              {payment.groups.map((g) => (
                <View key={g.label}>
                  <Row label={g.label} value={g.total === null ? "" : signed(g.total)} />
                  {g.lines.map((l) => (
                    <Row key={l.label} label={l.label} value={signed(l.amount)} sub />
                  ))}
                </View>
              ))}
              <View className="mt-1.5 flex-row items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {payment.status === "estimated"
                    ? "Doanh thu đơn hàng ước tính"
                    : "Doanh thu đơn hàng"}
                </Text>
                <Text className="text-lg font-bold text-emerald-600 dark:text-emerald-400" style={TABULAR}>
                  {formatMoney(payment.payout)}
                </Text>
              </View>
              {payment.status === "estimated" ? (
                <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  Số ước tính của sàn, có thể đổi khi sàn quyết toán.
                </Text>
              ) : null}
            </>
          ) : payment ? (
            <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              Sàn chưa báo phí và doanh thu của đơn này.
            </Text>
          ) : null}
        </View>
      </Section>
    </View>
  );
}

/** Số có dấu kiểu Shopee: −51.379 ₫ / 30.000 ₫. */
function signed(v: number): string {
  return v < 0 ? `−${groupVN(Math.abs(v))} ₫` : `${groupVN(v)} ₫`;
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
      <View className="mb-2 flex-row items-center gap-1.5">
        <Ionicons name={icon} size={15} color="#64748b" />
        <Text className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  bold = false,
  sub = false,
  danger = false,
  accent = false,
  selectable = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
  /** Dòng con thụt lề, chữ nhỏ — bóc tách bên trong nhóm phía trên. */
  sub?: boolean;
  danger?: boolean;
  /** Chữ màu nhấn — tên shop. */
  accent?: boolean;
  selectable?: boolean;
}) {
  const tone = danger
    ? "text-red-500 dark:text-red-400"
    : accent
      ? "text-emerald-600 dark:text-emerald-400"
      : sub
        ? "text-slate-500 dark:text-slate-400"
        : "text-slate-900 dark:text-slate-100";
  return (
    <View className={`flex-row items-center justify-between gap-3 py-[3px] ${sub ? "pl-3" : ""}`}>
      <Text className={`${sub ? "text-[11px]" : "text-[13px]"} text-slate-500 dark:text-slate-400`}>
        {label}
      </Text>
      <Text
        selectable={selectable}
        numberOfLines={1}
        className={`flex-1 text-right ${sub ? "text-[11px]" : "text-[13px]"} ${
          bold || accent ? "font-bold" : "font-medium"
        } ${tone}`}
        style={TABULAR}
      >
        {value}
      </Text>
    </View>
  );
}
