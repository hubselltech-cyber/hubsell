import { Router, type Response } from "express";
import type { AuthRequest } from "../auth";
import {
  esignConfigFromEnv,
  esignLogin,
  getSigningStatus,
  listCertificates,
  runEsignSmokeTest,
} from "../integrations/invoice/misa-esign";
import {
  getInbotAccessToken,
  getInputInvoiceDetail,
  inbotConfigFromEnv,
  listModifiedInputInvoices,
  syncInputInvoicesToDb,
} from "../integrations/invoice/misa-inbot";
import { testPosConnection } from "../integrations/invoice/misa-pos";

/**
 * ĐIỂM BẮN TEST SANDBOX MISA (nội bộ) — /api/test/misa-sandbox/*
 *
 * Mục đích: xác minh 2 bộ khóa sandbox MISA (Hóa đơn đầu vào + eSign) ngay từ
 * trình duyệt/curl với JWT Admin, không cần chạy script trong máy chủ. Mọi
 * response trả cả dữ liệu THÔ MISA gửi về — giai đoạn dò tài liệu cần thấy
 * nguyên văn để chỉnh map, đừng cắt gọt.
 *
 * An toàn:
 *   - Gác requireAuth + ADMIN ở app.ts.
 *   - Trên production PHẢI bật cờ env MISA_SANDBOX_TEST_ENABLED=1 mới mở —
 *     tránh để ngỏ cụm endpoint đập thẳng vào NCC trên môi trường thật.
 *   - Không endpoint nào trả nguyên văn secret — chỉ báo thiếu/đủ env.
 *
 * Bản CLI tương đương (không cần chạy server): backend/scripts/misa-sandbox-test.ts
 */

const router = Router();

// Chặn cả cụm trên production khi chưa bật cờ.
router.use((_req, res, next) => {
  const enabled =
    process.env.NODE_ENV !== "production" ||
    process.env.MISA_SANDBOX_TEST_ENABLED === "1";
  if (!enabled) {
    res.status(503).json({
      error:
        "Cụm test MISA sandbox đang tắt trên production — đặt env MISA_SANDBOX_TEST_ENABLED=1 để mở tạm.",
    });
    return;
  }
  next();
});

/** Gom lỗi service thành 502 + thông điệp nguyên văn (đủ để dò tài liệu MISA). */
function fail(res: Response, err: unknown) {
  res.status(502).json({ ok: false, error: (err as Error).message });
}

// GET / — checklist env của cả 2 dịch vụ (không lộ giá trị).
router.get("/", (_req, res) => {
  const inbot = inbotConfigFromEnv();
  const esign = esignConfigFromEnv();
  res.json({
    ok: true,
    inbot: inbot.ok
      ? { configured: true, appBase: inbot.config.appBase, apiBase: inbot.config.apiBase }
      : { configured: false, missing: inbot.missing },
    esign: esign.ok
      ? { configured: true, apiBase: esign.config.apiBase }
      : { configured: false, missing: esign.missing },
    huongDan: {
      "POST /inbot/auth": "thử đăng nhập 2 bước lấy AccessToken hóa đơn đầu vào",
      "GET /inbot/invoices?from=2026-08-01&to=2026-08-07&persist=1":
        "kéo hóa đơn đầu vào trong kỳ; persist=1 = upsert vào bảng input_invoices",
      "GET /inbot/invoices/:id": "chi tiết 1 hóa đơn theo InvoiceID MISA",
      "POST /esign/auth": "thử đăng nhập eSign (x-clientId/x-clientKey)",
      "GET /esign/certificates": "danh sách chứng thư số của tài khoản sandbox",
      "POST /esign/sign-sample": "chạy trọn luồng ký thử PDF mẫu (hash → sign → status)",
      "GET /esign/status/:transactionId": "poll trạng thái một giao dịch ký",
    },
  });
});

// ---------- MISA meInvoice — Hóa đơn đầu vào ----------

router.post("/inbot/auth", async (_req, res) => {
  try {
    const token = await getInbotAccessToken();
    res.json({
      ok: true,
      tokenMasked: token.length > 16 ? `${token.slice(0, 8)}…${token.slice(-8)}` : "(ngắn bất thường)",
      tokenLength: token.length,
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/inbot/invoices", async (req: AuthRequest, res) => {
  try {
    // Mặc định: 7 ngày gần nhất — sandbox thường chỉ có vài hóa đơn mẫu.
    const to = typeof req.query.to === "string" ? req.query.to : new Date().toISOString().slice(0, 10);
    const from =
      typeof req.query.from === "string"
        ? req.query.from
        : new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

    if (req.query.persist === "1") {
      const sync = await syncInputInvoicesToDb(req.ownerId!, { from, to });
      res.json({ ok: true, mode: "persist", from, to, ...sync });
      return;
    }
    const invoices = await listModifiedInputInvoices({ from, to });
    res.json({ ok: true, mode: "list", from, to, count: invoices.length, invoices });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/inbot/invoices/:id", async (req, res) => {
  try {
    res.json({ ok: true, invoice: await getInputInvoiceDetail(req.params.id) });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- MISA meInvoice POS — Máy tính tiền ----------

// POST /pos/auth — thử lấy token luồng POS bằng env (MISA_POS_* → MISA_CLIENT_*).
router.post("/pos/auth", async (_req, res) => {
  try {
    const r = await testPosConnection({
      taxCode: null,
      companyName: null,
      companyAddress: null,
      posClientId: null,
      posSecretKey: null,
      posCodePrefix: null,
      posMachineId: null,
      posSeries: null,
    });
    res.json({ ok: true, source: "env-sandbox", tokenLength: r.tokenLength });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- MISA eSign — Chữ ký số từ xa ----------

router.post("/esign/auth", async (_req, res) => {
  try {
    const s = await esignLogin();
    res.json({
      ok: true,
      userId: s.userId,
      hasRemoteSigningToken: Boolean(s.remoteSigningAccessToken),
      accessTokenMasked: `${s.accessToken.slice(0, 8)}…${s.accessToken.slice(-8)}`,
      expiresAt: new Date(s.expiresAt).toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/esign/certificates", async (_req, res) => {
  try {
    res.json({ ok: true, certificates: await listCertificates() });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/esign/sign-sample", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await runEsignSmokeTest()) });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/esign/status/:transactionId", async (req, res) => {
  try {
    res.json({ ok: true, status: await getSigningStatus(req.params.transactionId) });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
