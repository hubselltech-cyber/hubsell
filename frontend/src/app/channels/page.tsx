"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  ShoppingCart,
  Store,
  Unplug,
  Wallet,
  Zap,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  connectChannel,
  connectLazadaCode,
  connectShopeeCode,
  disconnectChannel,
  fetchChannelProducts,
  fetchChannels,
  getLazadaAuthUrl,
  getShopeeAuthUrl,
  getStoredUser,
  getTiktokAuthUrl,
  getToken,
  sendMockOrder,
  syncChannelOrders,
  syncTiktokSettlements,
  updateChannel,
  type Channel,
  type ChannelName,
  type ChannelProduct,
} from "@/lib/api";
import { canManageShop } from "@/lib/permissions";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const CONNECTABLE: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK", "OFFLINE"];

// Che bớt token cho gọn mắt: shp_41ef08…
function maskToken(token: string | null): string {
  if (!token) return "(chưa có — hãy Kết nối lại)";
  return token.slice(0, 10) + "…" + token.slice(-4);
}

// ---------- Dialog: Kết nối gian hàng ----------

function ConnectDialog({
  open,
  onOpenChange,
  existing,
  onDone,
  initialLazadaCode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: Channel[];
  onDone: () => void;
  /** Code Lazada do callback Render bật về (?lazada=code) — điền sẵn vào ô. */
  initialLazadaCode?: string;
}) {
  const [channelName, setChannelName] = useState<ChannelName>(CONNECTABLE[0]);
  const [shopName, setShopName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Lazada: callback đăng ký là backend Render (Lazada bắt https) nên local
  // không nhận được redirect — mở trang uỷ quyền ở TAB MỚI rồi người dùng dán
  // code từ URL callback vào đây để đổi token.
  const [lazadaCode, setLazadaCode] = useState("");
  const [lazadaAuthOpened, setLazadaAuthOpened] = useState(false);

  useEffect(() => {
    if (open) {
      // Có code Lazada chờ sẵn → nhảy thẳng vào bước đổi code của Lazada
      setChannelName(initialLazadaCode ? "LAZADA" : CONNECTABLE[0]);
      setShopName("");
      setSubmitting(false);
      setLazadaCode(initialLazadaCode ?? "");
      setLazadaAuthOpened(false);
    }
  }, [open, initialLazadaCode]);

  // Tên đã dùng trên chính sàn đang chọn. Chặn ngay trên giao diện thay vì để
  // người dùng điền xong bấm Kết nối rồi mới nhận lỗi từ máy chủ.
  const usedNames = new Set(
    existing
      .filter((c) => c.channelName === channelName && c.status === "ACTIVE")
      .map((c) => c.shopName.trim().toLowerCase())
  );
  const trimmed = shopName.trim();
  const duplicated = trimmed !== "" && usedNames.has(trimmed.toLowerCase());

  // TikTok/Shopee/Lazada đi qua OAuth THẬT: người bán uỷ quyền bên sàn, tên
  // gian do sàn trả về nên không cần nhập tay. Các sàn còn lại vẫn giả lập.
  const isTiktok = channelName === "TIKTOK";
  const isShopee = channelName === "SHOPEE";
  const isLazada = channelName === "LAZADA";
  const isOAuth = isTiktok || isShopee || isLazada;

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!isOAuth && duplicated) return;
    setSubmitting(true);
    try {
      if (isTiktok) {
        const { url, state } = await getTiktokAuthUrl();
        // Lưu state để trang callback đối chiếu (chống CSRF) sau khi TikTok trả về.
        sessionStorage.setItem("tiktok_oauth_state", state);
        window.location.href = url; // chuyển hướng sang trang uỷ quyền TikTok
        return;
      }
      if (isShopee) {
        // Shopee: state (mang ownerId) đã ký ở backend, callback là route backend.
        const { url } = await getShopeeAuthUrl();
        window.location.href = url;
        return;
      }
      if (isLazada) {
        // Chưa có code: mở trang uỷ quyền ở tab mới, giữ dialog chờ dán code.
        if (!lazadaCode.trim()) {
          const { url } = await getLazadaAuthUrl();
          window.open(url, "_blank", "noopener");
          setLazadaAuthOpened(true);
          setSubmitting(false);
          return;
        }
        // Người dùng có thể dán NGUYÊN URL callback — tự bóc tham số code ra.
        let code = lazadaCode.trim();
        const fromUrl = code.match(/[?&]code=([^&\s]+)/);
        if (fromUrl) code = decodeURIComponent(fromUrl[1]);
        const r = await connectLazadaCode(code);
        toast.success(`Đã kết nối Lazada: ${r.channel.shopName}`);
        onOpenChange(false);
        onDone();
        return;
      }
      const c = await connectChannel(channelName, trimmed || undefined);
      toast.success(
        `Đã kết nối gian hàng "${c.shopName}" trên ${CHANNEL_META[c.channelName].label}`
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kết nối gian hàng</DialogTitle>
          <DialogDescription>
            {isOAuth ? (
              <>
                {CHANNEL_META[channelName].label} dùng uỷ quyền thật: bạn sẽ được
                chuyển sang trang {CHANNEL_META[channelName].label} để đăng nhập và
                cho phép Hubsell truy cập gian hàng.
              </>
            ) : (
              <>
                Một sàn có thể kết nối nhiều gian hàng. Đặt tên để phân biệt chúng
                trên báo cáo. (Kết nối giả lập — hệ thống cấp API Token ảo.)
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConnect} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="channel-select">Sàn thương mại</Label>
            <NativeSelect
              id="channel-select"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value as ChannelName)}
            >
              {CONNECTABLE.map((n) => (
                <option key={n} value={n}>
                  {CHANNEL_META[n].label}
                </option>
              ))}
            </NativeSelect>
            {usedNames.size > 0 && (
              <p className={TEXT_SUB}>
                Đang có {formatNumber(usedNames.size)} gian hàng trên sàn này.
              </p>
            )}
          </div>

          {/* OAuth (TikTok/Shopee/Lazada): tên gian do sàn trả về, không nhập tay. */}
          {isOAuth ? (
            <div className="space-y-3">
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Tên gian hàng sẽ được lấy tự động từ{" "}
                {CHANNEL_META[channelName].label} sau khi uỷ quyền.
              </p>
              {/* Lazada mở uỷ quyền ở tab mới → quay lại đây dán code đổi token. */}
              {isLazada && (
                <div className="grid gap-2">
                  <Label htmlFor="lazada-code">Code uỷ quyền</Label>
                  <Input
                    id="lazada-code"
                    placeholder="Dán code (hoặc nguyên URL callback) vào đây"
                    value={lazadaCode}
                    onChange={(e) => setLazadaCode(e.target.value)}
                  />
                  <p className={TEXT_SUB}>
                    {lazadaCode.trim()
                      ? "Code đã sẵn sàng — bấm “Đổi code lấy token” để hoàn tất kết nối."
                      : lazadaAuthOpened
                        ? "Uỷ quyền xong, trình duyệt sẽ tự quay về trang này kèm code điền sẵn; nếu không, copy tham số code trên thanh địa chỉ rồi dán vào ô trên."
                        : "Bấm nút bên dưới để mở trang uỷ quyền Lazada; uỷ quyền xong trình duyệt tự quay về đây."}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="shop-name">Tên gian hàng</Label>
              <Input
                id="shop-name"
                placeholder={`VD: ${CHANNEL_META[channelName].label} - Shop Chính`}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                maxLength={60}
              />
              {duplicated ? (
                <p className="text-sm text-red-500">
                  Đã có gian hàng tên này trên {CHANNEL_META[channelName].label}.
                  Đặt tên khác để phân biệt.
                </p>
              ) : (
                <p className={TEXT_SUB}>Bỏ trống thì lấy tên sàn làm mặc định.</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting || (!isOAuth && duplicated)}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlugZap className="size-4" />
              )}
              {isLazada && lazadaCode.trim()
                ? "Đổi code lấy token"
                : isOAuth
                  ? `Tiếp tục với ${CHANNEL_META[channelName].label}`
                  : "Kết nối"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dialog: Giả lập đơn hàng từ sàn ----------

function MockOrderDialog({
  channel,
  open,
  onOpenChange,
  onDone,
}: {
  channel: Channel;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<ChannelProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelSku, setChannelSku] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [customerName, setCustomerName] = useState("Khách thử nghiệm");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Chỉ lấy sản phẩm sàn ĐÃ liên kết về kho gốc — đơn của sản phẩm chưa liên
    // kết sẽ bị webhook từ chối vì không biết trừ kho nào.
    fetchChannelProducts({ channelId: channel.id, linked: "yes", pageSize: 100 })
      .then((res) => {
        setItems(res.items);
        setChannelSku(res.items[0]?.channelSku ?? "");
      })
      .catch(() => toast.error("Không tải được danh mục sàn"))
      .finally(() => setLoading(false));
  }, [open, channel.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!channelSku || !Number.isInteger(qty) || qty <= 0) {
      toast.error("Chọn sản phẩm và nhập số lượng nguyên dương");
      return;
    }
    if (!channel.apiToken) {
      toast.error("Kênh chưa có token. Hãy Ngắt kết nối rồi Kết nối lại.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await sendMockOrder({
        channelId: channel.id,
        webhookToken: channel.apiToken,
        customerName: customerName.trim() || undefined,
        items: [{ channelSku, quantity: qty }],
      });
      const adj = res.adjustments[0];
      toast.success(
        `${res.message} ${adj ? `"${adj.productName}" −${adj.deducted} → còn ${adj.newQuantity}.` : ""}`,
        { duration: 6000 }
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ", {
        duration: 6000,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const meta = CHANNEL_META[channel.channelName];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-5 text-amber-500" />
            Giả lập đơn hàng từ {meta.label}
          </DialogTitle>
          <DialogDescription>
            Mô phỏng sàn gửi webhook về Hubsell: hệ thống sẽ tra mapping, tạo đơn
            và tự động trừ tồn kho sản phẩm gốc.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Đang tải danh mục sàn…
          </p>
        ) : items.length === 0 ? (
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">
              Sàn này chưa có sản phẩm nào được liên kết với kho gốc, nên chưa thể
              nhận đơn.
            </p>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              onClick={() => onOpenChange(false)}
              render={<Link href="/mappings" />}
            >
              <Link2 className="size-4" />
              Đi liên kết sản phẩm
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="mock-sku">Sản phẩm trên sàn (đã liên kết)</Label>
              <NativeSelect
                id="mock-sku"
                value={channelSku}
                onChange={(e) => setChannelSku(e.target.value)}
              >
                {items.map((i) => (
                  <option key={i.channelSku} value={i.channelSku}>
                    {i.channelSku} — {i.productName} ({formatVND(i.price)})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="mock-qty">Số lượng</Label>
                <Input
                  id="mock-qty"
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mock-customer">Tên khách</Label>
                <Input
                  id="mock-customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShoppingCart className="size-4" />
                )}
                Gửi đơn về Hubsell
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Trang chính ----------

// ---------- Dialog: Cập nhật gian hàng ----------

function UpdateShopDialog({
  channel,
  open,
  onOpenChange,
  onDone,
}: {
  channel: Channel;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [shopName, setShopName] = useState(channel.shopName);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = shopName.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      // Chỉ đổi tên gian hàng — phí sàn không còn nhập tay ở trang kết nối,
      // hệ thống tự tạm tính (mặc định theo sàn, hoặc theo đơn thực tế).
      await updateChannel(channel.id, { shopName: trimmed });
      toast.success(`Đã cập nhật gian hàng "${trimmed}"`);
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được máy chủ"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cập nhật gian hàng</DialogTitle>
          <DialogDescription>
            Gian hàng trên {CHANNEL_META[channel.channelName].label}. Đổi tên
            không ảnh hưởng tới đơn hàng và sản phẩm đã đồng bộ.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-shop-name">Tên gian hàng</Label>
            <Input
              id="edit-shop-name"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              maxLength={60}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting || !trimmed}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Pencil className="size-4" />
              )}
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ChannelsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  // Code Lazada do callback Render bật về máy dev (?lazada=code&code=...)
  const [lazadaPrefill, setLazadaPrefill] = useState<string | null>(null);
  const [mockFor, setMockFor] = useState<Channel | null>(null);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [denied, setDenied] = useState(false);
  // Khoá nút khi đang đồng bộ — giá trị dạng `${channelId}:orders|settlements`.
  const [syncing, setSyncing] = useState<string | null>(null);

  /**
   * Gom gian hàng theo SÀN. Giữ thứ tự sàn cố định theo CONNECTABLE thay vì
   * theo thứ tự dữ liệu trả về, để vị trí các khối không nhảy mỗi lần tải lại.
   * Trong mỗi sàn, gian đang hoạt động lên trước rồi mới tới gian đã ngắt.
   */
  const grouped = useMemo(
    () =>
      CONNECTABLE.map((platform) => ({
        platform,
        shops: channels
          .filter((c) => c.channelName === platform)
          .sort((a, b) => {
            const byStatus =
              Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE");
            return byStatus !== 0
              ? byStatus
              : a.shopName.localeCompare(b.shopName, "vi");
          }),
      })).filter((g) => g.shops.length > 0),
    [channels]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await fetchChannels());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      toast.error("Không tải được danh sách kênh");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Trang cấu hình gian hàng chỉ dành cho Chủ shop
    if (!canManageShop(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  // Sau khi Shopee uỷ quyền, backend redirect về /channels?shopee=connected|error.
  // Đọc 1 lần rồi dọn query để F5 không toast lại. Đọc trực tiếp window.location
  // (client-only) để khỏi cần bọc Suspense như useSearchParams ở Next 16.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopee = params.get("shopee");
    const lazada = params.get("lazada");
    if (!shopee && !lazada) return;
    if (shopee === "connected") {
      toast.success(`Đã kết nối Shopee: ${params.get("shop") || "gian hàng"}`);
    } else if (shopee === "error") {
      toast.error(`Kết nối Shopee thất bại: ${params.get("msg") || "lỗi không rõ"}`);
    } else if (shopee === "code" && params.get("code") && params.get("shop_id")) {
      // Callback Render bật code+shop_id về máy dev — Shopee trả đủ cả hai nên
      // đổi token luôn, không cần bước dán tay như Lazada.
      toast.info("Đã nhận code uỷ quyền Shopee — đang đổi token…");
      connectShopeeCode(params.get("code")!, params.get("shop_id")!)
        .then(async (r) => {
          toast.success(r.message);
          setChannels(await fetchChannels());
        })
        .catch((err) =>
          toast.error(
            `Kết nối Shopee thất bại: ${err instanceof Error ? err.message : "lỗi không rõ"}`
          )
        );
    }
    if (lazada === "connected") {
      toast.success(`Đã kết nối Lazada: ${params.get("shop") || "gian hàng"}`);
    } else if (lazada === "error") {
      toast.error(`Kết nối Lazada thất bại: ${params.get("msg") || "lỗi không rõ"}`);
    } else if (lazada === "code" && params.get("code")) {
      // Callback Render bật code uỷ quyền về máy dev — mở dialog với code điền
      // sẵn, người dùng chỉ cần bấm nút hoàn tất (backend local đổi code lấy token).
      setLazadaPrefill(params.get("code"));
      setConnectOpen(true);
      toast.info("Đã nhận code uỷ quyền Lazada — bấm “Đổi code lấy token” để hoàn tất.");
    }
    window.history.replaceState({}, "", "/channels");
  }, []);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  async function handleDisconnect(c: Channel) {
    try {
      await disconnectChannel(c.id);
      toast.success(`Đã ngắt kết nối ${CHANNEL_META[c.channelName].label}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Lỗi máy chủ");
    }
  }

  async function handleReconnect(c: Channel) {
    try {
      await connectChannel(c.channelName);
      toast.success(
        `Đã kết nối lại ${CHANNEL_META[c.channelName].label} (token mới được cấp)`
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Lỗi máy chủ");
    }
  }

  async function handleSyncOrders(c: Channel) {
    setSyncing(`${c.id}:orders`);
    try {
      const r = await syncChannelOrders(c.id);
      toast.success(
        `Đồng bộ đơn ${CHANNEL_META[c.channelName].label}: +${formatNumber(
          r.created
        )} mới, ${formatNumber(r.updated)} cập nhật (tổng ${formatNumber(
          r.fetched
        )} đơn).`
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Lỗi máy chủ");
    } finally {
      setSyncing(null);
    }
  }

  async function handleSyncSettlements(c: Channel) {
    setSyncing(`${c.id}:settlements`);
    try {
      const r = await syncTiktokSettlements(c.id);
      toast.success(
        `Đồng bộ đối soát: cập nhật ${formatNumber(
          r.ordersUpdated
        )} đơn (${formatNumber(r.transactions)} giao dịch).`
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Lỗi máy chủ");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Kết nối gian hàng trên các sàn để đồng bộ đơn hàng về Hubsell.
          </p>
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="size-4" />
            Kết nối gian hàng
          </Button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tải…
          </p>
        ) : channels.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Chưa kết nối gian hàng nào. Bấm “Kết nối gian hàng” để bắt đầu.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ platform, shops }) => {
              const meta = CHANNEL_META[platform];
              const activeCount = shops.filter(
                (c) => c.status === "ACTIVE"
              ).length;
              return (
                <Card key={platform} className="shadow-sm">
                  {/* ĐẦU KHỐI SÀN — logo, tên sàn, số gian hàng đang kết nối */}
                  <CardHeader className="border-b pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-3 text-base">
                      <span
                        className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-semibold ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                      <span className="font-semibold">
                        {formatNumber(shops.length)} kết nối
                      </span>
                      {activeCount < shops.length && (
                        <span className={TEXT_SUB}>
                          ({formatNumber(activeCount)} đang hoạt động)
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="divide-y p-0">
                    {shops.map((c) => {
                      const active = c.status === "ACTIVE";
                      return (
                        <div
                          key={c.id}
                          className={cn(
                            "flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40",
                            !active && "opacity-70"
                          )}
                        >
                          {/* TÊN GIAN HÀNG là tiêu đề chính của dòng */}
                          <div className="min-w-56 flex-1">
                            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold">
                              <span className="flex min-w-0 items-center gap-2">
                                <Store className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">{c.shopName}</span>
                              </span>
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
                                  active ? "text-emerald-500" : "text-zinc-400"
                                )}
                              >
                                <span
                                  className={cn(
                                    "size-2 rounded-full",
                                    active ? "bg-emerald-500" : "bg-zinc-300"
                                  )}
                                />
                                {active ? "Đang hoạt động" : "Đã ngắt kết nối"}
                              </span>
                            </p>
                            <p
                              className={cn(
                                TEXT_SUB,
                                "mt-1 flex items-center gap-1.5 font-mono"
                              )}
                            >
                              <KeyRound className="size-3 shrink-0" />
                              {maskToken(c.apiToken)}
                            </p>
                          </div>

                          {/* Trang Kênh bán chỉ lo KẾT NỐI API — không hiển thị
                              phí sàn (phí thực tế do đơn hàng quyết định, xem ở
                              Command Center / Báo cáo tài chính). */}
                          <div className="min-w-48">
                            <p className={TEXT_SUB}>
                              {formatNumber(c._count?.orders ?? 0)} đơn đã đồng bộ
                            </p>
                            <p className={TEXT_SUB}>
                              {formatNumber(c.matchedProductCount ?? 0)} SP sàn đã
                              khớp SKU
                            </p>
                          </div>

                          <div className="ml-auto flex flex-wrap gap-2">
                            {active ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditing(c)}
                                >
                                  <Pencil className="size-3.5" />
                                  Cập nhật
                                </Button>
                                {/* Gian đã uỷ quyền API thật (TikTok/Shopee/Lazada) →
                                    đồng bộ dữ liệu thật; còn lại dùng "Giả lập đơn".
                                    "Đồng bộ đối soát" hiện mới có cho TikTok. */}
                                {(c.channelName === "TIKTOK" ||
                                  c.channelName === "SHOPEE" ||
                                  c.channelName === "LAZADA") &&
                                c.apiConnected ? (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-slate-700"
                                      disabled={syncing !== null}
                                      onClick={() => handleSyncOrders(c)}
                                    >
                                      {syncing === `${c.id}:orders` ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                      ) : (
                                        <RefreshCw className="size-3.5" />
                                      )}
                                      Đồng bộ đơn
                                    </Button>
                                    {c.channelName === "TIKTOK" && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-slate-700"
                                        disabled={syncing !== null}
                                        onClick={() => handleSyncSettlements(c)}
                                      >
                                        {syncing === `${c.id}:settlements` ? (
                                          <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                          <Wallet className="size-3.5" />
                                        )}
                                        Đồng bộ đối soát
                                      </Button>
                                    )}
                                  </>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-amber-700"
                                    disabled={
                                      !c.apiToken || c.channelName === "OFFLINE"
                                    }
                                    onClick={() => setMockFor(c)}
                                  >
                                    <Zap className="size-3.5" />
                                    Giả lập đơn
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-rose-700"
                                  onClick={() => handleDisconnect(c)}
                                >
                                  <Unplug className="size-3.5" />
                                  Ngắt kết nối
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReconnect(c)}
                              >
                                <PlugZap className="size-3.5" />
                                Kết nối lại
                              </Button>
                            )}
                          </div>

                          {active && !c.apiToken && (
                            <p className="w-full text-xs text-amber-600">
                              Gian hàng cũ chưa có API Token — hãy “Ngắt kết nối”
                              rồi “Kết nối lại” để được cấp token.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Giai đoạn 3 — Đồng bộ đơn hàng đa kênh
        </p>
      </div>

      <ConnectDialog
        open={connectOpen}
        onOpenChange={(o) => {
          setConnectOpen(o);
          if (!o) setLazadaPrefill(null); // đóng dialog thì bỏ code chờ, mở lại là form trắng
        }}
        existing={channels}
        onDone={load}
        initialLazadaCode={lazadaPrefill ?? undefined}
      />
      {mockFor && (
        <MockOrderDialog
          channel={mockFor}
          open={true}
          onOpenChange={(o) => {
            if (!o) setMockFor(null);
          }}
          onDone={load}
        />
      )}

      {editing && (
        <UpdateShopDialog
          channel={editing}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onDone={load}
        />
      )}
    </AppShell>
  );
}
