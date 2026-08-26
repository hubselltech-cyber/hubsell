import { Router, type NextFunction, type Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
  clearMisaTokenCache,
  getMisaAccessToken,
} from "../integrations/invoice/misa-auth";
import {
  clearEsignSessionCache,
  esignLogin,
} from "../integrations/invoice/misa-esign";
import {
  INVOICE_PATTERN_RE,
  INVOICE_SERIES_RE,
  listInvoiceTemplates,
  POS_SERIES_RE,
  TAX_CODE_RE,
  type StandardInvoiceConfig,
} from "../integrations/invoice/misa-einvoice";
import {
  listPosMachines,
  testPosConnection,
} from "../integrations/invoice/misa-pos";

/**
 * HÓA ĐƠN ĐIỆN TỬ & CHỮ KÝ SỐ — Multi-Vendor Adapter (module đóng gói độc lập).
 *
 * Cấu hình kết nối tới các NCC hóa đơn (MISA/Viettel/VNPT/Bkav/Custom), gắn
 * theo ownerId (một chủ shop = một pháp nhân = một MST — xem chú thích model
 * InvoiceConfig). Ba nhóm trường, khớp 3 khối trên trang Kết nối & Xuất hóa đơn:
 *   (1) Pháp nhân & Thuế : taxCode / companyName / companyAddress — NĐ 123/2020
 *       bắt buộc hóa đơn mang MST + tên + địa chỉ người bán.
 *   (2) meInvoice API    : provider, clientId/secretKey, mẫu số (invoicePattern)
 *       + ký hiệu (invoiceSeries) theo TT 78/2021 — thiếu/sai ký hiệu là NCC
 *       từ chối cấp số.
 *   (3) MISA eSign       : signMethod USB_TOKEN | ESIGN_CLOUD + bộ khóa ký nền
 *       (esignClientId/esignSecretKey, esignUsername/esignPassword, certSerial).
 *
 * Trường nhạy cảm (secretKey, apiKey, esignSecretKey, esignPassword) KHÔNG bao
 * giờ trả về nguyên văn — chỉ trả bản CHE (••••1234) + cờ đã-đặt. Khi lưu, để
 * trống nghĩa là GIỮ NGUYÊN giá trị cũ, tránh vô tình xoá khóa.
 */

const router = Router();

// 25/08: thêm 3 NCC từ khảo sát thương mại (EasyInvoice/M-Invoice/Mắt Bão).
const PROVIDERS = ["MISA", "EASYINVOICE", "MINVOICE", "MATBAO", "VIETTEL", "VNPT", "BKAV", "CUSTOM"];
// NCC chưa nối API — UI cho xem trước giao diện nhưng KHÔNG cho lưu (25/08 anh
// Trung đổi từ "lưu cấu hình trước" sang khóa cứng). MISA/CUSTOM nằm ngoài.
// ⏳ Các NCC này TÍCH HỢP SAU KHI THƯƠNG MẠI HÓA HUBSELL (chiến lược 25/08:
// MISA tiếp thị lấy khách trước, có data mới đàm phán hoa hồng từng bên —
// EasyInvoice là đích nhắm chính). Mở bên nào = rút khỏi đây + bỏ cờ `soon`
// trong frontend/src/lib/invoice-vendors.ts + thêm adapter vào
// PROVIDER_FACTORIES (integrations/invoice/index.ts).
const COMING_SOON_PROVIDERS = ["EASYINVOICE", "MINVOICE", "MATBAO", "VIETTEL", "VNPT", "BKAV"];
const SIGN_METHODS = ["USB_TOKEN", "ESIGN_CLOUD"];
const INVOICE_TYPES = ["STANDARD", "POS"];

/** Che chuỗi bí mật, chỉ lộ 4 ký tự cuối. */
function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.length <= 4 ? "••••" : "••••" + v.slice(-4);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Chỉ nhận secret mới khi client GỬI chuỗi khác rỗng; ngược lại giữ giá trị cũ. */
function nextSecret(incoming: unknown, current: string | null): string | null {
  const s = str(incoming);
  return s === null ? current : s;
}

type ShopConfig = {
  taxCode: string | null;
  companyName: string | null;
  companyAddress: string | null;
  provider: string;
  signMethod: string;
  partnerCode: string | null;
  clientId: string | null;
  secretKey: string | null;
  meinvoiceUsername: string | null;
  meinvoicePassword: string | null;
  customApiUrl: string | null;
  invoicePattern: string | null;
  invoiceSeries: string | null;
  esignClientId: string | null;
  esignSecretKey: string | null;
  esignUsername: string | null;
  esignPassword: string | null;
  certSerial: string | null;
  posProvider: string;
  posClientId: string | null;
  posSecretKey: string | null;
  posCodePrefix: string | null;
  posMachineId: string | null;
  posSeries: string | null;
  defaultInvoiceType: string;
  defaultVatRate: number;
};

