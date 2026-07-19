"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  KeyRound,
  Link2,
  Loader2,
  PlugZap,
  Plus,
  ShoppingCart,
  Unplug,
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
  disconnectChannel,
  fetchChannelProducts,
  fetchChannels,
  getStoredUser,
  getToken,
  sendMockOrder,
  type Channel,
  type ChannelName,
  type ChannelProduct,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";

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
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: Channel[];
  onDone: () => void;
}) {
  const [channelName, setChannelName] = useState<ChannelName>(CONNECTABLE[0]);
  const [shopName, setShopName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setChannelName(CONNECTABLE[0]);
      setShopName("");
    }
  }, [open]);

  // Tên đã dùng trên chính sàn đang chọn. Chặn ngay trên giao diện thay vì để
  // người dùng điền xong bấm Kết nối rồi mới nhận lỗi từ máy chủ.
  const usedNames = new Set(
    existing
      .filter((c) => c.channelName === channelName && c.status === "ACTIVE")
      .map((c) => c.shopName.trim().toLowerCase())
  );
  const trimmed = shopName.trim();
  const duplicated = trimmed !== "" && usedNames.has(trimmed.toLowerCase());

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (duplicated) return;
    setSubmitting(true);
    try {
      const c = await connectChannel(channelName, trimmed || undefined);
      toast.success(
        `Đã kết nối gian hàng "${c.shopName}" trên ${CHANNEL_META[c.channelName].label}`
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kết nối gian hàng</DialogTitle>
          <DialogDescription>
            Một sàn có thể kết nối nhiều gian hàng. Đặt tên để phân biệt chúng
            trên báo cáo. (Kết nối giả lập — hệ thống cấp API Token ảo.)
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
              <p className="text-sm text-rose-600">
                Đã có gian hàng tên này trên {CHANNEL_META[channelName].label}.
                Đặt tên khác để phân biệt.
              </p>
            ) : (
              <p className={TEXT_SUB}>Bỏ trống thì lấy tên sàn làm mặc định.</p>
            )}
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
            <Button type="submit" disabled={submitting || duplicated}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlugZap className="size-4" />
              )}
              Kết nối
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

export default function ChannelsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [mockFor, setMockFor] = useState<Channel | null>(null);
  const [denied, setDenied] = useState(false);

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
    // Trang cấu hình kênh chỉ dành cho Chủ shop (Admin)
    if (getStoredUser()?.role === "STAFF") {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((c) => {
              const meta = CHANNEL_META[c.channelName];
              const active = c.status === "ACTIVE";
              return (
                <Card key={c.id} className={active ? "" : "opacity-70"}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-start justify-between gap-2 text-base">
                      {/* TÊN GIAN HÀNG là thông tin chính, badge sàn chỉ là phụ
                          đề — hai shop cùng sàn phải phân biệt được bằng mắt */}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {c.shopName}
                        </span>
                        <span
                          className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${
                          active ? "text-emerald-600" : "text-zinc-400"
                        }`}
                      >
                        <span
                          className={`size-2 rounded-full ${
                            active ? "bg-emerald-500" : "bg-zinc-300"
                          }`}
                        />
                        {active ? "Đang hoạt động" : "Đã ngắt kết nối"}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <KeyRound className="size-4 shrink-0" />
                      <span className="truncate font-mono text-xs">
                        {maskToken(c.apiToken)}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      {formatNumber(c._count?.orders ?? 0)} đơn hàng ·{" "}
                      {formatNumber(c._count?.channelProducts ?? 0)} sản phẩm sàn
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {active ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-amber-700"
                            disabled={!c.apiToken || c.channelName === "OFFLINE"}
                            onClick={() => setMockFor(c)}
                          >
                            <Zap className="size-4" />
                            Giả lập đơn hàng
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-700"
                            onClick={() => handleDisconnect(c)}
                          >
                            <Unplug className="size-4" />
                            Ngắt kết nối
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReconnect(c)}
                        >
                          <PlugZap className="size-4" />
                          Kết nối lại
                        </Button>
                      )}
                    </div>
                    {active && !c.apiToken && (
                      <p className="text-xs text-amber-600">
                        Kênh cũ chưa có API Token — hãy “Ngắt kết nối” rồi “Kết nối
                        lại” để được cấp token.
                      </p>
                    )}
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
        onOpenChange={setConnectOpen}
        existing={channels}
        onDone={load}
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
    </AppShell>
  );
}
