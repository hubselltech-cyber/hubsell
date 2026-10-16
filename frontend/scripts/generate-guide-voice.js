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
 * Chạy: node scripts/generate-guide-voice.js [kho|donhang|hoadon|lazada|tiktok|taichinh|giutien|ads|tiktokads|nhansu] [số bước]
 * (không truyền = sinh mọi tour; thêm số bước = chỉ sinh lại một câu). Tour `ads` / `tiktokads` đọc bằng GenMax (xem GENMAX bên dưới).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "D:/Claude Code/Hubsell/frontend/public/guide-assets/voice";
const VOICE = "vi-VN-HoaiMyNeural";

/**
 * 16/10/2026: tour nào có trong GENMAX thì đọc bằng GenMax (genmax.io — tài khoản
 * anh Trung, khóa ở C:\Users\trung\.genmax-key, KHÔNG đưa vào repo) thay edge-tts.
 * Giọng "Ngọc Huyền - VBee" là giọng CỘNG ĐỒNG (clone MiniMax người khác chia sẻ,
 * GET /v1/community/voices → voice_id UUID), gọi như giọng clone của mình:
 * POST /v1/text-to-speech/{voice_id} provider=minimax model speech-02-hd
 * language_code "Vietnamese" → GET /v1/history/{id} tới completed → tải audio_url.
 * Giá ~1 credit/ký tự (tour ads 15 câu ≈ 5.000 credit).
 */
