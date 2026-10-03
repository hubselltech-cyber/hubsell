import type { TourStep } from "@/components/tour/guide-tour-player";

/**
 * DỮ LIỆU 4 TOUR HƯỚNG DẪN ĐỘNG — dùng bởi màn onboarding lần đầu đăng nhập
 * (tour Liên kết gian hàng) và trang Hướng dẫn sử dụng /guide (cả 4 tour).
 *
 * Ảnh + TỌA ĐỘ mục tiêu sinh từ script — UI đổi thì chạy lại script tương ứng
 * rồi dán tọa độ mới vào đây, kẻo con trỏ ảo chỉ trật chỗ:
 *  - Tour liên kết gian hàng: scripts/capture-onboarding-assets.js
 *    (+ capture-shopee-confirm.js cho màn Confirm Authorization dựng lại).
 *  - 3 tour còn lại: scripts/capture-guide-tour-assets.js.
 *
 * Giọng thuyết minh (MP3 Hoài My): scripts/generate-onboarding-voice.js (tour
 * gian hàng) và generate-guide-voice.js (3 tour kia) — LỜI THOẠI phải sửa
 * cùng lúc với title/desc ở đây rồi sinh lại file.
 */

export type GuideTour = {
  steps: TourStep[];
  /** Thư mục chứa step-N.mp3 thuyết minh. */
  voiceDir: string;
};

// ============ TOUR 1: LIÊN KẾT GIAN HÀNG (dùng chung với onboarding) ============

const OB = "/onboarding";

export const CHANNELS_TOUR: GuideTour = {
  voiceDir: `${OB}/voice`,
  steps: [
    {
      img: `${OB}/onboard-channels-empty.png`,
      title: "Mở menu “Kênh bán”",
      desc: "Trong thanh điều hướng bên trái, chọn Kênh bán — trung tâm quản lý mọi gian hàng của bạn.",
      target: { x: 8.3, y: 54.9, w: 14.93, h: 4.58 },
      zoom: 1.9,
    },
    {
      img: `${OB}/onboard-channels-empty.png`,
      title: "Bấm “Kết nối gian hàng”",
      desc: "Nút nằm ở góc phải phía trên. Một sàn có thể kết nối nhiều gian hàng khác nhau.",
      target: { x: 92.21, y: 10.83, w: 11.13, h: 3.33 },
      zoom: 2,
    },
    {
      img: `${OB}/onboard-connect-dialog.png`,
      title: "Chọn sàn muốn kết nối",
      desc: "Shopee, Lazada hay TikTok Shop — chọn sàn bạn đang bán trong ô “Sàn thương mại”.",
      target: { x: 50, y: 48.96, w: 28.89, h: 3.75 },
      zoom: 1.7,
    },
    {
      img: `${OB}/onboard-connect-dialog.png`,
      title: "Uỷ quyền chính chủ trên sàn",
      desc: "Bấm “Tiếp tục” — bạn đăng nhập ngay trên trang của sàn để cho phép Hubsell truy cập; tên gian hàng được lấy về tự động.",
      target: { x: 58.3, y: 61.88, w: 12.29, h: 3.33 },
      zoom: 1.85,
    },
    // 3 bước dưới diễn ra trên TRANG CHÍNH CHỦ của Shopee (ảnh thật trang
    // "Đăng nhập để cấp quyền"). Tọa độ theo KHUNG 3:2 sau khi ảnh dọc
    // 960x1180 được contain + căn giữa (ảnh chiếm 22.88%→77.12% bề ngang).
    {
      img: `${OB}/onboard-shopee-oauth.png`,
      title: "Chọn khu vực Việt Nam",
      desc: "Bạn được chuyển sang trang đăng nhập chính chủ của Shopee — đổi khu vực ở ô đầu tiên thành VN.",
      target: { x: 35.25, y: 37.9, w: 8.4, h: 6.9 },
      zoom: 1.6,
      fit: "contain",
      // Che chữ "SG" trong ảnh gốc bằng "VN" cho khớp lời hướng dẫn.
      typing: [{ box: { x: 33.8, y: 37.9, w: 4.8, h: 6.9 }, text: "VN" }],
    },
    {
      img: `${OB}/onboard-shopee-oauth.png`,
      title: "Đăng nhập tài khoản Shopee của shop",
      desc: "Điền tên đăng nhập và mật khẩu Shopee rồi bấm “Đăng Nhập” — bạn nhập trực tiếp trên trang Shopee, Hubsell không nhìn thấy mật khẩu.",
      target: { x: 50, y: 42.6, w: 37.9, h: 16.3 },
      zoom: 1.5,
      fit: "contain",
      typing: [
        { box: { x: 54.2, y: 37.9, w: 29.5, h: 6.9 }, text: "shop_cua_ban" },
        { box: { x: 50, y: 47.4, w: 37.9, h: 6.8 }, text: "••••••••••" },
      ],
    },
    {
      img: `${OB}/onboard-shopee-confirm.png`,
      title: "Xác nhận uỷ quyền cho Hubsell",
      desc: "Shopee liệt kê các quyền Hubsell cần (sản phẩm, đơn hàng, thanh toán, khuyến mãi) — bấm “Confirm Authorization” để hoàn tất kết nối.",
      target: { x: 24.86, y: 53.13, w: 23.33, h: 4.79 },
      zoom: 1.8,
    },
    {
      img: `${OB}/onboard-channel-connected.png`,
      title: "Đồng bộ đơn hàng",
      desc: "Kết nối xong, đơn hàng tự chảy về Hubsell. Muốn kéo ngay lập tức, bấm “Đồng bộ đơn” trên gian vừa nối.",
      target: { x: 73.19, y: 28.75, w: 8.24, h: 2.92 },
      zoom: 1.95,
    },
  ],
};

// ============ TOUR 2: QUẢN LÝ KHO & LIÊN KẾT SẢN PHẨM ============

const GT = "/guide-assets/tour";