function serializeConfig(c: ShopConfig | null) {
  return {
    // (1) Pháp nhân & Thuế
    taxCode: c?.taxCode ?? "",
    companyName: c?.companyName ?? "",
    companyAddress: c?.companyAddress ?? "",
    // (2) meInvoice API
    provider: c?.provider ?? "MISA",
    partnerCode: c?.partnerCode ?? "",
    clientId: c?.clientId ?? "",
    customApiUrl: c?.customApiUrl ?? "",
    invoicePattern: c?.invoicePattern ?? "",
    invoiceSeries: c?.invoiceSeries ?? "",
    hasSecretKey: Boolean(c?.secretKey),
    secretKeyMasked: mask(c?.secretKey),
    // Tài khoản meInvoice CỦA SHOP (multi-tenant 23/08) — mật khẩu chỉ trả che.
    meinvoiceUsername: c?.meinvoiceUsername ?? "",
    hasMeinvoicePassword: Boolean(c?.meinvoicePassword),
    meinvoicePasswordMasked: mask(c?.meinvoicePassword),
    // (3) Chữ ký số eSign
    signMethod: c?.signMethod ?? "USB_TOKEN",
    esignClientId: c?.esignClientId ?? "",
    esignUsername: c?.esignUsername ?? "",
    certSerial: c?.certSerial ?? "",
    hasEsignSecretKey: Boolean(c?.esignSecretKey),
    esignSecretKeyMasked: mask(c?.esignSecretKey),
    hasEsignPassword: Boolean(c?.esignPassword),
    esignPasswordMasked: mask(c?.esignPassword),
    // (4) Máy tính tiền (POS)
    posProvider: c?.posProvider ?? "MISA",
    posClientId: c?.posClientId ?? "",
    posCodePrefix: c?.posCodePrefix ?? "",
    posMachineId: c?.posMachineId ?? "",
    posSeries: c?.posSeries ?? "",
    hasPosSecretKey: Boolean(c?.posSecretKey),
    posSecretKeyMasked: mask(c?.posSecretKey),
    defaultInvoiceType: c?.defaultInvoiceType ?? "STANDARD",
    // % thuế suất GTGT mặc định cho dòng hàng chưa khai riêng ở SKU (24/08).
    defaultVatRate: c?.defaultVatRate ?? 0,
  };
}

function findShopConfig(ownerId: string) {
  return prisma.invoiceConfig.findFirst({ where: { ownerId, channelId: null } });
}

