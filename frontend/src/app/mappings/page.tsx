"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, Link2Off, Store } from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  createMapping,
  deleteMapping,
  fetchChannelProducts,
  fetchChannels,
  fetchProducts,
  getStoredUser,
  getToken,
  type Channel,
  type ChannelProductItem,
  type Product,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatVND } from "@/lib/format";

export default function MappingsPage() {
  const router = useRouter();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [items, setItems] = useState<ChannelProductItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingSku, setSavingSku] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // Tải danh sách kênh (chỉ kênh online đang hoạt động) + toàn bộ sản phẩm gốc
  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [chs, prods] = await Promise.all([
        fetchChannels(),
        fetchProducts({ page: 1, pageSize: 50 }),
      ]);
      const online = chs.filter(
        (c) => c.status === "ACTIVE" && c.channelName !== "OFFLINE"
      );
      setChannels(online);
      setProducts(prods.items);
      setChannelId((prev) => prev || online[0]?.id || "");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 409) return; // chưa có kênh — overlay xử lý
      toast.error("Không tải được dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Tải danh mục sản phẩm của sàn đang chọn
  const loadItems = useCallback(async () => {
    if (!channelId) {
      setItems([]);
      return;
    }
    setLoadingItems(true);
    try {
      const res = await fetchChannelProducts(channelId);
      setItems(res.items);
    } catch {
      toast.error("Không tải được danh mục sàn");
    } finally {
      setLoadingItems(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Trang mapping chỉ dành cho Chủ shop (Admin)
    if (getStoredUser()?.role === "STAFF") {
      setDenied(true);
      setLoading(false);
      return;
    }
    loadBase();
  }, [loadBase, router]);

  useEffect(() => {
    if (denied) return;
    loadItems();
  }, [loadItems, denied]);

  // Người dùng chọn sản phẩm gốc cho một SKU sàn
  async function handleMapChange(item: ChannelProductItem, productId: string) {
    setSavingSku(item.channelSku);
    try {
      if (productId === "") {
        // Gỡ liên kết
        if (item.mapping) {
          await deleteMapping(item.mapping.id);
          toast.success(`Đã gỡ liên kết ${item.channelSku}`);
        }
      } else {
        await createMapping({
          productId,
          channelId,
          channelSku: item.channelSku,
        });
        const p = products.find((x) => x.id === productId);
        toast.success(
          `Đã nối ${item.channelSku} ↔ ${p ? `${p.skuCode} (${p.productName})` : "sản phẩm gốc"}`
        );
      }
      loadItems();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Lỗi máy chủ");
    } finally {
      setSavingSku(null);
    }
  }

  const selectedChannel = channels.find((c) => c.id === channelId);
  const mappedCount = items.filter((i) => i.mapping).length;

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <p className="text-muted-foreground">
          Nối sản phẩm trên sàn với sản phẩm gốc trong kho. Khi đơn hàng từ sàn
          đổ về, Hubsell dựa vào liên kết này để tự động trừ tồn kho.
        </p>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tải…
          </p>
        ) : channels.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <Store className="mx-auto mb-2 size-8" />
              Chưa có kênh online nào đang hoạt động. Hãy vào trang{" "}
              <span className="font-medium">Kênh bán</span> để kết nối
              Shopee/Lazada/TikTok trước.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex max-w-sm flex-col gap-2">
              <Label htmlFor="mapping-channel">Chọn sàn</Label>
              <NativeSelect
                id="mapping-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {CHANNEL_META[c.channelName].label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {selectedChannel && (
              <p className="text-sm text-muted-foreground">
                <Link2 className="mr-1 inline size-4" />
                Đã liên kết {mappedCount}/{items.length} sản phẩm trên sàn{" "}
                {CHANNEL_META[selectedChannel.channelName].label}.
              </p>
            )}

            <Card>
              <CardContent className="p-0">
                {loadingItems ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Đang tải danh mục sàn…
                  </p>
                ) : items.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Sàn này không có sản phẩm nào.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU trên sàn</TableHead>
                        <TableHead>Tên trên sàn</TableHead>
                        <TableHead className="text-right">Giá sàn</TableHead>
                        <TableHead className="w-[320px]">
                          Sản phẩm gốc trong kho
                        </TableHead>
                        <TableHead className="text-center">Trạng thái</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.channelSku}>
                          <TableCell className="font-mono text-sm font-medium">
                            {item.channelSku}
                          </TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell className="text-right">
                            {formatVND(item.price)}
                          </TableCell>
                          <TableCell>
                            <NativeSelect
                              value={item.mapping?.productId ?? ""}
                              disabled={savingSku === item.channelSku}
                              onChange={(e) =>
                                handleMapChange(item, e.target.value)
                              }
                            >
                              <option value="">— Chưa liên kết —</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.skuCode} — {p.productName} (tồn:{" "}
                                  {p.quantityInStock})
                                </option>
                              ))}
                            </NativeSelect>
                          </TableCell>
                          <TableCell className="text-center">
                            {item.mapping ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                                <Link2 className="size-3" />
                                Đã nối
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500">
                                <Link2Off className="size-3" />
                                Chưa nối
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Giai đoạn 3 — Đồng bộ đơn hàng đa kênh
        </p>
      </div>
    </AppShell>
  );
}