export const WAREHOUSE_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/kho",
  // 25/09 làm lại 14 bước theo Hàng hóa 24/09: 9 bước thiết lập (nguyên lý → 3 bước
  // kho trung tâm → bảng) + phiếu nhiều mã, nhật ký kho, vị trí chứa hàng (cây
  // Kho › Kệ › Tầng), cất lên kệ, kiểm kê. Ảnh + tọa độ từ
  // scripts/capture-guide-tour-assets.js kho; lời đọc generate-guide-voice.js kho.
  steps: [
    {
      img: `${GT}/kho-guide-start.png`,
      title: "Nguyên lý: một kho trung tâm cho mọi gian",
      desc: "Mở “Quản lý Kho” → “Hàng hóa”. Khối đầu trang kể nguyên lý: kho Hubsell là trung tâm, mọi gian luôn hiện cùng một số “Có thể bán”. Shop A bán 1 đơn thì kho và Shop B, C cùng trừ 1; nhập kho thì mọi gian cùng lên.",
      target: { x: 58.89, y: 28.44, w: 75.42, h: 11.46 },
      zoom: 1.2,
    },
    {
      img: `${GT}/kho-guide-start.png`,
      title: "Đặt cùng mã SKU trên mọi shop",
      desc: "Cùng một sản phẩm bán trên nhiều shop thì đặt cùng mã SKU trên sàn — Hubsell tự khớp về một SKU kho. Khác mã thì phải nối tay và dễ nhầm.",
      target: { x: 58.89, y: 36.25, w: 75.42, h: 1.67 },
      zoom: 1.8,
    },
    {
      img: `${GT}/kho-guide-start.png`,
      title: "Bước 1: Kéo sản phẩm từ sàn về",
      desc: "Bấm “Kéo sản phẩm về” — danh mục của mọi gian đã kết nối được kéo về, kèm giá bán và tồn trên sàn. Sàn có hàng mới thì bấm lại.",
      target: { x: 27.46, y: 51.04, w: 10.33, h: 2.92 },
      zoom: 2,
    },
    {
      img: `${GT}/kho-guide-link.png`,
      title: "Bước 2: Nối về SKU kho",
      desc: "Khối tự chuyển sang bước 2 và cho biết còn bao nhiêu sản phẩm sàn chưa nối. Bấm “Tự khớp + tạo SKU”.",
      target: { x: 53.09, y: 51.04, w: 10.77, h: 2.92 },
      zoom: 2,
    },
    {
      img: `${GT}/kho-oneclick-dialog.png`,
      title: "Chọn mức nối",
      desc: "SKU sàn trùng mã tự nối vào kho. Chọn “Tự khớp + tạo SKU còn lại” để Hubsell tạo SKU kho cho phần còn lại từ chính dữ liệu sàn — tồn ban đầu lấy theo số trên sàn.",
      target: { x: 54.68, y: 60.47, w: 15.09, h: 3.33 },
      zoom: 1.9,
    },
    {
      img: `${GT}/kho-bulk.png`,
      title: "Nối tay theo lô — khi muốn tự quyết",
      desc: "Tab “Sản phẩm trên sàn”: tick các dòng cùng một mẫu → thanh công cụ hiện dưới đáy, chọn SKU gốc rồi bấm “Liên kết”, hoặc “Tạo SKU kho”.",
      target: { x: 50, y: 95.83, w: 100, h: 8.33 },
      zoom: 1.5,
    },
    {
      img: `${GT}/kho-guide-sync.png`,
      title: "Bước 3: Bật đồng bộ tồn cho từng gian",
      desc: "Nối xong, khối chuyển sang bước 3. Bấm “Bật đồng bộ” để mở hộp chọn gian — bật từng gian sau khi so số.",
      target: { x: 77.08, y: 51.04, w: 7.9, h: 2.92 },
      zoom: 2,
    },
    {
      img: `${GT}/kho-sync-dialog.png`,
      title: "So số rồi “Bật & đẩy”",
      desc: "Gạt công tắc của gian: Hubsell đọc tồn thật trên sàn, đặt cạnh số “Có thể bán” để bạn duyệt. Bấm “Bật & đẩy” — từ đó kho đổi số là mọi gian đổi theo, mỗi 6 giờ tự đối soát sửa lệch.",
      target: { x: 50, y: 38, w: 54, h: 24 },
      zoom: 1.45,
    },
    {
      img: `${GT}/kho-inventory.png`,
      title: "Xong: bảng Tồn kho là việc hằng ngày",
      desc: "Khối thiết lập tự thu thành một dòng. Cột “Bán trên” cho biết SKU đang nối những gian nào; cột “Có thể bán” trừ phần đang giữ cho đơn. Mũi tên xanh / đỏ cuối dòng là nhập, xuất nhanh từng mã; dấu ⋯ mở lịch sử, ngừng kinh doanh.",
      target: { x: 84.36, y: 39.13, w: 10.51, h: 5.13 },
      zoom: 1.7,
    },
    {
      img: `${GT}/kho-receive.png`,
      title: "Phiếu nhiều mã: nhập / xuất hàng loạt",
      desc: "Bấm “Phiếu nhiều mã”: gõ hoặc quét mã SKU rồi Enter, mỗi mã một dòng (quét trùng thì cộng dồn), sửa số lượng, chọn nơi nhập, một lý do chung rồi bấm “Nhập kho”. Chuyển chip “Xuất hàng” cho phiếu xuất.",
      target: { x: 58.89, y: 32.15, w: 77.64, h: 18.54 },
      zoom: 1.3,
    },
    {
      img: `${GT}/kho-logs.png`,
      title: "Nhật ký kho: vì sao tồn đổi",
      desc: "Tab “Nhật ký kho” ghi mọi biến động: mã SKU, số thay đổi, tồn sau, vị trí, loại (nhập, xuất, đơn hàng & sàn, điều chỉnh, chuyển vị trí), lý do, đơn gây ra và AI LÀM — tay ghi tên người, tự động ghi Hệ thống.",
      target: { x: 58.89, y: 40.57, w: 77.64, h: 40.94 },
      zoom: 1.25,
    },
    {
      img: `${GT}/kho-locations.png`,
      title: "Vị trí chứa hàng: Kho › Kệ › Tầng",
      desc: "Thuê thêm kho nhỏ hay muốn biết hàng nằm kệ nào? Bấm “Thêm vị trí chứa hàng”: tồn hiện có nằm ở “Kho chính”, vị trí mới bắt đầu từ 0. Kệ thuộc kho, xếp thành cây; đơn trừ hàng theo thứ tự từ trên xuống; ô “Nhận hoàn” không tính tồn bán. Sinh nhiều kệ một lượt, in tem mã vạch dán lên kệ.",
      target: { x: 50, y: 47.97, w: 44.44, h: 28.13 },
      zoom: 1.5,
    },
    {
      img: `${GT}/kho-putaway.png`,
      title: "Cất lên kệ: quét tem kệ, quét SKU",
      desc: "Hàng về nằm ở Kho chính, dỡ ra rồi cất lên kệ. Trang “Cất lên kệ”: quét tem kệ để chọn nơi cất, quét từng SKU (quét trùng cộng 1), một nút chuyển hết — nhật ký ghi từng dòng, tổng không đổi nên sàn không bị đẩy số.",
      target: { x: 58.89, y: 33.23, w: 77.64, h: 18.54 },
      zoom: 1.3,
    },
    {
      img: `${GT}/kho-stocktake.png`,
      title: "Kiểm kê: đếm thật, chỉ mã lệch mới ghi",
      desc: "Trang “Kiểm kê”: chọn vị trí, bảng chỉ liệt kê mã đang có hàng ở đó, gõ số thực đếm hoặc quét mã để cộng 1. Chip “Chỉ hiện lệch” để đếm lại riêng mã lệch, rồi “Chốt kiểm kê” — mỗi mã lệch một dòng nhật ký, sàn nhận số mới. Số đang gõ dở được nhớ trong trình duyệt.",
      target: { x: 58.89, y: 40, w: 77.64, h: 32.08 },
      zoom: 1.25,
    },
  ],
};

// ============ TOUR 3: ĐƠN HÀNG & ĐỐI SOÁT DÒNG TIỀN ============