const GENMAX = {
  ads: { voice: "19725c22-f795-4fa1-bfc5-88c5a82f9440", model: "speech-02-hd", speed: 1.0 },
  tiktokads: { voice: "19725c22-f795-4fa1-bfc5-88c5a82f9440", model: "speech-02-hd", speed: 1.0 },
};
const GENMAX_KEY_FILE = path.join(process.env.USERPROFILE || "C:/Users/trung", ".genmax-key");
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function genmaxTts(text, dest, cfg) {
  const key = fs.readFileSync(GENMAX_KEY_FILE, "utf8").trim();
  const H = { "xi-api-key": key, "content-type": "application/json" };
  const sub = await fetch(`https://api.genmax.io/v1/text-to-speech/${cfg.voice}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      text,
      provider: "minimax",
      model_id: cfg.model,
      language_code: "Vietnamese",
      voice_settings: { speed: cfg.speed, pitch: 0, vol: 1 },
    }),
  }).then((r) => r.json());
  if (!sub.id) throw new Error("GenMax không nhận việc: " + JSON.stringify(sub));
  for (let i = 0; i < 90; i++) {
    await sleepMs(2000);
    const h = await fetch(`https://api.genmax.io/v1/history/${sub.id}`, { headers: H }).then((r) => r.json());
    if (h.status === "completed") {
      const buf = Buffer.from(await fetch(h.result.audio_url).then((r) => r.arrayBuffer()));
      fs.writeFileSync(dest, buf);
      return h.credits_deducted;
    }
    if (h.status === "failed") throw new Error("GenMax lỗi: " + h.error);
  }
  throw new Error("GenMax quá 3 phút chưa xong: " + sub.id);
}

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
  // 16/10/2026 làm lại 15 bước (xem ADS_TOUR trong lib/guide-tours.ts) — giọng GenMax
  // MiniMax "Ngọc Huyền - VBee" (GENMAX bên dưới), số lẻ viết bằng chữ để đọc đúng.
  ads: [
    "Vào Trợ lý quảng cáo, chọn Quảng cáo Shopee. Góc phải chọn gian hàng và khoảng ngày muốn xem. Lần đầu, bấm Kết nối Hubsell Ads: Shopee tách quyền quảng cáo sang một ứng dụng riêng, nên mỗi gian liên kết thêm một lần, đăng nhập đúng tài khoản Shopee của gian rồi bấm Đồng ý. Nút Làm mới kéo số mới nhất từ sàn, ngoài ra Hubsell tự kéo mỗi ba mươi phút.",
    "Năm thẻ số: chi phí quảng cáo, GMV từ quảng cáo, ROAS, ROAS hòa vốn, và lãi lỗ ước tính. ROAS hòa vốn tính từ biên lãi ròng thật của shop, lấy giá vốn và phí sàn từ đơn đã đối soát ba mươi ngày gần nhất. ROAS dưới số này là đang chạy lỗ, dù sàn báo dương. Lãi lỗ ước tính bằng GMV từ quảng cáo nhân biên lãi, trừ chi phí.",
    "Trợ lý so ROAS từng chiến dịch với ROAS hòa vốn của chính sản phẩm trong chiến dịch đó, không phải một con số đoán. Dải đỏ đếm số chiến dịch đề xuất tạm dừng hoặc cần duyệt. Bấm Lọc cần xử lý để bảng chỉ còn những dòng này. Chuông thông báo ở góc phải cũng báo mỗi khi Trợ lý có đề xuất mới.",
    "Bảng chiến dịch. Cột Trợ lý gắn nhãn từng dòng: Ổn, Cần duyệt, Đề xuất tạm dừng, hay Thiếu dữ liệu. Chiến dịch đang lãi nhưng bị chặn phân phối có nhãn xanh Ngân sách đang chặn, hoặc Mục tiêu đang bó. Máy đã tắt thì ghi Hubsell tạm dừng. Tiếp theo là trạng thái, ngân sách, chi phí, số đơn, chi phí mỗi đơn, GMV, ROAS tô màu theo hòa vốn, cột Mục tiêu tô đỏ khi đặt thấp hơn hòa vốn, và lãi lỗ ước tính. Bấm một dòng để xem căn cứ.",
    "Hộp chi tiết. Phần Căn cứ nói rõ cửa sổ ngày đang xét, ROAS so với ngưỡng, và số tiền đã tiêu. Mục tiêu ROAS trên sàn đặt thấp hơn hòa vốn thì có hộp cảnh báo kèm nút Nâng lên mức an toàn, gửi thẳng lên Shopee. Đang lãi mà bị ngân sách hoặc mục tiêu chặn thì Trợ lý gợi ý tăng ngân sách, hay hạ mục tiêu từng nấc. Phần Từ khóa cho xem từ khóa đang đặt và hỏi từ khóa Shopee gợi ý. Dưới cùng là các nút: Mở Seller Center, Tạm dừng ngay trong Hubsell, Đã xử lý trên Seller Center, Theo dõi thêm, hoặc Bỏ qua cảnh báo.",
    "Tab Gợi ý chạy ads xếp hạng từng sản phẩm: Nên chạy ngay, Thử nhỏ, hay Chưa nên, kèm lý do và ROAS cần đạt. Bấm một dòng để xem căn cứ và tạo chiến dịch với mục tiêu, ngân sách đã tính sẵn. Có số thị trường của Shopee thì gợi ý chính xác hơn, bấm Lấy số của sàn.",
    "Tab ROAS hòa vốn sản phẩm: mỗi mã hàng có biên lãi ba mươi ngày, ROAS hòa vốn, mục tiêu an toàn, và mức đang đặt trên sàn. Đặt ROAS mục tiêu trên Shopee dưới cột hòa vốn là chạy lỗ dù sàn báo dương. Mang số Mục tiêu an toàn đi tạo chiến dịch.",
    "Tab Cấu hình Trợ lý Tự động là luật riêng của gian đang chọn. Trên cùng là công tắc Bật Trợ lý cho gian này: tắt đi thì cột Trợ lý và mọi cảnh báo biến mất, số liệu vẫn đồng bộ bình thường. Khối Sàn dữ liệu: chiến dịch chưa tiêu đủ một trăm nghìn đồng, hoặc chưa đủ năm mươi lượt click trong bảy ngày, thì Trợ lý chưa phán xét. Cửa sổ ngắn hơn, ngưỡng tự hạ theo.",
    "Khối Tự thực thi có ba chế độ. Tắt: Trợ lý chỉ gắn nhãn và cảnh báo. Diễn tập: máy ghi vào Sổ hành động những gì nó định làm, nhưng không đụng lên sàn, nên chạy vài tuần để kiểm. Thực thi thật: máy tự tạm dừng chiến dịch dính Đề xuất tạm dừng hoặc Vọt chi. Chiến dịch bạn đã bấm Bỏ qua hay Theo dõi thì không bị đụng, và ROAS đạt lại thì máy tự bật. Công tắc Hạ ngân sách trước, tắt sau: lần đầu máy chỉ hạ ngân sách ngày để giữ chiến dịch sống, hôm sau vẫn lỗ mới tạm dừng, hết lỗ thì trả lại ngân sách cũ.",
    "Quy tắc một, Loại thẳng. Chiến dịch tiêu quá mức cho phép thử, mặc định một trăm năm mươi nghìn đồng, mà không có đơn, hoặc ROAS tụt dưới hòa vốn nhân hệ số nguy hiểm, mặc định không phẩy chín lăm, thì Trợ lý đề xuất tạm dừng ngay. Đơn từ quảng cáo về trễ vài giờ, nên trong ngày máy chỉ kết luận khi đã tiêu đủ mức này. Shop ngân sách lớn nên nâng mức tiêu lên cho phù hợp.",
    "Quy tắc hai, Vùng vàng chờ duyệt. ROAS đã trên hòa vốn nhưng chưa vượt hòa vốn nhân vùng an toàn, mặc định một phẩy một, thì gắn nhãn vàng Cần duyệt: lãi còn mỏng, cần người quyết, máy không tự tắt. Đây cũng là mức máy đòi hỏi trước khi tự bật lại chiến dịch nó đã dừng.",
    "Quy tắc ba, Vọt chi trong ngày. Hôm nay tiêu gấp đôi trung bình ngày, và đã quá một trăm nghìn đồng, mà ROAS dưới hòa vốn, thì báo ngay, không chờ đủ mẫu. Hai con số này sửa được. Ở chế độ Thực thi thật, vọt chi bị tắt ngay, không qua bước hạ ngân sách.",
    "Quy tắc bốn, Bảo vệ công thần. Chiến dịch có từ ba mươi đơn trong bảy ngày mà vi phạm quy tắc một hoặc hai, chỉ bị hạ xuống theo dõi sát, không đề xuất cắt ngay. Để không tắt nhầm chiến dịch chủ lực chỉ vì một ngày xấu.",
    "Khối Hạ mục tiêu ROAS. Chiến dịch đang lãi mà tiêu ít vì mục tiêu ROAS trên sàn đặt cao, Trợ lý gợi ý hạ mục tiêu từng nấc mười phần trăm, mỗi nấc cách nhau bốn mươi tám giờ để sàn học lại. Ô Lãi tối thiểu sau quảng cáo, mặc định năm đồng trên mỗi trăm đồng doanh thu, là mức sàn: không gợi ý hạ xuống dưới mức còn giữ được số lãi này. Sửa xong, bấm Lưu cấu hình.",
    "Cuối trang là Sổ hành động và bảng điểm Trợ lý. Mọi lần máy định làm khi diễn tập, hay đã làm thật, như tạm dừng, hạ ngân sách, bật lại, đều ghi ở đây kèm căn cứ lúc đó, và kết luận nhìn từ những ngày sau: vẫn lỗ là máy đúng, ROAS đạt lại là máy sai. Thao tác tắt bật trên Seller Center cũng được ghi là Tắt trên sàn, Bật trên sàn. Mỗi tối tám giờ, một chuông tổng kết số lần dừng, bật lại, và diễn tập trong ngày. Xem bảng điểm vài tuần, tin rồi hãy bật Thực thi thật.",
  ],
  // 16/10/2026 — tour Trợ lý quảng cáo TikTok (14 bước, TIKTOK_ADS_TOUR) — giọng GenMax Ngọc Huyền.
  tiktokads: [
    "Vào Trợ lý quảng cáo, chọn Quảng cáo TikTok, mở tab Kết nối tài khoản quảng cáo. Mỗi gian TikTok Shop là một dòng. Bấm Kết nối, đăng nhập tài khoản TikTok for Business đang chạy GMV Max cho gian đó. Hubsell tự nhận tài khoản quảng cáo của gian, chỉ đọc số, không sửa chiến dịch. Nếu người khác giữ tài khoản quảng cáo, bấm Sao chép link gửi họ. Kết nối không hết hạn, chỉ khi thu hồi trên TikTok mới cần bấm Kết nối lại.",
    "Tab Tổng quan chiến dịch. Chọn gian và khoảng ngày ở góc phải, bấm Làm mới để kéo số mới nhất; Hubsell cũng tự kéo mỗi giờ. Năm thẻ số: chi phí quảng cáo, doanh thu GMV Max, gồm cả đơn tự nhiên của sản phẩm trong chiến dịch theo cách TikTok tính, ROI, đơn hàng kèm chi phí mỗi đơn, và lãi lỗ ước tính bằng doanh thu nhân biên lãi trước quảng cáo, trừ chi phí.",
    "Ngay trên bảng là ô Lãi tối thiểu giữ lại sau quảng cáo, tính bằng đồng trên mỗi trăm đồng doanh thu. Đây là cấu hình chung của gian: Trợ lý gợi ý hạ ROI mục tiêu từng nấc mười phần trăm, và dừng ở mức còn giữ được số lãi này. Đặt không là hạ được tới hòa vốn. Bảng chiến dịch GMV Max lọc theo Đang chạy, Tạm dừng, Đã dừng. Cột Tự động cho biết chiến dịch đang Tắt, Diễn tập, hay Tự loại thật.",
    "Cuộn bảng sang phải. ROI mục tiêu đang đặt trên TikTok. Hòa vốn, bấm số gạch chân để xem căn cứ: một chia biên lãi trước quảng cáo, chỉ tính đơn đã đối soát sáu mươi ngày. ROI thực tô đỏ khi thấp hơn mục tiêu hoặc hòa vốn. Rồi lãi lỗ ước tính, và cột Nhận định: Đang lãi, Quảng cáo đang lỗ, Mục tiêu đang ghìm phân phối, Giữ mục tiêu, Ngân sách đang chặn, hay TikTok không phân phối.",
    "Bấm vào nhận định để xem Căn cứ: ROI thực so với hòa vốn, lãi hay lỗ trên mỗi trăm đồng doanh thu, mục tiêu đang đặt. Dưới là Đề xuất một câu: loại bớt video, nâng hay hạ ROI mục tiêu một nấc, tăng ngân sách ba mươi phần trăm, hoặc giữ mục tiêu. Chiến dịch chỉ sửa được trên Seller Center, nên có sẵn link Sửa chiến dịch trong Seller Center. Khi kết luận đổi loại, chuông thông báo sẽ báo.",
    "Tab Hòa vốn sản phẩm. Ba thẻ: hòa vốn toàn gian, số sản phẩm đã có mốc riêng, và số sản phẩm thiếu giá vốn. Mỗi sản phẩm một dòng: doanh thu, biên lãi, ROI hòa vốn, chiến dịch đang chứa nó, và nhận định: Chạy thử, Đã có mốc hòa vốn, Mục tiêu dưới hòa vốn, Lỗ trước quảng cáo, hay Thiếu giá vốn. Bấm một dòng để xem ô Nên chạy: đặt ROI mục tiêu bao nhiêu, ngân sách bao nhiêu mỗi ngày, tính từ biên lãi của chính sản phẩm đó.",
    "Bấm một chiến dịch để soi từng video. Đầu trang: ROI mục tiêu, hòa vốn, ROI thực, chi phí, số đơn, phần trăm ngân sách ngày đang dùng, và nhận định. Ba thẻ: video đang tiêu tiền, video tiêu tiền mà chưa ra đơn, và số tiền vào các video đó. Chip lọc nhanh: Chưa ra đơn, Có đơn ROI dưới mục tiêu, Máy sẽ loại, Cần xem, Đang học, Đã loại. Bảng video có trạng thái TikTok, cột Tự động là kết luận lượt chấm gần nhất, chi phí, đơn, doanh thu, ROI. Lưu ý chi phí từng video TikTok cập nhật trễ tới mười một giờ.",
    "Loại tay: tick các video tiêu tiền mà không ra đơn, thanh công cụ hiện tổng tiền đã tiêu, bấm Loại khỏi chiến dịch. Hubsell ghi sổ rồi gửi lệnh thật lên TikTok, sàn cần khoảng hai mươi phút để áp dụng. Loại nhầm thì tick lại và bấm Khôi phục, hoặc Khôi phục cả lệnh trong tab Lịch sử. Video đã khôi phục tay thì máy không loại lại trong ba mươi ngày.",
    "Nút Tự động loại video mở cấu hình riêng của từng chiến dịch. Ba chế độ. Tắt: máy không làm gì. Diễn tập: mỗi ngày sau mười hai giờ trưa, máy chấm điểm, ghi sổ và báo chuông những video sẽ bị loại, nhưng chưa loại. Tự loại thật: gửi lệnh loại lên TikTok, chỉ bật được sau ít nhất một ngày diễn tập với đúng bộ số này. ROI mục tiêu mặc định lấy số đang đặt trên TikTok. Soi theo là cửa sổ từ ba tới ba mươi ngày, tính tới hôm qua.",
    "Mở Nâng cao. Khối Loại thẳng tay có ba luật, bật tắt từng luật. Một: tiêu từ hai trăm nghìn đồng mà không có đơn, tính trong cửa sổ đang soi. Hai: có đơn nhưng ROI dưới mức loại; mức loại tính theo phần trăm ROI mục tiêu, mặc định năm mươi phần trăm, hoặc theo ROI hòa vốn của chiến dịch; video nằm giữa mức loại và mục tiêu chỉ bị gắn cờ Cần xem. Ba: chi phí mỗi đơn vượt trần, mặc định tắt, đặt theo biên lãi của sản phẩm.",
    "Khối Sàn dữ liệu: chưa xét khi tiêu dưới năm mươi nghìn đồng, ít tiền quá chưa đủ để phán; video TikTok còn đang học không bao giờ bị xét. Bảo vệ video công thần: video từ hai mươi đơn trong ba mươi ngày mà vi phạm thì phải liên tục hai ngày mới loại. Chốt an toàn mỗi ngày: loại tối đa mười video một ngày, tốn tiền nhất loại trước, và luôn giữ lại ít nhất ba video đang ra đơn.",
    "Bấm Chạy thử với cấu hình này: máy chấm bằng số thật của TikTok, không ghi sổ. Dòng Nếu áp hôm nay liệt kê video sẽ loại kèm lý do, số công thần ân hạn, cần xem, ổn. Ưng thì bấm Lưu. Sao chép sang chiến dịch khác áp cùng bộ số cho chiến dịch khác của gian. Lưu ý: đổi số là phải diễn tập lại một lượt trước khi bật Tự loại thật.",
    "Tab Đối chiếu diễn tập, chỉ hiện khi chiến dịch đang Diễn tập. Mỗi video máy định loại: từ hôm sau ngày đó tới nay tiêu thêm bao nhiêu, ra mấy đơn, ROI bao nhiêu, rồi kết luận: Máy đúng khi vẫn không ra đơn, Lưng chừng, hay Hồi phục khi video đã lên tới mục tiêu, loại thật là mất. Nếu loại thật, TikTok dồn tiền sang video khác chứ không bớt chi. Xem vài ngày, tin rồi mới bật Tự loại thật.",
    "Tab Lịch sử loại, khôi phục. Mỗi lệnh ghi giờ, ai làm, Trợ lý tự động hay thủ công, chế độ Diễn tập chưa loại, Đã gửi lên TikTok, hay TikTok từ chối, kèm căn cứ và từng video với số lúc đó. Nút Khôi phục cả lệnh trả lại nguyên lệnh. Đổi thông số tự động loại cũng được ghi lại. Chuông thông báo báo khi máy định loại, loại thật, sàn từ chối, hay khi nhận định chiến dịch đổi. Chúc shop chạy quảng cáo có lãi.",
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
// Tham số 3 (tùy chọn): chỉ sinh lại một bước, vd `ads 1` — sửa một câu không phải đọc lại cả tour.
const ONLY_STEP = process.argv[3] ? Number(process.argv[3]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const [tour, lines] of Object.entries(TOURS)) {
    if (ONLY && tour !== ONLY) continue;
    const dir = path.join(BASE, tour);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < lines.length; i++) {
      if (ONLY_STEP && i + 1 !== ONLY_STEP) continue;
      const dest = path.join(dir, `step-${i + 1}.mp3`);
      const txt = path.join(dir, `line-${i + 1}.txt`);
      fs.writeFileSync(txt, lines[i], "utf8");
      let ok = false;
      if (GENMAX[tour]) {
        let credits = 0;
        for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
          try {
            credits = await genmaxTts(lines[i], dest, GENMAX[tour]);
            ok = fs.existsSync(dest) && fs.statSync(dest).size > 5000;
          } catch (e) {
            console.warn(`  ${tour}/step-${i + 1} GenMax lượt ${attempt}: ${e.message}`);
            await sleep(3000 * attempt);
          }
        }
        fs.rmSync(txt, { force: true });
        if (!ok) {
          console.error(`FAIL: ${tour}/step-${i + 1}.mp3 GenMax hỏng sau 3 lượt`);
          process.exit(1);
        }
        console.log(`${tour}/step-${i + 1}.mp3  ${Math.round(fs.statSync(dest).size / 1024)} KB · ${credits} credit`);
        continue;
      }
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
