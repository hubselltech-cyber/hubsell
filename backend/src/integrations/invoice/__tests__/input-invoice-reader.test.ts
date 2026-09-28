import { describe, expect, it } from "vitest";
import { looksLikeXml, parseVnEInvoiceXml } from "../input-invoice-reader";

// XML rút gọn theo chuẩn TCTN (QĐ 1450/QĐ-TCT) — cấu trúc thật của hóa đơn
// MISA/Viettel/VNPT: HDon > DLHDon > TTChung + NDHDon(NBan, DSHHDVu, TToan).
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<HDon>
  <DLHDon Id="data">
    <TTChung>
      <PBan>2.0.0</PBan>
      <THDon>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</THDon>
      <KHMSHDon>1</KHMSHDon>
      <KHHDon>C26TAA</KHHDon>
      <SHDon>00001234</SHDon>
      <NLap>2026-09-28</NLap>
      <DVTTe>VND</DVTTe>
      <TGia>1</TGia>
      <HTTToan>CK</HTTToan>
    </TTChung>
    <NDHDon>
      <NBan><Ten>CÔNG TY CỔ PHẦN CHỮ KÝ SỐ ABC</Ten><MST>0101234567</MST></NBan>
      <NMua><Ten>CÔNG TY TNHH CÔNG NGHỆ HUBSELL</Ten><MST>0111626360</MST></NMua>
      <DSHHDVu>
        <HHDVu><THHDVu>Chứng thư số EFY-CA 3 năm</THHDVu><ThTien>1362727</ThTien></HHDVu>
        <HHDVu><THHDVu>USB token</THHDVu><ThTien>0</ThTien></HHDVu>
      </DSHHDVu>
      <TToan>
        <THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>1362727</ThTien><TThue>136273</TThue></LTSuat></THTTLTSuat>
        <TgTCThue>1362727</TgTCThue>
        <TgTThue>136273</TgTThue>
        <TgTTTBSo>1499000</TgTTTBSo>
      </TToan>
    </NDHDon>
  </DLHDon>
</HDon>`;

describe("parseVnEInvoiceXml", () => {
  it("đọc đủ số/ký hiệu/ngày/NCC/tiền, giữ số 0 đầu của SHDon", () => {
    const r = parseVnEInvoiceXml(SAMPLE);
    expect(r).not.toBeNull();
    expect(r!.invoiceNo).toBe("00001234");
    expect(r!.invoiceSerial).toBe("1C26TAA");
    expect(r!.invoiceDate).toBe("2026-09-28");
    expect(r!.sellerName).toBe("CÔNG TY CỔ PHẦN CHỮ KÝ SỐ ABC");
    expect(r!.sellerTaxCode).toBe("0101234567");
    expect(r!.subtotal).toBe(1362727);
    expect(r!.vatRate).toBe("10");
    expect(r!.vatAmount).toBe(136273);
    expect(r!.total).toBe(1499000);
    expect(r!.currency).toBe("VND");
    expect(r!.paymentMethod).toBe("BANK");
    expect(r!.description).toBe("Chứng thư số EFY-CA 3 năm (+1 mục khác)");
    expect(r!.isForeign).toBe(false);
  });

  it("trả null với XML không phải hóa đơn chuẩn (để chuyển sang AI)", () => {
    expect(parseVnEInvoiceXml("<root><a>1</a></root>")).toBeNull();
    expect(parseVnEInvoiceXml("không phải xml")).toBeNull();
  });

  it("HTTToan TM/CK → chưa rõ (null) cho người duyệt chọn; TM → CASH", () => {
    expect(parseVnEInvoiceXml(SAMPLE.replace("<HTTToan>CK</HTTToan>", "<HTTToan>TM/CK</HTTToan>"))!.paymentMethod).toBeNull();
    expect(parseVnEInvoiceXml(SAMPLE.replace("<HTTToan>CK</HTTToan>", "<HTTToan>TM</HTTToan>"))!.paymentMethod).toBe("CASH");
    expect(parseVnEInvoiceXml(SAMPLE.replace("<TSuat>10%</TSuat>", "<TSuat>KCT</TSuat>"))!.vatRate).toBe("KCT");
  });

  it("looksLikeXml nhận diện theo byte đầu", () => {
    expect(looksLikeXml(Buffer.from("  <?xml version"))).toBe(true);
    expect(looksLikeXml(Buffer.from("%PDF-1.7"))).toBe(false);
  });
});
