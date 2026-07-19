import type { Carrier } from "@/lib/api";

/**
 * Nhãn hiển thị của các đơn vị vận chuyển.
 * Giữ đúng thứ tự này trong dropdown lọc: các hãng shop hay dùng nhất lên
 * trước, "Hãng khác" luôn nằm cuối.
 */
export const CARRIER_META: Record<Carrier, { label: string; short: string }> = {
  SPX: { label: "SPX Express", short: "SPX" },
  GHTK: { label: "Giao Hàng Tiết Kiệm", short: "GHTK" },
  GHN: { label: "Giao Hàng Nhanh", short: "GHN" },
  JT: { label: "J&T Express", short: "J&T" },
  VIETTEL_POST: { label: "Viettel Post", short: "VTPost" },
  NINJA_VAN: { label: "Ninja Van", short: "Ninja" },
  BEST: { label: "BEST Express", short: "BEST" },
  KHAC: { label: "Hãng khác / shop tự giao", short: "Khác" },
};

export const CARRIER_OPTIONS = (Object.keys(CARRIER_META) as Carrier[]).map(
  (value) => ({ value, label: CARRIER_META[value].label })
);

/** Nhãn an toàn cho đơn chưa được gán hãng vận chuyển. */
export function carrierLabel(carrier: Carrier | null): string {
  return carrier ? CARRIER_META[carrier].label : "Chưa gán";
}

export function carrierShort(carrier: Carrier | null): string {
  return carrier ? CARRIER_META[carrier].short : "—";
}
