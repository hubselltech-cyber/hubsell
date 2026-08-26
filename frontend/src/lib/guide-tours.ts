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
  steps: [
    {
      img: `${GT}/kho-inventory.png`,
      title: "Mở “Quản lý Kho” → “Hàng hóa”",
      desc: "Toàn bộ sản phẩm và tồn kho nằm ở đây — một kho duy nhất cho mọi gian hàng.",
      target: { x: 9.58, y: 31.98, w: 12.36, h: 3.75 },
      zoom: 1.9,
    },
    {
      img: `${GT}/kho-links.png`,
      title: "Kéo danh mục sản phẩm từ sàn về",
      desc: "Mở tab “Chờ liên kết” rồi bấm “Đồng bộ từ sàn” — sản phẩm của mọi gian đã kết nối được kéo về đây, kèm cả giá bán và tồn kho trên sàn.",
      target: { x: 49.77, y: 20.79, w: 10.13, h: 3.33 },
      zoom: 2,
    },
    {
      img: `${GT}/kho-links.png`,
      title: "Nối toàn bộ bằng MỘT cú bấm",
      desc: "Bấm “Tự khớp + tạo SKU toàn bộ”: SKU trùng mã tự nối vào kho, phần còn lại hệ thống tạo SKU kho mới rồi nối luôn — tồn kho ban đầu tự lấy theo số trên sàn.",
      target: { x: 26.67, y: 20.79, w: 15.55, h: 3.33 },
      zoom: 2,
    },
    {
      img: `${GT}/kho-bulk.png`,
      title: "Nối tay theo lô — khi muốn tự quyết",
      desc: "Tick các dòng cùng một mẫu → thanh công cụ hiện dưới đáy: chọn SKU gốc rồi bấm “Liên kết”, hoặc “Tạo SKU kho” cho hàng chưa có trong kho.",
      target: { x: 50, y: 95.83, w: 100, h: 8.33 },
      zoom: 1.5,
    },
    {
      img: `${GT}/kho-inventory.png`,
      title: "Tab Tồn kho: một nguồn số duy nhất",
      desc: "Cột “Bán trên” cho biết mỗi SKU đang nối những gian nào — đơn từ gian nào về cũng trừ chung một tồn kho. Nhập / xuất hàng ngay trên từng dòng.",
      target: { x: 46.61, y: 16.12, w: 55.44, h: 2.67 },
      zoom: 1.5,
    },
    {
      img: `${GT}/kho-sync-dialog.png`,
      title: "Bật đồng bộ tồn kho lên sàn",
      desc: "Bấm “Cài đặt” → gạt “Tự động đồng bộ”: mọi biến động kho tự đẩy tồn mới lên mọi gian. Chỉ bật khi số tồn trong Hubsell đã đúng; muốn đẩy lại một lần, bấm “Sync ngay toàn bộ”.",
      target: { x: 70.07, y: 39.43, w: 2.5, h: 2.08 },
      zoom: 2,
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
