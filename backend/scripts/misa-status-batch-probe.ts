// ============================================================
// BÀI THỬ SANDBOX meINVOICE — hóa đơn bước 5, lát 12 (docs/HANG-DOI-BEN.md mục 4.6):
// lệnh HỎI TRẠNG THÁI THEO LÔ (/invoice/status) cư xử thế nào. CHỈ ĐỌC — không lập,
// không sửa tờ nào bên MISA, không đụng database. Chạy từ thư mục backend/:
//
//   npx tsx scripts/misa-status-batch-probe.ts
//
// Mã tra cứu thật lấy bằng cách tra ngược mã tham chiếu HUBSELL-TEST-xxx của các tờ
// sandbox đã lập ở scripts/misa-publish-test.ts. Không đụng database.
//
//   S7  Adapter thật (checkStatuses): khai đúng / lệch / thiếu ký hiệu đều phải ra tờ thật.
//
//   S1  Lô nhỏ mã thật: MISA trả những trường nào, SendTaxStatus trên sandbox ra gì.
//   S2  Lô có lẫn MỘT mã không tồn tại: cả lô hỏng, hay chỉ thiếu dòng của mã đó.
//   S3  Lô toàn mã không tồn tại.
//   S4  Cùng lô S1 nhưng khai invoiceWithCode ngược lại (ký hiệu có mã): kết quả có đổi không.
//   S5  Lô có mã lặp lại.
//   S6  Lô 50 và lô lớn hơn 50 (nếu đủ mã): có bị từ chối không, mất bao lâu.
// ============================================================
import "dotenv/config";

import { getInvoiceStatuses, type StandardInvoiceConfig } from "../src/integrations/invoice/misa-einvoice";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../src/integrations/invoice/misa-provider";
import { MISA_SANDBOX_TAX_CODE } from "../src/services/tax-pilot";

const cfg = {
  taxCode: process.env.MISA_TAX_CODE ?? null,
  companyName: "CÔNG TY CỔ PHẦN MISA",
  companyAddress: "Tòa nhà Technosoft, Duy Tân, Cầu Giấy, Hà Nội",
  clientId: process.env.MISA_CLIENT_ID ?? null,
  secretKey: process.env.MISA_CLIENT_SECRET ?? null,
  meinvoiceUsername: process.env.MISA_USERNAME ?? null,
  meinvoicePassword: process.env.MISA_PASSWORD ?? null,
  invoicePattern: "1",
  invoiceSeries: "1K26TYY",
  defaultUnitName: "Cái",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
} as unknown as StandardInvoiceConfig;

async function ask(label: string, ids: string[], series = "1K26TYY") {
  const t0 = Date.now();
  try {
    const items = await getInvoiceStatuses(ids, { ...cfg, invoiceSeries: series } as StandardInvoiceConfig);
    console.log(`\n${label}: gửi ${ids.length} mã → nhận ${items.length} dòng, ${Date.now() - t0} ms`);
    return items;
  } catch (err) {
    const e = err as Error & { detail?: unknown };
    console.log(`\n${label}: gửi ${ids.length} mã → LỖI sau ${Date.now() - t0} ms: ${e.message}`);
    if (e.detail) console.log("   chi tiết:", JSON.stringify(e.detail).slice(0, 400));
    return null;
  }
}

function brief(items: Awaited<ReturnType<typeof getInvoiceStatuses>>) {
  for (const it of items) {
    console.log(
      `   ${it.transactionId} · số ${it.invoiceNo} · PublishStatus ${it.publishStatus} · SendTaxStatus ${it.sendTaxStatus} · IsDelete ${it.isDeleted}`
    );
  }
}