// GET /api/invoice-config — cấu hình cấp shop + api_key theo từng gian hàng.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const [shopConfig, channels, channelConfigs] = await Promise.all([
      findShopConfig(ownerId),
      prisma.channel.findMany({
        where: { userId: ownerId },
        orderBy: [{ channelName: "asc" }, { shopName: "asc" }],
        select: { id: true, channelName: true, shopName: true },
      }),
      prisma.invoiceConfig.findMany({
        where: { ownerId, channelId: { not: null } },
        select: { channelId: true, apiKey: true },
      }),
    ]);

    const keyByChannel = new Map(
      channelConfigs.map((c) => [c.channelId, c.apiKey])
    );

    res.json({
      config: serializeConfig(shopConfig),
      channelKeys: channels.map((ch) => {
        const apiKey = keyByChannel.get(ch.id) ?? null;
        return {
          channelId: ch.id,
          channelName: ch.channelName,
          shopName: ch.shopName,
          hasApiKey: Boolean(apiKey),
          apiKeyMasked: mask(apiKey),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/invoice-config — lưu cấu hình cấp shop (cả 3 nhóm trong MỘT body;
// các secret để trống = giữ nguyên). POST giữ làm alias cho client cũ/tài liệu.
async function saveShopConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ownerId = req.ownerId!;
    const {
      taxCode,
      companyName,
      companyAddress,
      provider,
      signMethod,
      partnerCode,
      clientId,
      secretKey,
      customApiUrl,
      invoicePattern,
      invoiceSeries,
      esignClientId,
      esignSecretKey,
      esignUsername,
      esignPassword,
      certSerial,
      meinvoiceUsername,
      meinvoicePassword,
      posProvider,
      posClientId,
      posSecretKey,
      posCodePrefix,
      posMachineId,
      posSeries,
      defaultInvoiceType,
      defaultVatRate,
    } = req.body ?? {};

    if (typeof provider !== "string" || !PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "Nhà cung cấp không hợp lệ" });
      return;
    }
    // 25/08 (anh Trung): NCC "Sắp ra mắt" chỉ XEM TRƯỚC trên UI — chặn lưu cả
    // ở đây (phòng gọi API thẳng), tránh provider trong DB trỏ sang NCC chưa có
    // adapter làm auto-issue chết lặng. Mở NCC nào = rút khỏi danh sách này.
    if (COMING_SOON_PROVIDERS.includes(provider)) {
      res.status(400).json({
        error: "Nhà cung cấp này đang Sắp ra mắt — chưa thể chọn làm NCC phát hành.",
      });
      return;
    }
    if (typeof signMethod !== "string" || !SIGN_METHODS.includes(signMethod)) {
      res.status(400).json({ error: "Phương thức ký không hợp lệ (USB_TOKEN | ESIGN_CLOUD)" });
      return;
    }
    // posProvider tuỳ chọn (client cũ không gửi) — có gửi thì phải hợp lệ.
    // Không nhận CUSTOM: máy tính tiền phải là NCC được CQT công nhận.
    if (
      posProvider !== undefined &&
      (typeof posProvider !== "string" ||
        !PROVIDERS.includes(posProvider) ||
        posProvider === "CUSTOM")
    ) {
      res.status(400).json({ error: "NCC máy tính tiền không hợp lệ (MISA | VIETTEL | VNPT | BKAV)" });
      return;
    }
    if (
      defaultInvoiceType !== undefined &&
      (typeof defaultInvoiceType !== "string" || !INVOICE_TYPES.includes(defaultInvoiceType))
    ) {
      res.status(400).json({ error: "Luồng phát hành không hợp lệ (STANDARD | POS)" });
      return;
    }
    // Thuế suất mặc định — tuỳ chọn (client cũ không gửi); có gửi thì phải là
    // số nguyên 0..100 (UI chỉ đưa 0/5/8/10 nhưng backend không khóa cứng,
    // phòng thuế suất đổi theo luật).
    const vatRateVal =
      defaultVatRate === undefined || defaultVatRate === null
        ? undefined
        : Number(defaultVatRate);
    if (
      vatRateVal !== undefined &&
      (!Number.isInteger(vatRateVal) || vatRateVal < 0 || vatRateVal > 100)
    ) {
      res.status(400).json({ error: "Thuế suất mặc định không hợp lệ — số nguyên 0-100 (%)" });
      return;
    }

    // ---- Validate định dạng theo TT 78/2021 (regex dùng chung misa-einvoice.ts).
    // Chỉ validate khi CÓ nhập — cho phép lưu dở dang lúc đang cấu hình.
    const taxCodeVal = str(taxCode);
    if (taxCodeVal && !TAX_CODE_RE.test(taxCodeVal)) {
      res.status(400).json({
        error: "MST không hợp lệ — 10 số hoặc 13 số/10-3 số (VD 0101243150 hoặc 0101243150-001)",
      });
      return;
    }
    const patternVal = str(invoicePattern);
    if (patternVal && !INVOICE_PATTERN_RE.test(patternVal)) {
      res.status(400).json({ error: "Mẫu số không hợp lệ — 1 chữ số từ 1 đến 6 (VD 1 = HĐ GTGT)" });
      return;
    }
    const seriesVal = str(invoiceSeries)?.toUpperCase() ?? null;
    if (seriesVal && !INVOICE_SERIES_RE.test(seriesVal)) {
      res.status(400).json({
        error:
          "Ký hiệu kê khai không hợp lệ — dạng C26TAA (C/K + 2 số năm + chữ loại HĐ + 2 ký tự; chữ thứ 4 không được là M — M dành cho máy tính tiền)",
      });
      return;
    }
    const posSeriesVal = str(posSeries)?.toUpperCase() ?? null;
    if (posSeriesVal && !POS_SERIES_RE.test(posSeriesVal)) {
      res.status(400).json({
        error: "Ký hiệu máy tính tiền không hợp lệ — ký tự thứ 4 phải là M, dạng C26MAA",
      });
      return;
    }

    const existing = await findShopConfig(ownerId);

    const data = {
      // (1) Pháp nhân & Thuế
      taxCode: taxCodeVal,
      companyName: str(companyName),
      companyAddress: str(companyAddress),
      // (2) meInvoice
      provider,
      partnerCode: str(partnerCode),
      clientId: str(clientId),
      // Chỉ ghi endpoint tuỳ biến khi chọn Custom, tránh giữ rác của lần chọn trước.
      customApiUrl: provider === "CUSTOM" ? str(customApiUrl) : null,
      invoicePattern: patternVal,
      invoiceSeries: seriesVal,
      secretKey: nextSecret(secretKey, existing?.secretKey ?? null),
      // Tài khoản meInvoice của shop — mật khẩu theo luồng che/giữ-nguyên.
      meinvoiceUsername: str(meinvoiceUsername),
      meinvoicePassword: nextSecret(meinvoicePassword, existing?.meinvoicePassword ?? null),
      // (3) eSign
      signMethod,
      esignClientId: str(esignClientId),
      esignUsername: str(esignUsername),
      certSerial: str(certSerial),
      esignSecretKey: nextSecret(esignSecretKey, existing?.esignSecretKey ?? null),
      esignPassword: nextSecret(esignPassword, existing?.esignPassword ?? null),
      // (4) Máy tính tiền
      ...(typeof posProvider === "string" ? { posProvider } : {}),
      posClientId: str(posClientId),
      posCodePrefix: str(posCodePrefix),
      posMachineId: str(posMachineId),
      posSeries: posSeriesVal,
      posSecretKey: nextSecret(posSecretKey, existing?.posSecretKey ?? null),
      ...(typeof defaultInvoiceType === "string"
        ? { defaultInvoiceType: defaultInvoiceType as "STANDARD" | "POS" }
        : {}),
      ...(vatRateVal !== undefined ? { defaultVatRate: vatRateVal } : {}),
    };

    const saved = existing
      ? await prisma.invoiceConfig.update({ where: { id: existing.id }, data })
      : await prisma.invoiceConfig.create({ data: { ownerId, ...data } });

    res.json({ config: serializeConfig(saved) });
  } catch (err) {
    next(err);
  }
}
router.put("/", saveShopConfig);
router.post("/", saveShopConfig);

// ============================================================
// KIỂM TRA KẾT NỐI — 2 nút riêng trên UI, dùng KHÓA ĐÃ LƯU của shop
// (fallback bộ env sandbox dùng chung khi shop chưa nhập). Chỉ đăng nhập lấy
// token — đủ chứng minh cặp khóa + tài khoản sống, không phát sinh hóa đơn.
// ============================================================

// POST /api/invoice-config/test-meinvoice
router.post("/test-meinvoice", async (req: AuthRequest, res) => {
  try {
    const cfg = await findShopConfig(req.ownerId!);
    if (cfg && cfg.provider !== "MISA") {
      res.status(400).json({
        ok: false,
        error: `Đang chọn NCC ${cfg.provider} — nút này kiểm tra kết nối MISA meInvoice.`,
      });
      return;
    }
    // Xoá cache để chắc chắn đăng nhập MỚI bằng đúng bộ khóa hiện tại.
    clearMisaTokenCache();
    // Model multi-tenant 23/08: khóa app dùng chung (cột shop override được),
    // còn bộ tài khoản meInvoice PHẢI của shop. Shop chưa nhập tài khoản thì
    // rơi về bộ env (sandbox thí điểm) và nói rõ qua `source` — nút test là
    // công cụ chẩn đoán, còn luồng PHÁT HÀNH thật không bao giờ fallback.
    const usingShopAccount = Boolean(cfg?.meinvoiceUsername && cfg?.meinvoicePassword);
    const clientId = cfg?.clientId ?? process.env.MISA_CLIENT_ID?.trim();
    const clientSecret = cfg?.secretKey ?? process.env.MISA_CLIENT_SECRET?.trim();
    const creds =
      clientId && clientSecret
        ? {
            clientId,
            clientSecret,
            taxCode: cfg?.taxCode ?? undefined,
            ...(usingShopAccount
              ? {
                  username: cfg!.meinvoiceUsername!,
                  password: cfg!.meinvoicePassword!,
                }
              : {}),
          }
        : undefined; // undefined = misa-auth tự đọc trọn bộ env
    const token = await getMisaAccessToken(creds);
    res.json({
      ok: true,
      source: usingShopAccount ? "shop-config" : "env-sandbox",
      message: usingShopAccount
        ? `Kết nối meInvoice OK bằng tài khoản của shop — đã lấy được Access Token (${token.length} ký tự).`
        : `Kết nối meInvoice OK (đang dùng tài khoản sandbox hệ thống — nhập tài khoản meInvoice của shop để phát hành thật).`,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/invoice-config/templates — danh sách KÝ HIỆU hóa đơn tài khoản
// meInvoice của shop đã đăng ký với CQT. Nuôi dropdown chọn ký hiệu trên UI
// (seller không phải gõ tay chuỗi TT78). Shop chưa nhập tài khoản → rơi về bộ
// env sandbox (thí điểm) — cùng triết lý nút Test; luồng PHÁT HÀNH thật vẫn
// không bao giờ fallback.
router.get("/templates", async (req: AuthRequest, res) => {
  try {
    const cfg = await findShopConfig(req.ownerId!);
    if (cfg && cfg.provider !== "MISA") {
      res.status(400).json({ error: `Đang chọn NCC ${cfg.provider} — chưa hỗ trợ tải ký hiệu.` });
      return;
    }
    const usingShopAccount = Boolean(cfg?.meinvoiceUsername && cfg?.meinvoicePassword);
    // Shop có tài khoản → dựng StandardInvoiceConfig từ row; chưa có → undefined
    // để listInvoiceTemplates dùng trọn bộ env sandbox.
    const templates = await listInvoiceTemplates(
      usingShopAccount ? (cfg as unknown as StandardInvoiceConfig) : undefined
    );
    res.json({ templates, source: usingShopAccount ? "shop-config" : "env-sandbox" });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// POST /api/invoice-config/test-esign
router.post("/test-esign", async (req: AuthRequest, res) => {
  try {
    const cfg = await findShopConfig(req.ownerId!);
    clearEsignSessionCache();
    const session = await esignLogin({
      clientId: cfg?.esignClientId ?? undefined,
      clientKey: cfg?.esignSecretKey ?? undefined,
      username: cfg?.esignUsername ?? undefined,
      password: cfg?.esignPassword ?? undefined,
    });
    const usingShopKeys = Boolean(cfg?.esignClientId && cfg?.esignSecretKey);
    res.json({
      ok: true,
      source: usingShopKeys ? "shop-config" : "env-sandbox",
      userId: session.userId,
      hasRemoteSigningToken: Boolean(session.remoteSigningAccessToken),
      message: "Kết nối MISA eSign OK — đăng nhập lấy token thành công.",
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/invoice-config/test-pos — kiểm tra kết nối luồng MÁY TÍNH TIỀN
// (đăng nhập bằng cặp khóa POS của shop; fallback env MISA_POS_* → meInvoice chung).
router.post("/test-pos", async (req: AuthRequest, res) => {
  try {
    const cfg = await findShopConfig(req.ownerId!);
    if (cfg && cfg.posProvider !== "MISA") {
      res.status(400).json({
        ok: false,
        error: `NCC máy tính tiền đang chọn là ${cfg.posProvider} (Sắp ra mắt) — hiện mới test được MISA POS.`,
      });
      return;
    }
    clearMisaTokenCache();
    const posCfg = {
      taxCode: cfg?.taxCode ?? null,
      companyName: cfg?.companyName ?? null,
      companyAddress: cfg?.companyAddress ?? null,
      posClientId: cfg?.posClientId ?? null,
      posSecretKey: cfg?.posSecretKey ?? null,
      posCodePrefix: cfg?.posCodePrefix ?? null,
      posMachineId: cfg?.posMachineId ?? null,
      posSeries: cfg?.posSeries ?? null,
    };
    const r = await testPosConnection(posCfg);
    // Quà thêm cho UI: có danh mục máy tính tiền thì gửi kèm để AUTO-FILL các ô
    // Mã máy/Dải mã — listPosMachines tự nuốt lỗi (null = sandbox chưa mở endpoint).
    const machines = await listPosMachines(posCfg);
    res.json({
      ok: true,
      source: r.usingShopKeys ? "shop-config" : "env-sandbox",
      message: `Kết nối meInvoice POS OK — đã lấy được Access Token (${r.tokenLength} ký tự).`,
      ...(machines && machines.length > 0 ? { machines } : {}),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

// PUT /api/invoice-config/channels/:channelId — lưu api_key riêng của một gian hàng.
// Body: { apiKey? } — để trống = giữ nguyên khóa cũ.
router.put("/channels/:channelId", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const { channelId } = req.params;
    const { apiKey } = req.body ?? {};

    const channel = await prisma.channel.findFirst({
      where: { id: channelId, userId: ownerId },
      select: { id: true },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng" });
      return;
    }

    const existing = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId },
    });
    const nextApiKey = nextSecret(apiKey, existing?.apiKey ?? null);

    const saved = existing
      ? await prisma.invoiceConfig.update({
          where: { id: existing.id },
          data: { apiKey: nextApiKey },
        })
      : await prisma.invoiceConfig.create({
          data: { ownerId, channelId, apiKey: nextApiKey },
        });

    res.json({
      channelId,
      hasApiKey: Boolean(saved.apiKey),
      apiKeyMasked: mask(saved.apiKey),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
