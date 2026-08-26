// ============================================================
// GIẢ LẬP WEBHOOK MISA meInvoice — bắn payload mock vào endpoint local để test
// thông luồng Queue + Đối soát thuế TRƯỚC KHI lưu cấu hình URL lên MISA.
//
// Đóng đúng vai MISA Sandbox: đọc mock/misa/*.json → POST thẳng vào
// /v1/webhooks/misa-meinvoice (kèm chữ ký HMAC nếu .env có MISA_WEBHOOK_SECRET)
// → rồi soi DB in ra kết quả: job trong hàng đợi, trạng thái InvoiceLog,
// ghi chú đối soát thuế trong audit log, einvoiceStatus của đơn.
//
// Chạy (từ thư mục backend/):
//   npx tsx scripts/simulate-misa-webhook.ts case1 --latest        # ký số OK, thuế khớp
//   npx tsx scripts/simulate-misa-webhook.ts case3 --latest        # lệch +300đ (trong biên độ 500đ → tự điều chỉnh)
//   npx tsx scripts/simulate-misa-webhook.ts case3 --latest --diff 40000  # lệch vượt biên độ → cảnh báo
//   npx tsx scripts/simulate-misa-webhook.ts case2 --latest        # hủy hóa đơn (bắn SAU case1)
//
// Tham số:
//   case1 | case2 | case3   (bắt buộc) — chọn kịch bản mock
//   --order <mã đơn>   dùng đơn THẬT trong DB: RefID + tiền thuế được tính lại
//                      từ chính đơn đó (Product.vatRate) nên case1 luôn khớp.
//   --latest           như --order nhưng tự lấy đơn mới nhất trong DB.
//   --diff <đồng>      (case3) độ lệch thuế muốn giả lập, mặc định 300.
//   --url <url>        đổi endpoint, mặc định https://localhost:<PORT|4000>/v1/webhooks/misa-meinvoice
//   --no-wait          chỉ bắn + in phản hồi, không chờ worker xử lý.
//
// Không có --order/--latest: bắn nguyên văn file JSON (RefID không tồn tại)
// → thấy đúng hành vi RETRY: job lỗi, hẹn lại sau 5 phút, 3 lần rồi FAILED.
// ============================================================

import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import type { MisaWebhookPayload } from "../src/integrations/invoice/misa-webhook";

const CASE_FILES: Record<string, string> = {
  case1: "case1-published-match.json",
  case2: "case2-cancelled.json",
  case3: "case3-tax-mismatch.json",
};

// ---------- Đọc tham số ----------
const args = process.argv.slice(2);
const caseName = args[0];
if (!caseName || !CASE_FILES[caseName]) {
  console.error("Cách dùng: npx tsx scripts/simulate-misa-webhook.ts case1|case2|case3 [--order MA_DON | --latest] [--diff N] [--url URL] [--no-wait]");
  process.exit(1);
}
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const orderCodeArg = argValue("--order");
const useLatest = args.includes("--latest");
const noWait = args.includes("--no-wait");
const diff = Number(argValue("--diff") ?? (caseName === "case3" ? 300 : 0));
const url =
  argValue("--url") ??
  `https://localhost:${process.env.PORT ?? 4000}/v1/webhooks/misa-meinvoice`;

