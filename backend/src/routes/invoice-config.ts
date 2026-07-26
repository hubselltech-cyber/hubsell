import { Router } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

/**
 * HÓA ĐƠN ĐIỆN TỬ & CHỮ KÝ SỐ — Multi-Vendor Adapter (module đóng gói độc lập).
 *
 * Cấu hình kết nối tới các NCC hóa đơn (MISA/Viettel/VNPT/Bkav/Custom). Hai cấp:
 *   - Cấu hình MẶC ĐỊNH cấp shop (channelId = null): NCC, phương thức ký,
 *     partnerCode của Hubsell, thông tin đăng nhập chung.
 *   - `apiKey` RIÊNG theo từng gian hàng (channelId != null) — phục vụ đối soát
 *     hoa hồng theo từng shop.
 *
 * Trường nhạy cảm (secretKey, apiKey) KHÔNG bao giờ trả về nguyên văn — chỉ trả
 * bản CHE (••••1234) + cờ đã-đặt. Khi lưu, để trống nghĩa là GIỮ NGUYÊN giá trị
 * cũ, tránh vô tình xoá khóa khi người dùng không nhập lại.
 */

const router = Router();

const PROVIDERS = ["MISA", "VIETTEL", "VNPT", "BKAV", "CUSTOM"];
const SIGN_METHODS = ["usb", "hsm"];

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

function serializeConfig(c: {
  provider: string;
  signMethod: string;
  partnerCode: string | null;
  clientId: string | null;
  secretKey: string | null;
  customApiUrl: string | null;
} | null) {
  return {
    provider: c?.provider ?? "MISA",
    signMethod: c?.signMethod ?? "usb",
    partnerCode: c?.partnerCode ?? "",
    clientId: c?.clientId ?? "",
    customApiUrl: c?.customApiUrl ?? "",
    hasSecretKey: Boolean(c?.secretKey),
    secretKeyMasked: mask(c?.secretKey),
  };
}

// GET /api/invoice-config — cấu hình cấp shop + api_key theo từng gian hàng.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const [shopConfig, channels, channelConfigs] = await Promise.all([
      prisma.invoiceConfig.findFirst({ where: { ownerId, channelId: null } }),
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

// PUT /api/invoice-config — lưu cấu hình cấp shop.
// Body: { provider, signMethod, partnerCode?, clientId?, secretKey?, customApiUrl? }
router.put("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const { provider, signMethod, partnerCode, clientId, secretKey, customApiUrl } =
      req.body ?? {};

    if (typeof provider !== "string" || !PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "Nhà cung cấp không hợp lệ" });
      return;
    }
    if (typeof signMethod !== "string" || !SIGN_METHODS.includes(signMethod)) {
      res.status(400).json({ error: "Phương thức ký không hợp lệ" });
      return;
    }

    const existing = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
    });

    const data = {
      provider,
      signMethod,
      partnerCode: str(partnerCode),
      clientId: str(clientId),
      // Chỉ ghi endpoint tuỳ biến khi chọn Custom, tránh giữ rác của lần chọn trước.
      customApiUrl: provider === "CUSTOM" ? str(customApiUrl) : null,
      secretKey: nextSecret(secretKey, existing?.secretKey ?? null),
    };

    const saved = existing
      ? await prisma.invoiceConfig.update({ where: { id: existing.id }, data })
      : await prisma.invoiceConfig.create({ data: { ownerId, ...data } });

    res.json({ config: serializeConfig(saved) });
  } catch (err) {
    next(err);
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
