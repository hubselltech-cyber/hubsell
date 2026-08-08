// Kiểm tra trạng thái liên kết shop trong DB local — KHÔNG đọc giá trị token,
// chỉ xem có/không và hạn dùng, đủ để biết quyền access còn sống hay chưa.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const chans = await p.channel.findMany({
    select: {
      channelName: true,
      shopName: true,
      externalShopId: true,
      status: true,
      accessTokenExpireAt: true,
      refreshTokenExpireAt: true,
      lastSyncAt: true,
    },
  });
  // Có token hay không kiểm tra bằng đếm NOT NULL, không select nội dung
  const tokenStats = await p.$queryRaw`
    SELECT "channelName",
           COUNT(*)::int AS shops,
           COUNT("apiToken")::int AS has_access_token,
           COUNT("refreshToken")::int AS has_refresh_token,
           COUNT("shopCipher")::int AS has_cipher
    FROM "Channel" GROUP BY 1`;
  console.log("=== SHOPS ===");
  for (const c of chans) {
    console.log(
      [
        c.channelName,
        c.shopName,
        "ext=" + c.externalShopId,
        c.status,
        "accessExp=" + (c.accessTokenExpireAt?.toISOString() ?? "-"),
        "refreshExp=" + (c.refreshTokenExpireAt?.toISOString() ?? "-"),
        "lastSync=" + (c.lastSyncAt?.toISOString() ?? "-"),
      ].join(" | ")
    );
  }
  console.log("=== TOKEN PRESENCE ===");
  console.log(JSON.stringify(tokenStats));

  const aff = await p.$queryRaw`
    SELECT c."channelName", COUNT(*)::int AS orders,
           SUM(o."totalAmount")::float AS gmv,
           SUM(o."affiliateFee")::float AS commission
    FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"
    WHERE o."affiliateFee" > 0 GROUP BY 1`;
  console.log("=== AFFILIATE ORDERS (affiliateFee > 0) LOCAL DB ===");
  console.log(JSON.stringify(aff));
  await p.$disconnect();
})();
