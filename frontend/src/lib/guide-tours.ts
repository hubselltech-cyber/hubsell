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
  // 06/09 làm lại theo hub Hàng hóa 3 tầng (anh Trung: "từ đầu phải nói về
  // nguyên lý"): 2 bước nguyên lý → 3 bước thiết lập (khối Kho trung tâm tự
  // chuyển bước giữa các ảnh) → nối tay → kết quả. Ảnh + tọa độ từ
  // scripts/capture-guide-tour-assets.js kho; lời đọc generate-guide-voice.js kho.
  steps: [
    {
      img: `${GT}/kho-guide-start.png`,
      title: "Nguyên lý: một kho trung tâm cho mọi gian",
      desc: "Mở “Quản lý Kho” → “Hàng hóa”. Khối đầu trang kể nguyên lý: kho Hubsell là trung tâm, mọi gian luôn hiện cùng một số “Có thể bán”. Shop A bán 1 đơn thì kho và Shop B, C cùng trừ 1; nhập kho thì mọi gian cùng lên.",
      target: { x: 58.89, y: 27.81, w: 75.42, h: 11.46 },
      zoom: 1.2,
    },
    {
      img: `${GT}/kho-guide-start.png`,
      title: "Đặt cùng mã SKU trên mọi shop",
      desc: "Cùng một sản phẩm bán trên nhiều shop thì đặt cùng mã SKU trên sàn — Hubsell tự khớp về một SKU kho. Khác mã thì phải nối tay và dễ nhầm.",
      target: { x: 58.89, y: 35.63, w: 75.42, h: 1.67 },
      zoom: 1.8,
    },
    {
      img: `${GT}/kho-guide-start.png`,
      title: "Bước 1: Kéo sản phẩm từ sàn về",
      desc: "Bấm “Kéo sản phẩm về” — danh mục của mọi gian đã kết nối được kéo về, kèm giá bán và tồn trên sàn. Sàn có hàng mới thì bấm lại.",
      target: { x: 27.46, y: 50.42, w: 10.33, h: 2.92 },
      zoom: 2,
    },
    {
      img: `${GT}/kho-guide-link.png`,
      title: "Bước 2: Nối về SKU kho",
      desc: "Khối tự chuyển sang bước 2 và cho biết còn bao nhiêu sản phẩm sàn chưa nối. Bấm “Tự khớp + tạo SKU”.",
      target: { x: 53.09, y: 50.42, w: 10.77, h: 2.92 },
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
      img: `${GT}/kho-sync-dialog.png`,
      title: "Bước 3: So số rồi bật đồng bộ từng gian",
      desc: "Bấm “Bật đồng bộ” → gạt công tắc của gian: Hubsell đọc tồn thật trên sàn, đặt cạnh số “Có thể bán” để bạn duyệt. Bấm “Bật & đẩy” — từ đó kho đổi số là mọi gian đổi theo, mỗi 6 giờ tự đối soát.",
      // Cả màn so số (bảng SKU + nút Bật & đẩy) — đo tay trên kho-sync-dialog.png.
      target: { x: 50, y: 38, w: 54, h: 24 },
      zoom: 1.45,
    },
    {
      img: `${GT}/kho-inventory.png`,
      title: "Xong: khối thu gọn, bảng là việc hằng ngày",
      desc: "Đã thiết lập, khối tự thu thành một dòng. Cột “Bán trên” cho biết mỗi SKU đang nối những gian nào — đơn từ gian nào về cũng trừ chung một tồn kho.",
      target: { x: 82.51, y: 33.88, w: 10.96, h: 5.05 },
      zoom: 1.7,
    },
  ],
};

// ============ TOUR 3: ĐƠN HÀNG & ĐỐI SOÁT DÒNG TIỀN ============