(async () => {
  if (cfg.taxCode !== MISA_SANDBOX_TAX_CODE) {
    throw new Error("DỪNG: MISA_TAX_CODE trong .env không phải MST sandbox của MISA — bài thử này chỉ chạy trên sandbox.");
  }
  // Mã THẬT lấy bằng cách tra ngược mã tham chiếu của các tờ scripts/misa-publish-test.ts đã
  // lập trên sandbox (HUBSELL-TEST-001...); phần còn lại của lô độn bằng mã không tồn tại.
  const fakeIds = Array.from({ length: 79 }, (_, i) => `HUBSELLKHONGCO${String(i).padStart(3, "0")}`);
  const refs = Array.from({ length: 40 }, (_, i) => `HUBSELL-TEST-${String(i + 1).padStart(3, "0")}`);
  const byRef = await getInvoiceStatuses(refs, cfg, "refId");
  console.log(`Tra ngược ${refs.length} mã tham chiếu HUBSELL-TEST-xxx trong MỘT lệnh → ${byRef.length} tờ.`);
  const realIds = [...new Set(byRef.map((it) => it.transactionId).filter((x): x is string => !!x))];
  const ids = [...realIds, ...fakeIds].slice(0, 80);
  console.log(`Mã tra cứu thật: ${realIds.length}; độn mã không tồn tại cho đủ lô.`);
  if (realIds.length === 0) throw new Error("Không có mã tra cứu thật nào để thử.");

  const few = ids.slice(0, 5);
  const s1 = await ask("S1 lô nhỏ mã thật", few);
  if (s1) {
    brief(s1);
    if (s1[0]) console.log("   Các trường MISA trả (dòng đầu):", JSON.stringify(s1[0].raw).slice(0, 1500));
    const missing = few.filter((id) => !s1.some((it) => it.transactionId === id));
    console.log(`   Mã gửi mà không có dòng trả về: ${missing.length}`);
  }

  const bogus = "HUBSELLKHONGTONTAI01";
  const s2 = await ask("S2 lô lẫn một mã không tồn tại", [...few.slice(0, 3), bogus]);
  if (s2) {
    brief(s2);
    console.log(`   Có dòng cho mã không tồn tại: ${s2.some((it) => it.transactionId === bogus)}`);
  }

  const s3 = await ask("S3 lô toàn mã không tồn tại", [bogus, "HUBSELLKHONGTONTAI02"]);
  if (s3) brief(s3);

  const s4 = await ask("S4 cùng lô S1, khai ký hiệu CÓ MÃ (invoiceWithCode=true)", few, "1C26TYY");
  if (s4) brief(s4);

  const s5 = await ask("S5 lô có mã lặp lại", [few[0], few[0], few[1] ?? few[0]]);
  if (s5) brief(s5);

  if (ids.length >= 50) {
    const s6 = await ask("S6a lô đúng 50 mã", ids.slice(0, 50));
    if (s6) console.log(`   SendTaxStatus gặp trong lô: ${[...new Set(s6.map((i) => i.sendTaxStatus))].join(", ")}; đã xóa: ${s6.filter((i) => i.isDeleted).length}`);
  }
  if (ids.length > 50) {
    await ask(`S6b lô ${ids.length} mã (lớn hơn 50)`, ids);
  } else {
    // Không đủ mã thật: độn mã lặp để xem MISA có giới hạn SỐ PHẦN TỬ của một lệnh không.
    const padded = Array.from({ length: 60 }, (_, i) => ids[i % ids.length]);
    await ask("S6b lô 60 phần tử (độn mã lặp, vì không đủ 51 mã thật)", padded);
  }

  // S7: adapter thật (MisaInvoiceProvider.checkStatuses) — tờ thật khai ĐÚNG ký hiệu, tờ thật
  // khai LỆCH ký hiệu (có mã) phải được hỏi lại loại ngược và vẫn ra, mã không tồn tại không có dòng.
  const provider = new MisaInvoiceProvider({ ...(cfg as object), defaultInvoiceType: "STANDARD" } as MisaProviderConfig);
  for (const series of ["1K26TYY", "1C26TYY", null]) {
    const t0 = Date.now();
    const res = await provider.checkStatuses([
      { transactionId: realIds[0], invoiceSeries: series },
      { transactionId: fakeIds[0], invoiceSeries: series },
    ]);
    console.log(
      `
S7 adapter, khai ký hiệu ${series ?? "(trống)"}: ${Date.now() - t0} ms → ` +
        (res.ok ? JSON.stringify([...res.found.values()]) : `KHÔNG HỎI ĐƯỢC: ${res.message}`)
    );
  }
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
