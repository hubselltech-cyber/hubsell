import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/components/admin/shared";
import type { PackStorageHealth } from "@/lib/api";

/**
 * HQ Sức khỏe — thẻ "Kho video đóng hàng (R2)" (26/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 36).
 * Chỉ vẽ số worker dọn đã ghi; mức đỏ / vàng nằm ở dòng "Kho video đóng hàng (R2)" của thẻ Dấu hiệu vận hành.
 */

const GATE_LABEL: Record<PackStorageHealth["gate"], string> = {
  all: "đang mở cho mọi chủ shop còn hạn gói",
  pilot: "chỉ mở cho tài khoản thí điểm",
  off: "đang tắt với mọi người",
};

function fmtStorage(mb: number): string {
  if (mb < 1000) return `${formatCount(Math.round(mb))} MB`;
  return `${(mb / 1000).toLocaleString("vi-VN", { maximumFractionDigits: mb < 100_000 ? 1 : 0 })} GB`;
}

function countSize(x: { count: number; mb: number }): string {
  return `${formatCount(x.count)} video · ${fmtStorage(x.mb)}`;
}

function Row(props: { label: string; value: string; danger?: boolean }) {
  return (
    // Cột hẹp (thẻ ≈ 260 px ở màn 1024): số không vừa một dòng thì tự xuống dòng dưới nhãn, căn phải — không bóp nhãn.
    <li className="flex flex-wrap items-baseline justify-between gap-x-4">
      <span>{props.label}</span>
      <span className={props.danger ? "ml-auto text-right font-medium text-red-700" : "ml-auto text-right"}>{props.value}</span>
    </li>
  );
}

export function PackStorageCard({ data }: { data: PackStorageHealth }) {
  const r = data.record;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Kho video đóng hàng (R2)</CardTitle>
        <CardDescription>Tính năng {GATE_LABEL[data.gate]}.</CardDescription>
      </CardHeader>
      <CardContent>
        {!r ? (
          <p className="text-sm text-muted-foreground">
            Chưa có số — worker dọn video ghi số 10 phút sau khi khởi động, rồi mỗi 6 giờ.
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-sm tabular-nums">
              <Row label="Đang lưu" value={countSize(r.stored)} />
              <Row label="Chủ shop có video" value={formatCount(r.stored.owners)} />
              <Row label="Đang giữ làm bằng chứng" value={countSize(r.held)} />
              <Row label="Tải lên 7 ngày qua" value={countSize(r.uploaded7d)} />
              <Row label="Đã xóa 7 ngày qua" value={countSize(r.deleted7d)} />
              <Row
                label="Ước tiền Cloudflare / tháng"
                value={
                  data.estUsdPerMonth != null && data.estUsdPerMonth > 0
                    ? `≈ ${data.estUsdPerMonth.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} USD (≈ ${formatCount(data.estVndPerMonth ?? 0)} đ)`
                    : `0 — trong ${data.freeStorageGb} GB miễn phí`
                }
              />
              <Row
                label="Tiền bán giờ quay 30 ngày"
                value={`${formatCount(r.revenue30dVnd)} đ · ${formatCount(r.purchases30d)} lượt mua`}
              />
              <Row
                label="Lượt dọn gần nhất"
                value={
                  `${(data.ageHours ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} giờ trước · ` +
                  (r.janitor
                    ? r.janitor.shadow
                      ? `CHẠY BÓNG, sẽ xóa ${formatCount(r.janitor.wouldDelete)}`
                      : `xóa thật ${formatCount(r.janitor.deleted)} · lỗi ${formatCount(r.janitor.errors)}`
                    : "không rõ kết quả")
                }
                danger={Boolean(r.janitor?.shadow) && data.gate !== "off" && r.stored.count > 0}
              />
              {r.overdue.count > 0 && <Row label="Quá hạn xóa hơn 1 ngày, vẫn còn" value={countSize(r.overdue)} danger />}
              {r.pastCap.count > 0 && <Row label="Còn lưu quá trần 60 ngày" value={countSize(r.pastCap)} danger />}
              {r.pending > 0 && <Row label="Đang tải lên dở" value={`${formatCount(r.pending)} video`} />}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Số lấy từ sổ video của Hubsell, không gọi Cloudflare (đếm {formatCount(r.ms)} ms, {r.windowDays} ngày gần nhất).
              R2 không có trần dung lượng: quá {data.freeStorageGb} GB miễn phí thì Cloudflare trừ thẻ theo tháng. HQ không
              đọc được thẻ còn trừ được hay không — xem trang Billing của Cloudflare.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
