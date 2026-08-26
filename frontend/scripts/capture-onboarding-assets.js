/**
 * Chá»¥p áº£nh GIAO DIá»†N THáº¬T cá»§a trang KÃªnh bÃ¡n cho mÃ n HÆ¯á»šNG DáºªN Äá»˜NG sau Ä‘Äƒng
 * nháº­p láº§n Ä‘áº§u (components/onboarding-overlay.tsx): con trá» áº£o cháº¡y trÃªn cÃ¡c
 * áº£nh nÃ y, click + phÃ³ng to tá»«ng vÃ¹ng thao tÃ¡c nhÆ° má»™t video quay mÃ n hÃ¬nh.
 *
 * CÃ¹ng cÆ¡ cháº¿ vá»›i capture-invoice-assets.js: má»Ÿ frontend tháº­t (localhost:3000)
 * báº±ng Chromium headless, cháº·n má»i request /api/* tráº£ dá»¯ liá»‡u máº«u â€” render Ä‘Ãºng
 * 100% giao diá»‡n production, tÃ¡i láº­p Ä‘Æ°á»£c khi UI Ä‘á»•i.
 *
 * NGOÃ€I áº¢NH, script cÃ²n in ra Tá»ŒA Äá»˜ (% viewport) cá»§a tá»«ng nÃºt má»¥c tiÃªu â€”
 * copy khá»‘i JSON Ä‘Ã³ vÃ o TOUR_STEPS trong onboarding-overlay.tsx má»—i láº§n chá»¥p
 * láº¡i, káº»o con trá» chá»‰ tráº­t chá»—.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/onboarding";
const VIEW = { width: 1440, height: 960 };

const user = {
  id: "u1",
  fullName: "Chá»§ shop",
  email: "shop@hubsell.vn",
  role: "ADMIN",
  isPlatformAdmin: false,
  createdAt: "2026-06-01T00:00:00.000Z",
};

// Gian Shopee ÄÃƒ Káº¾T Ná»I THáº¬T cho áº£nh cuá»‘i (bÆ°á»›c Äá»“ng bá»™ Ä‘Æ¡n) â€” data demo
// Sunny Closet trÃ¹ng bá»™ áº£nh landing/guide cho nháº¥t quÃ¡n.
const connectedChannel = {
  id: "c1",
  channelName: "SHOPEE",
  shopName: "Sunny Closet",
  externalShopId: "281534907",
  externalShopName: "Sunny Closet",
  apiToken: "shpk_live_5f2a81c9d3e7b640",
  status: "ACTIVE",
  feeRate: "0",
  createdAt: "2026-08-20T09:00:00.000Z",
  apiConnected: true,
  accessTokenExpireAt: "2026-09-20T09:00:00.000Z",
  _count: { orders: 1284, channelProducts: 96 },
  matchedProductCount: 42,
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2, // áº£nh nÃ©t gáº¥p Ä‘Ã´i â€” bá»‹ phÃ³ng to tá»›i ~2.2x trong tour
    locale: "vi-VN",
    ignoreHTTPSErrors: true,
  });

  // áº¢nh 1+2 cáº§n danh sÃ¡ch gian Rá»–NG, áº£nh 3 cáº§n 1 gian Shopee Ä‘Ã£ ná»‘i â€”
  // route Ä‘á»c biáº¿n nÃ y nÃªn chá»‰ cáº§n Ä‘á»•i giÃ¡ trá»‹ rá»“i reload.
  let channelsPayload = [];

  await ctx.route("**/api/**", (route) => {
    const req = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors });
    }
    const url = req.url();
    const json = (o) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(o),
      });
    // hasChannels: true Ä‘á»ƒ AppShell render app Ä‘áº§y Ä‘á»§ (sidebar lÃ  nhÃ¢n váº­t
    // chÃ­nh cá»§a bÆ°á»›c 1) â€” mÃ n onboarding tháº­t khÃ´ng cháº·n trang nÃ y ná»¯a.
    if (url.includes("/api/auth/me")) return json({ user, hasChannels: true });
    if (/\/api\/channels(\?|$)/.test(url)) return json(channelsPayload);
    if (url.includes("/api/notifications")) return json({ items: [], unread: 0 });
    if (url.includes("/api/subscription/me")) {
      return json({
        exempt: true,
        hasSubscription: false,
        plan: null,
        subscription: null,
        usage: { channels: 1, staff: 0, ordersThisMonth: 0 },
        orders: { limit: null, used: 0, ratio: null, state: "OK", graceDeadline: null },
        expiry: { expired: false, lockDeadline: null, locked: false },
        locked: false,
        lockedReason: null,
        upgradePlans: [],
        payment: null,
        pendingUpgradeRequest: null,
      });
    }
    return json({});
  });

  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();

  // % viewport cá»§a tÃ¢m + kÃ­ch thÆ°á»›c má»™t element â€” náº¡p vÃ o TOUR_STEPS.
  const pct = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error("KhÃ´ng láº¥y Ä‘Æ°á»£c boundingBox");
    const r = (v) => Math.round(v * 100) / 100;
    return {
      x: r(((b.x + b.width / 2) / VIEW.width) * 100),
      y: r(((b.y + b.height / 2) / VIEW.height) * 100),
      w: r((b.width / VIEW.width) * 100),
      h: r((b.height / VIEW.height) * 100),
    };
  };
  const targets = {};

  // ---- áº¢nh 1: trang KÃªnh bÃ¡n trá»‘ng (sidebar + nÃºt Káº¿t ná»‘i gian hÃ ng) ----
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const navLink = page.getByRole("link", { name: "KÃªnh bÃ¡n" });
  await navLink.waitFor({ timeout: 30000 });
  await page.getByText("ChÆ°a káº¿t ná»‘i gian hÃ ng nÃ o").waitFor();
  await page.waitForTimeout(1200); // Ä‘á»£i font + icon náº¡p xong

  targets.navChannels = await pct(navLink);
  targets.connectButton = await pct(
    page.getByRole("button", { name: "Káº¿t ná»‘i gian hÃ ng" })
  );
  await page.screenshot({ path: path.join(OUT, "onboard-channels-empty.png") });

  // ---- áº¢nh 2: dialog Káº¿t ná»‘i gian hÃ ng (Shopee máº·c Ä‘á»‹nh) ----
  await page.getByRole("button", { name: "Káº¿t ná»‘i gian hÃ ng" }).click();
  const select = page.locator("#channel-select");
  await select.waitFor();
  const oauthBtn = page.getByRole("button", { name: /Tiáº¿p tá»¥c vá»›i Shopee/ });
  await oauthBtn.waitFor();
  await page.waitForTimeout(500); // Ä‘á»£i animation má»Ÿ dialog Ä‘á»©ng yÃªn

  targets.platformSelect = await pct(select);
  targets.oauthButton = await pct(oauthBtn);
  await page.screenshot({ path: path.join(OUT, "onboard-connect-dialog.png") });

  // ---- áº¢nh 3: gian Shopee Ä‘Ã£ káº¿t ná»‘i + nÃºt Äá»“ng bá»™ Ä‘Æ¡n ----
  channelsPayload = [connectedChannel];
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const syncBtn = page.getByRole("button", { name: "Äá»“ng bá»™ Ä‘Æ¡n", exact: true });
  await syncBtn.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);

  targets.syncButton = await pct(syncBtn);
  await page.screenshot({ path: path.join(OUT, "onboard-channel-connected.png") });

  await browser.close();
  console.log("DONE: 3 anh da luu vao", OUT);
  console.log("TOA DO MUC TIEU (% viewport) â€” dan vao TOUR_STEPS:");
  console.log(JSON.stringify(targets, null, 2));
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