export const ORDERS_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/donhang",
  steps: [
    {
      img: `${GT}/dh-orders.png`,
      title: "Mở menu “Đơn hàng”",
      desc: "Đơn của mọi sàn gom về một chỗ — lọc theo sàn, gian hàng, trạng thái giao.",
      target: { x: 8.3, y: 16.77, w: 14.93, h: 4.58 },
      zoom: 1.9,
    },
    {
      img: `${GT}/dh-orders.png`,
      title: "Đơn tự chảy về — không cần làm gì",
      desc: "Hệ thống tự quét đơn mới 10 phút một lần, chạy cả khi bạn không mở phần mềm. Đơn tự trừ tồn kho khi SKU đã nối.",
      target: { x: 58.33, y: 65.1, w: 78.75, h: 52.29 },
      zoom: 1.3,
    },
    {
      img: `${GT}/dh-channels.png`,
      title: "Muốn lấy đơn NGAY: bấm “Đồng bộ đơn”",
      desc: "Sang trang Kênh bán, bấm “Đồng bộ đơn” trên gian hàng — đơn mới nhất được kéo về lập tức.",
      target: { x: 73.19, y: 28.75, w: 8.24, h: 2.92 },
      zoom: 1.95,
    },
    {
      img: `${GT}/dh-costs.png`,
      title: "Nhập giá vốn cho sản phẩm",
      desc: "Vào “Quản lý Tài chính” → “Cấu hình Giá vốn”, điền giá vốn từng sản phẩm — điều kiện để báo cáo lãi/lỗ tính đúng.",
      target: { x: 85.24, y: 50.37, w: 8.89, h: 3.75 },
      zoom: 1.8,
    },
    {
      img: `${GT}/dh-channels.png`,
      title: "Đối soát: biết từng đơn thực nhận bao nhiêu",
      desc: "Sàn trừ phí rồi mới chuyển tiền. Bấm “Đồng bộ đối soát” để lấy số liệu quyết toán — hệ thống cũng tự chạy mỗi giờ cho cả 3 sàn.",
      target: { x: 82.86, y: 28.75, w: 10, h: 2.92 },
      zoom: 1.9,
    },
    {
      img: `${GT}/dh-costs.png`,
      title: "Xem lãi/lỗ thật & tiền về ngân hàng",
      desc: "Lợi nhuận từng đơn xem ở “Lãi/Lỗ Thực Hiện”, dòng tiền về ngân hàng xem ở “Báo cáo dòng tiền” — cùng trong nhóm Quản lý Tài chính.",
      target: { x: 9.58, y: 28.85, w: 12.36, h: 7.92 },
      zoom: 1.9,
    },
  ],
};

// ============ TOUR 4: KẾT NỐI & XUẤT HÓA ĐƠN ĐIỆN TỬ ============

export const INVOICE_TOUR: GuideTour = {
  voiceDir: "/guide-assets/voice/hoadon",
  steps: [
    {
      img: `${GT}/hd-issue.png`,
      title: "Mở tab “Cấu hình kết nối”",
      desc: "Vào “Hóa đơn & Thuế” → “Kết nối & Xuất hóa đơn”, chuyển sang tab Cấu hình kết nối — việc thiết lập chỉ làm MỘT lần.",
      target: { x: 32.42, y: 33.23, w: 9.71, h: 4.38 },
      zoom: 1.9,
    },
    {
      img: `${GT}/hd-config.png`,
      title: "Điền pháp nhân & tài khoản meInvoice",
      desc: "Mã số thuế, tên hộ kinh doanh, địa chỉ — rồi tài khoản meInvoice của shop (chưa có thì bấm link Đăng ký ngay trong form).",
      target: { x: 35.47, y: 43, w: 25, h: 5 },
      zoom: 1.7,
    },
    {
      img: `${GT}/hd-config.png`,
      title: "Bấm “Test” kiểm tra kết nối",
      desc: "Kết nối OK thì hệ thống tự tải ký hiệu hóa đơn từ meInvoice về cho bạn chọn.",
      target: { x: 94.02, y: 47.19, w: 4.59, h: 2.92 },
      zoom: 2,
    },
    {
      img: `${GT}/hd-config-bottom.png`,
      title: "Chọn ký hiệu, thuế suất rồi “Lưu cấu hình”",
      desc: "Chọn ký hiệu hóa đơn vừa tải về và thuế suất GTGT mặc định, bấm Lưu — từ giờ xuất hóa đơn chỉ còn một cú tick.",
      target: { x: 23.4, y: 95.78, w: 9.02, h: 3.33 },
      zoom: 1.9,
    },
    {
      img: `${GT}/hd-issue.png`,
      title: "Tick đơn đã giao → “Xuất hóa đơn”",
      desc: "Tab Xuất hóa đơn liệt kê đơn đã giao thành công. Tick các đơn cần xuất rồi bấm nút — hóa đơn được phát hành và gửi Cơ quan Thuế qua meInvoice.",
      target: { x: 39.6, y: 37.85, w: 9.36, h: 2.92 },
      zoom: 1.9,
    },
    {
      img: `${GT}/hd-issue.png`,
      title: "Bật tự động — không phải nhớ gì nữa",
      desc: "Gạt “Tự động phát hành”: đơn giao thành công và đã đối soát tự ra hóa đơn; “Tự động điều chỉnh khi hoàn” lo nốt phần hàng trả lại.",
      target: { x: 27.26, y: 49.55, w: 14, h: 2.5 },
      zoom: 1.9,
    },
    {
      img: `${GT}/hd-history.png`,
      title: "Tra cứu & tải PDF ở “Lịch sử”",
      desc: "Trang “Lịch sử & Báo cáo thuế” lưu mọi hóa đơn đã phát hành — bấm “Tải” để lấy bản PDF đã ký, kèm mã tra cứu công khai trên meinvoice.vn.",
      target: { x: 95.98, y: 60.21, w: 4.09, h: 2.92 },
      zoom: 2,
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
      desc: "Hubsell mở sẵn hộp Kết nối gian hàng với code ủy quyền đã điền. Bấm Đổi code lấy token để gắn gian vào tài khoản. Nếu tab này chưa đăng nhập Hubsell, hãy đăng nhập rồi bấm Kết nối gian hàng → Lazada lần nữa, Lazada sẽ cho qua ngay.",
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