export const ORDERS_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/donhang",
  // 25/09 làm lại 8 bước: thêm dải tab trạng thái, thanh xử lý hàng loạt (Chuẩn bị
  // hàng / In phiếu), tab Mapping giá vốn, tab Đơn hủy / Hoàn trả.
  steps: [
    {
      img: `${GT}/dh-orders.png`,
      title: "Mở menu “Đơn hàng”",
      desc: "Đơn của mọi sàn gom về một chỗ — lọc theo sàn, gian hàng, đơn vị vận chuyển, loại đơn; tìm theo mã đơn, tên khách, số điện thoại hoặc mã vận đơn.",
      target: { x: 8.85, y: 15.73, w: 16.04, h: 4.17 },
      zoom: 1.9,
    },
    {
      img: `${GT}/dh-orders.png`,
      title: "Đơn tự chảy về, chia theo trạng thái",
      desc: "Dải tab: Chờ xử lý → Đã xử lý → Đang giao → Đã giao thành công, và Đơn hủy / Hoàn trả, kèm số đơn từng tab. Đơn mới về tức thì qua webhook, Hubsell còn tự quét mỗi 10 phút — chạy cả khi bạn không mở phần mềm; SKU đã nối thì tự trừ tồn.",
      target: { x: 58.89, y: 14.95, w: 77.78, h: 4.9 },
      zoom: 1.5,
    },
    {
      img: `${GT}/dh-orders-bulk.png`,
      title: "Tick đơn Chờ xử lý → “Chuẩn bị hàng” & “In phiếu”",
      desc: "Tick nhiều đơn, thanh dưới đáy hiện: “Chuẩn bị hàng” báo sàn sắp xếp vận chuyển (như bấm trên Seller Center) rồi in vận đơn; “In phiếu” in vận đơn + phiếu xuất hàng hàng loạt — cả 3 sàn một lượt.",
      target: { x: 50, y: 95.83, w: 100, h: 8.33 },
      zoom: 1.5,
    },
    {
      img: `${GT}/dh-channels.png`,
      title: "Muốn lấy đơn NGAY: bấm “Đồng bộ đơn”",
      desc: "Sang trang Kênh bán, bấm “Đồng bộ đơn” trên gian hàng — đơn mới nhất được kéo về lập tức. Gian mới nối được kéo sẵn 3 tháng đơn gần nhất.",
      target: { x: 73.19, y: 28.75, w: 8.24, h: 2.92 },
      zoom: 1.95,
    },
    {
      img: `${GT}/dh-costs.png`,
      title: "Nhập giá vốn cho sản phẩm",
      desc: "Vào “Quản lý Tài chính” → “Cấu hình Giá vốn”, điền giá vốn từng SKU — nhập xong bấm ra ngoài ô là tự lưu. Tab “Mapping giá vốn” gộp theo mã SKU mọi gian để nhập một lần áp cho tất cả. Đây là điều kiện để lãi/lỗ tính đúng.",
      target: { x: 82.49, y: 54.79, w: 8.89, h: 3.75 },
      zoom: 1.8,
    },
    {
      img: `${GT}/dh-channels.png`,
      title: "Đối soát: biết từng đơn thực nhận bao nhiêu",
      desc: "Sàn trừ phí rồi mới chuyển tiền. Bấm “Đồng bộ đối soát” để lấy bản kê quyết toán — hệ thống cũng tự chạy mỗi giờ cho cả 3 sàn.",
      target: { x: 82.86, y: 28.75, w: 10, h: 2.92 },
      zoom: 1.9,
    },
    {
      img: `${GT}/dh-costs.png`,
      title: "Xem lãi/lỗ thật & tiền về ngân hàng",
      desc: "Lợi nhuận từng đơn sau phí sàn, giá vốn, quảng cáo xem ở “Lãi/Lỗ Thực Hiện” (tab riêng từng sàn, đúng tên phí của Shopee, TikTok, Lazada); tiền về ngân hàng ở “Báo cáo dòng tiền” — cùng nhóm Quản lý Tài chính.",
      target: { x: 10.14, y: 26.77, w: 13.47, h: 7.92 },
      zoom: 1.9,
    },
    {
      img: `${GT}/dh-orders.png`,
      title: "Đơn hủy / Hoàn trả",
      desc: "Tab “Đơn hủy / Hoàn trả” theo dõi kiện quay đầu. Hàng về tới kho thì quét mã nhận ở “Quản lý Kho” → “Đối soát đơn hoàn”, cộng lại kho một chạm; hoàn về ô “Nhận hoàn” thì chưa tính tồn bán cho tới khi kiểm xong.",
      target: { x: 74.71, y: 15, w: 11.83, h: 5 },
      zoom: 1.8,
    },
  ],
};

// ============ TOUR 4: KẾT NỐI & XUẤT HÓA ĐƠN ĐIỆN TỬ ============

export const INVOICE_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/hoadon",
  // 25/09 làm lại 9 bước theo module Hóa đơn 19/09: thêm thời điểm xuất (ngay khi
  // giao / sau đối soát), tab Kê khai thuế, khối Đối chiếu kỳ, trạng thái CQT.
  steps: [
    {
      img: `${GT}/hd-issue-top.png`,
      title: "Mở tab “Cấu hình kết nối”",
      desc: "Vào “Hóa đơn & Thuế” → “Kết nối & Xuất hóa đơn”, chuyển sang tab Cấu hình kết nối — việc thiết lập chỉ làm MỘT lần.",
      target: { x: 32.85, y: 16.88, w: 8.03, h: 5 },
      zoom: 1.9,
    },
    {
      img: `${GT}/hd-config.png`,
      title: "Điền pháp nhân & tài khoản meInvoice",
      desc: "Mã số thuế, tên hộ kinh doanh, địa chỉ theo đăng ký kinh doanh — rồi tài khoản meInvoice của chính shop (chưa có thì bấm link Đăng ký ngay trong form; phí hóa đơn trả cho MISA, Hubsell không thu thêm). Hóa đơn phát hành từ tài khoản của shop, Hubsell chỉ là cầu nối.",
      target: { x: 36.58, y: 40, w: 23.02, h: 2.08 },
      zoom: 1.7,
    },
    {
      img: `${GT}/hd-config.png`,
      title: "Bấm “Test” kiểm tra kết nối",
      desc: "Kết nối OK thì hệ thống tự tải ký hiệu hóa đơn từ meInvoice về cho bạn chọn. Ký nền tự động (HSM) theo chứng thư gắn tài khoản meInvoice — không cần USB Token.",
      target: { x: 94.02, y: 45.31, w: 4.59, h: 2.92 },
      zoom: 2,
    },
    {
      img: `${GT}/hd-config-bottom.png`,
      title: "Chọn ký hiệu, thuế suất rồi “Lưu cấu hình”",
      desc: "Chọn ký hiệu hóa đơn vừa tải về, thuế suất GTGT mặc định (hộ kinh doanh 0%, doanh nghiệp 5/8/10% — Hubsell cảnh báo nếu chọn lệch với ký hiệu) và đơn vị tính, bấm Lưu — từ giờ xuất hóa đơn chỉ còn một cú tick.",
      target: { x: 24.51, y: 95.78, w: 9.02, h: 3.33 },
      zoom: 1.9,
    },
    {
      img: `${GT}/hd-issue-top.png`,
      title: "Chọn thời điểm xuất & bật tự động",
      desc: "Tab Xuất hóa đơn: chọn “Ngay khi giao thành công” (đúng quy định — hóa đơn ra cùng ngày giao) hoặc “Sau khi sàn đối soát xong” (ít phải điều chỉnh hơn). Gạt “Tự động phát hành” để không phải nhớ gì nữa; “Tự động điều chỉnh khi hoàn” lo nốt phần hàng trả lại.",
      // Cả khối Tự động phát hành + thời điểm xuất + Tự động điều chỉnh (đo tay trên hd-issue-top.png).
      target: { x: 58.9, y: 57.5, w: 74.5, h: 22 },
      zoom: 1.3,
    },
    {
      img: `${GT}/hd-issue.png`,
      title: "Tick đơn đã giao → “Xuất hóa đơn”",
      desc: "Danh sách chỉ có đơn đã giao thành công, chia chip Tất cả / Đã đối soát / Chờ đối soát; nhãn “Cần HĐ” là khách có yêu cầu hóa đơn. Tick các đơn rồi bấm nút — hóa đơn phát hành và gửi Cơ quan Thuế qua meInvoice. Đơn chưa vào hàng chờ thì gõ mã đơn ở ô dưới cùng để phát hành lẻ.",
      target: { x: 40.69, y: 37.85, w: 9.36, h: 2.92 },
      zoom: 1.9,
    },
    {
      img: `${GT}/hd-declaration.png`,
      title: "Kê khai thuế: số liệu kỳ theo sàn",
      desc: "Trang “Lịch sử & Báo cáo thuế”, tab Kê khai thuế: doanh thu tính thuế của quý theo từng sàn (tiền hàng − giảm giá người bán − hoàn), số sàn đã khấu trừ nộp thay (GTGT + TNCN), phần chưa đối soát, hạn nộp tờ khai và ngưỡng doanh thu năm. Bấm Xuất Excel để nộp tờ khai trên eTax.",
      target: { x: 58.89, y: 55, w: 77.7, h: 64 },
      zoom: 1.2,
    },
    {
      img: `${GT}/hd-history.png`,
      title: "Đối chiếu kỳ: sót đơn nào chưa có hóa đơn?",
      desc: "Tab Lịch sử hóa đơn: 4 thẻ tổng kỳ (đã phát hành, giá trị ròng, GTGT đầu ra, thuế sàn trích hộ) và khối Đối chiếu kỳ đếm trên đơn: giao trong kỳ, đã có hóa đơn, chưa xuất, quá hạn lập, Cơ quan Thuế từ chối — có việc phải xử lý trước khi kê khai.",
      target: { x: 58.89, y: 53.94, w: 77.78, h: 19.43 },
      zoom: 1.35,
    },
    {
      img: `${GT}/hd-history-table.png`,
      title: "Nhật ký hóa đơn: trạng thái CQT & tải PDF",
      desc: "Mỗi tờ hóa đơn ghi số, trạng thái phát hành, kết quả Cơ quan Thuế (đã cấp mã / chờ / từ chối — Hubsell tự kiểm lại định kỳ), tổng tiền, thuế. Lọc “Cần điều chỉnh” cho đơn sàn đã chốt hoàn; bấm “Tải” lấy PDF đã ký kèm mã tra cứu công khai trên meinvoice.vn.",
      target: { x: 85.43, y: 90.74, w: 4.09, h: 2.92 },
      zoom: 1.9,
    },
  ],
};

