"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgePercent,
  CircleCheck,
  CircleDashed,
  CloudOff,
  Hourglass,
  Loader2,
  PackageSearch,
  PlugZap,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { KOC_PLATFORM_META } from "@/components/koc/koc-data";
import { KocShell } from "@/components/koc/koc-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
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
  fetchKocAffiliateOrders,
  fetchKocChannelDetail,
  type KocAffiliateOrderDTO,
  type KocChannelDetailDTO,
} from "@/lib/api";
import { formatDateTime, formatNumber, formatVND } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_NUMBER_STRONG,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRANG AFFILIATE THEO SÀN — SỐ THẬT 100%, KHÔNG CÒN PRESET GIẢ.
 *
 * Ba trang TikTok/Shopee/Lazada dùng chung component này, cùng đọc
 * /api/koc/channel-detail (+ /api/koc/orders lọc theo sàn). Sàn chưa phát
 * sinh đơn affiliate thì hiện 0 và empty-state nói thẳng — không vẽ số mẫu.
 *
 * TIKTOK = CỔNG CHỜ: chưa thử nghiệm được cả sandbox (đang đợi phía TikTok)
 * nên đầu trang có thẻ trạng thái checklist; toàn bộ khung số liệu bên dưới
 * vẫn nối sẵn vào cùng đường ống API — shop thật uỷ quyền xong là số tự chảy
 * vào, không phải sửa thêm dòng code nào.
 */

type ChannelKey = "SHOPEE" | "LAZADA" | "TIKTOK";

/** Nội dung đặc thù từng sàn: chương trình affiliate + giới hạn API (text
 *  thông tin thật, KHÔNG phải số liệu). */
const CHANNEL_INFO: Record<
  ChannelKey,
  { programName: string; source: string; limits: string[] }
> = {
  SHOPEE: {
    programName: "Shopee Affiliate (AMS)",
    source:
      "Hoa hồng AMS đọc từ đối soát ký quỹ (escrow) của từng đơn — trường order_ams_commission_fee, đồng bộ bằng token gian hàng sẵn có.",
    limits: [
      "API seller chỉ trả tổng phí AMS theo ĐƠN — không cho biết KOC/creator nào dẫn đơn.",
      "Đơn chỉ có số sau khi sàn quyết toán (đơn hoàn tất), nên số liệu trễ hơn thời gian thực 1–3 ngày.",
      "Cấu hình gói hoa hồng AMS vẫn thao tác trên Kênh Người Bán Shopee.",
    ],
  },
  LAZADA: {
    programName: "Lazada Affiliate / Sponsored",
    source:
      "Phí tiếp thị liên kết đọc từ sao kê Finance API (fee_name nhóm affiliate/sponsor), đồng bộ mỗi giờ bằng token 2 gian hàng đã liên kết.",
    limits: [
      "Finance API chỉ trả phí theo ĐƠN — không có danh tính creator.",
      "Đơn thiếu sao kê (chưa quyết toán) sẽ chưa được tính — đây là lý do số tăng dần theo ngày.",
      "Nhóm phí 'sponsor' của Lazada gộp chung bucket affiliate — số có thể gồm cả sponsored discovery.",
    ],
  },
  TIKTOK: {
    programName: "TikTok Shop Affiliate",
    source:
      "Khi shop thật uỷ quyền, phí affiliate sẽ đổ vào cùng đường ống đối soát (statement transactions) — khung trang này tự hiện số, không cần sửa code.",
    limits: [
      "Chưa thử nghiệm được sandbox — đang đợi phía TikTok.",
      "TikTok Affiliate API (danh tính creator, Open/Target Plan) cần app được duyệt scope Affiliate.",
      "Gian 'Tiktok' hiện tại trong hệ thống là giả lập (chưa OAuth thật).",
    ],
  },
};

const ORDERS_PAGE_SIZE = 10;

