/**
 * Chá»¥p áº£nh GIAO DIá»†N THáº¬T cá»§a Hubsell cho bá»™ slide hÆ°á»›ng dáº«n.
 *
 * CÃ¡ch hoáº¡t Ä‘á»™ng: má»Ÿ frontend tháº­t (localhost:3000) báº±ng Chromium headless,
 * cháº·n má»i request /api/* vÃ  tráº£ dá»¯ liá»‡u máº«u â€” nhá» Ä‘Ã³ render Ä‘Ãºng 100% giao
 * diá»‡n production mÃ  khÃ´ng cáº§n backend hay Ä‘Äƒng nháº­p tháº­t.
 */
const { chromium } = require("playwright");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/guide-assets";

const user = {
  id: "u1",
  fullName: "Chá»§ shop",
  email: "shop@hubsell.vn",
  role: "ADMIN",
  isPlatformAdmin: false,
  createdAt: "2026-06-01T00:00:00.000Z",
};

// 2 gian hÃ ng máº«u â€” sá»‘ liá»‡u khá»›p bá»‘i cáº£nh tháº­t (DarkMan 963 Ä‘Æ¡n)
const channels = [
  {
    id: "c1", channelName: "SHOPEE", shopName: "DarkMan Store",
    externalShopId: "128600269", apiToken: "shp_41ef08c2a97f31d2b6f4",
    status: "ACTIVE", feeRate: "0", createdAt: "2026-07-01T00:00:00.000Z",
    apiConnected: true, _count: { orders: 963, channelProducts: 120 },
    matchedProductCount: 87,
  },
  {
    id: "c2", channelName: "LAZADA", shopName: "Hi.BÃ© Official",
    externalShopId: "400123", apiToken: "lzd_9f31d2b6a97f41ef08aa",
    status: "ACTIVE", feeRate: "0", createdAt: "2026-07-10T00:00:00.000Z",
    apiConnected: true, _count: { orders: 214, channelProducts: 60 },
    matchedProductCount: 52,
  },
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // áº£nh nÃ©t gáº¥p Ä‘Ã´i cho slide
    locale: "vi-VN",
    ignoreHTTPSErrors: true,
  });

  // Cháº·n toÃ n bá»™ API â€” ká»ƒ cáº£ preflight CORS (frontend gá»i https://localhost:4000)
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
    if (url.includes("/api/auth/me")) return json({ user, hasChannels: true });
    if (/\/api\/channels(\?|$)/.test(url)) return json(channels);
    return json({});
  });

  // Gieo phiÃªn Ä‘Äƒng nháº­p trÆ°á»›c khi trang cháº¡y script
  await ctx.addInitScript(([u]) => {
    localStorage.setItem("hubsell_token", "demo-token");
    localStorage.setItem("hubsell_user", JSON.stringify(u));
  }, [user]);

  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/channels", { waitUntil: "domcontentloaded" });
  const connectBtn = page.getByRole("button", { name: "Káº¿t ná»‘i gian hÃ ng" });
  await connectBtn.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200); // Ä‘á»£i font + icon náº¡p xong

  // 1) ToÃ n trang KÃªnh bÃ¡n
  await page.screenshot({ path: path.join(OUT, "channels-page.png") });

  // 2) RiÃªng khá»‘i gian hÃ ng Shopee (cÃ³ nÃºt Äá»“ng bá»™ Ä‘Æ¡n / Äá»“ng bá»™ Ä‘á»‘i soÃ¡t)
  const shopeeCard = page
    .locator("div[class*='shadow-sm']")
    .filter({ hasText: "DarkMan Store" })
    .first();
  await shopeeCard.screenshot({ path: path.join(OUT, "shopee-card.png") });

  // 3) Há»™p thoáº¡i Káº¿t ná»‘i gian hÃ ng â€” máº·c Ä‘á»‹nh Shopee
  await connectBtn.click();
  await page.getByText("SÃ n thÆ°Æ¡ng máº¡i").waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "connect-dialog-shopee.png") });

  // 4) Chuyá»ƒn sang Lazada â€” hiá»‡n Ã´ "Code uá»· quyá»n"
  await page.selectOption("#channel-select", "LAZADA");
  await page.getByText("Code uá»· quyá»n").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "connect-dialog-lazada.png") });

  await browser.close();
  console.log("DONE: 4 anh da luu vao", OUT);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