// ============ TOUR 5: KẾT NỐI GIAN HÀNG LAZADA (app ISV — 14/09/2026) ============

/**
 * Luồng THẬT đã kiểm chứng bằng shop Hi.Bé 14/09/2026: app ISV Lazada bắt seller
 * có gói "Hubsell Miễn phí" (₫0, kỳ nửa năm) trên Service Marketplace. Shop chưa
 * có gói thì sau khi đăng nhập Lazada TỰ đưa sang trang gói → 3 bước trên
 * Marketplace → ủy quyền → Lazada mở TAB MỚI về Hubsell kèm code (không state)
 * → popup điền sẵn code → "Đổi code lấy token". Shop đã có gói: Lazada bỏ qua
 * phần gói, ủy quyền xong tự quay về Hubsell luôn.
 *
 * Ảnh + tọa độ: scripts/capture-lazada-tour-assets.js (màn Hubsell mock qua
 * Playwright; màn Lazada chụp thật từ Chrome đăng nhập Hi.Bé, khung 1440x960).
 * Giọng: scripts/generate-guide-voice.js lazada. Quay MP4: render-tour-video.js.
 */
export const LAZADA_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/lazada",
  steps: [
    {
      img: `${GT}/lz-channels.png`,
      title: "Mở menu “Kênh bán”",
      desc: "Trong thanh điều hướng bên trái, chọn Kênh bán — nơi quản lý mọi gian hàng của bạn.",
      target: { x: 8.85, y: 48.85, w: 16.04, h: 4.17 },
      zoom: 1.9,
    },
    {
      img: `${GT}/lz-channels.png`,
      title: "Bấm “Kết nối gian hàng”",
      desc: "Nút ở góc phải phía trên. Một tài khoản Hubsell nối được nhiều gian Lazada.",
      target: { x: 92.21, y: 10.83, w: 11.13, h: 3.33 },
      zoom: 2,
    },
    {
      img: `${GT}/lz-dialog.png`,
      title: "Chọn sàn “Lazada”",
      desc: "Trong ô Sàn thương mại, chọn Lazada. Tên gian hàng sẽ được lấy tự động sau khi ủy quyền, không cần nhập.",
      target: { x: 50, y: 47.29, w: 28.89, h: 3.75 },
      zoom: 1.7,
    },
    {
      img: `${GT}/lz-dialog.png`,
      title: "Bấm “Tiếp tục với Lazada”",
      desc: "Hubsell mở trang ủy quyền chính chủ của Lazada ở tab mới. Bạn thao tác trên trang Lazada, Hubsell không nhìn thấy mật khẩu.",
      target: { x: 58.39, y: 63.54, w: 12.1, h: 3.33 },
      zoom: 1.85,
    },
    {
      img: `${GT}/lz-auth.png`,
      title: "Đổi ô Site thành “Vietnam”",
      desc: "Trang Lazada Open Platform mặc định chọn Singapore — bấm ô Site và chọn Vietnam. Chọn sai nước sẽ đăng nhập nhầm Seller Center Singapore.",
      target: { x: 70.25, y: 35.9, w: 28, h: 2.9 },
      zoom: 1.7,
      typing: [{ box: { x: 70.25, y: 35.9, w: 28, h: 2.9 }, text: "Vietnam" }],
    },
    {
      img: `${GT}/lz-auth.png`,
      title: "Bấm “Use Seller Login”",
      desc: "Lazada mở trang đăng nhập Seller Center Việt Nam ở tab mới.",
      target: { x: 70.25, y: 41.1, w: 28, h: 3.9 },
      zoom: 1.7,
    },
    {
      img: `${GT}/lz-seller-login.png`,
      title: "Đăng nhập tài khoản Seller Center của shop",
      desc: "Nhập số điện thoại hoặc email và mật khẩu Seller Center rồi bấm Đăng nhập. Nếu trình duyệt đang đăng nhập sẵn shop khác, hãy đăng xuất trước để nối đúng gian.",
      target: { x: 79.86, y: 38.85, w: 29.17, h: 4.17 },
      zoom: 1.6,
      typing: [
        { box: { x: 79.86, y: 25.52, w: 29.03, h: 3.96 }, text: "0912 345 678" },
        { box: { x: 78.89, y: 31.35, w: 27.08, h: 3.96 }, text: "••••••••••" },
      ],
    },
    {
      img: `${GT}/lz-marketplace.png`,
      title: "Lazada đưa sang trang gói Hubsell Miễn phí (chỉ lần đầu)",
      desc: "Lazada yêu cầu mọi shop đăng ký gói dịch vụ trước khi ủy quyền cho phần mềm. Gói Hubsell giá 0đ — chọn phiên bản “Hubsell Miễn phí” và chu kỳ “Nửa năm”. Shop đã có gói thì Lazada bỏ qua bước này và tự quay về Hubsell.",
      target: { x: 37.5, y: 46.1, w: 10.5, h: 9 },
      zoom: 1.6,
    },
    {
      img: `${GT}/lz-marketplace.png`,
      title: "Bấm “Sử dụng được phép”",
      desc: "Nút xanh dưới phần chu kỳ — chưa chọn phiên bản và chu kỳ thì Lazada hiện cảnh báo vàng.",
      target: { x: 36, y: 56.75, w: 16.6, h: 4.2 },
      zoom: 1.7,
    },
    {
      img: `${GT}/lz-order-confirm.png`,
      title: "Tick đồng ý điều khoản rồi “Xác nhận”",
      desc: "Trang Xác nhận đơn hàng của Marketplace: tick “Đang đồng ý và ký kết Term of use” rồi bấm Xác nhận. Đơn 0đ, không phải thanh toán gì.",
      target: { x: 84.81, y: 54.58, w: 9.56, h: 4.58 },
      zoom: 1.7,
    },
    {
      img: `${GT}/lz-order-success.png`,
      title: "Đặt hàng thành công → bấm “Được phép sử dụng dịch vụ”",
      desc: "Lazada vẽ sẵn 3 bước: bấm nút này, bấm dùng dịch vụ, rồi đồng ý. Nút chỉ mở trang Dịch vụ đã mua, chưa phải ủy quyền — đừng dừng ở đây.",
      target: { x: 40.05, y: 64.6, w: 15.2, h: 4.2 },
      zoom: 1.7,
    },
    {
      img: `${GT}/lz-subscribed.png`,
      title: "Bấm “Dịch vụ sử dụng” trên thẻ Hubsell",
      desc: "Trang Dịch vụ đã mua liệt kê gói vừa đặt kèm ngày hết hạn. Bấm “Dịch vụ sử dụng” — đây mới là bước ủy quyền.",
      target: { x: 37.2, y: 54, w: 7.6, h: 3.4 },
      zoom: 1.8,
    },
    {
      img: `${GT}/lz-agree-modal.png`,
      title: "Tick “đã đọc kỹ và đồng ý” rồi “Đồng ý”",
      desc: "Hộp thoại xin phép truyền dữ liệu gian hàng sang Hubsell. Tick ô đồng ý rồi bấm Đồng ý — Lazada tự mở tab mới về Hubsell.",
      target: { x: 49.2, y: 65.5, w: 55, h: 12 },
      zoom: 1.45,
    },
    {
      img: `${GT}/lz-dialog-code.png`,
      title: "Về Hubsell: bấm “Đổi code lấy token”",
      desc: "Hubsell mở sẵn hộp Kết nối gian hàng với code ủy quyền đã điền. Bấm Đổi code lấy token để gắn gian vào tài khoản — Hubsell kéo đơn + số đối soát 3 tháng gần nhất về (vài phút). Nếu tab này chưa đăng nhập Hubsell, hãy đăng nhập rồi bấm Kết nối gian hàng → Lazada lần nữa, Lazada sẽ cho qua ngay.",
      target: { x: 58.62, y: 68.23, w: 11.65, h: 3.33 },
      zoom: 1.85,
    },
    {
      img: `${GT}/lz-connected.png`,
      title: "Gian Lazada “Đang hoạt động” — bấm “Đồng bộ đơn”",
      desc: "Thẻ gian hiện Kỳ dịch vụ đến ngày hết gói. Đơn tự chảy về mỗi 10 phút; muốn kéo ngay bấm Đồng bộ đơn. Trước khi hết kỳ nửa năm Hubsell sẽ nhắc bạn bấm Gia hạn (cũng 0đ) rồi ủy quyền lại.",
      target: { x: 73.19, y: 50.94, w: 8.24, h: 2.92 },
      zoom: 1.95,
    },
  ],
};

