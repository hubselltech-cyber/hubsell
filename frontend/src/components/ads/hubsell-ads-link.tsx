"use client";

import { useEffect, useState } from "react";
import { Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  connectHubsellAdsCode,
  getHubsellAdsAuthUrl,
  unlinkHubsellAds,
  type HubsellAdsLinkStatus,
} from "@/lib/api";

/**
 * HUBSELL ADS — KHỐI LIÊN KẾT APP ADS SERVICE RIÊNG (10/09/2026)
 *
 * Shopee cấp quyền theo từng app: app chính của Hubsell (ERP System sau ISV)
 * không còn Ads API, nên Trợ lý quảng cáo Shopee chạy trên app "Hubsell Ads"
 * và gian phải ủy quyền THÊM một lần cho app này. Khối này chỉ hiện khi backend
 * đã bật Hubsell Ads (status.required = true):
 *   · NOT_LINKED   → thẻ mời kết nối (chưa có số liệu ads mới cho tới khi nối)
 *   · DISCONNECTED → dải cảnh báo ủy quyền hết hạn, kết nối lại
 *   · ACTIVE       → một dòng xác nhận + nút gỡ
 * Chưa bật (required = false) → không render gì, trang chạy như trước.
 *
 * Kết quả ủy quyền quay về chính trang này qua query ?hubsell_ads=connected|
 * error|code (code = trạm trung chuyển dev local → gọi /connect ngay tại đây).
 */
export function HubsellAdsLink({
  channelId,
  shopName,
  status,
  onChanged,
}: {
  channelId: string;
  shopName: string;
  status: HubsellAdsLinkStatus | null;
  /** Gọi sau khi liên kết/gỡ xong để trang nạp lại dashboard. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // Đọc kết quả ủy quyền MỘT lần rồi dọn query — F5 không toast lại.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("hubsell_ads");
    if (!result) return;
    const clean = () => {
      params.delete("hubsell_ads");
      params.delete("code");
      params.delete("shop_id");
      params.delete("shop");
      params.delete("msg");
      const qs = params.toString();
      window.history.replaceState({}, "", `/ads/shopee${qs ? `?${qs}` : ""}`);
    };
    if (result === "connected") {
      toast.success(`Đã kết nối Hubsell Ads cho gian ${params.get("shop") || ""}`.trim());
      clean();
      onChanged();
    } else if (result === "error") {
      toast.error(`Kết nối Hubsell Ads thất bại: ${params.get("msg") || "lỗi không rõ"}`);
      clean();
    } else if (result === "code" && params.get("code") && params.get("shop_id")) {
      const cid = params.get("channelId") || channelId;
      const code = params.get("code")!;
      const shopId = params.get("shop_id")!;
      clean();
      toast.info("Đã nhận code uỷ quyền Hubsell Ads — đang đổi token…");
      connectHubsellAdsCode(code, shopId, cid)
        .then((r) => {
          toast.success(r.message);
          onChanged();
        })
        .catch((err) =>
          toast.error(
            `Kết nối Hubsell Ads thất bại: ${err instanceof Error ? err.message : "lỗi không rõ"}`
          )
        );
    }
    // Chỉ chạy lúc mount — query là kết quả của lần redirect này.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status?.required) return null;

  async function connect() {
    if (!channelId || busy) return;
    setBusy(true);
    try {
      const { url } = await getHubsellAdsAuthUrl(channelId);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lấy được link ủy quyền");
      setBusy(false);
    }
  }

  async function unlink() {
    if (!channelId || busy) return;
    if (!window.confirm(`Gỡ liên kết Hubsell Ads khỏi gian "${shopName}"? Số liệu ads sẽ ngừng cập nhật cho tới khi kết nối lại.`)) {
      return;
    }
    setBusy(true);
    try {
      const r = await unlinkHubsellAds(channelId);
      toast.success(r.message);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gỡ liên kết thất bại");
    } finally {
      setBusy(false);
    }
  }

  if (status.status === "ACTIVE") {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-emerald-600" />
        <span>
          Hubsell Ads đã kết nối cho gian <b className="font-medium text-foreground">{shopName}</b>
          {" · "}ủy quyền tự gia hạn.
        </span>
        <button
          type="button"
          onClick={() => void unlink()}
          disabled={busy}
          className="underline-offset-2 hover:underline disabled:opacity-50"
        >
          Gỡ liên kết
        </button>
      </p>
    );
  }

  if (status.status === "DISCONNECTED") {
    return (
      <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Ủy quyền Hubsell Ads của gian {shopName} đã hết hạn</p>
          <p className="mt-0.5 text-amber-700">
            Shopee thu hồi phiên sau 30 ngày không gia hạn được. Số liệu quảng cáo
            đang đứng ở lần đồng bộ cuối — kết nối lại để Trợ lý tiếp tục theo dõi.
          </p>
        </div>
        <Button size="sm" onClick={() => void connect()} disabled={busy}>
          <Link2 className="size-4" />
          {busy ? "Đang mở Shopee…" : "Kết nối lại"}
        </Button>
      </div>
    );
  }

  // NOT_LINKED — thẻ mời kết nối.
  return (
    <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-orange-500 text-white">
          <Link2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">
            Kết nối Hubsell Ads cho gian {shopName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shopee tách quyền quảng cáo sang ứng dụng riêng, nên gian này cần ủy
            quyền thêm một lần cho <b className="font-medium text-foreground">Hubsell Ads</b>{" "}
            để Trợ lý đọc chi phí, chiến dịch và ví quảng cáo. Đơn hàng, kho và
            tài chính không bị ảnh hưởng.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>1. Bấm nút bên dưới — Shopee mở trang ủy quyền.</li>
            <li>
              2. Đăng nhập đúng tài khoản của gian <b className="font-medium text-foreground">{shopName}</b>{" "}
              và bấm Đồng ý.
            </li>
            <li>3. Quay về đây, số liệu ads sẽ tự đồng bộ trong vòng 10 phút.</li>
          </ul>
        </div>
        <Button onClick={() => void connect()} disabled={busy || !channelId} className="self-center">
          <Link2 className="size-4" />
          {busy ? "Đang mở Shopee…" : "Kết nối Hubsell Ads"}
        </Button>
      </div>
    </div>
  );
}
