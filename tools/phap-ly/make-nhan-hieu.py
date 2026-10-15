# -*- coding: utf-8 -*-
"""Sinh bộ hồ sơ ĐĂNG KÝ NHÃN HIỆU chữ "HUBSELL" cho CÔNG TY TNHH CÔNG NGHỆ HUBSELL
theo Mẫu số 04 Phụ lục I Thông tư 10/2026/TT-BKHCN (áp dụng từ 01/04/2026, thay Mẫu 08 NĐ 65/2023).

Đầu ra: C:\\Users\\trung\\Downloads\\Ho-so-nhan-hieu-Hubsell\\
  1-To-khai-dang-ky-nhan-hieu-HUBSELL-Mau-04.pdf   (bản tham khảo để điền cổng / nộp giấy)
  2-Mau-nhan-hieu-chu-HUBSELL.png                   (80 x 80 mm @ 300 dpi, đen trên trắng)
  3-Mau-nhan-hieu-ket-hop-HUBSELL.png               (tùy chọn: logo + chữ, có màu)
  4-Danh-muc-dich-vu-nhom-42-9.txt                  (dán vào cổng)
Chạy: python docs/scripts-phap-ly-make-nhan-hieu.py
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib import colors
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\trung\Downloads\Ho-so-nhan-hieu-Hubsell"
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(ROOT, "frontend", "public", "logo-hubsell.png")

pdfmetrics.registerFont(TTFont("Arial", r"C:\Windows\Fonts\arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", r"C:\Windows\Fonts\arialbd.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Italic", r"C:\Windows\Fonts\ariali.ttf"))
pdfmetrics.registerFont(TTFont("Sym", r"C:\Windows\Fonts\seguisym.ttf"))
CB0 = '<font name="Sym">\u2610</font>'
CB1 = '<font name="Sym">\u2612</font>'

# ----- Dữ liệu chủ đơn (khớp GCN ĐKDN 09/09/2026 + hồ sơ BCT) -----
CO = "CÔNG TY TNHH CÔNG NGHỆ HUBSELL"
NAME_EN = "HUBSELL TECHNOLOGY CO., LTD."
MST = "0111626360"
ADDR = "Số nhà 5K1, Ngõ 5, TT75, Tổng Cục II, BQP, Tổ dân phố Kim Chung, Xã Hoài Đức, Thành phố Hà Nội, Việt Nam"
PHONE = "0965863292"
EMAIL = "support@hubsell.vn"
OWNER = "NGUYỄN TRUNG HIẾU"
OWNER_ROLE = "Giám đốc – Người đại diện theo pháp luật"
MARK = "HUBSELL"
DATE_LINE = "Hà Nội, ngày ....... tháng ....... năm 2026"

MO_TA = (
    "Nhãn hiệu là nhãn hiệu chữ \u201cHUBSELL\u201d, gồm bảy chữ cái La-tinh viết in hoa, kiểu chữ thường, "
    "màu đen trên nền trắng, không kèm hình. \u201cHUBSELL\u201d là từ tự tạo, không có nghĩa trong tiếng Việt; "
    "được ghép từ \u201cHUB\u201d (trung tâm) và \u201cSELL\u201d (bán hàng), gợi ý nghĩa trung tâm quản lý bán hàng. "
    "Nhãn hiệu không yêu cầu bảo hộ màu sắc."
)

# ----- Danh mục dịch vụ / hàng hóa: đúng 6 mục mỗi nhóm (mục thứ 7 trở đi thu thêm phí) -----
NHOM_42 = [
    "Phần mềm dưới dạng dịch vụ (SaaS) để quản lý bán hàng đa kênh trên các sàn thương mại điện tử",
    "Cung cấp sử dụng trực tuyến phần mềm không tải về để quản lý đơn hàng, tồn kho, hàng hóa, tài chính và quảng cáo cho người bán hàng trực tuyến",
    "Nền tảng dưới dạng dịch vụ (PaaS) để kết nối và đồng bộ dữ liệu với các sàn thương mại điện tử",
    "Thiết kế và phát triển phần mềm máy tính",
    "Lưu trữ dữ liệu điện tử",
    "Tư vấn công nghệ thông tin; hỗ trợ kỹ thuật, xử lý sự cố phần mềm máy tính",
]
NHOM_09 = [
    "Phần mềm máy tính có thể tải về để quản lý bán hàng đa kênh trên các sàn thương mại điện tử",
    "Ứng dụng phần mềm cho điện thoại di động có thể tải về để quản lý đơn hàng, tồn kho, hàng hóa, tài chính và quảng cáo",
    "Phần mềm máy tính có thể tải về để đồng bộ hóa dữ liệu bán hàng giữa các sàn thương mại điện tử",
    "Phần mềm quản lý kho hàng có thể tải về",
    "Phần mềm kế toán và lập hóa đơn điện tử có thể tải về",
    "Ấn phẩm điện tử có thể tải về (tài liệu hướng dẫn sử dụng phần mềm)",
]

# ----- Phí, lệ phí (TT 263/2016/TT-BTC; miễn 2 khoản lệ phí khi nộp qua VNeID theo TT 29/2026/TT-BTC đến 31/12/2026) -----
FEES = [
    ("Lệ phí nộp đơn", "1 đơn", 150000, "Miễn khi nộp qua VNeID (TT 29/2026/TT-BTC)"),
    ("Phí công bố đơn", "1 đơn", 120000, ""),
    ("Phí tra cứu phục vụ thẩm định nội dung", "2 nhóm × 180.000", 360000, ""),
    ("Phí thẩm định nội dung (≤ 6 sản phẩm/dịch vụ mỗi nhóm)", "2 nhóm × 550.000", 1100000, ""),
    ("Lệ phí cấp Văn bằng bảo hộ", "120.000 + 100.000 (nhóm 2)", 220000, "Miễn khi nộp qua VNeID; nộp khi được cấp"),
    ("Phí đăng bạ Văn bằng bảo hộ", "1 văn bằng", 120000, "Nộp khi được cấp"),
    ("Phí công bố Văn bằng bảo hộ", "1 văn bằng", 120000, "Nộp khi được cấp"),
]


def vnd(n):
    return f"{n:,.0f}".replace(",", ".") + " đ"


# ====================== 1. MẪU NHÃN HIỆU (PNG) ======================
def make_mark_images():
    px = int(80 / 25.4 * 300)  # 80 mm @ 300 dpi = 945 px
    # --- Nhãn chữ: đen trên trắng ---
    im = Image.new("RGB", (px, px), "white")
    d = ImageDraw.Draw(im)
    size = 190
    font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", size)
    while d.textbbox((0, 0), MARK, font=font)[2] > px * 0.86:
        size -= 4
        font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", size)
    l, t, r, b = d.textbbox((0, 0), MARK, font=font)
    d.text(((px - (r - l)) / 2 - l, (px - (b - t)) / 2 - t), MARK, font=font, fill="black")
    p1 = os.path.join(OUT, "2-Mau-nhan-hieu-chu-HUBSELL.png")
    im.save(p1, dpi=(300, 300))

    # --- Nhãn kết hợp (tùy chọn): logo trên, chữ dưới ---
    im2 = Image.new("RGB", (px, px), "white")
    logo = Image.open(LOGO).convert("RGBA")
    lw = int(px * 0.52)
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
    im2.paste(logo, ((px - lw) // 2, int(px * 0.08)), logo)
    d2 = ImageDraw.Draw(im2)
    f2 = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 150)
    l, t, r, b = d2.textbbox((0, 0), MARK, font=f2)
    d2.text(((px - (r - l)) / 2 - l, int(px * 0.08) + logo.height + int(px * 0.05) - t), MARK, font=f2, fill=(20, 24, 28))
    p2 = os.path.join(OUT, "3-Mau-nhan-hieu-ket-hop-HUBSELL.png")
    im2.save(p2, dpi=(300, 300))
    return p1, p2


# ====================== 2. DANH MỤC (TXT để dán) ======================
def make_list_txt():
    p = os.path.join(OUT, "4-Danh-muc-dich-vu-nhom-42-9.txt")
    with open(p, "w", encoding="utf-8") as f:
        f.write("NHÓM 42:\n" + "; ".join(NHOM_42) + ".\n\n")
        f.write("NHÓM 09:\n" + "; ".join(NHOM_09) + ".\n\n")
        f.write("MÔ TẢ NHÃN HIỆU:\n" + MO_TA + "\n")
    return p


# ====================== 3. TỜ KHAI (PDF) ======================
base = ParagraphStyle("b", fontName="Arial", fontSize=10.5, leading=14, alignment=TA_JUSTIFY)
left = ParagraphStyle("l", parent=base, alignment=TA_LEFT)
center = ParagraphStyle("c", parent=base, alignment=TA_CENTER)
bold_c = ParagraphStyle("bc", parent=center, fontName="Arial-Bold")
title = ParagraphStyle("t", parent=bold_c, fontSize=14, leading=19)
h = ParagraphStyle("h", parent=left, fontName="Arial-Bold", fontSize=10.5)
small = ParagraphStyle("s", parent=left, fontSize=9, leading=12)
small_i = ParagraphStyle("si", parent=small, fontName="Arial-Italic")

GRID = TableStyle([
    ("GRID", (0, 0), (-1, -1), 0.6, colors.black),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
])


def box(rows, widths):
    t = Table(rows, colWidths=widths)
    t.setStyle(GRID)
    return t


def P(txt, st=left):
    return Paragraph(txt, st)


def make_pdf(mark_png):
    path = os.path.join(OUT, "1-To-khai-dang-ky-nhan-hieu-HUBSELL-Mau-04.pdf")
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
                            title="Tờ khai đăng ký nhãn hiệu HUBSELL", author=CO)
    W = A4[0] - 36 * mm
    s = []

    s += [P("Mẫu số 04 – Phụ lục I<br/>Thông tư 10/2026/TT-BKHCN", small_i)]
    s += [Spacer(1, 3 * mm), P("TỜ KHAI", title), P("ĐĂNG KÝ NHÃN HIỆU", title),
          P("Kính gửi: Cục Sở hữu trí tuệ<br/>384-386 Nguyễn Trãi, phường Thanh Xuân, Thành phố Hà Nội", center),
          P("Người nộp đơn dưới đây yêu cầu Cục Sở hữu trí tuệ xem xét đơn và cấp Giấy chứng nhận đăng ký nhãn hiệu", small_i),
          Spacer(1, 3 * mm)]

    # Ô dành cho Cục
    s += [box([[P("<b>DẤU NHẬN ĐƠN</b><br/>(Dành cho cán bộ nhận đơn)", small),
                P("Mã hồ sơ thủ tục hành chính: ..............................<br/>Số đơn: ....................................<br/>Ngày nộp đơn: ..........................", small)]],
               [W * 0.45, W * 0.55]), Spacer(1, 3 * mm)]

    # 1. Nguồn gốc đơn + loại nhãn hiệu
    s += [box([[P("<b>NGUỒN GỐC ĐƠN</b>", h)],
               [P(f"{CB0} Đơn tách từ đơn số: ........... ngày nộp: ...........  &nbsp;&nbsp; {CB1} Đơn nộp mới (không phải đơn tách)", left)]], [W]), Spacer(1, 2 * mm)]

    # 2. Mẫu nhãn hiệu
    img = RLImage(mark_png, 45 * mm, 45 * mm)
    s += [box([
        [P("<b>MẪU NHÃN HIỆU</b>", h), P("<b>LOẠI NHÃN HIỆU YÊU CẦU ĐĂNG KÝ</b>", h)],
        [img, P(f"{CB1} Nhãn hiệu thông thường<br/>{CB0} Nhãn hiệu tập thể<br/>{CB0} Nhãn hiệu chứng nhận<br/>"
                f"{CB0} Nhãn hiệu ba chiều<br/>{CB0} Nhãn hiệu âm thanh<br/>{CB0} Nhãn hiệu liên kết<br/><br/>"
                f"<b>Màu sắc:</b> {CB1} Đen – trắng (không yêu cầu bảo hộ màu) &nbsp; {CB0} Yêu cầu bảo hộ màu sắc: ..........", left)],
        [P("<b>MÔ TẢ NHÃN HIỆU</b>", h), ""],
        [P(MO_TA, left), ""],
    ], [W * 0.42, W * 0.58]), Spacer(1, 2 * mm)]
    s[-2].setStyle(TableStyle([("SPAN", (0, 2), (1, 2)), ("SPAN", (0, 3), (1, 3))]))
    s[-2].setStyle(GRID)

    # 3. Chủ đơn
    s += [box([
        [P("<b>CHỦ ĐƠN</b> <i>(Tổ chức, cá nhân yêu cầu cấp Giấy chứng nhận đăng ký nhãn hiệu)</i>", h)],
        [P(f"<b>Tên đầy đủ:</b> {CO}<br/>"
           f"<b>Tên tiếng nước ngoài:</b> {NAME_EN}<br/>"
           f"<b>Địa chỉ:</b> {ADDR}<br/>"
           f"<b>Mã số doanh nghiệp:</b> {MST} &nbsp;&nbsp; <b>Mã quốc gia (địa chỉ):</b> VN &nbsp;&nbsp; <b>Mã quốc tịch:</b> VN<br/>"
           f"<b>Điện thoại:</b> {PHONE} &nbsp;&nbsp; <b>Email:</b> {EMAIL}<br/>"
           f"{CB0} Ngoài chủ đơn khai tại mục này còn có chủ đơn khác khai tại trang bổ sung", left)],
    ], [W]), Spacer(1, 2 * mm)]

    # 4. Đại diện chủ đơn
    s += [box([
        [P("<b>ĐẠI DIỆN CỦA CHỦ ĐƠN</b>", h)],
        [P(f"{CB1} là người đại diện theo pháp luật của chủ đơn: <b>{OWNER}</b> – {OWNER_ROLE}<br/>"
           f"{CB0} là tổ chức dịch vụ đại diện sở hữu công nghiệp được ủy quyền<br/>"
           f"{CB0} là người khác được ủy quyền", left)],
    ], [W]), Spacer(1, 2 * mm)]

    # 5. Quyền ưu tiên
    s += [box([
        [P("<b>YÊU CẦU HƯỞNG QUYỀN ƯU TIÊN</b>", h)],
        [P(f"{CB1} Không yêu cầu hưởng quyền ưu tiên &nbsp;&nbsp; {CB0} Theo đơn đầu tiên nộp tại Việt Nam &nbsp;&nbsp; "
           f"{CB0} Theo đơn nộp theo Công ước Paris &nbsp;&nbsp; {CB0} Theo thỏa thuận khác", left)],
    ], [W]), Spacer(1, 2 * mm)]

    # 6. Phí, lệ phí
    fee_rows = [[P("<b>Loại phí, lệ phí</b>", small), P("<b>Số đối tượng tính phí</b>", small), P("<b>Số tiền</b>", small), P("<b>Ghi chú</b>", small)]]
    total = 0
    for name, qty, amt, note in FEES:
        total += amt
        fee_rows.append([P(name, small), P(qty, small), P(vnd(amt), small), P(note, small)])
    fee_rows.append([P("<b>Tổng số phí, lệ phí theo biểu (chưa trừ miễn, giảm)</b>", small), "", P(f"<b>{vnd(total)}</b>", small),
                     P("Nộp qua VNeID đến 31/12/2026: miễn lệ phí nộp đơn + lệ phí cấp văn bằng → còn <b>" + vnd(total - 150000 - 220000) + "</b>", small)])
    s += [box([[P("<b>PHÍ, LỆ PHÍ</b> <i>(TT 263/2016/TT-BTC; miễn theo TT 29/2026/TT-BTC; giảm 50% theo TT 64/2025/TT-BTC)</i>", h)],
               [box(fee_rows, [W * 0.40 - 10, W * 0.22, W * 0.14, W * 0.24])],
               [P(f"Số chứng từ nộp phí, lệ phí (trường hợp nộp qua chuyển khoản / cổng thanh toán): ......................................", small)]],
              [W]), Spacer(1, 2 * mm)]

    # 7. Danh mục hàng hóa, dịch vụ
    s += [box([
        [P("<b>DANH MỤC VÀ PHÂN NHÓM HÀNG HÓA, DỊCH VỤ MANG NHÃN HIỆU</b> <i>(theo Bảng phân loại quốc tế Ni-xơ, phiên bản NCL 13-2026; chủ đơn tự phân nhóm)</i>", h)],
        [P("<b>Nhóm 42:</b> " + "; ".join(NHOM_42) + ".", left)],
        [P("<b>Nhóm 09:</b> " + "; ".join(NHOM_09) + ".", left)],
        [P(f"Tổng số nhóm: <b>02</b> &nbsp;&nbsp; Số sản phẩm/dịch vụ mỗi nhóm: <b>06</b> (không vượt 6 → không phát sinh phí mục thứ 7)", small)],
    ], [W]), Spacer(1, 2 * mm)]

    # 8. Các tài liệu có trong đơn
    s += [box([
        [P("<b>CÁC TÀI LIỆU CÓ TRONG ĐƠN</b>", h), P("<b>KIỂM TRA DANH MỤC TÀI LIỆU</b><br/><i>(Dành cho cán bộ nhận đơn)</i>", h)],
        [P(f"{CB1} Tờ khai, gồm ....... trang × 01 bản<br/>"
           f"{CB1} Mẫu nhãn hiệu, gồm 01 tệp ảnh (nộp trực tuyến) / 05 mẫu (nộp giấy), kích thước 80 × 80 mm<br/>"
           f"{CB0} Quy chế sử dụng nhãn hiệu tập thể / chứng nhận (không áp dụng)<br/>"
           f"{CB0} Văn bản ủy quyền (không áp dụng – người đại diện theo pháp luật ký)<br/>"
           f"{CB0} Tài liệu chứng minh quyền ưu tiên (không áp dụng)<br/>"
           f"{CB1} Bản sao chứng từ nộp phí, lệ phí (nếu nộp qua chuyển khoản)<br/>"
           f"{CB0} Tài liệu khác: ....................", left),
         P("<br/>".join([CB0] * 7), left)],
    ], [W * 0.72, W * 0.28]), Spacer(1, 2 * mm)]

    # 9. Cam kết + ký
    s += [box([
        [P("<b>CAM KẾT CỦA CHỦ ĐƠN</b>", h)],
        [P("Tôi cam đoan mọi thông tin trong tờ khai trên đây là trung thực, đúng sự thật và hoàn toàn chịu trách nhiệm trước pháp luật.", left)],
        [Table([[P("", left), P(f"<i>{DATE_LINE}</i><br/><b>Chữ ký, họ tên chủ đơn / đại diện của chủ đơn</b><br/><i>(ghi rõ chức vụ và đóng dấu, nếu có)</i>"
                                f"<br/><br/><br/><br/><br/><b>{OWNER}</b><br/>{OWNER_ROLE}", bold_c)]],
                colWidths=[W * 0.40, W * 0.56])],
    ], [W])]

    doc.build(s)
    return path


if __name__ == "__main__":
    p1, p2 = make_mark_images()
    p4 = make_list_txt()
    pdf = make_pdf(p1)
    for p in (pdf, p1, p2, p4):
        print("OK", p, os.path.getsize(p), "bytes")