// ============ TOUR 6: KẾT NỐI GIAN HÀNG TIKTOK SHOP (app tùy chỉnh ISV — 25/09/2026) ============

/**
 * Luồng THẬT đã kiểm chứng bằng shop nhà 16/09/2026: Hubsell chuyển hướng (cùng tab)
 * sang services.tiktokshop.com → TikTok đưa tới trang đăng nhập Seller Center VN →
 * trang custom-authorize 2 bước (01 Cài đặt: cửa hàng, thời hạn Không giới hạn,
 * email liên hệ bắt buộc → 02 Ủy quyền) → TikTok trả về app.hubsell.tech/channels/
 * tiktok/callback (kèm state) → Hubsell đổi code lấy token, hiện "Kết nối thành công".
 * Bẫy đã gặp: trình duyệt đang đăng nhập tài khoản KHÔNG sở hữu gian hàng → TikTok
 * hiện màn "Bắt đầu bán" (đăng ký shop mới) thay vì ủy quyền.
 *
 * Ảnh: màn Hubsell mock + trang đăng nhập Seller Center (công khai) chụp bằng
 * scripts/capture-tiktok-tour-assets.js; màn "01 Cài đặt" + "Bắt đầu bán" cắt từ
 * ảnh thật anh Trung chụp 16/09 (tên shop đổi thành DarkMan); màn "02 Ủy quyền"
 * DỰNG LẠI bằng scripts/capture-tiktok-authorize-confirm.js (không chụp lại được).
 * Giọng: generate-guide-voice.js tiktok. Quay MP4: render-tour-video.js tiktok.
 */