export function KocChannelPage({ platform }: { platform: ChannelKey }) {
  const meta = KOC_PLATFORM_META[platform];
  const info = CHANNEL_INFO[platform];

  const [days, setDays] = useState(30);
  const [detail, setDetail] = useState<KocChannelDetailDTO | null>(null);
  const [orders, setOrders] = useState<KocAffiliateOrderDTO[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (pageNo: number, rangeDays: number) => {
      try {
        setLoading(true);
        setError(null);
        const [d, o] = await Promise.all([
          fetchKocChannelDetail(platform, rangeDays),
          fetchKocAffiliateOrders({
            days: rangeDays,
            page: pageNo,
            pageSize: ORDERS_PAGE_SIZE,
            channel: { channelName: platform },
          }),
        ]);
        setDetail(d);
        setOrders(o.orders);
        setOrdersTotal(o.total);
        setPage(o.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không kết nối được máy chủ");
      } finally {
        setLoading(false);
      }
    },
    [platform]
  );

  useEffect(() => {
    load(1, days);
  }, [load, days]);

  // ----- Cổng chờ TikTok: xác định trạng thái từng bước từ dữ liệu thật -----
  const hasRealShop =
    detail?.shops.some((s) => s.authorizedReal && s.connected) ?? false;

  return (
    <KocShell>
      {/* ===== CỔNG CHỜ TIKTOK (chỉ hiện ở trang TikTok) ===== */}
      {platform === "TIKTOK" && (
        <Card className="border-violet-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hourglass className="size-4.5 text-violet-600" />
              Cổng chờ TikTok Shop — chưa kích hoạt được, đang đợi phía TikTok
            </CardTitle>
            <CardDescription>
              Khung số liệu bên dưới đã nối sẵn vào cùng đường ống API với
              Shopee/Lazada. Hoàn thành 3 bước sau là số tự chảy vào, không cần
              sửa code:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span>
                  <b>Thử nghiệm sandbox TikTok Shop</b> — chưa thực hiện được,
                  đang đợi phía TikTok mở môi trường thử nghiệm cho app.
                </span>
              </li>
              <li className="flex items-start gap-2">
                {hasRealShop ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-slate-400" />
                )}
                <span>
                  <b>Uỷ quyền gian hàng TikTok thật</b> qua trang{" "}
                  <a href="/channels" className="font-medium text-violet-700 underline">
                    Kênh bán
                  </a>{" "}
                  — gian &quot;Tiktok&quot; hiện tại là giả lập, chưa OAuth thật.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <span>
                  <b>App được duyệt scope Affiliate</b> — để lấy danh tính
                  creator theo đơn (Shopee/Lazada không có khả năng này, TikTok
                  là cửa duy nhất).
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ===== TRẠNG THÁI TẢI / LỖI ===== */}
      {loading && !detail && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang đọc dữ liệu affiliate {meta.label} từ đối soát sàn…
          </CardContent>
        </Card>
      )}
      {(error || (!loading && !detail)) && (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm">
            <CloudOff className="size-5 shrink-0 text-slate-400" />
            <div>
              <p className="text-slate-900">
                Chưa đọc được dữ liệu affiliate {meta.label}
              </p>
              <p className={TEXT_SUB}>{error ?? "Không rõ nguyên nhân"}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => load(1, days)}
            >
              Thử lại
            </Button>
          </CardContent>
        </Card>
      )}

      {detail && (
        <>
          {/* ===== THANH CHỌN KỲ ===== */}
          <div className="flex items-center justify-end gap-2">
            <span className={TEXT_SUB}>Kỳ thống kê</span>
            <NativeSelect
              className="w-32"
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Chọn kỳ thống kê"
            >
              <option value="7">7 ngày</option>
              <option value="30">30 ngày</option>
              <option value="90">90 ngày</option>
            </NativeSelect>
          </div>

          {/* ===== 4 THẺ CHỈ SỐ THẬT ===== */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={`GMV Affiliate ${meta.label}`}
              value={<Money value={detail.totals.gmv} />}
              icon={TrendingUp}
              tone="info"
              subtitle={
                detail.totals.shopGmv > 0
                  ? `Chiếm ${detail.totals.sharePct.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% GMV toàn sàn cùng kỳ`
                  : `Toàn sàn chưa có đơn trong ${detail.days} ngày`
              }
            />
            <StatCard
              label="Doanh thu ròng affiliate"
              value={<Money value={detail.totals.netRevenue} />}
              icon={Wallet}
              tone="positive"
              colorValue
              subtitle="GMV đã trừ tiền hoàn thật từ sàn"
            />
            <StatCard
              label="Hoa hồng sàn đã trừ"
              value={<Money value={detail.totals.commission} />}
              icon={BadgePercent}
              tone="negative"
              colorValue
              subtitle={info.programName}
            />
            <StatCard
              label="Đơn affiliate"
              value={formatNumber(detail.totals.orders)}
              icon={ShoppingBag}
              tone="neutral"
              subtitle={
                detail.totals.refundedOrders > 0
                  ? `Trong đó ${formatNumber(detail.totals.refundedOrders)} đơn hoàn`
                  : `Trên tổng ${formatNumber(detail.totals.shopOrders)} đơn của sàn`
              }
            />
          </div>

          {/* ===== BIỂU ĐỒ GMV vs HOA HỒNG THEO NGÀY ===== */}
          <Card>
            <CardHeader>
              <CardTitle>
                GMV Affiliate vs Hoa hồng ({detail.days} ngày)
              </CardTitle>
              <CardDescription>
                Số thật theo ngày tạo đơn — đơn chỉ vào biểu đồ sau khi sàn
                quyết toán và ghi nhận phí affiliate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.totals.orders === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <PackageSearch className="size-8 text-slate-300" />
                  <p className="text-sm text-slate-900">
                    Chưa phát sinh đơn affiliate trong {detail.days} ngày gần nhất
                  </p>
                  <p className={cn(TEXT_SUB, "max-w-md")}>
                    Biểu đồ sẽ tự hiện khi sàn quyết toán đơn có phí tiếp thị
                    liên kết. {info.source}
                  </p>
                </div>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={detail.series}>
                      <defs>
                        <linearGradient id="gradKocGmv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="gradKocCommission" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f87171" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#f87171" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" fontSize={12} tickLine={false} />
                      <YAxis
                        fontSize={11}
                        tickLine={false}
                        width={110}
                        tickFormatter={(v: number) => formatVND(v)}
                      />
                      <Tooltip
                        formatter={(value, name) => [
                          formatVND(Number(value)),
                          name === "gmv" ? "GMV Affiliate" : "Hoa hồng sàn trừ",
                        ]}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "gmv" ? "GMV Affiliate" : "Hoa hồng sàn trừ"
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="gmv"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#gradKocGmv)"
                      />
                      <Area
                        type="monotone"
                        dataKey="commission"
                        stroke="#f87171"
                        strokeWidth={2}
                        fill="url(#gradKocCommission)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ===== GIAN HÀNG TRÊN SÀN ===== */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="size-4.5 text-emerald-600" />
                Gian hàng {meta.label} &amp; trạng thái liên kết
              </CardTitle>
              <CardDescription>
                Dùng token đã liên kết sẵn — không cần uỷ quyền thêm.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader className={TABLE_HEAD_EMPHASIS}>
                  <TableRow>
                    <TableHead>Gian hàng</TableHead>
                    <TableHead className="w-36">Liên kết</TableHead>
                    <TableHead className="w-40">Đồng bộ gần nhất</TableHead>
                    <TableHead className="text-right">Đơn affiliate</TableHead>
                    <TableHead className="text-right">GMV Affiliate</TableHead>
                    <TableHead className="text-right">Hoa hồng</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.shops.map((s) => (
                    <TableRow key={s.channelId}>
                      <TableCell>
                        <p className="text-slate-900">{s.shopName}</p>
                        <p className={TEXT_SUB}>
                          {s.externalShopId
                            ? `ID ${s.externalShopId}`
                            : "Gian giả lập — chưa OAuth thật"}
                        </p>
                      </TableCell>
                      <TableCell>
                        {s.authorizedReal && s.connected ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            Đang hoạt động
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-slate-50 text-slate-500"
                          >
                            Chưa uỷ quyền thật
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {s.lastSyncAt ? (
                          formatDateTime(s.lastSyncAt)
                        ) : (
                          <span className={TEXT_SUB}>Chưa đồng bộ</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-slate-700">
                        {formatNumber(s.affiliate.orders)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={s.affiliate.gmv} className="text-slate-900" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          value={s.affiliate.commission}
                          className={cn(TEXT_NUMBER_STRONG, "text-red-500")}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.shops.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Chưa liên kết gian hàng {meta.label} nào — vào trang
                        Kênh bán để kết nối.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ===== TOP SKU ĐƯỢC AFFILIATE BÁN ===== */}
          <Card>
            <CardHeader>
              <CardTitle>Top SKU bán qua affiliate</CardTitle>
              <CardDescription>
                Gom từ dòng hàng của các đơn affiliate. Hoa hồng ở đây là số
                PHÂN BỔ theo tỷ trọng giá trị dòng (sàn chỉ trả phí cấp đơn) —
                dùng để so tương quan, không phải số đối soát.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.topSkus.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Chưa có dòng hàng affiliate nào trong {detail.days} ngày gần
                  nhất.
                </p>
              ) : (
                <Table>
                  <TableHeader className={TABLE_HEAD_EMPHASIS}>
                    <TableRow>
                      <TableHead>SKU / Sản phẩm</TableHead>
                      <TableHead className="w-24 text-right">SL bán</TableHead>
                      <TableHead className="text-right">GMV</TableHead>
                      <TableHead className="text-right">Hoa hồng (phân bổ)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.topSkus.map((s) => (
                      <TableRow key={s.channelSku}>
                        <TableCell>
                          <p className="font-mono text-sm text-slate-900">
                            {s.channelSku}
                          </p>
                          <p className={TEXT_SUB}>{s.productName}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-slate-700">
                          {formatNumber(s.quantity)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={s.gmv} className="text-slate-900" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={s.commission} className={TEXT_NUMBER_MUTED} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ===== ĐƠN AFFILIATE CỦA SÀN ===== */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="size-4.5 text-violet-600" />
                Đơn affiliate {meta.label} ({formatNumber(ordersTotal)} đơn ·{" "}
                {detail.days} ngày)
              </CardTitle>
              <CardDescription>
                Bằng chứng từng dòng — đơn sàn đã trừ phí tiếp thị liên kết khi
                quyết toán.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader className={TABLE_HEAD_EMPHASIS}>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Gian hàng</TableHead>
                    <TableHead className="w-40">Ngày tạo</TableHead>
                    <TableHead className="text-right">GMV</TableHead>
                    <TableHead className="text-right">Hoa hồng affiliate</TableHead>
                    <TableHead className="w-32">Quyết toán</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-sm text-slate-900">
                        {o.orderCode}
                      </TableCell>
                      <TableCell className="text-sm text-slate-900">
                        {o.shopName}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {formatDateTime(o.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={o.gmv} className="text-slate-900" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          value={o.commission}
                          className={cn(TEXT_NUMBER_STRONG, "text-red-500")}
                        />
                      </TableCell>
                      <TableCell>
                        {o.isSettled ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            Đã quyết toán
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700"
                          >
                            Chờ quyết toán
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {orders.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Chưa có đơn affiliate {meta.label} nào trong{" "}
                        {detail.days} ngày gần nhất.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {ordersTotal > ORDERS_PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <span className={TEXT_SUB}>
                    Trang {page}/{Math.ceil(ordersTotal / ORDERS_PAGE_SIZE)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1 || loading}
                    onClick={() => load(page - 1, days)}
                  >
                    Trước
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      page >= Math.ceil(ordersTotal / ORDERS_PAGE_SIZE) || loading
                    }
                    onClick={() => load(page + 1, days)}
                  >
                    Sau
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ===== NGUỒN SỐ & GIỚI HẠN API (thông tin, không phải số liệu) ===== */}
          <Card>
            <CardHeader>
              <CardTitle>{info.programName} — nguồn số &amp; giới hạn</CardTitle>
              <CardDescription>{info.source}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {info.limits.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · {meta.label} Affiliate — dữ liệu thật từ đối soát sàn
      </p>
    </KocShell>
  );
}
