/**
 * Sinh MP3 thuyết minh cho 3 tour động của trang Hướng dẫn sử dụng (/guide):
 * Quản lý kho (8), Đơn hàng & dòng tiền (6), Hóa đơn (7) — giọng NỮ tiếng Việt
 * vi-VN-HoaiMyNeural, cùng giọng với tour onboarding.
 * (Tour Liên kết gian hàng tái dùng public/onboarding/voice/ — không sinh ở đây.)
 *
 * Ra file public/guide-assets/voice/{kho|donhang|hoadon}/step-N.mp3.
 * LỜI THOẠI phải khớp title/desc trong lib/guide-tours.ts — sửa bước nào thì
 * sửa câu tương ứng rồi chạy lại script. File thừa (tour rút bớt bước) tự xóa.
 *
 * Cần CLI edge-tts (Python): pip install edge-tts. Cùng các gotcha đã bisect ở
 * generate-onboarding-voice.js: truyền câu qua --file UTF-8 (qua --text argv
 * bị NoAudioReceived), dịch vụ flaky nên retry 4 lượt + nghỉ giữa các call.
 *
 * Chạy: node scripts/generate-guide-voice.js [kho|donhang|hoadon|lazada|tiktok|taichinh|giutien|ads|nhansu]
 * (không truyền = sinh cả 3 tour).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "D:/Claude Code/Hubsell/frontend/public/guide-assets/voice";
const VOICE = "vi-VN-HoaiMyNeural";

const TOURS = {
  // 06/09 làm lại theo hub Hàng hóa 3 tầng: nguyên lý trước, rồi 3 bước thiết lập.
  kho: [
    "Trước khi bắt tay vào làm, hãy nắm nguyên lý. Mở Quản lý Kho, chọn Hàng hóa. Khối đầu trang kể câu chuyện: kho Hubsell là trung tâm, một SKU kho nối tới nhiều gian hàng, và mọi gian luôn hiện cùng một số Có thể bán. Shop A bán một đơn, kho và Shop B, Shop C cùng trừ một. Nhập kho, mọi gian cùng lên.",
    "Điều quan trọng nhất: cùng một sản phẩm bán trên nhiều shop thì đặt cùng mã SKU trên sàn. Trùng mã là Hubsell tự khớp về một SKU kho. Khác mã thì phải nối tay và dễ nhầm.",
    "Bước một. Bấm Kéo sản phẩm về. Danh mục của mọi gian đã kết nối được kéo về Hubsell, kèm giá bán và tồn kho trên sàn. Sau này sàn có hàng mới thì bấm lại.",
    "Bước hai. Khối thiết lập tự chuyển sang bước hai và cho biết còn bao nhiêu sản phẩm sàn chưa nối về kho. Bấm Tự khớp và tạo SKU.",
    "Hộp thoại cho chọn hai mức. Chỉ tự khớp trùng mã, nếu muốn an toàn tuyệt đối. Hoặc Tự khớp và tạo SKU còn lại: phần chưa trùng mã, Hubsell tạo SKU kho mới từ chính dữ liệu sàn rồi nối luôn, tồn ban đầu lấy theo số trên sàn.",
    "Muốn tự quyết từng dòng, mở tab Sản phẩm trên sàn. Tick các dòng thuộc cùng một mẫu, thanh công cụ hiện dưới đáy: chọn SKU gốc rồi bấm Liên kết, hoặc bấm Tạo SKU kho cho hàng chưa có trong kho.",
    "Bước ba. Nối xong, khối chuyển sang bước ba. Bấm Bật đồng bộ để mở hộp chọn gian. Bật từng gian sau khi so số.",
    "Gạt công tắc của gian hàng. Hubsell đọc tồn thật trên sàn, đặt cạnh số Có thể bán để bạn duyệt trước. Bấm Bật và đẩy. Từ đó kho đổi số là mọi gian đổi theo, và mỗi sáu giờ hệ thống tự đối soát, sửa lệch.",
    "Xong ba bước, khối thiết lập tự thu thành một dòng. Từ đây bảng Tồn kho là việc hằng ngày. Cột Bán trên cho biết mỗi SKU đang nối những gian nào, cột Có thể bán đã trừ phần đang giữ cho đơn. Mũi tên xanh và đỏ cuối dòng là nhập, xuất nhanh từng mã; dấu ba chấm mở lịch sử, ngừng kinh doanh.",
    "Nhập hàng nhiều mã một lúc thì bấm Phiếu nhiều mã. Gõ hoặc quét mã SKU rồi Enter, mỗi mã một dòng, quét trùng thì cộng dồn. Sửa số lượng nếu cần, chọn nơi nhập, ghi một lý do chung rồi bấm Nhập kho. Chuyển sang chip Xuất hàng khi làm phiếu xuất.",
    "Tab Nhật ký kho trả lời câu hỏi vì sao tồn đổi. Mỗi dòng ghi mã SKU, số thay đổi, tồn sau, vị trí, loại biến động, lý do, đơn hàng gây ra, và ai làm: thao tác tay ghi tên người, tự động ghi Hệ thống. Lọc theo loại, theo mã, theo khoảng ngày.",
    "Thuê thêm kho nhỏ, hay muốn biết hàng nằm kệ nào? Bấm Thêm vị trí chứa hàng. Tồn hiện có nằm ở Kho chính, vị trí mới bắt đầu từ không. Kệ thuộc kho, xếp thành cây Kho, Kệ, Tầng. Đơn bán trừ hàng theo thứ tự từ trên xuống. Ô Nhận hoàn không tính vào tồn bán. Có thể sinh nhiều kệ một lượt và in tem mã vạch dán lên kệ.",
    "Hàng về thường nằm ở Kho chính, dỡ ra rồi mới cất lên kệ. Mở trang Cất lên kệ: quét tem kệ để chọn nơi cất, rồi quét từng SKU, quét trùng thì cộng một. Một nút chuyển hết lên kệ, nhật ký ghi từng dòng. Tổng không đổi nên sàn không bị đẩy số.",
    "Cuối tháng kiểm kho, mở trang Kiểm kê. Chọn vị trí, bảng chỉ liệt kê những mã đang có hàng ở đó. Gõ số thực đếm, hoặc quét mã để cộng một. Bấm chip Chỉ hiện lệch để đếm lại riêng mã lệch, rồi Chốt kiểm kê. Mỗi mã lệch thành một dòng nhật ký, sàn nhận số mới. Số đang gõ dở được nhớ trong trình duyệt, lỡ tải lại trang không mất công đếm.",
  ],
  donhang: [
    "Bước một. Mở menu Đơn hàng. Đơn của mọi sàn gom về một chỗ. Lọc theo sàn, gian hàng, đơn vị vận chuyển, loại đơn; tìm theo mã đơn, tên khách, số điện thoại hoặc mã vận đơn.",
    "Bước hai. Dải tab chia đơn theo trạng thái: Chờ xử lý, Đã xử lý, Đang giao, Đã giao thành công, và Đơn hủy, Hoàn trả, kèm số đơn từng tab. Đơn mới về tức thì qua webhook, Hubsell còn tự quét mười phút một lần, chạy cả khi bạn không mở phần mềm. SKU đã nối kho thì đơn tự trừ tồn.",
    "Bước ba. Tick nhiều đơn Chờ xử lý, thanh công cụ hiện dưới đáy. Chuẩn bị hàng báo sàn sắp xếp vận chuyển, như bấm trên Seller Center, rồi in vận đơn. In phiếu in vận đơn và phiếu xuất hàng hàng loạt, cả ba sàn một lượt.",
    "Bước bốn. Muốn lấy đơn ngay, sang trang Kênh bán và bấm Đồng bộ đơn trên gian hàng. Gian mới nối được kéo sẵn ba tháng đơn gần nhất.",
    "Bước năm. Vào Quản lý Tài chính, chọn Cấu hình Giá vốn, điền giá vốn từng SKU, nhập xong bấm ra ngoài ô là tự lưu. Tab Mapping giá vốn gộp theo mã SKU mọi gian, nhập một lần áp cho tất cả. Đây là điều kiện để báo cáo lãi lỗ tính đúng.",
    "Bước sáu. Sàn trừ phí rồi mới chuyển tiền. Bấm Đồng bộ đối soát để lấy bản kê quyết toán, biết từng đơn thực nhận bao nhiêu. Hệ thống cũng tự chạy mỗi giờ cho cả ba sàn.",
    "Bước bảy. Lợi nhuận từng đơn sau phí sàn, giá vốn, quảng cáo xem ở Lãi Lỗ Thực Hiện, có tab riêng từng sàn với đúng tên phí của Shopee, TikTok, Lazada. Tiền về ngân hàng xem ở Báo cáo dòng tiền, cùng trong nhóm Quản lý Tài chính.",
    "Bước tám. Tab Đơn hủy, Hoàn trả theo dõi kiện quay đầu. Hàng về tới kho thì quét mã nhận ở Quản lý Kho, mục Đối soát đơn hoàn, cộng lại kho một chạm. Hoàn về ô Nhận hoàn thì chưa tính tồn bán cho tới khi kiểm xong.",
  ],
  hoadon: [
    "Bước một. Vào Hóa đơn và Thuế, chọn Kết nối và Xuất hóa đơn, rồi mở tab Cấu hình kết nối. Việc thiết lập chỉ làm một lần.",
    "Bước hai. Điền mã số thuế, tên hộ kinh doanh, địa chỉ theo đăng ký kinh doanh, rồi tài khoản meInvoice của chính shop. Chưa có tài khoản thì bấm link Đăng ký ngay trong form, phí hóa đơn trả cho MISA, Hubsell không thu thêm. Hóa đơn phát hành từ tài khoản của shop, Hubsell chỉ là cầu nối kỹ thuật.",
    "Bước ba. Bấm Test để kiểm tra kết nối. Kết nối thành công thì hệ thống tự tải ký hiệu hóa đơn từ meInvoice về cho bạn chọn. Hóa đơn được ký nền tự động theo chứng thư gắn với tài khoản meInvoice, không cần USB Token.",
    "Bước bốn. Chọn ký hiệu hóa đơn vừa tải về, thuế suất GTGT mặc định và đơn vị tính, rồi bấm Lưu cấu hình. Hộ kinh doanh chọn không phần trăm, doanh nghiệp chọn năm, tám hoặc mười phần trăm; chọn lệch với ký hiệu Hubsell sẽ cảnh báo. Từ giờ xuất hóa đơn chỉ còn một cú tick.",
    "Bước năm. Ở tab Xuất hóa đơn, chọn thời điểm xuất. Ngay khi giao thành công là đúng quy định, hóa đơn ra cùng ngày giao hàng. Sau khi sàn đối soát xong thì ra trễ vài ngày nhưng ít phải lập hóa đơn điều chỉnh. Gạt Tự động phát hành để không phải nhớ gì nữa, và Tự động điều chỉnh khi hoàn lo nốt phần hàng trả lại.",
    "Bước sáu. Danh sách chỉ gồm đơn đã giao thành công, chia chip Tất cả, Đã đối soát, Chờ đối soát. Nhãn Cần hóa đơn là khách có yêu cầu. Tick các đơn cần xuất rồi bấm nút, hóa đơn được phát hành và gửi Cơ quan Thuế qua meInvoice. Đơn chưa vào hàng chờ thì gõ mã đơn ở ô dưới cùng để phát hành lẻ.",
    "Bước bảy. Trang Lịch sử và Báo cáo thuế, tab Kê khai thuế, cho số liệu kỳ theo từng sàn: doanh thu tính thuế của quý bằng tiền hàng trừ giảm giá người bán trừ hoàn, số sàn đã khấu trừ nộp thay gồm GTGT và TNCN, phần chưa đối soát, hạn nộp tờ khai và ngưỡng doanh thu năm. Bấm Xuất Excel để nộp tờ khai trên eTax.",
    "Bước tám. Tab Lịch sử hóa đơn có bốn thẻ tổng kỳ và khối Đối chiếu kỳ đếm trên đơn: giao trong kỳ, đã có hóa đơn, chưa xuất, quá hạn lập, Cơ quan Thuế từ chối. Đây là danh sách việc phải xử lý trước khi kê khai.",
    "Bước chín. Nhật ký hóa đơn điện tử ghi từng tờ: số hóa đơn, trạng thái phát hành, kết quả Cơ quan Thuế, đã cấp mã, đang chờ hay từ chối, hệ thống kiểm lại mỗi mười hai giờ. Lọc Cần điều chỉnh cho đơn sàn đã chốt hoàn. Bấm Tải để lấy bản PDF đã ký, kèm mã tra cứu công khai trên meinvoice chấm vn.",
  ],
  // 14/09/2026 — tour Kết nối Lazada (app ISV, 15 bước, luồng thật đã kiểm chứng bằng Hi.Bé).
  lazada: [
    "Bước một. Trong thanh điều hướng bên trái, chọn Kênh bán, nơi quản lý mọi gian hàng của bạn.",
    "Bước hai. Bấm Kết nối gian hàng ở góc phải phía trên. Một tài khoản Hubsell nối được nhiều gian Lazada.",
    "Bước ba. Trong ô Sàn thương mại, chọn Lazada. Tên gian hàng sẽ được lấy tự động sau khi ủy quyền, không cần nhập.",
    "Bước bốn. Bấm Tiếp tục với Lazada. Hubsell mở trang ủy quyền chính chủ của Lazada ở tab mới. Bạn thao tác trên trang Lazada, Hubsell không nhìn thấy mật khẩu.",
    "Bước năm. Trang Lazada Open Platform mặc định chọn Singapore. Bấm ô Site và chọn Vietnam. Chọn sai nước sẽ đăng nhập nhầm sang Seller Center Singapore.",
    "Bước sáu. Bấm Use Seller Login. Lazada mở trang đăng nhập Seller Center Việt Nam ở tab mới.",
    "Bước bảy. Nhập số điện thoại hoặc email và mật khẩu Seller Center của shop rồi bấm Đăng nhập. Nếu trình duyệt đang đăng nhập sẵn shop khác, hãy đăng xuất trước để nối đúng gian.",
    "Bước tám. Lần đầu kết nối, Lazada đưa bạn sang trang gói dịch vụ Hubsell. Đây là quy định của Lazada cho mọi phần mềm: shop phải có gói trước khi ủy quyền. Gói Hubsell giá không đồng. Chọn phiên bản Hubsell Miễn phí và chu kỳ Nửa năm. Shop đã có gói thì Lazada bỏ qua bước này và tự quay về Hubsell.",
    "Bước chín. Bấm Sử dụng được phép, nút xanh dưới phần chu kỳ. Chưa chọn phiên bản và chu kỳ thì Lazada hiện cảnh báo vàng.",
    "Bước mười. Trang Xác nhận đơn hàng: tick Đang đồng ý và ký kết Term of use, rồi bấm Xác nhận. Đơn không đồng, không phải thanh toán gì.",
    "Bước mười một. Đặt hàng thành công. Lazada vẽ sẵn ba bước: bấm nút, bấm dùng dịch vụ, rồi đồng ý. Bấm Được phép sử dụng dịch vụ. Nút này chỉ mở trang Dịch vụ đã mua, chưa phải ủy quyền, đừng dừng ở đây.",
    "Bước mười hai. Trang Dịch vụ đã mua liệt kê gói vừa đặt kèm ngày hết hạn. Bấm Dịch vụ sử dụng trên thẻ Hubsell. Đây mới là bước ủy quyền.",
    "Bước mười ba. Hộp thoại xin phép truyền dữ liệu gian hàng sang Hubsell. Tick ô đã đọc kỹ và đồng ý, rồi bấm Đồng ý. Lazada tự mở tab mới về Hubsell.",
    "Bước mười bốn. Hubsell mở sẵn hộp Kết nối gian hàng với code ủy quyền đã điền. Bấm Đổi code lấy token để gắn gian vào tài khoản. Hubsell sẽ kéo đơn hàng và số đối soát của ba tháng gần nhất về, thường xong trong vài phút. Nếu tab này chưa đăng nhập Hubsell, hãy đăng nhập rồi bấm Kết nối gian hàng, chọn Lazada lần nữa, Lazada sẽ cho qua ngay.",
    "Bước mười lăm. Gian Lazada đã Đang hoạt động, thẻ gian hiện kỳ dịch vụ đến ngày hết gói. Đơn tự chảy về mỗi mười phút, muốn kéo ngay bấm Đồng bộ đơn. Trước khi hết kỳ nửa năm, Hubsell sẽ nhắc bạn bấm Gia hạn, cũng không đồng, rồi ủy quyền lại.",
  ],
  // 25/09/2026 — tour Kết nối TikTok Shop (app tùy chỉnh ISV, 12 bước, luồng thật 16/09 shop nhà).
  tiktok: [
    "Bước một. Trong thanh điều hướng bên trái, chọn Kênh bán, nơi quản lý mọi gian hàng của bạn trên Shopee, Lazada và TikTok Shop.",
    "Bước hai. Bấm Kết nối gian hàng ở góc phải phía trên. Một tài khoản Hubsell nối được nhiều gian TikTok Shop.",
    "Bước ba. Trong ô Sàn thương mại, chọn TikTok. Tên gian hàng sẽ được TikTok trả về sau khi ủy quyền, không cần nhập.",
    "Bước bốn. Bấm Tiếp tục với TikTok. Hubsell chuyển bạn sang trang ủy quyền chính chủ của TikTok Shop ngay trong tab này. Mọi thao tác đăng nhập diễn ra trên trang TikTok, Hubsell không nhìn thấy mật khẩu.",
    "Bước năm. Đăng nhập Trung tâm nhà bán hàng TikTok. Nhập số điện thoại và mật khẩu của tài khoản sở hữu gian hàng rồi bấm Đăng nhập. Có thể đổi sang đăng nhập bằng email, mã SMS hoặc tài khoản TikTok. Nếu trình duyệt đang đăng nhập sẵn shop, TikTok bỏ qua bước này.",
    "Bước sáu. Lưu ý quan trọng. Nếu TikTok hiện màn Chào mừng đến với Việt Nam địa điểm và nút Bắt đầu bán, tức là tài khoản đang đăng nhập không sở hữu gian hàng nào. Đừng bấm. Hãy mở cửa sổ ẩn danh, quay lại Hubsell bấm Kết nối gian hàng, rồi đăng nhập đúng tài khoản chủ shop.",
    "Bước bảy. Trang ủy quyền bước một, Cài đặt. TikTok hiện logo Hubsell, ô Cửa hàng được ủy quyền là gian của bạn, và Thời hạn cấp quyền mặc định Không giới hạn. Giữ nguyên để không phải ủy quyền lại định kỳ.",
    "Bước tám. Điền địa chỉ email của shop vào ô Địa chỉ email liên hệ. TikTok bắt buộc ô này. Số điện thoại liên hệ không bắt buộc, bỏ trống được.",
    "Bước chín. Bấm Xác nhận cài đặt, nút màu xanh ngọc ở góc phải dưới thẻ. TikTok chuyển sang bước hai.",
    "Bước mười. Bước hai, Ủy quyền. TikTok liệt kê các quyền Hubsell cần: đơn hàng, tài chính, vận chuyển, sản phẩm, trả hàng. Bấm Ủy quyền. Sau này muốn thu hồi, vào Trung tâm nhà bán hàng, mục Dịch vụ, Quản lý ủy quyền.",
    "Bước mười một. TikTok tự đưa bạn về Hubsell. Màn hình báo Kết nối thành công kèm tên gian, và nhắc Hubsell đang kéo đơn cùng số đối soát của ba tháng gần nhất về, thường xong trong vài phút. Bấm Về trang Kênh bán.",
    "Bước mười hai. Gian TikTok đã Đang hoạt động. Đơn mới về tức thì qua webhook, ngoài ra Hubsell tự quét mỗi mười phút. Muốn kéo ngay bấm Đồng bộ đơn, phí sàn lấy bằng Đồng bộ đối soát. Ủy quyền không hết hạn, chỉ khi bạn thu hồi trên TikTok mới cần bấm Kết nối lại.",
  ],
  // 25/09/2026 — 4 tour dữ liệu thật (Sunny Closet): Tài chính, Giữ tiền, Trợ lý quảng cáo Shopee, Nhân viên & gói.
  taichinh: [
    "Mở Tổng quan. Chọn Hôm nay, Hôm qua, bảy ngày hay ba mươi ngày, và lọc theo sàn. Bốn thẻ đầu trang: doanh thu, số đơn, tổng chi phí, lợi nhuận dự kiến, kèm phần trăm so với kỳ trước và đường xu hướng.",
    "Dải phễu bên dưới cho biết đơn đang nằm ở đâu: Chờ xác nhận, Đang xử lý, Đang giao, Thành công. Cạnh đó là Hoàn trả hàng và Đơn hủy. Nhìn một dòng biết hôm nay còn bao nhiêu đơn phải xử lý.",
    "Kéo xuống: nửa vòng cung chia doanh thu theo Shopee, TikTok, Lazada, kèm giá trị trung bình mỗi đơn. Biểu đồ thác nước bên phải bóc doanh thu thành giá vốn, chi phí sàn, quảng cáo, vận hành, phần còn lại là lãi ròng.",
    "Vào Quản lý Tài chính, chọn Lãi Lỗ Thực Hiện. Bốn thẻ: lợi nhuận ròng thực nhận sau đối soát, thất thu do đơn hoàn, tỷ lệ hoàn, và sàn có tỷ lệ hoàn cao nhất. Chip Lợi nhuận âm lọc ngay những đơn đang bán lỗ.",
    "Vòng tròn Bóc tách nguyên nhân thất thu chia tổng thất thu đơn hoàn thành ba khoản: giá vốn hàng chưa thu hồi, tiền sàn giữ lại, và hoàn tiền nhưng khách giữ hàng. Rê chuột vào dấu hỏi để xem cách tính từng khoản.",
    "Tab Shopee, TikTok Shop, Lazada liệt kê từng đơn với cột phí đúng tên mỗi sàn dùng: phí cố định, phí thanh toán, trợ giá vận chuyển, voucher, thuế khấu trừ. Số lấy từ bản kê đối soát thật, đơn chưa đối soát để trống chứ không ước. Bấm Xuất file Excel để lưu về máy.",
    "Báo cáo dòng tiền xếp bốn cột. Tổng giá trị sản phẩm trừ từng khoản sàn khấu trừ bằng Doanh thu. Trừ giá vốn, quảng cáo, chi phí biến đổi và cố định bằng Chi phí. Còn lại là Lợi nhuận ròng tạm tính, tách phần đã thực nhận và phần dự kiến, trừ thuế bổ sung dự phòng.",
    "Chi phí ngoài sàn ghi ở Thu chi vận hành. Bấm Thêm chi phí: nội dung, phân loại cố định hay biến đổi, nhóm chi phí như mặt bằng, nhân sự, đóng gói, gắn sàn và shop, số tiền, ngày. Khoản chi trừ thẳng vào lợi nhuận ròng trong Báo cáo dòng tiền. Không ghi thì lãi chỉ là lãi ảo.",
    "Vào Hóa đơn và Thuế, chọn Thuế bổ sung. Đặt phần trăm thuế dự phòng, cơ sở tính theo lợi nhuận hay doanh thu, kỳ tháng, quý hay năm. Hệ thống tự trích khi tính lợi nhuận ròng. Khối dưới là thuế sàn khấu trừ tại nguồn một phẩy năm phần trăm theo luật, tự động, không cần làm gì thêm.",
    "Cuối cùng, Trợ lý vận hành, mục Cảnh báo và P&L Sản phẩm. Mỗi SKU một dòng: đã bán, doanh thu thuần, giá vốn, phí sàn và ship phân bổ, trần chi quảng cáo, lợi nhuận. Chip Cần xử lý ngay gom mã đang lỗ. Chip Chưa nhập giá vốn nhắc mã chưa có số để tính.",
  ],
  giutien: [
    "Vào Quản lý Kho, chọn Đối soát đơn hoàn. Đơn sàn báo hoàn tự đổ về danh sách. Hàng về tới kho, bắn máy quét mã vận đơn vào ô, hoặc bật camera quét. Bắn xong tự tra, không cần bấm gì thêm.",
    "Quét xong cả xấp, bấm Nhập kho tất cả đơn đã nhận. Mọi kiện đã nhận được cộng lại kho một lượt. Bốn thẻ đếm: chờ về tay, đã nhận chờ nhập kho, quá mười bốn ngày chưa về, và chờ khiếu nại sàn.",
    "Dòng đỏ là kiện quá mười bốn ngày chưa về tay, đủ căn cứ khiếu nại đơn vị vận chuyển. Cột Tình trạng theo dõi tới cùng: Chờ về tay, Đã nhập kho, hoặc Chờ khiếu nại sàn khi hàng hỏng, thiếu, rồi Đã đền bù kèm số tiền sàn trả.",
    "Sang Đối soát phí ship. Trang này so phí vận chuyển sàn báo lúc tạo đơn với phí thực trừ khi quyết toán. Chênh lệch âm là tiền shop bị trừ thêm. Thẻ trên cho tổng số đơn lệch và tổng tiền cần đòi lại.",
    "Bấm Xuất file khiếu nại sàn để lấy danh sách gửi Shopee hoặc Lazada đòi tiền. Mỗi dòng có nút chuyển trạng thái: Chờ khiếu nại, Đang khiếu nại, Đã đối soát, để không quên đơn nào.",
    "Quản lý Tài chính, mục Kiểm toán phí sàn gom ba rổ tiền bị giữ: truy thu phí ship, sàn trả thiếu so với bản kê, và chờ sàn trả tiền quá hạn. Mỗi rổ một tab, mỗi đơn một dòng với số sàn báo, thực trừ, bị trừ thêm. Đổi trạng thái ngay tại cột cuối.",
    "Cuối cùng, Cấu hình tự động hóa, tab Cứu đơn giao thất bại. Shipper báo giao hỏng là Hubsell cảnh báo chủ shop và tự nhắn khách qua chat sàn theo mẫu bạn soạn, hiện áp dụng cho Shopee. Thẻ đếm đơn được cảnh báo, cứu được, mất đơn, và doanh thu giữ lại. Nhật ký ghi từng đơn đã nhắn.",
  ],
  ads: [
    "Vào Trợ lý quảng cáo, chọn Quảng cáo Shopee. Bấm Kết nối Hubsell Ads một lần để đọc số thật từ Shopee Ads. Chọn gian hàng và khoảng ngày. Năm thẻ: chi phí, GMV từ ads, ROAS, ROAS hòa vốn tính từ biên lãi thật của shop, và lãi lỗ ước tính.",
    "Trợ lý so ROAS từng chiến dịch với ROAS hòa vốn của chính sản phẩm trong chiến dịch đó, không phải một con số đoán. Dải đỏ đếm chiến dịch đề xuất tạm dừng hoặc cần duyệt. Bấm Lọc cần xử lý để xem riêng.",
    "Bảng chiến dịch: mỗi dòng có nhãn Trợ lý là Ổn, Đề xuất tạm dừng, Cần duyệt hay Thiếu dữ liệu, kèm trạng thái, ngân sách, chi phí, số đơn, chi phí mỗi đơn, GMV. ROAS tô xanh khi có lãi thật, vàng khi sát ngưỡng, đỏ khi đang lỗ dù sàn báo dương. Bấm một dòng để xem căn cứ.",
    "Tab Gợi ý chạy ads xếp hạng từng sản phẩm: Nên chạy ngay, Thử nhỏ, hay Chưa nên, kèm lý do như cầu yếu hay sắp hết hàng, và ROAS cần đạt. Có số thị trường của Shopee thì gợi ý chính xác hơn.",
    "Tab ROAS hòa vốn sản phẩm: mỗi SKU có biên lãi ba mươi ngày, ROAS hòa vốn và mục tiêu an toàn. Đặt ROAS mục tiêu trên Shopee dưới cột hòa vốn là chạy lỗ dù sàn báo dương. Mang số này đi tạo chiến dịch.",
    "Tab Cấu hình Trợ lý Tự động: bật Trợ lý cho gian, đặt sàn dữ liệu tối thiểu, và bốn quy tắc: loại thẳng, vùng vàng chờ duyệt, vọt chi trong ngày, bảo vệ công thần, đều neo theo ROAS hòa vốn. Chế độ Diễn tập chỉ ghi sổ để bạn xem Trợ lý định làm gì. Tin rồi mới bật thực thi, và ưu tiên hạ ngân sách trước, tắt sau.",
  ],
  nhansu: [
    "Mở Nhân viên, bấm Thêm nhân viên. Nhân viên đăng nhập bằng tên shop, gạch chéo, tên nhân viên, và mật khẩu bạn cấp. Không cần email.",
    "Điền tên, tên đăng nhập, mật khẩu. Chọn nhanh vai Nhân viên vận hành, Nhân viên kho hay Kế toán, hoặc tick từng mục, kể cả từng báo cáo tài chính: tick gì thấy nấy. Dưới cùng chọn gian hàng phụ trách. Nhân viên chỉ thấy đơn và hàng của gian được giao.",
    "Vào Cấu hình, chọn Gói dịch vụ: gói hiện tại, kỳ hiệu lực, thanh đơn hàng tháng này so với trần gói, số gian và nhân viên. Vượt trần đơn vẫn đồng bộ đầy đủ, chỉ khóa tính năng nâng cao sau thời gian ân hạn nếu chưa nâng gói.",
    "Mọi gói đều đủ tính năng, chỉ khác trần đơn, gian và nhân viên. Chọn kỳ một, ba, sáu hay mười hai tháng rồi bấm Đăng ký mua. Thanh toán qua cổng payOS bằng chuyển khoản QR, gói kích hoạt ngay khi tiền vào.",
    "Cấu hình chung có chế độ sáng, tối hay theo hệ thống, ba bộ màu giao diện, và đổi mật khẩu tài khoản. Mục Kiếm Tiền Cùng Hubsell ở cuối menu là link giới thiệu: bạn bè thanh toán, bạn nhận mười phần trăm vào Ví Hubsell.",
  ],
};

const ONLY = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const [tour, lines] of Object.entries(TOURS)) {
    if (ONLY && tour !== ONLY) continue;
    const dir = path.join(BASE, tour);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < lines.length; i++) {
      const dest = path.join(dir, `step-${i + 1}.mp3`);
      const txt = path.join(dir, `line-${i + 1}.txt`);
      fs.writeFileSync(txt, lines[i], "utf8");
      let ok = false;
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        const r = spawnSync(
          "python",
          ["-m", "edge_tts", "--voice", VOICE, "--file", txt, "--write-media", dest],
          { encoding: "utf8" }
        );
        ok = r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 5000;
        if (!ok) {
          console.warn(`  ${tour}/step-${i + 1} lượt ${attempt} hỏng, thử lại…`);
          await sleep(2000 * attempt);
        }
      }
      fs.rmSync(txt, { force: true });
      if (!ok) {
        console.error(`FAIL: ${tour}/step-${i + 1}.mp3 sinh hỏng sau 4 lượt`);
        process.exit(1);
      }
      const kb = Math.round(fs.statSync(dest).size / 1024);
      console.log(`${tour}/step-${i + 1}.mp3  ${kb} KB`);
      await sleep(1500);
    }
    // Tour rút bớt bước thì file step-N thừa phải đi, kẻo player đọc nhầm.
    for (const f of fs.readdirSync(dir)) {
      const m = /^step-(\d+)\.mp3$/.exec(f);
      if (m && Number(m[1]) > lines.length) fs.rmSync(path.join(dir, f), { force: true });
    }
  }
  console.log("DONE:", BASE);
})();