export const TIKTOK_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/tiktok",
  steps: [
    {
      img: `${GT}/tk-channels.png`,
      title: "Mở menu “Kênh bán”",
      desc: "Trong thanh điều hướng bên trái, chọn Kênh bán — nơi quản lý mọi gian hàng của bạn trên Shopee, Lazada và TikTok Shop.",
      target: { x: 8.85, y: 48.85, w: 16.04, h: 4.17 },
      zoom: 1.9,
    },
    {
      img: `${GT}/tk-channels.png`,
      title: "Bấm “Kết nối gian hàng”",
      desc: "Nút ở góc phải phía trên. Một tài khoản Hubsell nối được nhiều gian TikTok Shop.",
      target: { x: 92.21, y: 10.83, w: 11.13, h: 3.33 },
      zoom: 2,
    },
    {
      img: `${GT}/tk-dialog.png`,
      title: "Chọn sàn “TikTok”",
      desc: "Trong ô Sàn thương mại, chọn TikTok. Tên gian hàng sẽ được TikTok trả về sau khi ủy quyền, không cần nhập.",
      target: { x: 50, y: 47.29, w: 28.89, h: 3.75 },
      zoom: 1.7,
    },
    {
      img: `${GT}/tk-dialog.png`,
      title: "Bấm “Tiếp tục với TikTok”",
      desc: "Hubsell chuyển bạn sang trang ủy quyền chính chủ của TikTok Shop ngay trong tab này. Mọi thao tác đăng nhập diễn ra trên trang TikTok — Hubsell không nhìn thấy mật khẩu.",
      target: { x: 58.54, y: 63.54, w: 11.81, h: 3.33 },
      zoom: 1.85,
    },
    {
      img: `${GT}/tk-seller-login.png`,
      title: "Đăng nhập Trung tâm nhà bán hàng TikTok",
      desc: "Nhập số điện thoại và mật khẩu của tài khoản SỞ HỮU gian hàng rồi bấm Đăng nhập. Có thể đổi sang đăng nhập bằng email, mã SMS hoặc tài khoản TikTok. Trình duyệt đang đăng nhập sẵn shop thì TikTok bỏ qua bước này.",
      target: { x: 61.11, y: 44.17, w: 26.46, h: 4.58 },
      zoom: 1.6,
      typing: [
        { box: { x: 63.97, y: 24.22, w: 20.59, h: 4.48 }, text: "912 345 678" },
        { box: { x: 59.5, y: 34.32, w: 23, h: 4.69 }, text: "••••••••••" },
      ],
    },
    {
      img: `${GT}/tk-wrong-account.png`,
      title: "Gặp màn “Bắt đầu bán”? — Sai tài khoản",
      desc: "Nếu TikTok hiện “Chào mừng đến với Việt Nam địa điểm” và nút Bắt đầu bán, tức là tài khoản đang đăng nhập KHÔNG sở hữu gian hàng nào. Đừng bấm. Mở cửa sổ ẩn danh, quay lại Hubsell bấm Kết nối gian hàng và đăng nhập đúng tài khoản chủ shop.",
      target: { x: 50, y: 68, w: 28.3, h: 5.1 },
      zoom: 1.6,
    },
    {
      img: `${GT}/tk-authorize-settings.png`,
      title: "Bước 01 Cài đặt: kiểm tra gian hàng & thời hạn",
      desc: "TikTok hiện logo Hubsell, ô “Cửa hàng được ủy quyền” là gian của bạn, và “Thời hạn cấp quyền” mặc định Không giới hạn — giữ nguyên để không phải ủy quyền lại định kỳ.",
      target: { x: 67.4, y: 46, w: 39.5, h: 14 },
      zoom: 1.6,
    },
    {
      img: `${GT}/tk-authorize-settings.png`,
      title: "Nhập email liên hệ (bắt buộc)",
      desc: "Điền địa chỉ email của shop vào ô “Địa chỉ email liên hệ” — TikTok bắt buộc. Số điện thoại liên hệ không bắt buộc, bỏ trống được.",
      target: { x: 67.4, y: 64.1, w: 39.5, h: 3.7 },
      zoom: 1.7,
      typing: [{ box: { x: 67.4, y: 64.1, w: 39.5, h: 3.7 }, text: "shopcuaban@gmail.com" }],
    },
    {
      img: `${GT}/tk-authorize-settings.png`,
      title: "Bấm “Xác nhận cài đặt”",
      desc: "Nút màu xanh ngọc ở góc phải dưới thẻ. TikTok chuyển sang bước 02.",
      target: { x: 81.7, y: 86.8, w: 11.2, h: 4.4 },
      zoom: 1.9,
    },
    {
      img: `${GT}/tk-authorize-confirm.png`,
      title: "Bước 02 Ủy quyền: bấm “Ủy quyền”",
      desc: "TikTok liệt kê các quyền Hubsell cần: đơn hàng, tài chính, vận chuyển, sản phẩm, trả hàng… Bấm Ủy quyền. Sau này muốn thu hồi, vào Trung tâm nhà bán hàng → Dịch vụ → Quản lý ủy quyền.",
      target: { x: 65.62, y: 91.35, w: 7.93, h: 4.58 },
      zoom: 1.8,
    },
    {
      img: `${GT}/tk-callback.png`,
      title: "Về Hubsell: “Kết nối thành công”",
      desc: "TikTok tự đưa bạn về Hubsell. Màn hình báo Kết nối thành công kèm tên gian, và nhắc Hubsell đang kéo đơn + số đối soát 3 tháng gần nhất về (vài phút). Bấm Về trang Kênh bán.",
      target: { x: 50, y: 63.23, w: 28.19, h: 3.33 },
      zoom: 1.7,
    },
    {
      img: `${GT}/tk-connected.png`,
      title: "Gian TikTok “Đang hoạt động” — bấm “Đồng bộ đơn”",
      desc: "Đơn mới về tức thì qua webhook, ngoài ra Hubsell tự quét mỗi 10 phút; muốn kéo ngay bấm Đồng bộ đơn, phí sàn lấy bằng Đồng bộ đối soát. Ủy quyền không hết hạn — chỉ khi bạn thu hồi trên TikTok mới cần bấm Kết nối lại.",
      target: { x: 73.19, y: 73.13, w: 8.24, h: 2.92 },
      zoom: 1.95,
    },
  ],
};

// ============ TOUR 7–10: TÀI CHÍNH · GIỮ TIỀN · TRỢ LÝ QUẢNG CÁO · NHÂN VIÊN & GÓI (25/09/2026) ============
// Ảnh chụp từ DỮ LIỆU THẬT shop demo Sunny Closet trên DB local (seed-landing-demo +
// seed-landing-tour) bằng scripts/capture-live-tour-assets.js — không mock /api.
// Giọng: generate-guide-voice.js taichinh|giutien|ads|nhansu. Quay: render-tour-video.js.