// Backend local chạy HTTPS cert tự ký — tắt kiểm cert CHỈ trong script test này.
if (url.startsWith("https://localhost")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

(async () => {
  // ---------- 1) Nạp payload mock ----------
  const file = path.resolve(__dirname, "../mock/misa", CASE_FILES[caseName]);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as MisaWebhookPayload & {
    _comment?: string;
  };
  delete raw._comment;
  let payload: MisaWebhookPayload = raw;

  // ---------- 2) Có --order/--latest: thay bằng số liệu ĐƠN THẬT ----------
  if (orderCodeArg || useLatest) {
    const order = await prisma.order.findFirst({
      where: orderCodeArg ? { orderCode: orderCodeArg } : {},
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { product: { select: { skuCode: true, vatRate: true } } } },
        channel: { select: { shopName: true } },
      },
    });
    if (!order) {
      console.error(`❌ Không tìm thấy đơn${orderCodeArg ? ` "${orderCodeArg}"` : " nào trong DB"}.`);
      process.exit(1);
    }

    // Tính thuế "phía Hubsell" từ cấu hình thuế độc lập (Product.vatRate) —
    // đây chính là số worker sẽ tự tính để đối soát.
    let expectedVat = 0;
    let goodsTotal = 0;
    const items = order.items.map((it, idx) => {
      const vatRate = it.product?.vatRate ?? 0;
      const lineVat = Math.round((Number(it.price) * it.quantity * vatRate) / 100);
      expectedVat += lineVat;
      goodsTotal += Number(it.price) * it.quantity;
      return {
        ItemCode: it.channelSku,
        Quantity: it.quantity,
        UnitPrice: Number(it.price),
        VATRate: vatRate,
        // Toàn bộ độ lệch giả lập dồn vào dòng ĐẦU — chi tiết dòng trong audit
        // sẽ nêu đúng dòng này khi lệch vượt biên độ.
        VATAmount: lineVat + (idx === 0 ? diff : 0),
      };
    });
    const misaVat = expectedVat + diff;
    // Mã tra cứu gắn theo đơn; có --diff thì thêm hậu tố để mỗi mức lệch là một
    // hóa đơn RIÊNG — không thì bản bắn sau bị idempotency bỏ qua (cùng mã tra
    // cứu + trạng thái đã đúng), không thấy được kết quả đối soát mới.
    const txnId = `MISA-SBX-${order.orderCode}${diff ? `-D${diff}` : ""}`;

    if (expectedVat === 0 && caseName !== "case2") {
      console.warn(
        "⚠️  Các sản phẩm của đơn này đều có vatRate = 0 (chưa cấu hình thuế suất GTGT " +
          "ở trang Sản phẩm) — thuế Hubsell tính = 0đ, đối soát sẽ so với số đó."
      );
    }

    payload = {
      EventType: payload.EventType,
      EventDate: new Date().toISOString(),
      Data:
        caseName === "case2"
          ? {
              TransactionID: txnId,
              RefID: order.orderCode,
              Reason: raw.Data.Reason ?? "Người bán hủy hóa đơn (test sandbox)",
            }
          : {
              TransactionID: txnId,
              InvNo: raw.Data.InvNo,
              RefID: order.orderCode,
              TotalAmount: goodsTotal + misaVat,
              TotalVATAmount: misaVat,
              InvoiceItems: items,
            },
    };

    console.log(`Đơn:          ${order.orderCode} (${order.channel.shopName})`);
    if (caseName !== "case2") {
      console.log(`Thuế Hubsell: ${vnd(expectedVat)} — MISA gửi: ${vnd(misaVat)} (lệch ${vnd(diff)})`);
    }
  }

  // ---------- 3) Ký HMAC nếu đã cấu hình secret (giống MISA thật sẽ làm) ----------
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.MISA_WEBHOOK_SECRET;
  if (secret) {
    headers["x-misa-signature"] = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");
  }

  // ---------- 4) POST vào endpoint local ----------
  console.log(`\n→ POST ${url}  [${payload.EventType}]`);
  const started = Date.now();
  const res = await fetch(url, { method: "POST", headers, body });
  const elapsed = Date.now() - started;
  const resBody = await res.json().catch(() => ({}));
  console.log(`← HTTP ${res.status} sau ${elapsed}ms (hạn MISA: 3000ms): ${JSON.stringify(resBody)}`);
  if (!res.ok) process.exit(1);

  if (noWait) {
    await prisma.$disconnect();
    return;
  }

  // ---------- 5) Soi kết quả: job hàng đợi → hóa đơn → audit ----------
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  console.log("\nChờ worker xử lý (tối đa 15s)…");
  const deadline = Date.now() + 15_000;
  let job = null;
  for (;;) {
    job = await prisma.misaWebhookLog.findUnique({ where: { bodyHash } });
    if (
      job &&
      (job.status === WebhookJobStatus.SUCCESS ||
        job.status === WebhookJobStatus.FAILED ||
        (job.status === WebhookJobStatus.PENDING && job.attempts > 0))
    )
      break;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!job) {
    console.log("⚠️  Không thấy job trong hàng đợi (bản trùng đã nhận trước đó?).");
  } else if (job.status === WebhookJobStatus.SUCCESS) {
    console.log(`✅ Job hàng đợi: SUCCESS (lần thử ${job.attempts})`);
  } else if (job.status === WebhookJobStatus.PENDING && job.attempts > 0) {
    console.log(
      `🔁 Job LỖI lần ${job.attempts}/3 — hẹn retry lúc ${job.nextRetryAt?.toLocaleTimeString("vi-VN")} (cách 5 phút).\n   Lý do: ${job.lastError}`
    );
  } else {
    console.log(`❌ Job hàng đợi: ${job?.status} — ${job?.lastError ?? ""}`);
  }

  const txn = payload.Data.TransactionID;
  const log = await prisma.invoiceLog.findFirst({
    where: { transactionId: txn },
    include: {
      statusHistory: { orderBy: { createdAt: "desc" }, take: 1 },
      order: { select: { einvoiceStatus: true } },
    },
  });
  if (log) {
    console.log(`\nHóa đơn (InvoiceLog):`);
    console.log(`  · Trạng thái:   ${log.status}${log.invoiceNo ? ` — số HĐ ${log.invoiceNo}` : ""}`);
    console.log(`  · Tiền thuế:    ${vnd(Number(log.vatAmount))}`);
    console.log(`  · Đơn liên quan: einvoiceStatus = ${log.order?.einvoiceStatus ?? "(đơn đã xóa)"}`);
    const last = log.statusHistory[0];
    if (last) {
      console.log(`  · Audit mới nhất: [${last.fromStatus ?? "∅"} → ${last.toStatus}] ${last.note ?? "(không ghi chú)"}`);
    }
  } else {
    console.log(`\n(Chưa có InvoiceLog cho mã tra cứu ${txn} — đúng nếu job đang chờ retry.)`);
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error("❌ Script lỗi:", err);
  await prisma.$disconnect();
  process.exit(1);
});

function vnd(n: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(n)}đ`;
}
