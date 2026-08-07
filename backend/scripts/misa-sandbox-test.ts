// ============================================================
// TEST NHANH 2 BỘ KHÓA SANDBOX MISA — chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-sandbox-test.ts env          ← soi env đã điền đủ chưa
//   npx tsx scripts/misa-sandbox-test.ts inbot-auth   ← đăng nhập Hóa đơn đầu vào
//   npx tsx scripts/misa-sandbox-test.ts inbot-list [from] [to]
//                                                     ← kéo hóa đơn trong kỳ (mặc định 7 ngày)
//   npx tsx scripts/misa-sandbox-test.ts inbot-detail <invoiceId>
//   npx tsx scripts/misa-sandbox-test.ts esign-auth   ← đăng nhập eSign
//   npx tsx scripts/misa-sandbox-test.ts esign-certs  ← danh sách chứng thư số
//   npx tsx scripts/misa-sandbox-test.ts esign-sign   ← ký thử PDF mẫu trọn luồng
//   npx tsx scripts/misa-sandbox-test.ts esign-status <transactionId>
//
// Script CHỈ gọi API MISA, KHÔNG đụng DB — muốn kéo hóa đơn về DB thì dùng
// endpoint GET /api/test/misa-sandbox/inbot/invoices?persist=1 (cần JWT Admin).
// Response in NGUYÊN VĂN để đối chiếu tài liệu kit khi tên trường lệch.
// ============================================================

import "dotenv/config";
import {
  esignConfigFromEnv,
  esignLogin,
  getSigningStatus,
  listCertificates,
  runEsignSmokeTest,
} from "../src/integrations/invoice/misa-esign";
import {
  getInbotAccessToken,
  getInputInvoiceDetail,
  inbotConfigFromEnv,
  listModifiedInputInvoices,
} from "../src/integrations/invoice/misa-inbot";

function show(label: string, value: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function mask(token: string): string {
  return token.length > 16 ? `${token.slice(0, 8)}…${token.slice(-8)}` : "(ngắn bất thường)";
}

(async () => {
  const [cmd, arg1, arg2] = process.argv.slice(2);

  switch (cmd) {
    case "env": {
      const inbot = inbotConfigFromEnv();
      const esign = esignConfigFromEnv();
      show("MISA Hóa đơn đầu vào (Inbot)", inbot.ok
        ? { configured: true, appBase: inbot.config.appBase, apiBase: inbot.config.apiBase }
        : { configured: false, thieu: inbot.missing });
      show("MISA eSign", esign.ok
        ? { configured: true, apiBase: esign.config.apiBase }
        : { configured: false, thieu: esign.missing });
      break;
    }

    case "inbot-auth": {
      const token = await getInbotAccessToken();
      show("AccessToken (che giữa)", `${mask(token)} — dài ${token.length} ký tự`);
      break;
    }

    case "inbot-list": {
      const to = arg2 ?? new Date().toISOString().slice(0, 10);
      const from = arg1 ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
      const invoices = await listModifiedInputInvoices({ from, to });
      show(`Hóa đơn đầu vào ${from} → ${to} (${invoices.length} bản ghi)`, invoices);
      break;
    }

    case "inbot-detail": {
      if (!arg1) throw new Error("Thiếu invoiceId: npx tsx scripts/misa-sandbox-test.ts inbot-detail <id>");
      show(`Chi tiết hóa đơn ${arg1}`, await getInputInvoiceDetail(arg1));
      break;
    }

    case "esign-auth": {
      const s = await esignLogin();
      show("Đăng nhập eSign", {
        userId: s.userId,
        accessToken: mask(s.accessToken),
        remoteSigningToken: s.remoteSigningAccessToken ? mask(s.remoteSigningAccessToken) : null,
        hetHan: new Date(s.expiresAt).toISOString(),
      });
      break;
    }

    case "esign-certs": {
      show("Chứng thư số", await listCertificates());
      break;
    }

    case "esign-sign": {
      show("Ký thử PDF mẫu (trọn luồng)", await runEsignSmokeTest());
      break;
    }

    case "esign-status": {
      if (!arg1) throw new Error("Thiếu transactionId: npx tsx scripts/misa-sandbox-test.ts esign-status <id>");
      show(`Trạng thái giao dịch ${arg1}`, await getSigningStatus(arg1));
      break;
    }

    default:
      console.log(
        "Lệnh: env | inbot-auth | inbot-list [from] [to] | inbot-detail <id> | " +
          "esign-auth | esign-certs | esign-sign | esign-status <txId>"
      );
      process.exit(cmd ? 1 : 0);
  }
})().catch((err) => {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
});
