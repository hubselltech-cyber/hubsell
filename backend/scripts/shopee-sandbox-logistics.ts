// ============================================================
// SCRIPT SETUP LOGISTICS CHO SHOP SANDBOX SHOPEE (chạy tay).
//
// Mục tiêu: gỡ lỗi "request dependency fail" khi tạo Test Order — do shop thiếu
// ĐỊA CHỈ LẤY HÀNG (pickup) và KÊNH VẬN CHUYỂN. Script gọi logistics API bằng
// access_token đang lưu trong DB (tự refresh nếu hết hạn) rồi IN RAW mọi phản hồi.
//
// Chạy:  cd backend && npx tsx scripts/shopee-sandbox-logistics.ts
// ============================================================

import "dotenv/config";
import crypto from "crypto";
import { prisma } from "../src/prisma";
import { getShopeeConfig } from "../src/integrations/shopee/config";
import { signShop } from "../src/integrations/shopee/client";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";

const cfg = getShopeeConfig();

function buildSignedQuery(path: string, accessToken: string, shopId: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const sign = signShop(cfg.partnerKey, cfg.partnerId, path, ts, accessToken, shopId);
  return new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(ts),
    access_token: accessToken,
    shop_id: shopId,
    sign,
  }).toString();
}

async function shopGet(path: string, accessToken: string, shopId: string): Promise<any> {
  const url = `${cfg.apiBase}${path}?${buildSignedQuery(path, accessToken, shopId)}`;
  const res = await fetch(url, { method: "GET" });
  return res.json();
}

async function shopPost(
  path: string,
  accessToken: string,
  shopId: string,
  body: Record<string, unknown>
): Promise<any> {
  const url = `${cfg.apiBase}${path}?${buildSignedQuery(path, accessToken, shopId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function section(title: string) {
  console.log("\n" + "=".repeat(70) + "\n" + title + "\n" + "-".repeat(70));
}

async function tryCall(label: string, fn: () => Promise<any>) {
  try {
    const r = await fn();
    console.log(`[${label}] →`, JSON.stringify(r, null, 2));
    return r;
  } catch (e) {
    console.log(`[${label}] ✗ FETCH FAIL:`, (e as Error).message);
    return null;
  }
}

(async () => {
  // (1) Lấy shop_id + access_token từ DB
  const channel = await prisma.channel.findFirst({
    where: { channelName: "SHOPEE", refreshToken: { not: null }, status: "ACTIVE" },
  });
  if (!channel) {
    console.log("❌ Không tìm thấy gian Shopee đã nối API trong DB.");
    await prisma.$disconnect();
    return;
  }

  section("THÔNG TIN SHOP (từ DB)");
  console.log("channel:", channel.shopName);
  console.log("shop_id:", channel.externalShopId);
  console.log("host   :", cfg.apiBase);

  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  console.log("access_token (che):", accessToken.slice(0, 8) + "…" + accessToken.slice(-6));

  // (2a) Danh sách địa chỉ — tìm pickup_address
  section("get_address_list — kiểm tra ĐỊA CHỈ LẤY HÀNG");
  const addrRes = await tryCall("get_address_list", () =>
    shopGet("/api/v2/logistics/get_address_list", accessToken, shopId)
  );
  const addressList: any[] = addrRes?.response?.address_list ?? [];
  const pickup = addressList.find((a) => (a.address_flag ?? []).includes("pickup_address"));
  console.log(
    pickup
      ? `✅ ĐÃ CÓ pickup address: id=${pickup.address_id} (${pickup.full_address ?? ""})`
      : `⚠️  CHƯA có địa chỉ gắn cờ "pickup_address". Tổng ${addressList.length} địa chỉ.`
  );
  // Nếu có địa chỉ nhưng chưa gắn cờ pickup → thử set_address_config (nếu API tồn tại)
  if (!pickup && addressList.length > 0) {
    const first = addressList[0];
    section("set_address_config — thử gắn cờ pickup cho địa chỉ sẵn có");
    await tryCall("set_address_config", () =>
      shopPost("/api/v2/logistics/set_address_config", accessToken, shopId, {
        show_pickup_address: true,
        address_config_list: [{ address_id: first.address_id, address_type_config: ["pickup_address"] }],
      })
    );
  }

  // (2b) Danh sách kênh vận chuyển
  section("get_channel_list — kiểm tra KÊNH VẬN CHUYỂN");
  const chRes = await tryCall("get_channel_list", () =>
    shopGet("/api/v2/logistics/get_channel_list", accessToken, shopId)
  );
  const channelList: any[] = chRes?.response?.logistics_channel_list ?? [];
  console.log(`\nCó ${channelList.length} kênh. Trạng thái:`);
  for (const ch of channelList) {
    console.log(
      `  - id=${ch.logistics_channel_id} | ${ch.logistics_channel_name} | enabled=${ch.enabled} | cod=${ch.cod_enabled}`
    );
  }

  // (2c) Bật một kênh (ưu tiên SPX/J&T, nếu chưa có thì kênh đầu đang tắt)
  const preferred =
    channelList.find((c) => /spx|j&t|jt|standard|express/i.test(c.logistics_channel_name ?? "")) ??
    channelList.find((c) => c.enabled === false) ??
    channelList[0];
  if (preferred) {
    section(`update_channel — BẬT kênh "${preferred.logistics_channel_name}" (id=${preferred.logistics_channel_id})`);
    await tryCall("update_channel", () =>
      shopPost("/api/v2/logistics/update_channel", accessToken, shopId, {
        logistics_channel_id: preferred.logistics_channel_id,
        enabled: true,
      })
    );
    // Xác nhận lại
    const after = await tryCall("get_channel_list (sau khi bật)", () =>
      shopGet("/api/v2/logistics/get_channel_list", accessToken, shopId)
    );
    const now = (after?.response?.logistics_channel_list ?? []).find(
      (c: any) => c.logistics_channel_id === preferred.logistics_channel_id
    );
    console.log(now ? `\n→ Kênh "${now.logistics_channel_name}" giờ enabled=${now.enabled}` : "");
  } else {
    console.log("⚠️  Không có kênh nào trong get_channel_list để bật.");
  }

  section("XONG — dùng thông tin dưới đây sang Test Order");
  console.log("shop_id:", shopId);
  console.log("(Nếu địa chỉ pickup + kênh vận chuyển đã ✅ → thử lại Create Test Order.)");

  await prisma.$disconnect();
})();