export const FINANCE_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/taichinh",
  steps: [
    {
      img: `${GT}/tc-dashboard.png`,
      title: "Tổng quan: 4 con số của ngày hôm nay",
      desc: "Mở “Tổng quan”. Chọn Hôm nay / Hôm qua / 7 ngày / 30 ngày và lọc theo sàn. Bốn thẻ: doanh thu, số đơn, tổng chi phí, lợi nhuận dự kiến — kèm % so với kỳ trước và đường xu hướng.",
      target: { x: 58.89, y: 41.18, w: 77.78, h: 16.52 },
      zoom: 1.3,
    },
    {
      img: `${GT}/tc-dashboard.png`,
      title: "Phễu đơn: đơn đang nằm ở đâu",
      desc: "Dải phễu Chờ xác nhận → Đang xử lý → Đang giao → Thành công, cạnh đó là Hoàn / Trả hàng và Đơn hủy — nhìn một dòng biết hôm nay còn bao nhiêu đơn phải xử lý.",
      target: { x: 58.89, y: 58.5, w: 77.78, h: 9 },
      zoom: 1.4,
    },
    {
      img: `${GT}/tc-dashboard-charts.png`,
      title: "Tỷ trọng kênh & bóc tách dòng tiền",
      desc: "Nửa vòng cung chia doanh thu theo Shopee / TikTok / Lazada kèm giá trị trung bình mỗi đơn. Biểu đồ thác nước bên phải bóc doanh thu thành giá vốn, chi phí sàn, quảng cáo, vận hành, còn lại là lãi ròng.",
      target: { x: 58.89, y: 25, w: 77.78, h: 42 },
      zoom: 1.25,
    },
    {
      img: `${GT}/tc-pnl.png`,
      title: "Lãi/Lỗ Thực Hiện: lãi thật sau đối soát",
      desc: "Vào “Quản lý Tài chính” → “Lãi/Lỗ Thực Hiện”. Bốn thẻ: lợi nhuận ròng thực nhận, thất thu do đơn hoàn, tỷ lệ hoàn, sàn hoàn cao nhất. Chip “Lợi nhuận âm” lọc ngay những đơn đang bán lỗ.",
      target: { x: 58.89, y: 36.28, w: 77.78, h: 15.89 },
      zoom: 1.3,
    },
    {
      img: `${GT}/tc-pnl.png`,
      title: "Bóc tách nguyên nhân thất thu",
      desc: "Vòng tròn bên phải chia tổng thất thu đơn hoàn thành 3 khoản: giá vốn hàng chưa thu hồi, tiền sàn giữ lại, hoàn tiền khách giữ hàng — rê chuột vào dấu hỏi để xem cách tính.",
      target: { x: 81.9, y: 69, w: 31.62, h: 44 },
      zoom: 1.35,
    },
    {
      img: `${GT}/tc-pnl-shopee.png`,
      title: "Tab từng sàn: phí đúng tên sàn gọi",
      desc: "Tab Shopee / TikTok Shop / Lazada liệt kê từng đơn với cột phí đúng tên mỗi sàn dùng (phí cố định, phí thanh toán, trợ giá vận chuyển, voucher, thuế khấu trừ…). Số lấy từ bản kê đối soát thật, đơn chưa đối soát để trống. Bấm Xuất file Excel để lưu.",
      target: { x: 58.89, y: 55, w: 77.78, h: 80 },
      zoom: 1.2,
    },
    {
      img: `${GT}/tc-cashflow.png`,
      title: "Báo cáo dòng tiền: từ giá trị sản phẩm tới lãi ròng",
      desc: "“Báo cáo dòng tiền” xếp 4 cột: Tổng giá trị sản phẩm trừ từng khoản sàn khấu trừ = Doanh thu; trừ giá vốn, quảng cáo, chi phí biến đổi, cố định = Chi phí; còn lại Lợi nhuận ròng tạm tính, tách phần đã thực nhận và phần dự kiến, trừ thuế bổ sung dự phòng.",
      target: { x: 58.89, y: 50.39, w: 77.78, h: 69.95 },
      zoom: 1.15,
    },
    {
      img: `${GT}/tc-expense-dialog.png`,
      title: "Thu chi vận hành: ghi chi phí ngoài sàn",
      desc: "“Thu chi vận hành” → “Thêm chi phí”: nội dung, phân loại cố định / biến đổi, nhóm chi phí (mặt bằng, nhân sự, đóng gói…), gắn sàn / shop, số tiền, ngày. Khoản chi trừ thẳng vào lợi nhuận ròng trong Báo cáo dòng tiền — không ghi thì lãi ảo.",
      target: { x: 50, y: 50, w: 31.11, h: 58.96 },
      zoom: 1.4,
    },
    {
      img: `${GT}/tc-tax.png`,
      title: "Thuế bổ sung: dự phòng đúng nghĩa vụ",
      desc: "“Hóa đơn & Thuế” → “Thuế bổ sung”: đặt % thuế dự phòng, cơ sở tính theo lợi nhuận hay doanh thu, kỳ tháng / quý / năm — hệ thống tự trích khi tính lợi nhuận ròng. Khối dưới là thuế sàn khấu trừ tại nguồn 1,5% (GTGT 1% + TNCN 0,5%) theo luật, tự động, không cần làm gì.",
      target: { x: 43.33, y: 44, w: 46.53, h: 50 },
      zoom: 1.3,
    },
    {
      img: `${GT}/tc-sku-pnl.png`,
      title: "P&L theo sản phẩm: mã nào đang gánh lỗ",
      desc: "“Trợ lý vận hành” → “Cảnh báo & P&L Sản phẩm”: mỗi SKU một dòng — đã bán, doanh thu thuần, giá vốn, phí sàn & ship phân bổ, trần chi quảng cáo, lợi nhuận. Chip “Cần xử lý ngay” gom mã lỗ; “Chưa nhập giá vốn” nhắc mã chưa có số để tính.",
      target: { x: 58.89, y: 55, w: 77.78, h: 60 },
      zoom: 1.25,
    },
  ],
};

export const MONEY_GUARD_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/giutien",
  steps: [
    {
      img: `${GT}/gt-returns.png`,
      title: "Đối soát đơn hoàn: quét mã nhận hàng về",
      desc: "“Quản lý Kho” → “Đối soát đơn hoàn”. Đơn sàn báo hoàn tự đổ về danh sách. Hàng về tới kho: bắn máy quét mã vận đơn vào ô (hoặc bật camera) — bắn xong tự tra, không cần bấm gì.",
      target: { x: 58.89, y: 27, w: 77.78, h: 14 },
      zoom: 1.4,
    },
    {
      img: `${GT}/gt-returns.png`,
      title: "Bấm “Nhập kho tất cả” — cộng tồn một lượt",
      desc: "Quét xong cả xấp, bấm “Nhập kho tất cả đơn đã nhận”: mọi kiện đã nhận cộng lại kho một lượt. Bốn thẻ đếm: chờ về tay, đã nhận chờ nhập kho, quá 14 ngày chưa về, chờ khiếu nại sàn.",
      target: { x: 58.89, y: 47, w: 77.78, h: 26 },
      zoom: 1.3,
    },
    {
      img: `${GT}/gt-returns-table.png`,
      title: "Kiện quá hạn: căn cứ khiếu nại bưu cục",
      desc: "Dòng đỏ là kiện quá 14 ngày chưa về tay — đủ căn cứ khiếu nại đơn vị vận chuyển. Cột Tình trạng theo dõi tới cùng: Chờ về tay → Đã nhập kho, hoặc Chờ khiếu nại sàn khi hàng hỏng / thiếu → Đã đền bù kèm số tiền sàn trả.",
      target: { x: 58.89, y: 48, w: 77.78, h: 86 },
      zoom: 1.2,
    },
    {
      img: `${GT}/gt-shipping.png`,
      title: "Đối soát phí ship: sàn trừ cao hơn báo",
      desc: "“Đối soát phí ship” so phí vận chuyển sàn báo lúc tạo đơn với phí thực trừ khi quyết toán — chênh lệch âm là tiền shop bị trừ thêm. Thẻ trên tổng số đơn lệch và tổng tiền cần đòi lại.",
      target: { x: 58.89, y: 23, w: 77.78, h: 16.31 },
      zoom: 1.3,
    },
    {
      img: `${GT}/gt-shipping.png`,
      title: "Xuất file khiếu nại, theo dõi trạng thái",
      desc: "Bấm “Xuất file khiếu nại sàn” để lấy danh sách gửi Shopee / Lazada đòi tiền. Mỗi dòng có nút chuyển trạng thái Chờ khiếu nại → Đang khiếu nại → Đã đối soát để không quên đơn nào.",
      target: { x: 91.15, y: 10.83, w: 13.25, h: 3.33 },
      zoom: 1.9,
    },
    {
      img: `${GT}/gt-fee-audit.png`,
      title: "Kiểm toán phí sàn: 3 rổ tiền bị giữ",
      desc: "“Quản lý Tài chính” → “Kiểm toán phí sàn” gom 3 rổ: truy thu phí ship, sàn trả thiếu so với bản kê, chờ sàn trả tiền quá hạn — mỗi rổ một tab, mỗi đơn một dòng với số sàn báo, thực trừ, bị trừ thêm. Đổi trạng thái ngay tại cột cuối.",
      target: { x: 58.89, y: 17.32, w: 77.78, h: 16.31 },
      zoom: 1.3,
    },
    {
      img: `${GT}/gt-rescue.png`,
      title: "Cứu đơn giao thất bại: nhắn khách trước khi kiện quay đầu",
      desc: "“Cấu hình tự động hóa” → tab “Cứu đơn giao thất bại”: shipper báo giao hỏng là Hubsell cảnh báo chủ shop và tự nhắn khách qua chat sàn theo mẫu bạn soạn (Shopee). Thẻ đếm đơn được cảnh báo, cứu được, mất đơn, doanh thu giữ lại; nhật ký ghi từng đơn đã nhắn.",
      target: { x: 58.89, y: 45, w: 77.78, h: 60 },
      zoom: 1.2,
    },
  ],
};

