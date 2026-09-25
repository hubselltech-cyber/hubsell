# -*- coding: utf-8 -*-
"""Sinh 2 PDF hồ sơ ĐĂNG KÝ THAY ĐỔI TÊN (bổ sung tên nước ngoài + tên viết tắt)
cho CÔNG TY TNHH CÔNG NGHỆ HUBSELL theo Mẫu số 12 Phụ lục I TT 68/2025/TT-BTC
(bản cập nhật TT 121/2026) + Quyết định của chủ sở hữu (Điều 41 NĐ 168/2025)."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib import colors
import os

OUT = r"C:\Users\trung\Downloads"
pdfmetrics.registerFont(TTFont("Arial", r"C:\Windows\Fonts\arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", r"C:\Windows\Fonts\arialbd.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Italic", r"C:\Windows\Fonts\ariali.ttf"))

pdfmetrics.registerFont(TTFont("Sym", r"C:\Windows\Fonts\seguisym.ttf"))
CB0 = '<font name="Sym">\u2610</font>'
CB1 = '<font name="Sym">\u2612</font>'

CO = "CÔNG TY TNHH CÔNG NGHỆ HUBSELL"
MST = "0111626360"
NAME_EN = "HUBSELL TECHNOLOGY CO., LTD."
NAME_SHORT = "HUBSELL"
ADDR = "5K1, Ngõ 5, TT75, Tổng Cục II, BQP, Tổ Dân Phố Kim Chung, Xã Hoài Đức, Thành phố Hà Nội, Việt Nam"
OWNER = "NGUYỄN TRUNG HIẾU"
OWNER_DOB = "27/02/1993"
OWNER_ID = "026093012010"
AGENCY = "Phòng Đăng ký kinh doanh và Tài chính doanh nghiệp – Sở Tài chính Thành phố Hà Nội"
DATE_LINE = "Hà Nội, ngày ....... tháng 09 năm 2026"

base = ParagraphStyle("b", fontName="Arial", fontSize=12, leading=17, alignment=TA_JUSTIFY)
left = ParagraphStyle("l", parent=base, alignment=TA_LEFT)
center = ParagraphStyle("c", parent=base, alignment=TA_CENTER)
bold_c = ParagraphStyle("bc", parent=center, fontName="Arial-Bold")
title = ParagraphStyle("t", parent=bold_c, fontSize=14, leading=20)
small_i = ParagraphStyle("si", parent=center, fontName="Arial-Italic", fontSize=11, leading=15)
h = ParagraphStyle("h", parent=left, fontName="Arial-Bold")
small = ParagraphStyle("s", parent=left, fontSize=10.5, leading=14)


def header(story, so="Số: ......../2026/.........."):
    t = Table(
        [[Paragraph(f"<b>{CO}</b><br/>--------", bold_c),
          Paragraph("<b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br/><b>Độc lập - Tự do - Hạnh phúc</b><br/>---------------", bold_c)],
         [Paragraph(so, center), Paragraph(f"<i>{DATE_LINE}</i>", center)]],
        colWidths=[75 * mm, 100 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [t, Spacer(1, 8 * mm)]


def sign_block(story, role_lines):
    t = Table([[Paragraph("", left), Paragraph("<br/>".join(role_lines), bold_c)],
               [Paragraph("", left), Paragraph("<br/><br/><br/><br/><br/>" + OWNER, bold_c)]],
              colWidths=[85 * mm, 90 * mm])
    story += [Spacer(1, 6 * mm), t]


# ------------------------------------------------------------------ 1. Mẫu số 12
def mau12():
    doc = SimpleDocTemplate(os.path.join(OUT, "1-Giay-de-nghi-thay-doi-ten-Mau-12-HUBSELL.pdf"), pagesize=A4,
                            leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title="Giấy đề nghị đăng ký thay đổi nội dung GCN ĐKDN - HUBSELL")
    s = []
    header(s)
    s += [Paragraph("GIẤY ĐỀ NGHỊ", title),
          Paragraph("Đăng ký thay đổi nội dung Giấy chứng nhận đăng ký doanh nghiệp/<br/>Thông báo thay đổi nội dung đăng ký doanh nghiệp", bold_c),
          Paragraph("(Dùng trong trường hợp đăng ký thay đổi nội dung Giấy chứng nhận đăng ký doanh nghiệp/thông báo thay đổi nội dung đăng ký doanh nghiệp; Bổ sung, cập nhật thông tin đăng ký doanh nghiệp; Đề nghị hiệu đính thông tin đăng ký doanh nghiệp)", small_i),
          Spacer(1, 5 * mm),
          Paragraph(f"<b>Kính gửi:</b> {AGENCY}", left),
          Spacer(1, 3 * mm),
          Paragraph(f"Tên doanh nghiệp (ghi bằng chữ in hoa): <b>{CO}</b>", left),
          Paragraph(f"Mã số doanh nghiệp/Mã số thuế: <b>{MST}</b>", left),
          Spacer(1, 5 * mm),
          Paragraph("A. ĐĂNG KÝ THAY ĐỔI NỘI DUNG ĐĂNG KÝ DOANH NGHIỆP/THÔNG BÁO THAY ĐỔI NỘI DUNG ĐĂNG KÝ DOANH NGHIỆP", h),
          Paragraph("<i>(Doanh nghiệp chọn và kê khai vào trang tương ứng với nội dung đăng ký/thông báo thay đổi và gửi kèm)</i>", left),
          Spacer(1, 2 * mm),
          Paragraph("Doanh nghiệp đăng ký thay đổi trên cơ sở (chỉ kê khai trong trường hợp đăng ký thay đổi trên cơ sở tách hoặc sáp nhập doanh nghiệp):", left),
          Paragraph("- Đăng ký thay đổi trên cơ sở tách doanh nghiệp: " + CB0 + "", left),
          Paragraph("- Đăng ký thay đổi trên cơ sở sáp nhập doanh nghiệp: " + CB0 + "", left),
          Paragraph("- Doanh nghiệp có Giấy chứng nhận quyền sử dụng đất tại đảo và xã, phường biên giới; xã, phường ven biển; khu vực khác có ảnh hưởng đến quốc phòng, an ninh: Có " + CB0 + " Không " + CB1 + "", left),
          Spacer(1, 6 * mm),
          Paragraph("ĐĂNG KÝ THAY ĐỔI TÊN DOANH NGHIỆP", bold_c),
          Spacer(1, 2 * mm),
          Paragraph(f"Tên doanh nghiệp viết bằng tiếng Việt sau khi thay đổi (ghi bằng chữ in hoa): <b>{CO}</b> <i>(giữ nguyên)</i>", left),
          Paragraph(f"Tên doanh nghiệp viết bằng tiếng nước ngoài sau khi thay đổi (nếu có): <b>{NAME_EN}</b>", left),
          Paragraph(f"Tên doanh nghiệp viết tắt sau khi thay đổi (nếu có): <b>{NAME_SHORT}</b>", left),
          Spacer(1, 6 * mm),
          Paragraph("B. BỔ SUNG, CẬP NHẬT THÔNG TIN ĐĂNG KÝ DOANH NGHIỆP", h),
          Paragraph("- Website: <b>hubsell.vn</b>", left),
          Paragraph("- Thư điện tử: <b>support@hubsell.vn</b>", left),
          Spacer(1, 4 * mm),
          Paragraph("C. ĐỀ NGHỊ HIỆU ĐÍNH THÔNG TIN ĐĂNG KÝ DOANH NGHIỆP: <i>không</i>", left),
          Spacer(1, 4 * mm),
          Paragraph("" + CB0 + " Đề nghị Quý Cơ quan cấp Giấy xác nhận thay đổi nội dung đăng ký doanh nghiệp cho doanh nghiệp đối với các thông tin thay đổi nêu trên.", left),
          Paragraph("Trường hợp hồ sơ đăng ký doanh nghiệp hợp lệ, đề nghị Quý Cơ quan đăng công bố nội dung đăng ký doanh nghiệp trên Cổng thông tin quốc gia về đăng ký doanh nghiệp.", left),
          Paragraph("Doanh nghiệp cam kết hoàn toàn chịu trách nhiệm trước pháp luật về tính hợp pháp, chính xác và trung thực của nội dung Thông báo này.", left),
          Paragraph("Người ký tại Thông báo này cam kết là người có quyền và nghĩa vụ thực hiện thủ tục đăng ký doanh nghiệp theo quy định của pháp luật và Điều lệ công ty.", left)]
    sign_block(s, ["NGƯỜI ĐẠI DIỆN THEO PHÁP LUẬT", "<i>(Ký và ghi họ tên)</i>"])
    s += [Spacer(1, 6 * mm),
          Paragraph("<b>Giấy tờ gửi kèm:</b> Quyết định của Chủ sở hữu công ty về việc thay đổi tên doanh nghiệp (bổ sung tên viết bằng tiếng nước ngoài và tên viết tắt).", small)]
    doc.build(s)


# ------------------------------------------------------------------ 2. Quyết định chủ sở hữu
def quyet_dinh():
    doc = SimpleDocTemplate(os.path.join(OUT, "2-Quyet-dinh-chu-so-huu-bo-sung-ten-nuoc-ngoai-HUBSELL.pdf"), pagesize=A4,
                            leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title="Quyết định của Chủ sở hữu về việc thay đổi tên doanh nghiệp - HUBSELL")
    s = []
    header(s, so="Số: 01/2026/QĐ-CSH")
    s += [Paragraph("QUYẾT ĐỊNH CỦA CHỦ SỞ HỮU CÔNG TY", title),
          Paragraph("Về việc thay đổi tên doanh nghiệp: bổ sung tên viết bằng tiếng nước ngoài và tên viết tắt", bold_c),
          Spacer(1, 6 * mm),
          Paragraph("CHỦ SỞ HỮU CÔNG TY TNHH CÔNG NGHỆ HUBSELL", bold_c),
          Spacer(1, 4 * mm),
          Paragraph("Căn cứ Luật Doanh nghiệp số 59/2020/QH14 ngày 17/6/2020 (sửa đổi, bổ sung bởi Luật số 76/2025/QH15), đặc biệt Điều 37, Điều 39 về tên doanh nghiệp và Điều 76 về quyền của chủ sở hữu công ty;", base),
          Paragraph("Căn cứ Nghị định số 168/2025/NĐ-CP ngày 30/6/2025 của Chính phủ về đăng ký doanh nghiệp;", base),
          Paragraph(f"Căn cứ Điều lệ {CO};", base),
          Paragraph("Xét nhu cầu giao dịch với đối tác, nền tảng và cơ quan nước ngoài của Công ty,", base),
          Spacer(1, 4 * mm),
          Paragraph("QUYẾT ĐỊNH:", bold_c),
          Spacer(1, 3 * mm),
          Paragraph("<b>Điều 1.</b> Thay đổi tên doanh nghiệp theo hướng bổ sung tên viết bằng tiếng nước ngoài và tên viết tắt, cụ thể:", base),
          Paragraph(f"1. Tên công ty viết bằng tiếng Việt: <b>{CO}</b> (giữ nguyên).", base),
          Paragraph(f"2. Tên công ty viết bằng tiếng nước ngoài: <b>{NAME_EN}</b>", base),
          Paragraph(f"3. Tên công ty viết tắt: <b>{NAME_SHORT}</b>", base),
          Paragraph("<b>Điều 2.</b> Sửa đổi khoản 2 Điều 1 Điều lệ công ty thành:", base),
          Paragraph(f"“2. Tên công ty viết bằng tiếng Việt: {CO}. Tên công ty viết bằng tiếng nước ngoài: {NAME_EN} Tên công ty viết tắt: {NAME_SHORT}.”", base),
          Paragraph("Các nội dung khác của Điều lệ giữ nguyên.", base),
          Paragraph("<b>Điều 3.</b> Đồng thời cập nhật thông tin liên hệ của doanh nghiệp: website hubsell.vn, thư điện tử support@hubsell.vn.", base),
          Paragraph(f"<b>Điều 4.</b> Giao ông {OWNER.title()}, Giám đốc kiêm người đại diện theo pháp luật, thực hiện thủ tục đăng ký thay đổi nội dung Giấy chứng nhận đăng ký doanh nghiệp tại cơ quan đăng ký kinh doanh và công bố theo quy định.", base),
          Paragraph("<b>Điều 5.</b> Quyết định này có hiệu lực kể từ ngày ký.", base),
          Spacer(1, 4 * mm),
          Paragraph("<b>Thông tin chủ sở hữu:</b>", left),
          Paragraph(f"Họ và tên: {OWNER} — Ngày sinh: {OWNER_DOB} — Quốc tịch: Việt Nam", left),
          Paragraph(f"Số định danh cá nhân: {OWNER_ID}", left),
          Paragraph(f"Địa chỉ liên lạc: {ADDR}", left),
          Paragraph("Tỷ lệ sở hữu: 100% vốn điều lệ (50.000.000 đồng)", left)]
    sign_block(s, ["CHỦ SỞ HỮU CÔNG TY", "<i>(Ký và ghi họ tên)</i>"])
    doc.build(s)


mau12()
quyet_dinh()
print("OK")
