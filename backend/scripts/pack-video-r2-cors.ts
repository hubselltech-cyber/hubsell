// ============================================================
// Đặt / xem luật CORS của bucket R2 chứa video đóng hàng.
//
// Vì sao cần: màn quay bằng webcam trên WEB tải clip thẳng từ trình duyệt lên R2 bằng đường dẫn ký sẵn.
// Trình duyệt chỉ cho làm vậy khi bucket khai nguồn (origin) của app trong luật CORS; app điện thoại không cần.
// Phải lộ tiêu đề ETag: tải theo mảnh đọc ETag của từng mảnh từ phản hồi để chốt tệp.
//
// Chạy:  npx tsx scripts/pack-video-r2-cors.ts            → chỉ XEM luật đang có
//        npx tsx scripts/pack-video-r2-cors.ts --apply    → ĐẶT luật bên dưới (ghi đè luật cũ của bucket)
// Khóa cần quyền quản trị bucket. Khóa chỉ có quyền đọc / ghi tệp sẽ bị từ chối (403) — khi đó dán khối JSON
// script in ra vào Cloudflare › R2 › <bucket> › Settings › CORS Policy.
// ============================================================
import "dotenv/config";
import { AwsClient } from "aws4fetch";

/** Nguồn được phép tải lên: app thật + hai cổng chạy local. */
const ALLOWED_ORIGINS = [
  "https://app.hubsell.vn",
  "https://app.hubsell.tech",
  "http://localhost:3010",
  "http://localhost:3000",
];

const DASHBOARD_JSON = [
  {
    AllowedOrigins: ALLOWED_ORIGINS,
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["content-type"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

function corsXml(): string {
  const rule = DASHBOARD_JSON[0];
  const tags = (name: string, values: string[]) => values.map((v) => `<${name}>${v}</${name}>`).join("");
  return (
    `<CORSConfiguration><CORSRule>` +
    tags("AllowedOrigin", rule.AllowedOrigins) +
    tags("AllowedMethod", rule.AllowedMethods) +
    tags("AllowedHeader", rule.AllowedHeaders) +
    tags("ExposeHeader", rule.ExposeHeaders) +
    `<MaxAgeSeconds>${rule.MaxAgeSeconds}</MaxAgeSeconds>` +
    `</CORSRule></CORSConfiguration>`
  );
}

async function main() {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("Thiếu biến R2_* trong backend/.env");
  }
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const url = `${R2_ENDPOINT.replace(/\/$/, "")}/${R2_BUCKET}?cors`;

  if (process.argv.includes("--apply")) {
    const put = await client.fetch(url, { method: "PUT", body: corsXml(), headers: { "content-type": "application/xml" } });
    console.log(`Đặt luật CORS cho bucket ${R2_BUCKET}: HTTP ${put.status}`);
    if (!put.ok) {
      console.log((await put.text()).slice(0, 300));
      console.log("\nKhóa này không đặt được luật. Dán khối sau vào Cloudflare › R2 › bucket › Settings › CORS Policy:\n");
      console.log(JSON.stringify(DASHBOARD_JSON, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  const get = await client.fetch(url);
  console.log(`Luật CORS đang có (HTTP ${get.status}):`);
  console.log((await get.text()).slice(0, 1200) || "(trống)");
}

main().catch((e) => {
  console.error("LỖI:", (e as Error).message);
  process.exitCode = 1;
});