export const ADS_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/ads",
  steps: [
    {
      img: `${GT}/ad-overview.png`,
      title: "Trợ lý quảng cáo Shopee: số thật + ROAS hòa vốn",
      desc: "“Trợ lý quảng cáo” → “Quảng cáo Shopee”. Bấm “Kết nối Hubsell Ads” một lần để đọc số từ Shopee Ads. Chọn gian, khoảng ngày. Năm thẻ: chi phí, GMV từ ads, ROAS, ROAS hòa vốn tính từ biên lãi thật của shop, và lãi/lỗ ước tính.",
      target: { x: 58.89, y: 53, w: 77.78, h: 34 },
      zoom: 1.25,
    },
    {
      img: `${GT}/ad-overview.png`,
      title: "Dải đỏ: chiến dịch cần xử lý",
      desc: "Trợ lý so ROAS từng chiến dịch với ROAS hòa vốn của chính sản phẩm trong chiến dịch đó — không phải một con số đoán. Dải đỏ đếm chiến dịch đề xuất tạm dừng hoặc cần duyệt; bấm “Lọc cần xử lý”.",
      target: { x: 58.89, y: 30.42, w: 77.78, h: 7.5 },
      zoom: 1.5,
    },
    {
      img: `${GT}/ad-campaigns.png`,
      title: "Bảng chiến dịch: màu theo lãi thật",
      desc: "Mỗi chiến dịch: nhãn Trợ lý (Ổn / Đề xuất tạm dừng / Cần duyệt / Thiếu dữ liệu), trạng thái, ngân sách, chi phí, đơn, chi phí mỗi đơn, GMV. ROAS tô xanh khi có lãi thật, vàng sát ngưỡng, đỏ đang lỗ dù sàn báo dương. Bấm một dòng xem căn cứ.",
      target: { x: 58.89, y: 55, w: 77.78, h: 75 },
      zoom: 1.2,
    },
    {
      img: `${GT}/ad-suggest.png`,
      title: "Gợi ý chạy ads: nên chạy sản phẩm nào",
      desc: "Tab “Gợi ý chạy ads” xếp hạng từng sản phẩm: Nên chạy ngay / Thử nhỏ / Chưa nên, kèm lý do (cầu yếu, sắp hết hàng…) và ROAS cần đạt. Có số thị trường của Shopee thì gợi ý chính xác hơn.",
      target: { x: 58.89, y: 60, w: 77.78, h: 70 },
      zoom: 1.2,
    },
    {
      img: `${GT}/ad-breakeven.png`,
      title: "ROAS hòa vốn sản phẩm: đặt mục tiêu TRƯỚC khi tạo",
      desc: "Tab “ROAS hòa vốn sản phẩm”: mỗi SKU có biên lãi 30 ngày, ROAS hòa vốn và mục tiêu an toàn. Đặt ROAS mục tiêu trên Shopee dưới cột hòa vốn là chạy lỗ dù sàn báo dương — mang số này đi tạo chiến dịch.",
      target: { x: 58.89, y: 62, w: 77.78, h: 66 },
      zoom: 1.2,
    },
    {
      img: `${GT}/ad-config.png`,
      title: "Cấu hình Trợ lý: luật riêng, diễn tập trước",
      desc: "Tab “Cấu hình Trợ lý Tự động”: bật Trợ lý cho gian, sàn dữ liệu tối thiểu, 4 quy tắc (loại thẳng, vùng vàng chờ duyệt, vọt chi trong ngày, bảo vệ công thần) đều neo theo ROAS hòa vốn. Chế độ Diễn tập chỉ ghi sổ để bạn xem Trợ lý định làm gì; tin rồi mới bật thực thi, và ưu tiên hạ ngân sách trước, tắt sau.",
      target: { x: 58.89, y: 66, w: 77.78, h: 60 },
      zoom: 1.2,
    },
  ],
};

export const STAFF_PLAN_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/nhansu",
  steps: [
    {
      img: `${GT}/ns-staff.png`,
      title: "Nhân viên: tạo tài khoản không cần email",
      desc: "Mở “Nhân viên” → “Thêm nhân viên”. Nhân viên đăng nhập bằng tên-shop/tên-nhân-viên và mật khẩu bạn cấp, không cần email.",
      target: { x: 92.53, y: 10.83, w: 10.49, h: 3.33 },
      zoom: 2,
    },
    {
      img: `${GT}/ns-staff-dialog.png`,
      title: "Tick tính năng, tick gian hàng",
      desc: "Điền tên, tên đăng nhập, mật khẩu. “Chọn nhanh” Nhân viên vận hành / Nhân viên kho / Kế toán, hoặc tick từng mục — kể cả từng báo cáo tài chính: tick gì thấy nấy. Dưới cùng chọn gian hàng phụ trách; nhân viên chỉ thấy đơn, hàng của gian được giao.",
      target: { x: 50, y: 50, w: 35.56, h: 90 },
      zoom: 1.2,
    },
    {
      img: `${GT}/ns-plan.png`,
      title: "Gói dịch vụ: đang dùng bao nhiêu so với trần",
      desc: "“Cấu hình” → “Gói dịch vụ”: gói hiện tại, kỳ hiệu lực, thanh đơn hàng tháng này so với trần gói, số gian và nhân viên. Vượt trần đơn vẫn đồng bộ đầy đủ — chỉ khóa tính năng nâng cao sau thời gian ân hạn nếu chưa nâng gói.",
      target: { x: 58.89, y: 28.91, w: 77.78, h: 22.19 },
      zoom: 1.3,
    },
    {
      img: `${GT}/ns-plan-cards.png`,
      title: "Chọn gói & thanh toán",
      desc: "Mọi gói đều đủ tính năng, chỉ khác trần đơn / gian / nhân viên. Chọn kỳ 1 / 3 / 6 / 12 tháng rồi bấm Đăng ký mua — thanh toán qua cổng payOS (chuyển khoản QR), gói kích hoạt ngay khi tiền vào.",
      target: { x: 32.59, y: 86.2, w: 25.18, h: 27 },
      zoom: 1.4,
    },
    {
      img: `${GT}/ns-general.png`,
      title: "Cấu hình chung: giao diện & mật khẩu",
      desc: "“Cấu hình chung”: chế độ sáng / tối / theo hệ thống, ba bộ màu giao diện, đổi mật khẩu tài khoản. Mục “Kiếm Tiền Cùng Hubsell” ở cuối menu là link giới thiệu — bạn bè thanh toán, bạn nhận 10% vào Ví Hubsell.",
      target: { x: 43.33, y: 40, w: 46.53, h: 42 },
      zoom: 1.3,
    },
  ],
};
