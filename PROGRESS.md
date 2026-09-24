# TIẾN ĐỘ PHÁT TRIỂN — HUBSELL

> File ghi nhận tiến độ theo từng phiên làm việc, giữ ngữ cảnh cho các phiên sau.
> Log nghiệp vụ chi tiết (checklist Done/Todo) nằm ở [TODO.md](TODO.md); kiến trúc & hướng dẫn ở [README.md](README.md).

---

## Phiên 24/09/2026 (đêm, 6) — XÁC MINH SỐNG 3 lệnh ghi Ads Shopee + GMS dời ra TAB riêng (anh Trung: "Em cứ xác minh đi. GMS đặt ở đâu? Tính kỹ không rối")

- **Xác minh sống trên ANO (chỉ đọc Sổ + bắn lệnh nhỏ đảo lại):** tạo chiến dịch = chính anh bấm 21:58 (campaign 201358573 chạy thật, sổ SUCCESS); change_roas_target 12,2 → 12,3 → 12,2 OK; change_budget 100.000 → 101.000 → 100.000 OK trên campaign đang chạy, campaign đã tạm dừng cũ trả error_server (chỉ đổi ngân sách campaign đang chạy — khớp executor). write-probe nhận thêm budget/roasTarget.
- **GMS**: bỏ khối trên bảng chính, chuyển thành TAB "GMV Max cấp shop" chỉ hiện khi gian đang chạy GMS; từng SP nạp khi mở tab; bỏ dòng mờ eligible. Docs mục 7 việc 1/6/8 + mục 12.3.

---

## Phiên 24/09/2026 (đêm, 5) — Ads Shopee GMS = GMV MAX CẤP SHOP, chỉ đọc (anh Trung: "Làm nốt GMS đi em")

Chi tiết `docs/ADS-SHOPEE-KHAI-THAC-API.md` mục 12. Tóm tắt:
- **Docs + probe prod**: eligibility.reason active_campaign = cách duy nhất biết shop đang chạy GMS; báo cáo chỉ theo KHOẢNG ngày
  (start ≠ end, không có số ngày lẻ); không có endpoint đọc cấu hình. ANO đủ điều kiện nhưng CHƯA chạy GMS; DarkMan chưa nối;
  4 call GMS liên tiếp dính rate limit cấp shop → giãn 1,5 s.
- **Code**: bảng riêng ads_gms_reports (7d/30d ngày trọn) + ads_gms_item_reports (7d) + Channel.adsGmsStatus; sync ở lượt lịch
  sử 6h (~4 call); dashboard `gms` + route gms/items ghép hòa vốn từng SP; khối UI "GMV Max cấp shop" + dialog từng SP; dòng mờ
  khi eligible. CHỈ ĐỌC, không ghi. Migration `20260925010000_ads_gms`.
- Soi local bằng số đặt tay đủ ca lãi/lỗ; tsc + eslint sạch; test +7. Đường "active" chưa có số thật (shop nhà chưa chạy GMS).

---

## Phiên 24/09/2026 (đêm, 4) — Ads Shopee ĐỢT C: TỪ KHÓA đọc được gì thì hiện, gợi ý có số (anh Trung: "Làm tiếp đợt C đi em")

Chi tiết `docs/ADS-SHOPEE-KHAI-THAC-API.md` mục 11. Tóm tắt:
- **Docs**: info_type 2 = manual_bidding_info (từ khóa đã chọn + vị trí Khám phá) cùng call → 0 call thêm; get_recommended_keyword_list
  có `input_keyword` tùy chọn (rỗng thì hỏi lại theo tên SP). Shopee KHÔNG cấp hiệu suất từng từ khóa → chỉ đọc + đối chiếu.
- **Code**: xung lưu `AdsCampaign.manualBidding`; `ads-keywords.ts` (parseManualBidding, mergeKeywordSignals, cache 24h ở
  ads_item_signals.kwSuggestions); route keyword-suggestions; modal: bảng từ khóa đang chọn + nút "Từ khóa Shopee gợi ý" (hớ >30%
  = mặc định tự đặt, vàng; chưa có trong campaign = xanh). Migration `20260925000000_ads_keywords`.
- Soi local đủ (hớ 43%, chưa có, không có số để so); 633 test pass (+8); tsc + eslint sạch. CHƯA bắn sống kèm input_keyword trên shop thật.

---

## Phiên 24/09/2026 (đêm, 3) — Ads Shopee ĐỢT B: HẠ NGÂN SÁCH TRƯỚC, TẮT SAU + cờ ví tự nạp (anh Trung: "Em làm đợt B đi")

Chi tiết `docs/ADS-SHOPEE-KHAI-THAC-API.md` mục 10. Tóm tắt:
- **Docs Shopee đọc lại**: change_budget dùng tham số `budget` (ngân sách ngày), sàn tự chặn mức sai
  (`error_daily_budget_range`) → không đoán tối thiểu; get_shop_toggle_info trả `auto_top_up`.
- **Executor**: nấc `cut_budget` — pause_now lần đầu trong ván → hạ ngân sách ngày = max(50% ngân sách, 70% chi tiêu TB
  7 ngày) (mặc định tự đặt), không giới hạn → trần 70% chi tiêu; hạ hôm nay thì thôi; hôm sau vẫn lỗ → tắt; spike vẫn
  tắt ngay; Lazada tắt như cũ. Cờ số gốc trên AdsCampaign (migration mới), bật lại (máy/người) → `restore_budget`;
  nút "Trả lại ngân sách"; người đổi ngân sách trên sàn → xóa cờ (OVERRIDDEN). Cờ cấu hình `cutBudgetFirst` mặc định bật.
- **Ví tự nạp**: xung +1 call → `Channel.adsAutoTopUp`; thẻ ví cạn hạ medium khi đã tự nạp, high + câu rõ khi không.
- Diễn tập DB dev đúng trình tự (DEMO-3 cut_budget PLANNED 200k → 109k; lượt 2 không lặp); UI nhãn/modal/nút/công tắc
  soi local. 626 test pass (+13), tsc + eslint sạch. **CHƯA bắn sống change_budget** — lần live đầu trên ANO là lần xác minh.

---

## Phiên 24/09/2026 (đêm, 2) — Ads Shopee/Lazada ĐỢT E: rổ thứ tư "đang lãi nhưng bị chặn phân phối" (anh Trung: "làm đi em")

Chi tiết `docs/ADS-SHOPEE-KHAI-THAC-API.md` mục 9. Tóm tắt:
- **Bối cảnh**: anh hỏi Shopee đánh giá hiệu quả dựa vào đâu / tối ưu kiểu gì → trình 4 rổ tối ưu, Hubsell thiếu rổ "lãi tốt
  nhưng bị chặn". Đọc prod (Chrome anh, chỉ đọc): ANO chỉ 1 campaign đang chạy (auto bidding, ngân sách không giới hạn, ROAS
  9,44x > hòa vốn 6,9x nhưng < mục tiêu 12,2x) — đúng ca "mục tiêu bó"; DarkMan 0 đang chạy, chưa nối.
- **Luật** `assessDelivery` (thuần, 12 test): chỉ khi ongoing + healthy + có hòa vốn + ≥ 3 ngày trọn có tiêu (bỏ hôm nay) +
  ROAS 7d ≥ hòa vốn × 1,1 + mục tiêu ok → `budget_capped` (tiêu ≥ 90% ngân sách ngày — mặc định tự đặt, Shopee không công bố)
  hoặc `target_binding` (ROAS thực < mục tiêu đang đặt). CHỈ GỢI Ý, không tự sửa sàn.
- **UI**: nhãn xanh dương ở cột Trợ lý thay "Ổn", dải xanh "N chiến dịch đang lãi nhưng bị chặn phân phối — có thể thêm đơn",
  khối trong modal: dữ kiện từng dòng + kết luận + mốc không nên hạ dưới (`safeTarget`). Lazada dùng chung.
- Soi local bằng demo (DEMO-1 ngân sách 340k → 95%; DEMO-8 auto mục tiêu 9x → bó); demo đã dọn, env trả lại. tsc + eslint sạch.

---

## Phiên 24/09/2026 (đêm) — Trợ lý quảng cáo Shopee/Lazada: BỘ LỌC KHOẢNG NGÀY CHUẨN thay 4 nút cứng (anh Trung: "bộ lọc sẵn cơ bản quá")

Chi tiết `docs/ADS-SHOPEE-KHAI-THAC-API.md` mục 8. Tóm tắt:
- **UI**: `DateRangePicker` dùng chung (Hôm nay / Hôm qua / 7 ngày / 30 ngày / Tháng này / Tháng trước + lịch chọn tay), cùng khuôn
  TikTok Ads; câu chữ theo khoảng ("7 ngày qua", "từ … đến …"); dòng vàng khi khoảng bị cắt theo trần hoặc trước ngày gian bắt
  đầu kéo số. Lazada dùng chung component.
- **Backend**: `resolveAdsDateRange` (from/to ngày sàn, `days` cũ vẫn chạy), trần 90 ngày = mặc định tự đặt theo RAM sau OOM
  (không phải giới hạn sàn); lõi insights nạp perf rộng hơn 30 ngày chỉ cho lớp hiển thị, rule engine không đổi; payload thêm
  `from/to/days/rangeClamped/perfSince`; bảng điểm + soi sống Lazada nhận cùng khoảng (Lazada khoảng dài chưa xác minh với sàn).
- Test +13 ca (61 ads pass); tsc + eslint sạch; soi local đủ 3 đường (preset, Tháng trước, chọn tay trước mốc kéo số); demo đã dọn.

---

## Phiên 24/09/2026 (khuya) — VỊ TRÍ CHỨA HÀNG đợt 2: ô không bán gắn hàng hoàn, phiếu nhặt in vị trí, kiểm kê theo vị trí, sinh kệ hàng loạt + tem — ĐÃ CODE + test đủ (anh Trung: "phải test đủ vị trí")

Chi tiết `docs/VI-TRI-CHUA-HANG.md` mục 8.8. Tóm tắt:
- **Ô không bán** (`sellable=false`): tổng `quantityInStock` = Σ vị trí bán được; chuyển vào/ra ô không bán đổi tồn bán và đẩy
  sàn; hàng hoàn về ô "Nhận hoàn" không bán thì chưa tính tồn bán cho tới khi kiểm xong chuyển sang kho bán; đơn không trừ ở đó;
  đổi cờ khi còn hàng bị chặn 409; mặc định luôn bán được.
- **Phiếu nhặt A6**: dòng đậm "Lấy ở: Kho 2" / "Lấy ở: Kho chính 1 · Kho 2 4" từ log trừ, "Đang ở: …" khi chưa trừ.
- **Kiểm kê** `/products/stocktake`: chỉ mã có hàng tại vị trí, quét mã cộng 1, chỉ hiện lệch, nháp localStorage, chốt →
  mỗi mã lệch một dòng ADJUST "Kiểm kê dd/mm tại X: sổ a → đếm b".
- **Sinh hàng loạt** "Kệ [A-C][1-3]" (≤ 200, mã KE-A1 tự sinh) + **tem PDF A4** 3×7 mã vạch Code 128.
- Test: +12 ca (7 tích hợp ô không bán + phiếu nhặt, 5 mẫu tên); suite pass; E2E local đủ vòng bật → chuyển → kiểm kê →
  tem → phiếu nhặt → rào → tắt (kết quả từng bước trong docs). Bug bắt được: sinh hàng loạt lần đầu trùng sortOrder gốc → sửa.
- Chưa làm: quét ô trên mobile (app mobile chưa có màn tồn kho); UI cây cha-con phẳng.

---

## Phiên 24/09/2026 (tối) — VỊ TRÍ CHỨA HÀNG đợt B (nhiều kho nhỏ / kệ / ô) — ĐÃ CODE + kiểm local (anh Trung: "cứ code dần phần B")

Khung 15/09 giữ nguyên, áp 4 điều chỉnh của lần rà 24/09 (mục 8.4 docs). Chi tiết đầy đủ `docs/VI-TRI-CHUA-HANG.md` mục 8.7.
- **Sổ kho một cửa** `services/stock-ledger.ts`: 14 chỗ ghi tồn gom về `applyStockDelta` / `setStockAbsolute` /
  `setLevelAbsolute` / `transferStockTx`; tổng `quantityInStock` vẫn là số cache (chỗ đọc + đẩy sàn không đổi), level theo
  vị trí ghi nguyên tử, trừ đơn phân bổ theo ưu tiên (`lib/stock-allocation.ts`), hủy đơn về đúng vị trí, hàng hoàn về
  "nơi nhận hoàn"; nhật ký thêm `locationId` + `balanceAfter`. Migration `20260924200000_stock_locations`, gốc sinh lazy.
- **API** `/api/stock-locations` (CRUD + order + transfer + set-level + levels), rào xóa (còn con / còn hàng / đang mặc định),
  xóa vị trí cuối = tắt tính năng. `adjust`/`adjust-bulk` nhận `locationId`.
- **UI**: nút Thêm vị trí → hộp quản lý (ưu tiên, mặc định, nhận hoàn), cột Đang ở + popover sửa số / Chuyển vị trí có xem
  trước, ô chọn vị trí ở Nhập/Xuất + Phiếu nhiều mã (nhớ lần cuối), nhật ký thêm Tồn sau + Vị trí.
- **Kiểm**: 7 test thuần + 7 test tích hợp mới (bất biến Σ level = tổng sau mỗi bước, bán vượt âm ở vị trí cuối), suite cũ
  pass; local shop reviewer: bật (gốc nhận 12 SKU · 1.694 chiếc) → chuyển 10 → nhật ký 2 dòng TRANSFER + Tồn sau 210 →
  DELETE còn hàng 409 → chuyển về → xóa hết → tắt, MU-LUOI-TRAI vẫn 210, stockLevels rỗng. tsc + eslint sạch hai đầu.
- Script `apply-migration-local.ts` sửa để giữ nguyên khối `DO $$` (FK idempotent). Đợt 2 (in vị trí lên phiếu nhặt, kiểm
  kê theo vị trí, cờ không bán, mobile) chưa làm.

---

## Phiên 24/09/2026 (chiều) — HOÀN THIỆN HÀNG HÓA đợt A: nhật ký kho, ngừng kinh doanh SKU, phiếu nhiều mã (ĐÃ CODE + kiểm local, CHƯA COMMIT lúc ghi)

**Bối cảnh:** anh Trung yêu cầu "khảo sát lại một lần nữa để hoàn thiện phần Hàng hóa" (khung Vị trí chứa hàng chốt 15/09 chưa code). Rà lại code + đối thủ trực tiếp còn thiếu (BigSeller, Ginee) → ghi `docs/VI-TRI-CHUA-HANG.md` mục 8. Em đề xuất làm nền (Đợt A) trước vị trí (Đợt B); anh chốt **A → B**: "làm sớm sau này thương mại đỡ phải sửa nhiều, có khách rồi mà sửa nhiều mất uy tín".

**Rà lại thấy gì (ngoài chuyện vị trí):** không có lịch sử kho trên UI (route có, FE không gọi, nhật ký không ghi ai làm); không ngừng kinh doanh / xóa SKU; nhập hàng từng SKU một popup; chưa kiểm kê. BigSeller đẩy TỔNG nhiều kho lên sàn (xác nhận hướng mình) + có kho nhận hoàn mặc định riêng (sẽ chép ở B); Ginee bind kho 1:1 theo gian.

**Đã làm (chi tiết đầy đủ ở docs mục 8.6):**
- Migration `20260924150000_product_inactive_inventory_actor` (IF NOT EXISTS, Render tự áp): `Product.isActive`, `InventoryLog.actorId` → User, enum `ADJUST`. Local đã áp tay (script apply-migration-local không nuốt được khối `DO $$` → FK chạy riêng).
- Backend: `GET /api/inventory/logs` thành sổ toàn shop (lọc SKU/ngày/loại/tìm, 20/50/100, kèm ai làm + mã đơn + gian); `POST /api/inventory/adjust-bulk` (phần thuần `lib/inventory-bulk.ts` + 5 test); sửa tồn trực tiếp + Excel đè số → ADJUST; mọi thao tác tay ghi `actorId`; `GET /api/products?status=` + `activeCount/inactiveCount`; `PATCH isActive` (ADMIN); `DELETE /:id` chỉ khi 0 đơn / 0 liên kết / 0 hàng mẫu / tồn 0, ngược lại 409 nêu lý do; cảnh báo sắp hết + cháy hàng bỏ SKU ngừng bán.
- Frontend: hub Hàng hóa sang `PageTabs + PageHeaderBand`, tab **Nhật ký kho** (chỉ gọi API khi mở), nút **⋯** mỗi dòng (Lịch sử kho · Cảnh báo & tồn an toàn · Ngừng kinh doanh ⇄ Bán lại · Xóa SKU) — bỏ nút chuông riêng vì cột Tồn kho đã ghi "≤ ngưỡng N" và nút thứ tư làm bảng tràn ngang; chip Đang bán / Ngừng bán N (ẩn khi 0); trang riêng **/products/receive** "Phiếu nhiều mã" (gõ/quét mã → Enter → cộng dồn → một lý do → một nút; xuất thiếu hàng chặn tại chỗ); Xuất Excel thêm cột Trạng thái.
- Kiểm local (cổng HTTP phụ 4001, shop reviewer@hubsell.vn): phiếu nhập 2 mã → nhật ký 2 dòng IMPORT ghi tên người làm + lý do; sửa tồn trực tiếp → dòng Điều chỉnh −5; Ngừng kinh doanh → dòng biến mất, chip "Ngừng bán 1", lọc thấy dòng gạch tên, Bán lại → tự về Đang bán; Xóa SKU đang nối sàn → 409 "đã có 544 dòng đơn hàng, đang nối 2 SKU sàn…". tsc + eslint sạch hai đầu; 5 test mới pass; suite tích hợp pass sau khi áp migration local. Env đã trả lại (`SHOPEE_CALLBACK_HTTP_PORT` tắt, `NEXT_PUBLIC_API_URL` về https://localhost:4000).

**Để lại cho Đợt B (vị trí chứa hàng):** helper `applyStockDelta` gom 14 chỗ ghi + `balanceAfter` trên nhật ký; vị trí gốc sinh lazy; `isReturnDefault`; kiểm kê theo vị trí ở Đợt C. Ảnh tour /guide chưa chụp lại theo UI mới; mobile chưa có nhật ký.

---

## Phiên 19/09/2026 (khuya) — Hóa đơn điện tử: vá 4 lỗ hổng trước khi khách xuất số lượng lớn (ĐÃ PUSH 1c1bada → 94bf5d9 + commit dọn dẹp; ticket MISA ĐÃ GỬI, ⏳ chờ trả lời)

- **ĐỢT 4 — MÃ HÓA BÍ MẬT NCC HÓA ĐƠN TRONG DB (anh: "làm luôn… nghiên cứu thật kỹ như một senior bảo mật"):**
  - **Vì sao nặng hơn mật khẩu thường:** meInvoice ký HSM phía MISA → ai có {MST + tài khoản + mật khẩu} là phát hành được hóa đơn hợp lệ dưới tên khách, không xóa được. Trước đó 9 cột bí mật của 2 bảng (`InvoiceConfig`, `PlatformInvoiceConfig`) nằm chữ thường trong Supabase.
  - **Thiết kế** (`backend/src/lib/secret-box.ts` + `integrations/invoice/config-secrets.ts`, đầy đủ ở `docs/BAO-MAT-MA-HOA-BI-MAT.md`): AES-256-GCM, IV ngẫu nhiên mỗi lần, **AAD = bảng + ownerId + tên cột** (chép bản mã của shop khác sang hàng mình không giải mã được), định dạng `enc:v1:<mã khóa>:…` cho phép **xoay khóa**, khóa ở env `SECRET_ENC_KEYS`. Lưu cấu hình KHÔNG BAO GIỜ giải mã (để trống ô = giữ nguyên bản mã); trang cấu hình giải mã **khoan dung** (ô hỏng = "chưa đặt" + dòng đỏ nhập lại) để khách luôn có lối thoát; luồng phát hành gặp bí mật không đọc được → lỗi tầm TÀI KHOẢN → ngắt mạch. Mật khẩu trên form che cố định `••••••••` (trước lộ 4 ký tự cuối). Chuyển đổi dữ liệu cũ **tự chạy lúc khởi động**: mã hóa xong giải mã thử khớp mới ghi, ghi có điều kiện theo giá trị cũ, log chỉ in số đếm.
  - **Triển khai 2 pha, không gãy shop đang nối:** code lên production mà CHƯA có khóa thì chạy y như trước + cảnh báo `[SecretBox] ⚠️ CHƯA BẬT`; ⏳ **anh phải tự tạo khóa + cất dự phòng + đặt `SECRET_ENC_KEYS` trên Render** (mục 4 của docs — Claude không được nhập khóa vào Render); ổn định rồi bật `SECRET_ENC_REQUIRED=1`.
  - **Kiểm chứng:** 18 test góc nhìn kẻ tấn công (sửa bản mã, chép sang shop / cột / bảng khác, mất khóa, xoay khóa, khóa sai định dạng, lỗi không lộ bí mật); diễn tập DB local 3 bí mật thật → bản mã, chạy lặp vô hại, giải mã đúng nguyên văn (so sha256), xoay `k1 → k2`; **gọi MISA sandbox thật** qua đúng đường sản phẩm OK trước + sau xoay khóa; tầng API: GET không lộ gì, PUT để trống giữ bản mã từng byte, PUT mật khẩu mới ra bản mã mới, nút Test đăng nhập OK. vitest 641/641, tsc BE + FE sạch. `backend/.env` local nay có `SECRET_ENC_KEYS` (k2,k1) — MẤT là bí mật local thành rác.
  - **✅ 23:47 — ĐÃ BẬT TRÊN PRODUCTION:** anh tự tạo khóa `k1` (PowerShell riêng, không qua chat) + đặt `SECRET_ENC_KEYS` trên Render; Claude soi tab Logs (không mở tab Environment) thấy `[SecretBox] BẬT — khóa đang dùng "k1", tổng 1 khóa giải mã được.` + `Chuyển đổi… quét 0 ô, mã hóa 0, lỗi 0` → production chưa có shop nào lưu bí mật NCC hóa đơn, không có gì để chuyển; từ nay lưu vào là mã hóa. ⏳ Còn: anh xác nhận đã cất khóa dự phòng; vài ngày sau bật `SECRET_ENC_REQUIRED=1`. Thấy thêm trong log: gian Lazada **"Hi.Bé" báo `IllegalAccessToken`** (token hết hạn / mất hiệu lực) — đồng bộ đơn + đơn hoàn của gian này đang lỗi, cần ủy quyền lại (việc riêng, chưa xử lý).
  - Tiện tay: `render.yaml` gỡ `MISA_API_BASE` trỏ host chết (đã gỡ tay trên Render 24/08, blueprint còn sót). **Chưa làm có chủ đích:** mã hóa token các sàn (rủi ro thấp hơn, đụng worker nóng) — đợt riêng, dùng lại `secret-box`.
- **ĐỢT 3 (sau khi anh xem prod):**
  - **Đơn vị tính:** anh muốn có gợi ý sẵn (chiếc, pcs, bộ, kiện…) → `frontend/src/lib/invoice-units.ts` = nguồn duy nhất 11 đơn vị; bản đầu là hàng nút bấm-để-điền, anh hỏi "dropdown hay liệt kê" → chốt **MỘT ô chọn + mục "Đơn vị khác…" mở ô gõ bên cạnh** (hàng nút chiếm 2 dòng, và ô gõ + nút là hai chỗ cùng quyết định một giá trị). Cố ý không gợi ý pcs / set / box (chữ trên hóa đơn phải tiếng Việt). Khảo sát: MISA eShop KHÔNG có đơn vị mặc định — khách chọn từ danh mục hoặc Thêm mới khi khai từng hàng hóa.
  - **Khối Tự động của thẻ Xuất hóa đơn dựng lại:** anh chê cụm quan trọng mà mờ nhạt (nhãn 12px, mốc xuất là select trần 11px, tooltip một đoạn 8 dòng "không đọc nổi") → khối riêng tràn ngang dưới tiêu đề, nhãn 14px đậm, **hai THẺ CHỌN mốc xuất** (Ngay khi giao thành công — nhãn "Đúng quy định" / Sau khi sàn đối soát xong), mỗi thẻ mang sẵn một câu giải thích nên BỎ tooltip; hai khối xếp chồng tới 1280px. Anh hỏi có cần bóng mờ không → **giữ phẳng** (bóng = tầng nổi của Card gốc; khối nằm TRONG Card mà thêm bóng là thẻ nổi trong thẻ nổi), thay bằng: khối đang BẬT nền xanh đậm hơn một bậc, khoảng thở 24px trước hàng chờ, dải đỏ "đơn quá hạn" dời xuống DƯỚI hàng tab.
  - **★ Quy ước rút ra cho trang sau:** cài đặt quan trọng có 2–3 lựa chọn → bày thành thẻ chọn, mỗi thẻ một câu giải thích, không nhét vào select nhỏ + tooltip dài.
  - **Ticket MISA ĐÃ GỬI ~23:10** (anh đăng nhập developer.misa.vn, Claude điền + gửi; trạng thái "Chờ xử lý"): hỏi API số hóa đơn còn lại + xác nhận 3 mã `LicenseInfo_*` về qua cổng itg + xác nhận `inputType=2` tra theo RefID là chính thức. Nội dung + nhật ký ở `docs/MISA-TICKET-TAI-NGUYEN-HOA-DON.md` — ĐỪNG gửi lại.
  - **Dọn dẹp cấu trúc:** các hàm THUẦN của tự động phát hành (`normalizeAutoIssueTrigger`, `vnStartOfDay`, `decideAfterFailure`) tách từ `workers/invoice-auto-issue.ts` sang `integrations/invoice/auto-issue-policy.ts` — `routes/tax.ts` hết phải import ngược từ tầng worker; worker chỉ còn quét + gọi. TODO.md: ghi chú dòng "còn phải làm" viết từ 07/2026 đã lỗi thời + thêm mục chờ ticket. vitest 623/623, tsc BE + FE sạch.

- **Anh Trung hỏi:** có quy định phải xuất ngay khi bán không, MISA đang xuất thế nào cho đơn sàn, lỗi thường gặp (nghe nói "không đúng đơn vị") và phương án đối ứng → soi code + sandbox ra 4 lỗ hổng, anh bảo **làm luôn**.
- **Căn cứ thời điểm (soát lại):** Điều 9 NĐ 254/2026 — bán hàng hóa lập hóa đơn **tại thời điểm giao hàng**, không có hạn ân cho bán nội địa; "chậm nhất ngày làm việc tiếp theo" chỉ áp hàng **xuất khẩu** (ghi chú 03/09 viện nhầm → đã sửa chú thích `INVOICE_OVERDUE_MS` + 2 câu trên UI; 48h là ngưỡng nhắc nội bộ). MISA eShop cho chọn: tự động theo trạng thái (giao thành công / bàn giao vận chuyển) · hàng loạt · hẹn giờ.
- **① Đơn vị tính:** payload không gửi `UnitName` → ô ĐVT in **trống** (bằng chứng: PDF hóa đơn bán hàng sandbox 00000005). Thêm `InvoiceConfig.defaultUnitName` (mặc định "Cái", ô nhập ở tab Cấu hình) + `Product.unitName` ghi đè theo SKU (form thêm sản phẩm); snapshot hóa đơn gốc đời cũ thiếu ĐVT thì payload đỡ bằng mặc định shop. Verify sandbox: HĐ 00000006 XML có `<DVTinh>Cái</DVTinh>`.
- **② Hóa đơn BÁN HÀNG (ký hiệu đầu 2 — hộ KD):** sandbox nhận payload "0%" và in đúng mẫu không cột thuế; lỗ hổng thật là shop lỡ để thuế suất > 0 → bị bóc ngược ra "thuế" vô nghĩa. `isSalesInvoiceSeries()` + cờ `salesInvoice` ở `buildInvoiceLines` (bỏ qua mọi thuế suất; reconcileTax dùng chung). UI: ký hiệu đầu 2 thay ô chọn thuế suất bằng dòng giải thích; ký hiệu đầu 1 mà để 0% → cảnh báo (không khóa).
- **③ Mốc xuất tự động:** `autoIssueTrigger` DELIVERED (mặc định, đúng mốc luật) | SETTLED (luật cũ). Migration giữ SETTLED cho shop ĐANG bật để không xả hóa đơn ngầm sau deploy. Ô chọn nhỏ ngay dưới nhãn công tắc + tooltip.
- **④ Dịch lỗi + ngắt mạch:** `invoice-errors.ts` (nguồn duy nhất: mã `[doc]` từ doc.meinvoice.vn + mã `[live]` dò sandbox — `UnAuthorize` kèm mã con `MisaIdError / TaxCodeNotExist / UserNotExist`) → câu tiếng Việt nêu việc cần làm + giữ mã/mô tả gốc của MISA + tầm lỗi ACCOUNT / ORDER / TRANSIENT. Worker: ACCOUNT → ngắt mạch ngay (`autoIssuePausedAt` + lý do, MỘT chuông), TRANSIENT → bỏ phần còn lại của lượt, ORDER → chạy tiếp, cùng mã lặp 3 đơn liên tiếp → ngắt (số 3 là mặc định tùy ý). Gỡ ngắt: nút "Chạy lại", bật lại công tắc, hoặc lưu lại cấu hình. `InvoiceNumberNotCotinuous` retry đúng 1 lần sau 2 giây (RefID chống trùng). `TokenExpiredCode` → xóa cache token.
- **Verify:** vitest 612/612 (lượt đầu 1 test đối soát không liên quan đỏ chập chờn lúc đang tắt server dev, 2 lượt sau xanh), tsc BE + FE sạch, eslint FE sạch; UI local qua proxy 8099: dải "tạm ngừng" + Chạy lại, ô chọn mốc, ô ĐVT, hai nhánh ký hiệu. Sandbox: 2 hóa đơn bán hàng 00000005–06 ký hiệu 2K26TYY (MST sandbox MISA).
- **ĐỢT 2 (cùng đêm — anh: "xử lý vài việc nhỏ còn lại" + hỏi có gọi được số hóa đơn còn lại không):**
  - **Số hóa đơn còn lại: KHÔNG có API.** Soát mục lục cả 3 bộ tài liệu doc.meinvoice.vn (itg / api / webapi — DocFX, mục lục ở `toc.html`) + dò cổng sandbox (`/company`, `/invoice/license`, `/invoice/resource`… đều 404); `GET /company` của bộ api/v3 cũng chỉ trả thông tin pháp nhân. Khách xem ở meInvoice → Hệ thống → Quản lý tài nguyên. Dấu hiệu duy nhất qua API = 3 mã lỗi lúc phát hành `LicenseInfo_OutOfInvoice / _NotBuy / _Expired` → đã map tầm TÀI KHOẢN: ngắt mạch + MỘT chuông chỉ chỗ mua thêm, mua xong bấm Chạy lại là xuất bù. Muốn báo TRƯỚC khi hết thì phải hỏi MISA (chưa gửi ticket) hoặc cho khách tự nhập số đã mua để Hubsell đếm lùi (lệch nếu khách còn lập tay bên meInvoice) — chờ anh chốt.
  - **Bảng mã lỗi chính thức** (`doc.meinvoice.vn/api/Document/ErrorCode.html`): thêm nhóm tài nguyên, chứng thư số (`CertRevocation`, `SigningTimeNotInRegistration`…), tờ khai đăng ký CQT (`DeclarationNotExist`, `InvalidDeclaration`, `ExistDeclarationNotReceive`…), `InvalidInvoiceDate`, `ExistsInvoiceNextYear`, `InvalidTokenCode`, `Exception`; tiền tố `InvoiceDetail_` / `RequireError_` bóc tên trường.
  - **MISA báo trùng mã đơn → tự nối lại:** dò ra `/invoice/status?inputType=2` tra theo RefID (= mã đơn). `recoverDuplicate` ở misa-provider: tờ còn sống thì ghi log ISSUED với đúng số + mã tra cứu (hết cảnh log kẹt FAILED, seller tưởng chưa có hóa đơn rồi lập tay thêm). Verify sandbox: phát hành lại RefID cũ → trả về 00000006, không sinh tờ mới.
  - **Bật tự động chỉ áp đơn giao từ 0h (giờ VN) ngày bật** (`autoIssueEnabledAt`, migration 20260919233000): đơn cũ có thể đã được lập hóa đơn tay bên meInvoice trước khi dùng Hubsell → tự xuất là TRÙNG; đơn cũ vẫn ở hàng chờ để xuất tay. Shop bật từ trước (mốc NULL) giữ hành vi cũ.
  - **MST / số định danh người mua:** `normalizeBuyerTaxCode` (bỏ khoảng trắng, dấu chấm; nhận 10 / 10-3 / 13 / 12 số) — sai dạng thì KHÔNG gọi MISA, ghi FAILED với lời nhắn rõ.
  - **Quà tặng 0đ:** dòng giá gốc 0 → `promotion` → `ItemType 2`; PDF sandbox 00000007 in "(Hàng khuyến mại không thu tiền)". Dòng bị voucher ăn hết KHÔNG tính là quà; hóa đơn điều chỉnh giữ ItemType 1.
  - Deck /guide + thông báo bật tự động đổi câu theo mốc mới. vitest 623/623, tsc BE + FE sạch. Một lượt giữa chừng đỏ 1 test = lỗi THẬT: regex kiểm MST mất dấu gạch chéo ngược khi vá bằng script — test bắt được, đã sửa.
- **Bẫy ghi lại:** vá file bằng script Node + template literal thì các ký hiệu regex có gạch chéo ngược (khoảng trắng, chữ số) bị nuốt mất dấu — regex phải sửa bằng công cụ Edit; luôn chạy test sau khi vá.
- **Để ngỏ ĐỢT 1 (đã xử lý hết ở đợt 2, trừ mục e chuyển thành câu hỏi "báo trước khi hết số"):** (a) bật tự động = xuất cả đơn cũ giao từ trước (kể cả đơn shop đã lập tay bên meInvoice) — cần anh chốt có chặn "chỉ đơn giao từ lúc bật" không; (b) `InvoiceDuplicated` chưa tự dò lại hóa đơn đã có bên MISA để nối vào log; (c) kiểm định dạng MST người mua trước khi gửi; (d) dòng quà tặng 0đ (ItemType 2); (e) mã lỗi "hết số hóa đơn" chưa bắt được mã thật (sandbox không giới hạn) — đang dựa lưới lặp mã; (f) deck hướng dẫn /guide còn câu "đã giao & đã đối soát".

## Phiên 19/09/2026 (đêm) — Thanh tab cấp trang + dải trắng đầu trang đo theo YouTube Studio; chữ ô nhập về 14px (ĐÃ PUSH eadc16a → 9e9f005 + commit dọn dẹp)

- **Anh Trung:** tiêu đề tab của YouTube Studio luôn dễ nhìn, của mình "phẳng và đồng nhất vào cả trang". Đo CSS thật Studio (Chrome anh): tab 16px/500 trên thân 14px, cao 48, nhãn cách 40px, vạch chọn 2px bo tròn **rộng đúng bằng nhãn**, kẻ đáy chạy suốt vùng nội dung, vùng tiêu đề + tab nền trắng tách khỏi vùng nội dung. Hubsell cũ: **8 bản tab viết tay chép nhau** (14px, cao 42, vạch ăn cả đệm, kẻ đáy chỉ dài bằng nội dung trên nền slate-50), dòng mô tả cùng màu chen giữa tiêu đề và tab.
- **`components/ui/page-tabs.tsx` (mới):** `PageTabs` — 15px → 17px ở 2xl / 500, cao 48, `gap-x-8`, vạch 3px bo góc trên rộng bằng nhãn, hover vạch mờ, `countTone: "attention"` = viên hổ phách cho số việc chờ khách xử lý, `trailing` = thông tin phụ mép phải, điện thoại cuộn ngang một hàng. `PageHeaderBand` — dải trắng tràn mép dính liền header (margin âm **phải khớp padding `<main>` trong app-shell.tsx**), chứa mô tả / thanh điều khiển + hàng tab (`className="border-b-0"` để dùng chung kẻ đáy của dải). **Trang mới có tab cấp trang phải dùng 2 component này, không viết tay.**
- **Anh duyệt bản B (có dải trắng)**, sửa 2 điểm sau khi xem prod: (1) tab không được bé hơn chữ ô tìm kiếm; (2) viên đếm của tab đang chọn **giữ đen đặc như cũ** (em từng đổi sang xám dịu — đừng đề xuất lại).
- **Đã áp:** dải + tab ở Đơn hàng, Lãi/Lỗ thực hiện, Giá vốn, Quảng cáo Shopee–Lazada, Quảng cáo TikTok (không có hàng tab thì dải tự đệm đáy); Chi tiết chiến dịch TikTok chỉ khối đầu trang vào dải — hàng tab GIỮ chỗ cũ vì thuộc khối bảng dưới ba con số kết luận; `SettingsShell` bọc tiêu đề + mô tả vào dải cho MỌI trang cấu hình + prop `tabs` (Hóa đơn Lịch sử / Kết nối dùng). CỐ Ý giữ nguyên tab lọc trong thẻ xuất hóa đơn (cấp dưới tab trang, phải nhỏ hơn).
- **Chữ trong ô nhập quá to (anh xem trang Hóa đơn, yêu cầu rà cả hệ thống):** gốc là `Input` + `NativeSelect` có `2xl:text-base` → từ 1536px chữ trong ô 16px trong khi nhãn / textarea / Select trigger 14px. Bỏ quy tắc nở (mobile vẫn 16px chống iOS tự phóng to). Nguồn thứ hai: 13 dòng mô tả đầu trang `<p className="text-muted-foreground">` không đặt cỡ → ăn 16px mặc định của body → `text-sm`. **Rà bằng đo thật:** script chỉ đọc chạy trong Chrome trên prod, liệt kê mọi chữ 15,5–16,5px không phải tiêu đề qua 22 trang ở bề ngang 1700px — chỉ ra đúng hai nguồn trên. Chưa đo: hộp thoại + tab đang đóng (ô nhập trong đó vẫn đi qua 2 component gốc).
- **Dọn dẹp cuối phiên:** import `page-tabs` về đúng thứ tự abc trong khối `@/components/ui/*` (7 file), thụt lề khối con của `PageHeaderBand` ở 3 trang quảng cáo (`git diff -w` xác nhận chỉ đổi khoảng trắng), xóa trang tạm `app/dev-ui-preview`.
- **Chưa làm / để ngỏ:** trang quảng cáo lặp chữ "Trợ lý quảng cáo" (header) / "Trợ lý quảng cáo Shopee" (h1 trong trang) — đã nêu, anh chưa phản hồi; chưa soi trang thật bằng dữ liệu ở local (cần đăng nhập) — anh xem trên prod: "tạm ổn".

## Phiên 19/09/2026 (chiều – tối) — Tên miền hubsell.vn: alias + email Zoho + thư tự động theo vai + mặt tiền (ĐÃ PUSH app c717077 → 277bd92, landing 694b2fe) — ⏳ CHẶNG 3 CHỜ TIKTOK REVIEW

> **NHẮC:** khi TikTok báo kết quả xét duyệt app và kết quả là OK → nhắc anh Trung làm **chặng 3 (buổi cắt)** theo [docs/CHUYEN-TEN-MIEN-HUBSELL-VN.md](docs/CHUYEN-TEN-MIEN-HUBSELL-VN.md) mục 3.

- **Bản khai hubsell.vn được duyệt** (Mắt Bão). Anh chốt chuyển DẦN, chạy song song hai tên miền, hạ tầng đợi TikTok review. Em phản biện một điểm và anh theo: app `.vn` chỉ là alias mềm, chưa phát link cho khách, vì mọi luồng quay về (Google, nối sàn, TikTok Ads, payOS, thư quên mật khẩu) đọc `APP_FRONTEND_URL` = `.tech`; không viết code "quay về đúng tên miền xuất phát" vì sau 301 thành đồ bỏ.
- **Chặng 0 — alias web:** Vercel thêm `hubsell.vn` + `www` (landing) và `app.hubsell.vn` (app); DNS Mắt Bão A `@` + 2 CNAME. Cả ba lên HTTPS, CORS từ `app.hubsell.vn` vào backend OK (allowlist đã thêm từ 13/09).
- **Chặng 1 — email:** soi Zoho thấy gói Free, một hộp `dev@hubsell.tech`, **`support@hubsell.tech` in trên landing + trang pháp lý CHƯA TỪNG tồn tại** → thêm bí danh. Anh nâng Mail Lite (12 USD / năm; đã so Mắt Bão Email Pro 19k / tháng — trần 100 người nhận / ngày, không rõ bí danh). Thêm `hubsell.vn` làm miền đầy đủ rồi đặt làm MIỀN CHÍNH (anh nhắc: về sau bỏ `.tech`), địa chỉ chính + đăng nhập Zoho = `dev@hubsell.vn`, bí danh `support@ / billing@ / no-reply@`, DNS MX + SPF + DKIM + DMARC `p=none`, 3 bộ lọc Hỗ trợ / Thanh toán / Hệ thống.
- **Thư tự động theo vai người gửi** (c717077, chi tiết trong commit + docs mục 2): `sendMail` nhận `role` noreply | billing; 4 thư khách mới (chào khách mới, mật khẩu vừa đổi, kích hoạt / gia hạn gói, nhắc hạn 7 ngày / 1 ngày cho cả kỳ dùng thử) + báo HQ khách mới + một thư tổng hợp khách hết hạn hôm qua; worker `subscription-reminder` chống trùng bằng bảng vé `subscription_reminders` (giành vé theo lô, hai worker song song không gửi đôi). Test đầu-cuối trên local bằng SMTP giả + tài khoản ảo: 9 thư đúng người gửi + Reply-To, lượt quét thứ hai không gửi trùng. Prod: anh đặt env SMTP Zoho (`smtppro.zoho.com`), thư quên mật khẩu về từ `Hubsell <no-reply@hubsell.vn>`, Trả lời cho `support@`, **anh xác nhận thư tới Gmail ngoài nhận được**.
- **Chặng 2 — mặt tiền** (landing 694b2fe, app 277bd92): email hỗ trợ `.vn`; Điều khoản ghi cả hai tên miền, ngày 19/09/2026 ↔ `TERMS_VERSION / PRIVACY_VERSION = 2026-09-19`; canonical + og:url về `https://hubsell.vn` (cả bản `.tech` cũng khai canonical `.vn`); chữ khung tour đọc `APP_HOST` từ env; link pháp lý trong app + link giới thiệu mặc định về `.vn`. **Sửa lỗi có sẵn:** `<landing>/register?ref=` trả 404 trên cả hai tên miền (landing chưa từng có trang này) → redirect 307 sang app `/login` kèm `?ref=`.
- **Ghi chú:** 2 link HQ trong email hết viết cứng `app.hubsell.tech` (đọc `APP_FRONTEND_URL`). DB LOCAL kẹt migration hỏng cũ `20260830120000_fee_audit` (migrate deploy local không chạy; prod không dính) — chưa xử lý. Bộ phân quyền tự động của Claude Code chặn nhóm thao tác DNS / tên miền lần đầu, anh xác nhận lại thì chạy. Anh lỡ dán một Mật khẩu ứng dụng Zoho vào chat — đã đề nghị xóa + tạo lại.
- **Chưa làm:** chặng 3 (chờ TikTok); bộ lọc Hỗ trợ + Hệ thống chưa thử riêng bằng thư thật; chữ `app.hubsell.tech` trong app mobile; DMARC nâng mức sau vài tuần.

## Phiên 19/09/2026 (sáng – trưa) — Quảng cáo TikTok: quyền Campaign được duyệt → API KHÔNG sửa được chiến dịch Seller Center → chuyển sang GỢI Ý (ĐÃ PUSH 74b1587 + commit dọn dẹp)

- **TikTok duyệt quyền Campaign** (Read campaigns + Create and update campaigns) sau chưa đầy 1 ngày. Token cấp trước khi duyệt KHÔNG tự có quyền mới (`40001 advertiser does not grant you …`) → thêm nút **Kết nối lại** cho gian đang nối khỏe (tab Kết nối; backend upsert dòng nối nên cấu hình Tự loại thật của TC054, sổ lệnh, số liệu giữ nguyên — ĐỪNG dùng Gỡ kết nối để nối lại, nó đưa Tự loại thật về Diễn tập). Anh đã nối lại and.not.or trên prod.
- **Probe 3 lệnh ĐỌC bằng token nhà** (shape thật ở docs/ADS-TIKTOK-GMV-MAX.md mục 4): `/gmv_max/campaign/get/` chỉ trả tên + trạng thái (gian nhà 20 chiến dịch Product + 2 LIVE); `/campaign/gmv_max/info/` trả ROI mục tiêu, ngân sách, sản phẩm, kiểu chọn video; `/gmv_max/bid/recommend/` **KHÔNG theo sản phẩm** (3 SPU thật + 1 SPU bịa đều ra 7,2 · 6tr; 2 SPU → 4; không SPU → 5) → không dựng cột "sàn gợi ý".
- **Lệnh SỬA chiến dịch bị sàn từ chối:** `/campaign/gmv_max/update/` đổi ngân sách TC076 (đang tắt) → `40002 Shop must belong to a Business Center account` 3/3 lần (anh Trung tự chạy script — Claude Code chặn Claude tự bắn lệnh ghi lên tài khoản quảng cáo thật). Tham số đúng theo docs TikTok. Anh sửa tay được trong **Seller Center** nhưng **Ads Manager của đúng tài khoản quảng cáo không liệt kê chiến dịch nào** ⇒ chiến dịch GMV Max tạo từ Seller Center: API đọc được + loại / khôi phục video được, KHÔNG sửa được từ phía tài khoản quảng cáo. **Ticket hỏi TikTok #4455484 đã gửi 19/09, chờ trả lời** (nguyên văn + việc sau trả lời: docs/TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md mục 7). Gác nút sửa / tạo chiến dịch qua API.
- **Hướng thay thế anh duyệt — Hubsell GỢI Ý, khách tự sửa trong Seller Center:** (1) `breakeven.ts profitPer100AtRoi` (lãi sau quảng cáo trên mỗi 100đ doanh thu = biên lãi − 1/ROI); (2) `campaign-advice.ts` (thuần, 10 test) chẩn đoán chiến dịch: Chưa kết luận được → Quảng cáo đang lỗ → Mục tiêu dưới hòa vốn → Ngân sách đang chặn → Mục tiêu đang bó phân phối → Đang lãi; hai mốc duy nhất không phải số của khách là **số của TikTok** (đạt ≥90% ROI mục tiêu + tiêu ≥80% ngân sách — điều kiện tự tăng ngân sách trong docs TikTok); KHÔNG có mốc "mục tiêu gấp N lần hòa vốn"; (3) trang chiến dịch: dòng phụ "dùng ~N% ngân sách ngày" + một nhãn kết luận, trỏ chuột / bấm hiện lý do + link Seller Center; (4) tab Hòa vốn sản phẩm: sản phẩm đang chạy dùng ĐÚNG bộ chẩn đoán đó (hai trang nói cùng một câu; anh chốt KHÔNG thêm cột Kết luận ở Tổng quan); (5) ô lý do: **dữ kiện mỗi ý một dòng, kết luận để riêng** (`tiktok-advice-body.tsx` dùng chung) — quy ước cho mọi ô lý do mới.
- **Gọt bảng Hòa vốn sản phẩm 11 → 7 cột** (anh: "nhìn đang hơi bị rối", dặn giữ ảnh sản phẩm + cột chi phí): Sản phẩm (ảnh, tên, mã copy, dòng phụ bán 7/30 · tồn — chỉ tô màu khi có vấn đề) · Doanh thu · Biên lãi · ROI hòa vốn · Chi quảng cáo 30 ngày (sắp xếp được) · Quảng cáo (mục tiêu · thực) · Nhận định (cột cuối). Bỏ dòng vàng "+… thiếu giá vốn". Chip lọc theo việc cần làm: Cần xem ngay · Đang chạy quảng cáo · Thiếu giá vốn · Chưa đủ đơn đối soát.
- **Dọn dẹp cuối phiên:** xóa 3 hàm client không nơi nào gọi (`getGmvMaxCampaignInfo`, `getGmvMaxBidRecommendation`, `isTiktokAdsScopeMissing` — viết cho nút sửa qua API đã gác; shape thật còn trong docs mục 4), gỡ nhánh "ads_losing" tính ở FE (chẩn đoán backend thay), xóa file tạm trong `scripts/out` (script thử lệnh ghi, kết quả probe hôm nay, bản sao token cũ). 577 test pass, tsc + eslint sạch hai đầu.
- **Thực tế gian nhà cần anh làm:** 53/56 sản phẩm thiếu giá vốn → 3/4 chiến dịch đang chạy (TC040 NEW, TC079, TC025 NEW ≈ 8,2tr / 30 ngày) chưa có mốc lãi lỗ. Link "Sửa … trong Seller Center" mới trỏ trang chủ `seller-vn.tiktok.com` — chờ anh gửi URL trang quảng cáo (một hằng số `TIKTOK_SELLER_CENTER_ADS_URL`). Trả ngân sách TC076 về 2.000.000 trong Seller Center.
- **Chưa làm / kế tiếp:** nhận định "Nên chạy / Chạy thử / Chưa nên" cho sản phẩm CHƯA chạy (anh gật hướng: hòa vốn tin được + tồn ≥14 ngày + đà bán 1,2 / 0,8 như Shopee; ROI mục tiêu đề xuất = hòa vốn × hệ số an toàn của cấu hình Trợ lý); **chiều 19/09 anh muốn nghiên cứu gợi ý NÂNG NGÂN SÁCH CHO VIDEO HIỆU QUẢ** (điểm xuất phát: nhóm endpoint "max delivery or creative boost session" trong mục lục GMV Max của docs TikTok — nhóm quyền *GMV Max › Session* app CHƯA xin; phải probe xem có dính giới hạn Seller Center như lệnh sửa chiến dịch không); chiến dịch LIVE vào bảng; kết quả lượt tự loại thật đầu tiên của TC054 trưa 19/09 chưa hỏi được.

## Phiên 18/09/2026 — Quảng cáo TikTok GMV Max: LOẠI VIDEO TỰ ĐỘNG (cấu hình theo từng chiến dịch + Diễn tập) — ĐÃ PUSH

- **Anh Trung chốt thiết kế (sau khi em trình + phản biện):** (1) cấu hình đặt vào **TỪNG CHIẾN DỊCH**, không có bộ chung theo gian — mỗi chiến dịch seller đòi cài khác nhau; bù bằng nút Sao chép sang chiến dịch khác; (2) nút cấu hình dạng **popup**, dễ dùng không rối; (3) video TikTok **Đang học thì không động tới** ("tư duy rất chuẩn"); (4) anh hỏi "API có nói 3 ngày hết diễn tập không?" → không có, em bỏ rào 3 ngày tự bịa: Tự loại thật mở khi đã có ≥1 lượt chấm (diễn tập/chạy thử) + xác nhận tóm tắt; (5) anh muốn tự động hơn: "TikTok học xong thì Hubsell bắt đầu tính" → đồng hồ luật tính từ **ngày ra trường** (LEARNING→DELIVERING) do lượt theo dõi hằng ngày ghi lại; anh chốt "cứ làm và theo dõi".
- **Backend:** `integrations/tiktok-ads/auto-rules.ts` (luật thuần: learning → protected → insufficient → vi phạm cứng [0 đơn / ROI < mục tiêu×% / CPA > trần] → ân hạn công thần theo NGÀY liên tục → flag → healthy; chốt trần video/ngày + giữ tối thiểu N video ra đơn; bỏ luật đột biến theo giờ vì API không có) + 13 test; `auto-run.ts` (theo dõi trạng thái video 30 ngày cho MỌI chiến dịch đang bật, ghi `graduatedOn`/`statusLog`/học lại; gom số theo cửa sổ hiệu lực — video ra trường trong cửa sổ chỉ tính từ ngày đó; dry_run ghi AdsActionLog PLANNED + chuông, live kiểm quyền + campaign còn bật rồi REMOVE; referenceId `ttauto-{rowId}-{ngày}`); worker `runTiktokAdsTier` gọi lượt ngày khi `autoRunDue` (sau 12h VN, mốc `TiktokAdsStoreLink.lastVideoTrackOn`); routes GET/PUT `/campaigns/:id/auto-rule`, POST `…/preview` (chạy thử không ghi), POST `…/copy`; khôi phục tay → `restoredByUserAt` (máy không loại lại 30 ngày). Prisma: `TiktokAdsAutoRule` + `TiktokAdsVideoWatch` + cột `lastVideoTrackOn` — migration `20260918120000_tiktok_ads_auto_rules` (đã áp local; prod tự áp khi Render boot `migrate deploy`, SQL viết IF NOT EXISTS).
- **Frontend:** popup `tiktok-auto-rule-dialog.tsx` 3 tầng (chế độ + ROI mục tiêu + Soi theo / Nâng cao thu gọn 8 ngưỡng / Chạy thử → "Nếu áp hôm nay: …" + danh sách video sẽ loại kèm căn cứ; xác nhận khi bật thật; sao chép); trang chiến dịch: chip "Tự động: …" cạnh tên (chủ shop bấm mở popup), dòng lượt gần nhất, chip lọc "Máy sẽ loại"/"Cần xem", nhãn kết luận máy dưới trạng thái từng video, lịch sử có nhãn "Diễn tập — chưa loại"; Tổng quan thêm cột Tự động.
- **Đã kiểm local bằng số thật (gian giả nối token nhà, đã xóa sau khi thử):** chạy thử TC054 7 ngày → loại 2 video 296.640đ/4 đơn (ROI 2,76 · 4,17 < 7,5), 2 ân hạn, 1 cần xem, 9 đang học bỏ qua; lượt ngày chạy tay: 4 chiến dịch theo dõi 75 video, sổ PLANNED + chuông + kết luận từng video hiện đúng trên UI. Chưa bắn live lần nào. Bản đồ + luật chi tiết: **docs/ADS-TIKTOK-GMV-MAX.md mục 6**.
- **Popup đã kiểm co giãn 18/09 (anh dặn "không co giãn là hỏng bét"):** 375 (điện thoại: xếp một cột, ô Soi theo hết cắt chữ, nhãn Nâng cao không gãy dòng), 768, 1920, 2560 (chữ 16px, popup 576px) — audit JS scrollWidth không có phần tử nào bị cắt, không tràn ngang.
- **Nút cấu hình nổi rõ (anh Trung 18/09 sau khi xem prod: chip cạnh tên "mờ nhạt quá, lên từ bao giờ mà mãi không thấy"):** bỏ chip nhỏ, thay bằng nút "Tự động loại video · <chế độ>" ở GÓC PHẢI hàng chip lọc, màu theo chế độ (Tắt viền xám · Diễn tập tím · Tự loại thật xanh), dòng lượt gần nhất nằm ngay dưới nút; điện thoại nút xuống dòng riêng, căn phải.
- **Khối Nâng cao sắp lại + công tắc từng luật (anh Trung 18/09: "thẳng hàng, đỡ phẳng" + "tính năng không muốn dùng thì sao?"):** 4 nhóm có khung (Loại thẳng tay · Sàn dữ liệu · Bảo vệ video công thần · Chốt an toàn mỗi ngày), mỗi dòng = công tắc + nhãn bên trái, ô số rộng cố định 11rem bên phải (điện thoại: ô số xuống dưới nhãn); 4 cờ mới `ruleNoOrderOn/ruleLowRoiOn/ruleCpaOn/graceOn` trong TiktokAdsAutoRule (migration `20260918160000_tiktok_ads_auto_rule_switches`, IF NOT EXISTS) — luật tắt thì engine bỏ qua kể cả số bên cạnh là 0 (trước đó anh để "Tiêu từ 0 mà 0 đơn" trên prod = mọi video 0 đơn đều bị loại → phải có công tắc, không dùng số 0 để tắt); dòng tóm tắt khi thu gọn chỉ kể luật đang bật; 14 test.
- **Rào cứng Diễn tập 1 ngày (anh Trung 18/09: "quan trọng, tránh lúc khách mất tiền lại đổ oan cho mình"):** Tự loại thật chỉ bật được khi chiến dịch đã có ít nhất một lượt chấm hằng ngày thật (`lastRunOn`); Chạy thử tại chỗ KHÔNG tính nữa. Backend PUT auto-rule trả 409 kèm hướng dẫn nếu chưa có; popup mờ nút + ghi rõ lý do. (Trước đó em để Chạy thử cũng mở được — anh chốt ngược lại.)
- **18/09 tối — bộ lọc thời gian CHUẨN ở Tổng quan (anh Trung: "chuẩn như những bộ lọc thời gian khác"):** bỏ 4 nút Hôm nay/7/14/30 ngày, thay bằng `DateRangePicker` dùng chung (phím nhanh + lịch chọn tay), mở trang ở 7 ngày qua. Backend `GET /api/ads/tiktok` nhận `?from=&to=` (kẹp bằng `clampGmvMaxRange`, lọc `dailyPerf` theo mốc UTC của chính ngày VN — bỏ `startOfDaysAgo` lệch múi giờ trên Render), trả thêm `from/to/dataFrom`; khoảng xem sớm hơn ngày Hubsell có số → hiện một dòng "Hubsell có số quảng cáo của gian từ dd/mm/yyyy…" (lần nối đầu chỉ kéo lùi 30 ngày, đừng để khách tưởng tháng đó không tiêu tiền). Bấm chiến dịch mang `from/to` sang trang soi video (link chuông không có from/to → 7 ngày qua). Đã soi local số thật 1440 + 375 (gian giả đã xóa, env đã trả).
- **18/09 tối — anh Trung báo ĐÃ BẬT DIỄN TẬP cho TC054 trên prod.** Em rà đường `live` + liệt kê việc còn thiếu trước khi bật Tự loại thật → **docs/ADS-TIKTOK-GMV-MAX.md mục 7** (chờ anh chốt thứ tự).
- **18/09 tối — A1 BẢNG ĐỐI CHIẾU DIỄN TẬP (anh Trung: "tiến hành làm từng phần A1"):** thẻ "Đối chiếu diễn tập — máy định loại có đúng không?" trên trang chiến dịch (chỉ khi đang Diễn tập): câu kết luận bằng tiền (từ dd/mm N video máy định loại đã tiêu thêm X, ra Y đơn, ROI nhóm so mục tiêu + mức loại) + chip đếm Máy đúng / Lưng chừng / Hồi phục / Chưa đủ dữ liệu + bảng từng video (mã + copy, ngày máy định loại + căn cứ lúc đó, tiền trước ROI sau, sắp xếp ở tiêu đề cột, hộp cuộn). Backend `backtest.ts` thuần + 7 test, route `GET …/auto-rule/backtest` (đọc sổ PLANNED, chưa định loại gì thì KHÔNG gọi sàn; có thì 2 call). Probe mới: tầng video nhận chiều `stat_time_day` → `fetchGmvMaxCampaignVideoDays`. Số cộng từ D+1 (dè dặt), kết luận theo đúng mốc khách cài, chân thẻ ghi rõ tiền được TikTok dồn sang video khác chứ không phải bớt chi. Đã soi local số thật 1440 + 375 (gian giả + sổ giả định 13/09 đã xóa, env đã trả). Còn A2 (chốt chặn số liệu sàn hỏng) → A3 (ghi sổ trước khi gọi sàn) → A4 (khôi phục một chạm) — docs mục 7.
- **18/09 tối — SẮP LẠI trang chiến dịch (anh Trung xem prod: "làm hẳn cái thẻ vào đó có hợp lý không… để hết ra đây rối lắm", gợi ý cột Tự động + trỏ chuột/bấm hiện lý do, hoặc tab riêng):** em làm CẢ HAI vì mỗi thứ một việc. (1) **Cột "Tự động"** riêng trong bảng video (chỉ hiện khi chiến dịch bật tự động): nhãn kết luận lượt chấm gần nhất cho MỌI video (Sẽ loại · Ân hạn · Cần xem · Đã khôi phục tay · Ổn · Chưa đủ dữ liệu · Chờ học xong · Chưa chấm), **trỏ chuột HOẶC bấm** (điện thoại không có hover) → ô nhỏ ghi lý do + ngày chấm + ngày TikTok học xong; bỏ nhãn nhét dưới cột Trạng thái. (2) **3 tab** dưới 3 ô số: Video (hằng ngày) · Đối chiếu diễn tập (chỉ khi đang Diễn tập; CHỈ gọi TikTok khi mở tab) · Lịch sử loại/khôi phục (kèm số lệnh). Đã soi local bằng một lượt diễn tập THẬT (chỉ ghi DB local): cột + ô lý do + tab đối chiếu "máy vừa định loại 2 video hôm nay, số tính từ mai" đúng; 375 không tràn. Bài học: thứ không xem hằng ngày thì KHÔNG chèn lên trên bảng chính.
- **18/09 chiều — ROI HÒA VỐN TIKTOK (anh Trung nhập giá vốn TC054 rồi hỏi "quảng cáo đã cập nhật lại chưa" → chưa: ROI trên trang là số TikTok = doanh thu ÷ chi phí, không có giá vốn; thứ cần giá vốn là mốc hòa vốn, anh chốt "chắc chắn phải làm"):** `integrations/tiktok-ads/breakeven.ts` — hòa vốn = 1 ÷ biên lãi TRƯỚC quảng cáo trên Lãi/Lỗ 30 ngày (SSOT `computePnlRow`). Hai điểm riêng của TikTok: (1) phí GMV Max đã bị sàn trừ trong quyết toán từng đơn (`TiktokOrderSettlement.feeGmvMax`, có dấu) → CỘNG NGƯỢC: lãi trước ads = profit − feeGmvMax; (2) mẫu số phải cùng định nghĩa "doanh thu" của TikTok (đếm đơn ĐẶT, không rút đơn hủy) → đơn HỦY góp doanh thu nhưng 0 đồng lãi (hòa vốn nghiêng cao = dè dặt); tự kiểm giả định bằng dòng "Hubsell thấy X · TikTok báo Y" 30 ngày. Chỉ tính đơn có bản kê sàn + đủ giá vốn; đơn thiếu giá vốn loại khỏi cả tử lẫn mẫu và báo độ phủ "%doanh thu có giá vốn". Nối chiến dịch → SKU: `AdsCampaign.itemIds` = SPU (lượt ngày + route soi video tự lưu, không tốn call thêm) ↔ `ChannelProduct.externalId = "productId-skuId"`; chiến dịch < 5 đơn thì mượn biên lãi toàn gian. UI: cột **Hòa vốn** ở Tổng quan (ROI thực đỏ cả khi dưới hòa vốn), đầu trang chiến dịch "ROI mục tiêu · Hòa vốn · ROI thực", số nào cũng trỏ/bấm ra ô căn cứ gạch đầu dòng; popup cấu hình NHẮC (không tự sửa số) khi ROI mục tiêu hoặc mức loại đặt DƯỚI hòa vốn. 8 test thuần; đã soi local end-to-end bằng đơn thử qua đúng `computePnlRow` (810k lãi trước ads / 2,25tr doanh thu gồm 1 đơn hủy → 36% → 2,78; độ phủ 90%) — dữ liệu thử đã xóa. Giá vốn mới nhập có vá ngược dòng đơn cũ đang = 0 (`lib/cost-price.ts`) nên hòa vốn ăn theo ngay.
- **18/09 chiều — HÒA VỐN CHỈ TÍNH ĐƠN ĐÃ CÓ KẾT CỤC CUỐI (anh Trung: "chỉ tính trên đơn đã giao thành công và hoàn thành công… TikTok đối soát rất lâu… phải tính trên đơn đã đối soát thành công"):** bản đầu lấy cả đơn có số ƯỚC TÍNH của sàn + đơn đang giao → biên lãi chưa chốt. Nay chỉ: (a) đơn ĐÃ ĐỐI SOÁT THẬT (`isSettled` + bản kê `estimated = false` — gồm giao thành công lẫn hoàn xong); (b) đơn HỦY nhưng chỉ đơn CÙNG LỨA (tạo không muộn hơn đơn đã đối soát mới nhất) — đơn hủy chốt trong vài giờ còn đối soát mất hàng tuần, không cắt lứa thì tỷ lệ hủy bị thổi phồng. Đơn đang giao / đã giao chờ đối soát / mới có ước tính / đang hoàn → để ngoài, đếm vào `pendingOrders` và nói rõ trong ô căn cứ. Cửa sổ 30 → **60 ngày** theo ngày tạo đơn (`fetchPnlOrdersAll`, phanh 8.000 đơn) vì phần đóng góp thật là đơn từ ~2 tuần trước trở về — 60 là mặc định chọn cho đủ mẫu, không phải số của sàn. Dòng tự kiểm mẫu số đổi thành so đúng bản chất: doanh thu MỌI đơn đặt Hubsell thấy vs doanh thu TikTok báo, cùng SKU, cùng khoảng ngày có số TikTok. 11 test thuần (tổng 505); kiểm end-to-end qua `computePnlRow` thật: 8 đã đối soát + 1 hủy cùng lứa, 4 đơn chưa chốt bị để ngoài → 36% → 2,78 đúng kỳ vọng.
- **18/09 chiều — MỨC LOẠI THEO HÒA VỐN (anh Trung hỏi "có nên đưa hòa vốn vào tiêu chí loại video không" → em nhận định NÊN, nhưng thay cho con số 50% tự đặt chứ không thêm luật thứ tư; anh duyệt "hợp lý"):** `AutoRuleConfig.hardBasis` = `pct` (mặc định — KHÔNG đổi hành vi chiến dịch đang chạy) | `breakeven`; cột `tiktok_ads_auto_rules.hardBasis` (migration `20260918200000_…hard_basis`, IF NOT EXISTS, Render tự áp). `resolveHardLevel` (thuần): khách chọn hòa vốn VÀ hòa vốn đủ tin → mức loại = hòa vốn của chiến dịch (đổi theo ngày); chưa đủ tin → TỰ RƠI về % mục tiêu và ghi lý do vào tóm tắt lượt/chuông. "Đủ tin" = biên lãi RIÊNG của chiến dịch (không mượn toàn gian) + độ phủ giá vốn ≥ 90% (`BREAKEVEN_MIN_COVERAGE_PCT` — mặc định chọn, anh duyệt, sàn không có số này) + không lỗ sẵn (sản phẩm lỗ trước ads thì KHÔNG biến thành "loại mọi video" — rơi về % và báo). Vùng hòa vốn → mục tiêu vẫn chỉ gắn cờ (còn lãi, để người quyết). Sổ lệnh + `lastRunSummary` chốt mức loại thực dùng hôm đó (`hardRoi/hardBasis/hardFallback`, căn cứ ghi "ROI 4,17 < hòa vốn 6,06 (10 đơn đã đối soát) — đang lỗ"); tab Đối chiếu diễn tập chấm "Máy đúng" theo đúng mức loại đó. Lượt ngày tính hòa vốn MỘT lần/gian và chỉ khi có chiến dịch chọn breakeven. Popup: dòng chính (có công tắc) "Có đơn nhưng ROI dưới mức loại — tính theo [% của ROI mục tiêu | ROI hòa vốn]", dòng % thành "Dự phòng khi chưa có hòa vốn". 7 test mới (tổng 512). Soi local trên video thật TC054 với hòa vốn thử 6,06: video ROI 7,39 đang bị tính vi phạm theo 7,5 → theo hòa vốn chỉ gắn cờ (còn lãi); ROI 2,76 và 4,17 vẫn loại. Dữ liệu thử đã xóa. ★ CHƯA bật cho TC054 trên prod — chờ anh xem hòa vốn thật + dòng đối chiếu doanh thu rồi tự chuyển trong popup.
- **18/09 chiều — popup cấu hình: hết cảnh "thiếu nút bật tắt" (anh Trung xem prod, hòa vốn thật TC054 = 5,92):** (1) dòng "… % mục tiêu" CHỈ hiện khi nó đang được dùng — chọn "% của ROI mục tiêu", hoặc chọn hòa vốn mà hòa vốn chưa đủ tin (máy tạm theo %); chọn "ROI hòa vốn" và hòa vốn đủ tin thì ẩn hẳn (số % vẫn lưu làm dự phòng). (2) `RuleRow` không bao giờ để cột trái TRỐNG đúng bằng một công tắc: dòng con của công tắc phía trên → nét nối góc (`gutter="sub"`: dòng %, Công thần, Ân hạn); nhóm luôn áp dụng không có gì để bật/tắt → bỏ hẳn cột trái (`gutter="none"`: Sàn dữ liệu, Chốt an toàn mỗi ngày). Ô số bên phải vẫn thẳng hàng ở mọi kiểu. Đã soi local cả hai chế độ.
- **18/09 chiều — luật ROI thấp gom về MỘT DÒNG (anh Trung: chọn gì thì cả cụm nằm trên cùng một dòng; ảnh prod còn lộ chữ ô chọn bị cắt "% của ROI mục ti…"):** `RuleRow wide` — công tắc · nhãn · [ô chọn `% mục tiêu | ROI hòa vốn`] [ô % + đơn vị, chỉ khi đang dùng %]; chọn hòa vốn (đủ tin) thì còn mỗi ô chọn, rộng 11rem thẳng mép với ô số các dòng khác; bỏ dòng con % riêng. Nhãn lựa chọn rút ngắn để hết cắt (đo local: chữ cần 75px, ô có 92px).
- **18/09 chiều — dòng "NGOÀI BẢNG" + B5 giờ chạy lượt chấm:** (1) Anh Trung hỏi chiến dịch được bồi video liên tục thì trang chi tiết có cập nhật không → CÓ (trang đọc SỐNG từ TikTok mỗi lần mở, video mới đi IN_QUEUE → LEARNING → DELIVERING đều thuộc nhóm Hubsell đọc); probe TC054 1.780 video: 4 nhóm Hubsell đọc = 194 video / 99,5% tiền, 5 nhóm không đọc = 1.586 video / 9.424đ. Thêm dòng chữ nhỏ dưới bảng: "Ngoài bảng: 5 video đã vào chiến dịch nhưng chưa tiêu tiền · 55 video TikTok tự ngưng phân phối (6.179đ) · 304 video chờ creator cấp quyền quảng cáo · 818 không hoạt động · 408 không khả dụng · 1 bị từ chối" — endpoint riêng `GET …/videos/outside` (`tallyVideoStatuses` thuần + test), FE gọi SAU khi bảng lên nên không làm chậm bảng; SPU lấy từ `itemIds` đã lưu. (2) **B5**: lượt chấm hằng ngày nay bám CẢ tầng xung (60' khi đang tiêu tiền, 120' khi im) qua `maybeRunTiktokAdsDaily`, tầng 6h chỉ còn là lưới đỡ → lượt chấm rơi trong 12h–14h thay vì 12h–18h; mốc `lastVideoTrackOn` + khóa gian chặn chạy hai lần. Chữ trên trang đổi thành "Lượt chấm chạy mỗi ngày trong khoảng 12h–14h trưa". 513 test pass.
- **18/09 tối — 3 THẺ CHỌN chế độ + A2 chốt chặn số liệu sàn hỏng:** (1) Anh Trung chê dải ba nút Tắt/Diễn tập/Tự loại thật "phẳng quá", hỏi in đậm hay phương án tốt hơn → 3 thẻ rời (`MODE_CARD`): biểu tượng + tên đậm + một dòng chú thích, thẻ đang chọn tô ĐÚNG MÀU chế độ (Tắt xám · Diễn tập tím · Tự loại thật xanh — trùng màu nút ngoài trang chiến dịch), thẻ Tự loại thật chưa đủ điều kiện thì viền đứt + ổ khóa + "Cần diễn tập 1 ngày"; role radiogroup. Soi 1600 + 375 (3 thẻ 109px đều nhau, không cắt chữ). (2) **A2** `videoDataProblem` (thuần, 5 test): tầng video của cửa sổ (mọi video đang phân phối + thẻ sản phẩm) báo 0 đơn / 0 đồng trong khi TẦNG CHIẾN DỊCH (`AdsCampaignDailyPerf`, đường báo cáo khác của sàn) có đơn / có tiêu tiền cùng kỳ → BỎ LƯỢT: không ghi kết luận video, không ghi lệnh, không loại, chuông "Trợ lý bỏ lượt chấm hôm nay" kèm lý do, `lastRunSummary.skipped`; cố ý KHÔNG đụng `lastRunOn` (lượt bị bỏ không được tính là "đã diễn tập 1 ngày"). Chỉ chặn khi có bằng chứng dương tính — KHÔNG so lệch phần trăm (hai tầng không bao giờ bằng nhau: video đã loại / sàn tự ngưng không nằm trong tầng video ta đọc); không có số tầng chiến dịch thì cho qua. Chạy thử trong popup cũng cảnh báo (`dataProblem`). Kiểm local: 4 chiến dịch thật chấm bình thường (không báo nhầm); chiến dịch giả lập "TikTok không trả dòng video nào + tầng chiến dịch 9 đơn" ở chế độ LIVE → bỏ lượt đúng, 0 lệnh ghi sổ, `lastRunOn` rỗng, chuông đúng. 518 test pass. CÒN A3 (ghi sổ trước khi gọi sàn) → A4 (khôi phục một chạm).
- **18/09 tối — A3 GHI SỔ TRƯỚC, GỌI SÀN SAU (anh Trung hỏi nguyên lý, em giải thích "viết phiếu chi trước rồi mới đưa tiền", anh duyệt):** `integrations/tiktok-ads/send-command.ts` — `sendVideoCommand(log, send)`: tạo dòng AdsActionLog status **SENDING** (đủ video + căn cứ) → gọi TikTok → cập nhật CHÍNH dòng đó thành SUCCESS / FAILED; tạo sổ hỏng thì KHÔNG gọi sàn; chốt sổ hỏng sau khi sàn đã nhận thì dòng nằm lại SENDING vẫn tra được. Dùng chung cho lệnh loại TỰ ĐỘNG (`applyAutoPlan`) lẫn nút Loại/Khôi phục THỦ CÔNG (route action) — trước đây cả hai gọi sàn xong mới ghi sổ, sự cố rơi đúng khe đó là video mất mà sổ trống. Dòng kẹt SENDING KHÔNG đoán kết quả: lượt chấm hằng ngày, ngay sau khi đọc trạng thái video, gọi `reconcileSendingCommands` (dòng ≥ 30 phút tuổi) → `reconcileSendingCommand` thuần: lệnh loại thành công ⇔ video không còn trong nhóm đang phân phối, lệnh khôi phục thì ngược lại; chốt SUCCESS/FAILED kèm ghi chú "đối chiếu lại thì TikTok đã loại x/y video". referenceId unique của dòng ghi trước chặn gửi lần hai khi lượt chấm chạy lại trong ngày. `pendingVideoActions` tính cả SENDING; Lịch sử có nhãn vàng "Đang gửi — chưa xác nhận" + hiện ghi chú đối chiếu. 4 test thuần (tổng 522). Kiểm local KHÔNG đụng TikTok (hàm gửi giả): trong lúc gửi sổ đã là SENDING → SUCCESS; sàn từ chối → FAILED kèm lỗi; trùng referenceId → ném lỗi, hàm gửi không bị gọi; dòng kẹt 40' → chốt "đã loại 1/2 video", dòng mới gửi không bị đụng. CÒN A4 (khôi phục một chạm cả lệnh).
- **18/09 tối — A4 KHÔI PHỤC MỘT CHẠM cả lệnh (đóng nhóm A "phải có trước khi bật thật"):** tab Lịch sử, mỗi dòng lệnh LOẠI đã gửi lên sàn (SUCCESS / SENDING, tự động lẫn thủ công) có nút "Khôi phục cả lệnh · N video" — đếm đúng số video của lệnh HIỆN CÒN đang bị loại ("còn 2/3 video đang bị loại"); không còn video nào bị loại thì chỉ ghi chú, không có nút. Không cần backend mới: danh sách "Đã loại" của trang luôn đủ video + mã sản phẩm → gom đúng video của lệnh rồi gửi qua đường khôi phục sẵn có (đã ghi-sổ-trước A3; backend tự gắn `restoredByUserAt` → máy không loại lại 30 ngày). Hộp xác nhận nêu số video + giờ lệnh. Nhân viên / chiến dịch tạm dừng thì nút mờ kèm lý do. Đã soi local bằng dòng lệnh chế sẵn trên video thật của TC054 — CHỈ mở hộp xác nhận, KHÔNG gửi (token thật).
- **CHỐT PHIÊN 18/09 (anh Trung: "dọn dẹp commit, tối làm tiếp"):** nhóm A (A1 đối chiếu diễn tập · A2 chốt chặn số liệu hỏng · A3 ghi sổ trước · A4 khôi phục một chạm) + B5 XONG; thêm ngoài kế hoạch: bộ lọc thời gian chuẩn, cột Tự động + 3 tab, ROI hòa vốn (chỉ đơn đã đối soát) + mức loại theo hòa vốn, dòng "Ngoài bảng", 3 thẻ chế độ. Tree sạch, dữ liệu thử local đã xóa, env local đã trả. CÒN trong mục 7 docs: B6 (dấu cấu hình đã diễn tập) · B7 (báo khi lệnh không ngấm — A3 đã chốt dòng kẹt, còn thiếu chuông) · B8 (chuông diễn tập chỉ khi danh sách đổi). VIỆC CỦA ANH trên prod: xem hòa vốn TC054 = 5,92 + dòng đối chiếu doanh thu → chuyển mức loại sang "ROI hòa vốn"; xem chuông lượt chấm 12h–14h trưa mai + tab Đối chiếu vài hôm → rồi mới bàn bật Tự loại thật.
- **18/09 khuya — B6 + B7 + B8 (anh Trung: "tiếp tục làm các phần tiếp theo") → ĐÓNG TRỌN mục 7 docs:** (1) **B6 cấu hình đã diễn tập chưa** — cột `TiktokAdsAutoRule.lastRunConfig` (migration `20260918230000_…rehearsed_config`, IF NOT EXISTS, Render tự áp): mỗi lượt chấm THẬT chốt cấu hình đã dùng; `unrehearsedFields` (thuần) so với cấu hình sắp lưu, số đi kèm luật ĐANG TẮT không tính. Em chọn CHẶN chứ không chỉ cảnh báo (khớp rào "diễn tập 1 ngày thật" anh chốt — diễn tập số nhẹ rồi sửa số nặng bật thật là đúng kịch bản "khách mất tiền đổ oan"): PUT live → 409 kèm tên ô; popup khóa thẻ Tự loại thật "Cấu hình chưa diễn tập" + dòng vàng nêu TÊN Ô đã đổi, gõ lại số cũ thì mở; đang chạy thật mà sửa số → form lùi về Diễn tập và nói rõ; lớp hai trong `applyAutoPlan` (dòng live cấu hình chưa diễn tập → lượt đó chỉ diễn tập). ⚠️ TC054 prod chưa có `lastRunConfig` → thẻ Tự loại thật khóa tới lượt chấm kế tiếp. (2) **B7 lệnh đã ngấm chưa** — `soakCheckCommands`: lượt chấm soi mỗi lệnh LOẠI SUCCESS (tự động lẫn thủ công) một lần, tuổi ≥ 30'; video còn đang phân phối mà không có lệnh khôi phục nào trên Hubsell sau đó → ghi chú mã video lên dòng sổ (Lịch sử tô vàng) + chuông; ngấm đủ cũng ghi chú xác nhận; không soi lệnh khôi phục (dễ báo nhầm). (3) **B8 chuông chỉ khi kết quả đổi** — `compareRunDigest` so với `lastRunSummary` lượt trước (thêm `excludeIds`): y hệt thì im (sổ PLANNED vẫn ghi cho tab Đối chiếu), đổi thì tiêu đề ghi "(thêm 2, bớt 1 so với lượt trước)"; lệnh loại thật luôn chuông. 13 test mới (tổng 535). Kiểm local KHÔNG gọi TikTok cho phần lượt chấm (3 ngày diễn tập: chuông 1·0·1; live chưa diễn tập → 0 lệnh live; soi lệnh báo đúng 1/3 video); popup soi bằng số thật TC054 chỉ đọc (ROI 15→20 khóa thẻ, gõ lại 15 mở; PUT live trả 409, không lưu). Dữ liệu thử đã xóa, env đã trả. CHƯA làm (chưa có căn cứ đặt mốc): diễn tập quá cũ — Tắt lâu ngày rồi bật thật vẫn được.
- **18/09 khuya — B6 ĐỔI THÀNH CẢNH BÁO (anh Trung chốt ngược bản chặn của em: "đổi số thì không cần diễn tập lại, chỉ hiện thông báo trước khi lưu… không muốn diễn tập thì họ trực tiếp ấn nút bỏ qua"):** gỡ khóa thẻ + gỡ việc lượt chấm tự hạ về diễn tập. Nay: bật thật / đang chạy thật mà sửa số → bấm Lưu hiện hộp vàng liệt kê TỪNG Ô "lượt chấm dùng X → nay Y" + 3 nút (Để em xem lại · Bỏ qua, bật thật luôn · Diễn tập lại); hộp tự cuộn vào khung nhìn. Backend: thiếu cờ `skipRehearsal` → 409 (client cũ không lọt), có cờ → lưu + GHI SỔ dòng `skip_rehearsal` (ai, giờ, ô nào đổi) hiện ở tab Lịch sử "Bật Tự loại thật · Bỏ qua diễn tập lại" — bằng chứng khách tự quyết. Rào "≥1 lượt chấm thật" giữ nguyên. 536 test. Soi local: hộp + Diễn tập lại trên TC054 thật (chỉ đọc); nút Bỏ qua chỉ thử trên chiến dịch giả không nối TikTok. Dữ liệu thử đã xóa, env đã trả. ĐỪNG dựng lại rào chặn.
- **18/09 khuya — NHẬT KÝ ĐỔI THÔNG SỐ thay cho dòng "bỏ qua diễn tập" (anh Trung thấy cấn: "đã bỏ qua diễn tập thì cứ thực thi theo thông số mới… khách đổi thông số thì mình cứ lưu lại lịch sử thời gian đổi thông số thôi"):** bỏ dòng sổ `skip_rehearsal` (câu chữ kiểu lập biên bản khách). Nay MỌI lần Lưu có đổi chế độ / đổi số → một dòng `config_change` trung tính: giờ + từng ô "X → Y" (`describeConfigChanges` thuần + 4 test, so thô với cấu hình đang lưu; lưu y nguyên / bị 409 thì không ghi; ghi hỏng không làm hỏng việc lưu). Tab Lịch sử: "Đổi thông số tự động loại" + các dòng đó, không nhãn cảnh báo. Hộp cảnh báo bỏ câu "Lịch sử ghi lại lựa chọn này". Kiểm local bằng route PUT thật trên chiến dịch giả không nối TikTok (4 kiểu lưu, sổ đúng 2 dòng). 539 test.
- **18/09 khuya — TAB ĐỐI CHIẾU DIỄN TẬP tính lại từ lần đổi bộ số gần nhất (em nêu, anh Trung duyệt "có, làm đi rồi push"):** trước đây bảng cộng chung mọi lượt PLANNED → khách đổi số giữa chừng thì câu kết luận lẫn hai bộ luật. Nay route backtest lấy mốc từ nhật ký đổi thông số (`ruleNumbersChanged`: dòng chỉ đổi chế độ không dịch mốc), chỉ đọc lượt diễn tập ghi SAU mốc; trả thêm `configChangedOn` + `plansBeforeChange`; thẻ nói rõ "chỉ tính từ khi đổi thông số dd/mm; N lượt trước đó chấm bằng bộ số cũ nên không tính" (cả ở trạng thái rỗng). Lần đổi số trước khi có nhật ký → không có mốc, tính hết như cũ. 2 test mới (tổng 541). Kiểm local route thật trên chiến dịch giả không nối TikTok: lượt cũ (2 video) bị để ngoài, lượt sau đổi số (1 video) được tính, 2 dòng chỉ đổi chế độ không dịch mốc. **ĐÃ PUSH cả 4 commit (f5600e2 → f8c99b3 → 1eee973 → commit này), kèm migration `20260918230000` (Render tự áp).**
- **18/09 khuya — số ROI hòa vốn tô XANH ĐẬM (anh Trung khoanh trên đầu trang chiến dịch), áp cả cột Hòa vốn ở Tổng quan — ĐÃ PUSH 6f16ce7.**
- **18/09 khuya — TAB "HÒA VỐN SẢN PHẨM" (anh Trung: muốn tab tính hòa vốn các sản phẩm + gợi ý tạo quảng cáo như Shopee; em trình: phần gợi ý/tạo chiến dịch của TikTok nằm trong nhóm quyền Campaign chưa xin → anh chốt "trước mắt 1 tab tính ROI hòa vốn, hoàn toàn dựa vào Lãi/Lỗ thực hiện, chỉ đơn giao thành công / hoàn thành công đã đối soát; phần nào phải xin thì làm xong rồi xin"):** tab thứ 2 ở `/ads/tiktok`. Backend dùng lại TRỌN phép tính hòa vốn chiến dịch (`tiktokBreakevenBaseByGroup` một lượt quét, test giữ kết quả từng sản phẩm = phép gom gốc → không bao giờ lệch số chiến dịch), route `GET /product-breakeven` chỉ đọc DB nên gian chưa nối quảng cáo vẫn xem được. Mỗi dòng một sản phẩm (item_group_id): đơn đã đối soát (+ đơn chờ), doanh thu, lãi trước QC, biên lãi, ROI hòa vốn (trỏ vào ra căn cứ), cột Nhận định 6 loại kèm lý do (Thiếu giá vốn · Chưa có đơn đối soát · Lỗ trước quảng cáo · Ít đơn — tham khảo · Mục tiêu dưới hòa vốn · Đã có mốc hòa vốn), % có giá vốn, chiến dịch đang chứa + ROI mục tiêu. Bảng đúng khẩu vị chuẩn (hộp cuộn, 20/50/100, sắp xếp ở tiêu đề, chip lọc, mã + copy). 8 test mới. Kiểm local bằng gian giả + 51 đơn thử qua `computePnlRow` thật (đã xóa): 2,35 khớp tính tay; soi 1440 + 375. CHƯA làm: gợi ý tạo quảng cáo (chờ xin quyền Campaign). Chi tiết docs mục 9.
- **18/09 khuya — tab Hòa vốn sản phẩm ĐÃ PUSH 9c6dd59 (anh gật). Tiếp: NÚT GỠ KẾT NỐI tài khoản quảng cáo (anh Trung: "thêm cột trong tab kết nối là được"):** mỗi dòng gian đã nối (kể cả nối hỏng) có nút "Gỡ kết nối" ở mép phải + hộp xác nhận nói rõ: Hubsell ngừng đọc số / ngừng chấm, quảng cáo trên TikTok vẫn chạy, số liệu + cấu hình + lịch sử được giữ. API DELETE có sẵn nhưng em bổ sung 2 việc khi gỡ (vì khách có thể nối tài khoản KHÁC sau đó): chiến dịch `ongoing` → `paused` (tránh dòng ma "Đang chạy" của tài khoản cũ), luật Tự loại thật → Diễn tập + dòng nhật ký (nối lại máy không lặng lẽ loại thật tiếp). Kiểm local bằng gian giả + token giả (không chạm TikTok): bấm gỡ trên UI → link + token xóa, 2 chiến dịch về paused, luật live → dry_run giữ nguyên số, có dòng nhật ký; tab hiện lại nút Kết nối. Dữ liệu thử đã xóa.
- **18/09 khuya — nút Gỡ kết nối ĐÃ PUSH 058c1ce; sửa câu báo nhầm ở Lịch sử cho lệnh vừa gửi (anh Trung loại tay 3 video 20:39 thấy ngay "không còn bị loại" — thật ra TikTok chưa kịp áp dụng) ĐÃ PUSH d3d577a. HỒ SƠ XIN QUYỀN CAMPAIGN đã soạn: `docs/TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md`** (6 endpoint cần, bấm ở đâu, đoạn mô tả tiếng Anh dán nguyên văn, ảnh minh họa có sẵn trên prod, việc phải nhớ sau khi duyệt — token cũ phải ủy quyền lại). Bảng Permission scope công khai của TikTok chưa liệt kê nhóm GMV Max → tên quyền chính xác đọc trong cổng lúc nộp. ✅ ĐÃ NỘP 18/09 tối (Claude điền trong Chrome của anh, anh xác nhận mới Submit): tên quyền thật đọc trong cổng = Ads management › Campaign › Read campaigns + Create and update campaigns (cụm GMV Max không có mục Campaign), ô lý do tối đa 500 ký tự; trạng thái app: Approved · Scope of Permissions Change Pending. ⏳ CHỜ TIKTOK DUYỆT.
- **CHỐT PHIÊN 18/09 KHUYA (anh Trung: "dọn dẹp và commit"):** trong phiên đã lên prod — B6 (cảnh báo đổi số + nút Bỏ qua / Diễn tập lại, không chặn) · B7 (soi lệnh đã ngấm) · B8 (chuông chỉ khi kết quả đổi) · nhật ký đổi thông số · tab Đối chiếu tính từ lần đổi bộ số gần nhất · số hòa vốn xanh đậm · TAB HÒA VỐN SẢN PHẨM · nút Gỡ kết nối · sửa câu báo nhầm ở Lịch sử; prod backend = `058c1ce` (FE tới `d3d577a`). Đã NỘP xin quyền Campaign trên TikTok (Scope of Permissions Change Pending). Tree sạch; 4 commit chỉ-docs chưa push (đi cùng lần push code kế — tránh Render build lại vì tài liệu). DB local: không còn gian thử / link / token mồ côi / chuông thử; `backend/.env` + `frontend/.env.local` đã trả; `scripts/out` chỉ còn file có sẵn từ trước. 548 test pass ở commit code cuối.
  - **Anh theo dõi trưa 19/09 (12h–14h):** chuông lượt chấm TC054 (sẽ có, danh sách đổi vì anh loại tay 3 video 20:39 — tiêu đề ghi "bớt 1"); dòng lệnh 20:39 ở Lịch sử có ghi chú "Kiểm lại 19/09…" (ca thật đầu tiên của B7); tab Hòa vốn sản phẩm của and.not.or (nhiều dòng "Thiếu giá vốn" là đúng hiện trạng); sau lượt chấm, hộp cảnh báo B6 mới so được từng ô.
  - **Việc kế khi TikTok duyệt quyền:** xem `docs/TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md` mục 6 (kiểm token cũ → and.not.or kết nối lại → probe đọc → trình thiết kế gợi ý tạo quảng cáo). Còn treo khác: tách luật video nhà / creator; LIVE GMV Max vào bảng (có quyền Read campaigns thì làm được); "diễn tập quá cũ" (chưa có căn cứ đặt mốc); xóa file mô phỏng tháng 7 (`tiktok-assistant*.ts(x)`, `tiktok-campaign-modal.tsx`).
- **18/09 khuya (sau chốt phiên) — anh Trung: "phần 3 làm được gì thì làm":** (1) **Diễn tập quá cũ** — đúng ý anh "chỉ thông báo, khách chọn thẳng bỏ qua được": bật thật mà lượt diễn tập gần nhất cách hôm nay lâu hơn cửa sổ "Soi theo" của chính khách (mốc có căn cứ: cửa sổ số liệu không còn trùng ngày nào) → hộp vàng "Lượt diễn tập gần nhất đã cách đây N ngày" + 3 nút như B6; backend 409 `stale_rehearsal` khi thiếu cờ bỏ qua; 4 test. (2) **Tab Hòa vốn sản phẩm bổ sung**: cột ROI quảng cáo 30 ngày của từng sản phẩm (endpoint riêng gọi TikTok sau khi bảng lên, 1 call / chiến dịch đang chạy), nhận định "Quảng cáo đang lỗ" (ROI thật < hòa vốn đã tin được), cột Bán 7 / 30 ngày + đà bán, cột Tồn trên sàn + số ngày đủ bán (ngưỡng lấy của bộ chấm Shopee, không đặt số mới); bỏ cột % có giá vốn. (3) **Xóa 4 file mô phỏng tháng 7** không còn trang nào dùng (`tiktok-assistant.ts`, `…-config-tab.tsx`, `…-rule-fields.tsx`, `tiktok-campaign-modal.tsx`, −1.900 dòng). Kiểm local: gian giả nối token nhà CHỈ ĐỌC + đơn thử gắn mã sản phẩm THẬT → ROI quảng cáo thật hiện đúng (TC054 11,69 / tiêu 6,38tr), "Quảng cáo đang lỗ" ra khi hòa vốn thử 17,65 > ROI thật 13,73, hộp diễn tập cũ hiện đúng (chỉ bấm Để em xem lại), PUT live thiếu cờ → 409 không lưu. Dữ liệu thử + token mồ côi đã xóa, env đã trả. CÒN trong phần 3: tách luật video nhà / creator (cần ý anh về cách nhận diện + ngưỡng); token lưu dạng thường + cache ảnh bìa trong RAM (việc hạ tầng, làm cùng đợt hạ tầng); shop chưa vào Business Center (chưa có shop để thử).
- **CHỐT PHIÊN 18/09 KHUYA (lần 2, anh Trung: "dọn dẹp và commit"):** `e370a7e` (cảnh báo diễn tập quá cũ + bổ sung tab Hòa vốn sản phẩm + xóa 4 file mô phỏng) ĐÃ PUSH và prod backend đã lên đúng bản này (`/health` xác nhận). Tree sạch, không còn commit chưa push trước dòng này; DB local sạch (0 gian thử / link / token / đơn thử / chuông thử); env local đã trả; `scripts/out` chỉ còn file có sẵn. CÒN CHỜ: (a) TikTok duyệt quyền Campaign → `docs/TIKTOK-ADS-XIN-QUYEN-CAMPAIGN.md` mục 6; (b) anh xem prod trưa 19/09 (chuông lượt chấm "bớt 1", ghi chú B7 trên lệnh loại tay 20:39, tab Hòa vốn sản phẩm số thật) rồi mới bàn bật Tự loại thật; (c) tách luật video nhà / creator — chờ anh cho cách nhận diện + ngưỡng.
- **18/09 đêm — anh Trung ĐÃ BẬT TỰ LOẠI THẬT cho TC054 trên prod (kèm chuyển mức loại sang ROI hòa vốn) rồi báo "vẫn treo", nghi xung với hòa vốn.** KHÔNG xung, KHÔNG treo: lệnh loại thật chỉ gửi ở LƯỢT CHẤM KẾ TIẾP (12h–14h 19/09) — đổi chế độ sau lượt 14:18 thì hôm nay không bắn (thiết kế từ đầu, docs mục 7C; referenceId một lệnh/ngày cũng chặn). Lỗi thật là CÂU CHỮ: dòng dưới nút gọi tên lượt theo chế độ ĐANG ĐẶT → hiện "Lượt LOẠI gần nhất 18/09: loại 2 video" cho một lượt DIỄN TẬP, nhãn "Sẽ loại" đứng cạnh video vẫn chạy → trông như máy kẹt. Sửa: `autoStatusOf` trả thêm `lastRunMode` (chế độ của chính lượt đó), trang gọi tên theo nó; khi đang live mà chưa có lượt live nào → dòng vàng "Vừa bật Tự loại thật — chưa có lệnh loại nào được gửi. Lượt loại thật đầu tiên chạy ở lượt chấm kế tiếp (12h–14h), máy chấm lại bằng số mới nhất rồi mới loại"; ô lý do của nhãn Sẽ loại ghi rõ "ở lượt chấm kế tiếp, nếu lúc đó video còn vi phạm". ⚠️ Trưa 19/09 = LẦN BẮN LIVE ĐẦU TIÊN — theo dõi chuông + tab Lịch sử + ghi chú B7 hôm sau.
- **18/09 đêm — LOẠI NGAY khi vừa bật Tự loại thật (anh Trung hỏi "đặt thời gian vậy có quá dài không?" → em: nhịp một lượt/ngày thì đúng, nhưng lúc VỪA BẬT chờ tới trưa hôm sau là thừa; anh chốt "đã diễn tập một khoảng thời gian rồi nên thực thi ngay ở lượt đầu là hợp lý"):** lưu xong với chế độ vừa chuyển sang live → popup sang bước Loại ngay: chấm lại tại chỗ, hiện đúng danh sách sẽ loại kèm căn cứ, nút đỏ "Loại ngay N video" / "Để lượt chấm kế tiếp". Backend `POST …/auto-rule/run-now` chấm lại và CHỈ gửi khi danh sách trùng khít cái khách vừa thấy (lệch → 409 `plan_changed`); đi qua đúng `applyAutoPlan` nên giữ mọi chốt an toàn; chỉ sau 12h VN; mã lệnh loại thật tách `…-live` để không bị dòng diễn tập cùng ngày chặn mà vẫn một lệnh thật/ngày (`autoCommandReferenceId` + 2 test). Trang chiến dịch: dòng vàng "vừa bật, chưa gửi lệnh nào" có nút "xem danh sách và loại ngay" (cho TC054 đã lỡ bật trước đó). Kiểm local bằng số thật TC054 (chỉ đọc): bước Loại ngay hiện đúng video anh khoanh (`…738631`, 118.299đ · 2 đơn · ROI 4,17 < 7,5); gửi danh sách lệch → 409, không gửi gì; KHÔNG bấm Loại ngay ở local (token thật). 555 test. Docs mục 7D.
- **18/09 đêm — `1206b2e` (Loại ngay) ĐÃ PUSH, prod đã lên. GÓI HẠ TẦNG RIÊNG TikTok Ads (anh Trung hỏi seller trăm chiến dịch × vài nghìn video có thành vấn đề không → em soi code ra 3 chỗ kẹt; anh: "làm riêng ra không chung đụng gì nhau"):** (1) mọi call TikTok Ads qua van tốc độ theo app 3 call/giây + lùi 2s/6s khi sàn báo quá tải (mã 40016/40100/40133 tra từ docs Return codes) — trước đây gọi thẳng, trong khi hạn mức app là CHUNG mọi seller; (2) rải giờ chấm mỗi gian lệch cố định 0–89 phút trong khung 12h–14h + mỗi worker chỉ một lượt chấm một lúc (không chiếm chỗ đồng bộ đơn); (3) ghi DB theo lô — createMany / updateMany / một câu UPDATE…FROM unnest cho kết luận, thay ~3 lệnh tuần tự mỗi video; (4) chiến dịch chưa bật luật chỉ theo dõi tối đa 10 cái tiêu nhiều nhất; (5) nhớ đệm kết quả hòa vốn 45 giây theo gian + gộp lượt tính trùng. Kiểm local số thật (chỉ đọc, rule diễn tập): trọn lượt chấm 4 chiến dịch / 76 video ≈ 2,3 giây, sổ PLANNED đúng. ★ PHÁT HIỆN: báo cáo video của TikTok THỈNH THOẢNG TRẢ THIẾU DÒNG (12 lần gọi cùng tham số, 3 lần thiếu đúng video `…738631`) → chấm điểm thì vô hại, nhưng B7 "lệnh đã ngấm" và chốt dòng kẹt SENDING kết luận theo sự VẮNG MẶT nên nay đọc 2 lần lấy hợp khi có lệnh cần soi (`hasCommandsToCheck`). 564 test. Docs mục 4 + mục 10.
- **CHỐT PHIÊN 18/09 ĐÊM (lần 3, anh Trung: "dọn dẹp và commit"):** prod backend = `ddedc40` (đã xác nhận /health) — gồm Loại ngay khi vừa bật Tự loại thật + gói hạ tầng riêng TikTok Ads. Tree sạch, không còn commit chưa push trước dòng này; DB local sạch (0 gian thử / link / token / đơn thử / chuông / dòng sổ thử); env local đã trả; `scripts/out` chỉ còn file có sẵn; thư mục nháp của phiên đã xóa. Anh hỏi bài toán lãi/lỗ hạ tầng theo giá gói → đã tính 2 vòng (anh phản biện đúng: khách trả tiền không phải tệp 99k/300 đơn), kết luận ghi ở memory Gói dịch vụ: hạ tầng ≈ 5–16% doanh thu, nhìn theo tiền/đơn thì chỗ mỏng nhất là Business kịch trần (70đ/đơn) và Enterprise → nên đặt giá sàn Enterprise ≥ ~60–70đ/đơn. ĐANG CHỜ: (a) TikTok duyệt quyền Campaign; (b) trưa 19/09 = LƯỢT LOẠI THẬT ĐẦU TIÊN của TC054 (hoặc anh bấm "xem danh sách và loại ngay" trước đó) — giờ chấm nay lệch cố định theo gian trong khung 12h–14h; (c) ý anh về tách luật video nhà / creator; (d) anh chưa trả lời: có kiểm lại giá Supabase để sửa mốc M4 ở HQ Sức khỏe không, có đặt trần số gian theo bậc gói không.
- **18/09 đêm — TRẦN GIAN THEO BẬC GÓI + GIÁ SÀN ENTERPRISE (anh Trung: "có đặt… em tính xem nên đặt trần gian như nào hợp lý, anh nghĩ Starter thì không cần" → em đã trình, anh: "commit lại mai làm"). CHƯA CODE GÌ — ĐỂ MAI.** Đề xuất đã trình, CHỜ ANH CHỐT: trần gian Starter 3 · Growth 5 · Pro 10 · Business 20 · Enterprise thỏa thuận (căn cứ: chi phí theo gian ≤ ~8% giá gói với ~3.000đ/gian/tháng — số ước từ thời gian worker, chưa đo prod; mật độ đơn/gian tăng đều 100→200→300→500; thứ khan hiếm thật là hạn mức API chung của từng app). Starter: anh nghĩ không cần, em phản biện nên đặt 3 (bảng giá nhất quán, 3 = mỗi sàn một gian nên không chặn khách thật nào, chặn đúng kiểu nối hàng chục gian ngủ ăn hạn mức API) — anh chưa phán. Giá sàn Enterprise 60đ/đơn cam kết (tới 50đ khi > 100k đơn/tháng). Máy móc ĐÃ CÓ SẴN: `ServicePlan.maxChannels` + `assertChannelSlot` chặn ở mọi đường nối gian + grandfather. VIỆC MAI (sau khi anh chốt số): (1) sửa `assertChannelSlot` KHÔNG đếm gian OFFLINE (hiện đếm mọi gian ACTIVE → "3 gian" thành 2 gian sàn) + test; (2) cột "đ/đơn" + cảnh báo dưới giá sàn ở HQ Gói dịch vụ; (3) nhập trần vào 4 gói trên prod /admin/plans (dữ liệu thật — anh nhập hoặc bảo em); (4) sửa bảng giá landing in tĩnh (`pricing.tsx`, repo hubsell-landing) hiện số gian theo gói. Còn treo từ trước: có kiểm lại giá Supabase để sửa mốc M4 ở HQ Sức khỏe không (anh chưa trả lời).
- **19/09 — TRẦN GIAN THEO BẬC GÓI: ANH TRUNG CHỐT SỐ + ĐÃ CODE (chưa commit / chưa push tại thời điểm ghi).** Anh chốt: **Starter 3 · Growth 5 · Pro 10 · Business 20 · Enterprise thỏa thuận** (Starter CÓ trần — 3 = mỗi sàn một gian); nhập trần trên prod = em thao tác qua Chrome của anh, hỏi xác nhận từng gói trước khi Lưu, làm SAU KHI backend đã lên bản này. Code: (1) `plan-enforcement.ts` — `countedChannelWhere` là MỘT định nghĩa cho cả số hiển thị (`usage.channels`) lẫn chốt chặn: gian ACTIVE và KHÔNG phải OFFLINE; cửa tạo gian tay bỏ qua `assertChannelSlot` khi tạo gian OFFLINE (không đồng bộ, không ăn hạn mức API sàn); câu báo lỗi + nhãn trang Gói dịch vụ ghi rõ "gian hàng trên sàn"; +1 test (565 pass). (2) HQ Gói dịch vụ: mỗi thẻ gói có dòng "≈ N đ/đơn khi kịch trần · kỳ 12 tháng N đ/đơn" (gói không đặt trần đơn thì không hiện — không bịa mẫu số), vàng khi dưới giá sàn; hộp Ghi nhận thanh toán: số tiền LỆCH giá niêm yết (= số thỏa thuận) mà quy ra đ/đơn kịch trần < giá sàn → dòng vàng, CHỈ CẢNH BÁO vẫn ghi nhận được; giá niêm yết đã chốt thì không nhắc (Business kỳ năm ≈ 58đ là số anh đã chốt). Giá sàn = hằng số đầu file `admin/plans/page.tsx`: 60đ/đơn, 50đ khi trần > 100.000 đơn/tháng. Nhãn ô "Trần gian hàng" → "Trần gian sàn". Đã soi local (proxy 8099): thẻ Beta 330đ/đơn, nhập 10.000đ → cảnh báo 33,3đ/đơn; env local đã trả. (3) Landing `pricing.tsx` (repo hubsell-landing): thẻ gói thay dòng "Kết nối Shopee, Lazada & TikTok Shop" bằng "N gian hàng Shopee, Lazada, TikTok Shop" (Enterprise "Thỏa thuận số gian hàng") + hàng số gian trong bảng chi tiết. CÒN: commit + push 2 repo → nhập 3/5/10/20 trên prod → kiểm /settings/plan prod hiện đúng trần.
- **19/09 (tiếp) — phần trần gian ĐÃ PUSH (`3512ac0`, landing `0b25e57`), trần 3/5/10/20 ĐÃ NHẬP prod /admin/plans (em thao tác qua Chrome của anh, anh duyệt lưu cả 3 gói; Growth vốn sẵn 5 gian và đang là gói MẶC ĐỊNH trên prod).** BẬC SCALE: anh bắt bẻ "Enterprise tối thiểu 20.000 đơn / 1,2tr phải qua tư vấn" (khách Business vượt trần buộc phải lên, đắt hơn đối thủ là mất khách) → khảo sát 3 nhánh (memory `hubsell-khao-sat-gia-tren-10k-don`): không hãng nào đặt tường "liên hệ sales" ở 10.000 đơn; BigSeller 20.000 đơn trả tháng = 1,402tr (70đ), Ginee ≈ 1,155tr (trả năm); anh nhắc đúng: giá rẻ của Haravan / Nhanh / BigSeller Pro là giá kỳ 1–2 năm trả một cục 8–31tr. ANH CHỐT: bậc TỰ MUA **Scale 20.000 đơn · 60đ/đơn → 1.199.000đ/tháng** (3 tháng 3.399k · 6 tháng 6.399k · 12 tháng 11.990k — cùng nhịp −6% / −11% / tặng 2 tháng của Pro, Business) · **40 gian sàn** · bảng giá **2 hàng × 3 thẻ** · gói mua thêm 1.000 đơn ĐỂ ĐỢT SAU. Code (chưa commit lúc ghi): landing `pricing.tsx` thêm thẻ Scale + cột thứ 6 bảng chi tiết + lưới 3 cột + câu "Trả theo tháng, không phí khởi tạo, không cam kết năm" + sửa câu "khác biệt duy nhất là hạn mức đơn" (nay còn số gian); app `/settings/plan` lưới 3 cột, thẻ Enterprise ghi "Cho shop trên N đơn/tháng" (N = trần gói tự mua lớn nhất, lấy từ bảng giá thật) + "Số gian hàng theo thỏa thuận"; HQ giá sàn đổi thành BẬC GIẢM DẦN 60đ → 45đ (từ 50.000 đơn) → 33đ (từ 100.000 đơn) bám mặt bằng khảo sát, vẫn chỉ cảnh báo; script seed thêm SCALE tier 5 (Enterprise → tier 6) + trần gian 3/5/10/20/40. ✅ XONG TRỌN 19/09: anh gật "Push + tạo gói Scale Đang bán" → push `a023828` (landing `f76ae1e`); trên prod /admin/plans (qua Chrome của anh): Enterprise đổi bậc 5 → 6 + mô tả "Trên 20.000 đơn/tháng", TẠO gói SCALE bậc 5 · 1.199.000 / 3.399.000 / 6.399.000 / 11.990.000 · 20.000 đơn · 40 gian · dùng thử 14 ngày · Đang bán. Lộ lỗi của em: thẻ Scale báo vàng "dưới giá sàn 60đ" vì 1.199.000 / 20.000 = 59,95đ → `844f39a` so theo số đã làm tròn (`isBelowFloor`). Đã kiểm prod: /settings/plan hiện 2 hàng × 3 thẻ, Scale có nút Thanh toán ngay, Enterprise "Cho shop trên 20.000 đơn/tháng"; landing hubsell.tech có thẻ Scale. CÒN TREO: gói mua thêm 1.000 đơn (đợt sau, khi có khách kẹt 10–13 nghìn đơn kêu); kỳ thanh toán tối thiểu của Sapo / KiotViet chưa xác minh được.
- **CHỐT PHIÊN 19/09 (anh Trung: "dọn dẹp và commit"):** prod app = `844f39a` (code) — trần gian theo bậc gói 3 / 5 / 10 / 20 / 40 (gian Offline không tính), bậc SCALE 20.000 đơn · 1.199k LIVE, Enterprise = trên 20.000 đơn (bậc 6), HQ có dòng đ/đơn + giá sàn giảm dần 60 → 45 → 33đ chỉ cảnh báo; landing `f76ae1e` 6 thẻ 2 hàng × 3. Đã kiểm HQ prod sau bản vá: thẻ Scale hết báo vàng giả, hộp Ghi nhận thanh toán cảnh báo đúng (gõ thử 900.000đ → 45đ/đơn, bấm Huỷ — không ghi nhận gì, doanh thu tháng vẫn 99.000đ). Tree sạch cả 2 repo, không còn commit chưa push trước dòng này; DB local sạch (0 user / gian / gói thử của test trần gói); env local đã trả; proxy + server đã tắt; thư mục nháp của phiên đã xóa; tab trình duyệt đã đóng. ĐANG CHỜ: (a) gói mua thêm 1.000 đơn (~90k) — anh chốt để đợt sau; (b) kỳ thanh toán tối thiểu của Sapo / KiotViet chưa xác minh; (c) gói MẶC ĐỊNH trên prod đang là Growth chứ không phải Starter — anh chưa nói cố ý hay không; (d) lượt loại thật đầu tiên của TC054 (12h–14h 19/09) — phiên sau hỏi kết quả; (e) TikTok duyệt quyền Campaign; (f) ý anh về tách luật video nhà / creator; (g) giá Supabase cho mốc M4 ở HQ Sức khỏe.
- **Việc kế:** push → bật Diễn tập cho TC054 trên prod, theo dõi vài hôm (kể cả câu hỏi "sàn có đưa video quay lại Đang học không" — log `học lại`) rồi mới bật thật.

## Phiên 17/09/2026 tối — Quảng cáo TikTok GMV Max: app Marketing API được duyệt → probe T1 → GĐ1 (ĐÃ PUSH df30bbc + bản vá kiểm lại tài khoản quảng cáo)

- **App "Hubsell" trên TikTok Marketing API được duyệt** (App ID 7686282112950747157, scope chỉ đọc + loại video). Probe thật bằng TKQC nhà: 1 lần ủy quyền = token thấy 5 tài khoản quảng cáo, mỗi tài khoản thấy nhiều shop; chỉ tài khoản ĐỘC QUYỀN GMV Max của shop (`exclusive_authorized_advertiser_info`) mới có số; report gồm cả campaign tạo từ Seller Center; 1 campaign thật có 1.779 video.
- **Anh Trung lưu ý:** một tài khoản quảng cáo chạy cho rất nhiều shop, kể cả nhiều seller (người chạy quảng cáo thuê). Thiết kế theo đó: token chỉ là chìa khóa (bảng `tiktok_ads_auths`, theo chủ shop, KHÔNG unique theo advertiser); quyền xem số do `tiktok_ads_store_links` quyết định và link CHỈ tạo cho gian TikTok chủ shop đã nối app chính (store_id = Channel.externalShopId — bằng chứng sở hữu). Shop seller khác trong cùng token: không lưu, không gọi report. Không dò ra gian nào → không giữ token. Người giữ tài khoản quảng cáo có thể không phải chủ shop → link ủy quyền gửi đi được (state ký 7 ngày) + callback công khai nhận diện bằng state. Migration `20260917235000_tiktok_ads_auth` (Render tự migrate deploy).
- **Backend:** `integrations/tiktok-ads/` (config, client, oauth tự dò gian, report 3 tầng, sync) · `routes/tiktok-ads.ts` (status / auth-url?invite=1 / gỡ + POST công khai `/api/auth/tiktok-ads/connect`) · `routes/ads-tiktok.ts` (`GET /api/ads/tiktok` tổng quan từ DB, `GET /campaigns/:id/videos` soi SỐNG sản phẩm→video, `POST /refresh`). Worker `order-auto-sync`: gian TikTok đã nối quảng cáo chạy xung 60' (2 ngày, 1 call) + lịch sử 6h (7/30 ngày); chưa nối thì bỏ qua như cũ; KHÔNG executor.
- **Dùng lại bảng AdsCampaign + AdsCampaignDailyPerf** (adType `gmv_max`, broad = direct vì GMV Max chỉ có một bộ số). **KHÔNG ghi AdSpend**: phí GMV Max đã bị trừ trong quyết toán từng đơn (`tiktok/settlements.ts` gmv_max_ad_fee_amount → serviceFee) — ghi nữa là Lãi/Lỗ trừ hai lần. Cũng vì thế CHƯA làm ROAS hòa vốn cho TikTok (biên lãi "chưa trừ ads" phải bóc riêng — cần tính rõ rồi trình).
- **Gotcha API:** metric thuộc tính (tên SP, tên video...) lỗi 40002 khi dimensions có ≥2 chiều ID → tầng video không bao giờ có tên, UI hiện mã + link `tiktok.com/@/video/{id}`; chi phí video trễ tới 11h; ROI gộp đơn tự nhiên.
- **Frontend:** `/ads/tiktok` thay trang "sắp ra mắt" (`components/ads/tiktok-ads-page.tsx`): chưa nối = MỘT nút Kết nối + dòng nhỏ "Người khác giữ tài khoản quảng cáo? Sao chép link gửi họ"; đã nối = 4 thẻ số + biểu đồ + bảng campaign (ROI thực đỏ khi dưới ROI mục tiêu) + hộp soi video tiêu tiền không ra đơn. `/ads/tiktok/callback` = trang nhận auth_code (không đòi đăng nhập; có trạm chuyển tiếp về localhost cho dev). Backend chưa đặt env thì trang tự hiện lại "sắp ra mắt".
- **Đã kiểm local bằng số thật** (gian giả mang store_id thật, đã xóa sau khi thử): dò link 0,9s, đồng bộ 30 ngày 20 campaign/120 dòng trong 2s; tsc BE+FE sạch, eslint sạch, 464 test pass.
- **Tài khoản quảng cáo TikTok là thực thể RỜI shop (anh Trung nhắc 17/09, khác Shopee — quyền ads gắn chết vào shop):** ngoài việc ủy quyền bằng tài khoản bất kỳ + link mời, thêm `verifyTiktokAdsLink` chạy mỗi lượt lịch sử 6h (1 call store/list): shop đổi người chạy thuê / chuyển quyền độc quyền GMV Max → tài khoản mới nằm trong token thì TỰ chuyển link, không thì NO_ACCESS kèm lý do nêu tên tài khoản mới, trang hiện dải đỏ + nút Kết nối lại. Đã thử thật cả hai nhánh bằng token nhà.
- **Bảng "Tài khoản quảng cáo của từng gian" (anh Trung 17/09: 3 shop có thể là 3 tài khoản quảng cáo khác nhau; nút Kết nối đứng một mình giữa trang thì khách không biết đang nối cho gian nào):** đầu trang /ads/tiktok mỗi gian MỘT DÒNG `tên gian → nút Kết nối TikTok Ads` (đã nối: chấm xanh + tên tài khoản quảng cáo + Xem số/Đang xem; hỏng: Kết nối lại + lý do đỏ), bỏ ô chọn gian ở góc. Nút mang GIAN ĐÍCH trong state → trang callback nói về đúng gian đó (gian đích không thuộc tài khoản vừa ủy quyền thì báo vàng kèm lý do, vẫn nối các gian tài khoản đó phủ được); không kể lể các gian khác đang dùng tài khoản khác.
- **Tách tab (anh Trung 17/09 khuya: bày bảng kết nối chung thì khách nhiều gian rối cả trang):** /ads/tiktok có 2 tab *Tổng quan chiến dịch* / *Kết nối tài khoản quảng cáo* (chip vàng = số gian chưa nối hoặc cần nối lại). Chưa nối gian nào → mở thẳng tab Kết nối; đã nối → mở Tổng quan, ô chọn gian chỉ liệt kê gian ĐÃ nối, tự nhảy sang gian có số; nút Xem số ở tab Kết nối đưa về Tổng quan đúng gian; kết nối hỏng → dải đỏ ở Tổng quan dẫn sang tab Kết nối.
- **✅ Anh ủy quyền thật trên prod 17/09 khuya:** and.not.or nối đúng tài khoản quảng cáo nhà, store_id = externalShopId KHỚP, worker kéo số, soi video đọc sống OK.
- **Trang riêng soi video thay popup (anh duyệt bản nháp local "khá được"):** `/ads/tiktok/campaign?id=&days=` — đầu trang ROI mục tiêu vs thực, 3 số kết luận, chip lọc nhanh (Tất cả / Chưa ra đơn / Có đơn ROI dưới mục tiêu / Đang học) + ô Chi phí từ + sắp xếp (chi phí, đơn, ROI, tỷ lệ bấm, chuyển đổi), bảng 20 video/trang có ẢNH BÌA + @kênh + caption. Nguồn ảnh/tên: oEmbed công khai của TikTok (`integrations/tiktok-ads/video-meta.ts`, nhớ đệm RAM 3h, ≤24 id/lượt) vì API chính thức `/gmv_max/video/get` chỉ trả video của tài khoản nhà, không trả video creator/affiliate — nhóm chiếm đa số và là nơi tiền rơi. Tỷ lệ bấm/chuyển đổi sàn trả sẵn phần trăm. Popup cũ đã xóa. **Treo (anh bảo từ từ):** thẻ + luật "có đơn nhưng ROI thấp" (số thật TC054: 6 video ngốn ~1,56tr/7 ngày, lớn hơn nhóm 0 đơn 293k) — chờ có giá vốn để biết ROI bao nhiêu mới là lỗ thật.
- **LOẠI VIDEO THỦ CÔNG (lệnh GHI đầu tiên lên TikTok Ads, anh duyệt bản local 17/09):** trang chiến dịch có cột tick (chỉ chủ shop, chỉ khi chiến dịch đang bật) → thanh "Đã chọn N video · Loại khỏi chiến dịch" → hộp xác nhận → `POST /api/ads/tiktok/campaigns/:id/videos/action` (requireAdmin, kiểm lại quyền tài khoản quảng cáo ngay trước lệnh, ≤400 video/lượt) gọi `/campaign/gmv_max/creative/update/` REMOVE|ADD. Sàn không trả kết quả từng video và ~20 phút mới đổi trạng thái → dòng mang nhãn vàng "Đang chờ TikTok loại/khôi phục" 30 phút (đọc từ AdsActionLog: action exclude_video|restore_video, mode live, verdict manual, reasons mỗi dòng "#<videoId> …"). Chip "Đã loại" liệt kê video EXCLUDED (kể cả loại từ Seller Center — TC054 có 140) + Khôi phục; cuối trang có lịch sử thao tác kèm nguyên văn lỗi sàn khi bị từ chối. **✅ 17/09 22h15 anh bắn lệnh thật đầu tiên trên prod: TikTok NHẬN, 22:18 còn DELIVERING → 22:23 đã EXCLUDED (áp dụng ~5–8 phút, nhanh hơn mức 20 phút docs ghi)** — chạy được với campaign tạo từ Seller Center + video affiliate, không cần quyền Campaign; rủi ro từng lo: rủi ro đã biết: sàn đòi Product GMV Max ở chế độ tự chọn video (AUTO_SELECTION), Hubsell không đọc được cờ này vì chưa xin quyền Campaign.
- **Bảng video TRONG HỘP như trang Lãi/Lỗ thực hiện (anh Trung 17/09):** dùng chung `PNL_TABLE_SCROLLER` + `PNL_STICKY_HEAD` (cuộn dọc/ngang trong hộp cao gần bằng màn hình, tiêu đề cột bám đỉnh hộp, KHÔNG overscroll-contain), `border-separate` để viền ô không trôi khi sticky; chọn 20/50/100 dòng mỗi trang; ảnh bìa hỏi theo lô 20 video (`useQueries`) để trang 100 dòng hiện ảnh dần.
- **Tinh chỉnh bảng video theo góp ý anh 17/09 khuya:** mã video luôn hiện dưới tên kênh + nút sao chép một chạm (530f232); SẮP XẾP NGAY TẠI TIÊU ĐỀ CỘT thay ô chọn ở lề phải — Chi phí / Đơn / Doanh thu / Tỷ lệ bấm / Chuyển đổi / ROI, bấm = cao→thấp, bấm lần nữa = thấp→cao, mũi tên ↓↑ ở cột đang xếp, aria-sort. Anh đã thử cả chiều Khôi phục video trên prod.
- **Bộ lọc thời gian CHUẨN + lịch sử có mã video (anh Trung 17/09 khuya):** trang chiến dịch thay 4 nút Hôm nay/7/14/30 bằng `DateRangePicker` dùng chung của app (phím nhanh + lịch chọn tay); backend `/campaigns/:id/videos` nhận `from`/`to` (kẹp ≤ hôm nay, dài tối đa 366 ngày — đã probe tầng video nhận tới 366 ngày vì không có chiều thời gian; `days` trên URL chỉ còn là khoảng khởi đầu mang từ Tổng quan sang). Lịch sử loại/khôi phục: mỗi lệnh hiện nhãn nguồn ("Loại thủ công" / "Khôi phục thủ công" / "Trợ lý tự động loại" + dòng "Căn cứ: …" cho lệnh tự động — quy ước lưu: dòng reasons KHÔNG mở đầu bằng #mã video là căn cứ), mã từng video kèm nút sao chép + số liệu lúc thao tác, nguyên văn lỗi sàn khi bị từ chối.
- **Cột CPA + sắp lại cột (anh Trung 17/09 khuya):** thêm cột *Chi phí / đơn* (CPA = chi phí ÷ đơn, anh: "rất quan trọng") đứng ngay sau Đơn, có sắp xếp; video chưa ra đơn hiện "—" và LUÔN xếp cuối ở cả hai chiều. Thứ tự cột chốt: Chi phí · Đơn · Chi phí/đơn · Doanh thu · ROI · rồi hai cột TỶ LỆ % (Tỷ lệ bấm, Chuyển đổi) dồn về cuối bên phải. Bỏ ô lọc "Chi phí từ" (anh: không cần nữa — đã có sắp xếp theo cột).
- **Dọn code cuối phiên 17/09:** tách 2 mẩu logic thuần khỏi route → `report.ts: clampGmvMaxRange` + `action-log.ts` (quy ước ghi/đọc sổ thao tác video) kèm 9 test `tiktok-ads.test.ts`; `getGmvMaxStores` trả `GmvMaxStore[]` có kiểu (hết ép kiểu rải rác); bỏ hàm chết (`fetchGmvMaxStoreDaily`, route + hàm FE `/status`, hàm FE gỡ kết nối chưa có nút gọi — API DELETE /link vẫn giữ); gom `formatRoi/formatPct` về `tiktok-ads-format.ts`; sửa chú thích lỗi thời (mã lỗi 40002, "preview mock", log khởi động worker thêm TikTok). Bản đồ kỹ thuật + bài học API + khung việc cấu hình tự động: **docs/ADS-TIKTOK-GMV-MAX.md**.
- **Loại TỰ ĐỘNG: TREO — anh bảo "còn phải nghiên cứu lại cho hợp lý".** Đã trình khung (3 mức Tắt/Diễn tập/Tự loại; 6 trường hợp kế thừa bộ luật 2 lớp tháng 7; 3 chỗ API thật buộc đổi: không có giờ chạy → dùng mức tiêu + trạng thái Đang học của sàn, không có số theo giờ + chi phí trễ 11h → bỏ luật đột biến 2 giờ, ân hạn theo ngày). Đừng tự làm khi anh chưa gọi.
- **Việc còn lại để lên prod:** (1) anh đặt `TIKTOK_ADS_APP_ID` + `TIKTOK_ADS_SECRET` trên Render; (2) commit + push; (3) anh bấm Kết nối trên prod bằng TKQC nhà → xác minh store_id = externalShopId của gian and.not.or thật (local không có gian TikTok nên chưa so được; lệch thì khớp dự phòng bằng store_code). **GĐ2:** tên/ảnh video (`/gmv_max/video/get`), luật + nút loại video (`/campaign/gmv_max/creative/update`, scope đã có), ROAS hòa vốn TikTok.

---

## Phiên 17/09/2026 khuya — Tab "MAPPING GIÁ VỐN": nhập giá một lần cho mọi gian, mọi sàn (✅ ANH CHỐT XONG PHẦN NÀY)

- **Vì sao:** tab Nhập giá vốn tách theo từng gian → 1 mẫu 10 phân loại × 10 shop × 3 sàn là cả trăm ô phải gõ. Anh Trung chốt nhiệm vụ của tab mới: (1) **tự phát hiện** SKU đã có giá ở một gian → đề xuất mapping sang gian còn lại; (2) seller **tìm SKU, nhập một lần**, có nút áp cho mọi gian. Bản đầu em làm kiểu "chọn gian nguồn → áp cả gian" đã bị bác — đừng quay lại hướng đó.
- **a5fdeed:** trang Cấu hình Giá vốn thêm tablist *Nhập giá vốn / Mapping giá vốn* (tab nhập chỉ ẨN, không tháo, để giữ ô đang gõ). Tab Mapping: **mỗi MÃ SKU một dòng gộp mọi gian** (mã chuẩn hoá trim + NFC + IN HOA — NFC vì các sàn trả dấu tiếng Việt khác dạng; CHỈ khớp theo mã, không bao giờ theo tên). 4 trạng thái: *đề xuất điền* / *lệch giá giữa các gian* (không đoán — bấm chip giá của gian đúng) / *chưa có giá* / *đã đủ*. Dải xanh "Hubsell phát hiện N mã…" + MỘT nút **Điền tất cả** (chỉ điền ô trống). Mỗi dòng: ô giá + **Áp dụng N gian**; dòng mẫu cha: **Giá vốn chung + Áp dụng cả mẫu**. Ghi đè giá khác phải qua popover liệt kê nơi bị đè. Máy chủ luôn tính lại, không tin số client.
- **Bảng giá theo mã mẫu** (bảng mới `cost_price_rules`, migration `20260917210000`): `TBSA01` khớp `TBSA01-Vàng-XXL` (tiền tố phải dừng ở dấu ngăn cách, mã dài thắng mã ngắn) + nhập Excel + xuất SKU chưa khớp đúng khuôn file nhập. Là KHUÔN, không phải nguồn giá vốn thứ ba — khi áp vẫn ghi xuống `Product.costPrice` / `ChannelProduct.costPrice`. Thu gọn ở cuối tab.
- **Tự điền khi đồng bộ:** SKU vừa tạo, chưa nối kho, trống giá → lấy theo bảng giá, không có thì theo SKU trùng mã ở gian khác (chỉ khi các gian thống nhất một giá). Thông báo "Đồng bộ xong" nói rõ số SKU được tự điền (dc5d040).
- **Kỹ thuật:** `lib/cost-mapping.ts` (phần thuần có 7 test vitest) · `lib/cost-price.ts` = `applyCostPrice`/`applyChannelCostPrice` tách khỏi `finance.ts`, vá đơn cũ gom theo GIAN thay vì lặp từng SKU trong transaction · `routes/cost-mapping.ts` gắn dưới `/api/finance/cost-prices` (`mapping/skus`, `mapping/fill-suggested`, `mapping/set-cost`, `rules*`).
- **Gợi ý tại chỗ (anh chốt làm luôn):** lưu giá ở tab *Nhập giá vốn* (từng ô hoặc "Giá vốn chung") mà mã đó còn ở gian khác chưa có giá → toast kèm nút **Áp dụng N ô trống** ngay tại chỗ (`update-cost`/`update-cost-bulk` trả thêm `siblings`, nút gọi `fill-suggested { codes }`); gian khác đang mang giá KHÁC thì toast dẫn sang tab Mapping. Khách không cần biết có tab Mapping vẫn được nhắc.
- **Lệch giá: ghi đè hoặc giữ nguyên, chọn xong KHÔNG nhắc lại:** dòng lệch giá có thêm "Giữ giá riêng từng gian, không nhắc nữa" → bảng mới `cost_conflict_dismissals` (migration `20260917233000`); mã đã giữ nguyên thôi tính là lệch giá (đủ giá = Đã đủ, còn gian trống = Chưa có giá), thôi gợi ý tại chỗ; có nút "Nhắc lại"; đặt một giá chung cho mã đó là tự xoá quyết định cũ. 8 test.
- Anh chốt: khách đặt mã SKU không kỷ luật thì khách tự đi mà kỷ luật — Hubsell KHÔNG làm khớp theo tên / khớp mờ.
- **d61d10f — thẳng cột ô nhập (anh soi prod thấy lộn xộn):** ô "Giá vốn chung" (dòng cha) và "Nhập giá vốn" (dòng con) giờ thẳng một cột — thứ đứng sau ô nhập (nút Áp dụng / dấu tick) chiếm khe rộng CỐ ĐỊNH (`ACTION_SLOT`), tiêu đề cột canh theo mép ô nhập. Ô cha cùng họ vàng nhưng đậm hơn một bậc, CHỈ khi mẫu còn phân loại thiếu giá (vàng = còn thiếu giá vốn), đủ giá thì trung tính. Tab Mapping sửa cùng bệnh (nút dài ngắn khác nhau → khe 8.5rem). Quy tắc cho bảng sau này: ô nhập nhiều tầng phải chung mép, phần đuôi để trong khe cố định.
- ✅ Đóng phần này 17/09 (a5fdeed → dc5d040 → 1bed861 → d61d10f, tree sạch, data test local đã dọn). Chỉ còn việc QUAN SÁT khi có dịp, không phải việc treo: dải xanh trên prod báo bao nhiêu mã (= tỷ lệ trùng mã thật giữa Shopee/TikTok/Lazada), phím Enter trong ô giá, bố cục chip khi shop ≥5 gian. Bảng giá theo mã mẫu nếu ít khách dùng thì cân nhắc gỡ.

---

## Phiên 17/09/2026 tối — CỔNG THANH TOÁN payOS BẬT PRODUCTION (giao dịch thật đầu tiên)

- Có tài khoản MB doanh nghiệp **55995995995**; anh liên kết payOS, tạo kênh Hubsell, đặt 8 env Render (5 `PAYOS_*` + 3 `PLAN_PAYMENT_BANK_*`), dán webhook. Thứ tự bắt buộc: env TRƯỚC rồi mới dán webhook (chưa có khóa `/api/webhooks/payos` trả 503).
- Giao dịch thật đầu tiên: shop nhà mua Starter tháng 99.000₫ (đơn 1789625317834836) → tiền về → gói gán 17/9–17/10/2026, payOS ghi 1 đơn (gói giao dịch 1/500), nội dung CK đủ `HS STARTER 17834836`.
- payOS cấp **tài khoản định danh** (VQRQAMB…) cho QR chứ không hiện 55995995995 → landing `/payment` in STK + giải thích số định danh, khuyên khách đối chiếu TÊN chủ tài khoản (landing 02065aa).
- **c0e116d:** anh so hộp thoại QR tự vẽ với trang của payOS và chốt dùng trang payOS → `goToCheckout` chuyển cùng tab sang `checkoutUrl`; payOS trả về `?checkout=` thì `GatewayCheckoutDialog` hiện Thành công/Đã hủy; dải vàng "Tiếp tục thanh toán"; nhả cờ `redirecting` khi bfcache. Hộp thoại QR (đã dựng lại một lớp + xanh thương hiệu) giữ làm dự phòng. Nội dung CK tay đổi "email" → "số điện thoại" (app ngân hàng không gõ được @).
- 🔜 Còn: 1 đơn thật kiểm luồng redirect trên prod; HQ gán Business cho shop nhà (đang Starter 300 đơn, tháng này 1.372 đơn → khóa tính năng nâng cao); kiểm HQ Kế toán có dòng thu; in STK vào hợp đồng SaaS.

---

## Phiên 17/09/2026 — App Hubsell Ads LIVE + Trợ lý quảng cáo Shopee đợt A, D (chốt tạm, phần còn lại gác)

### App Hubsell Ads (Ads Service, Live Partner 2044679) chạy thật
- Shopee duyệt Go-Live. Env Render lần đầu dán NHẦM partner app chính (2040029) — bắt được qua `id` trong state trang đăng nhập Shopee trước khi ủy quyền; sửa đúng `HUBSELL_ADS_PARTNER_ID/KEY` Live, không đặt `HUBSELL_ADS_ENV`. Bẫy Render: thêm biến trùng tên báo "Duplicate key" → sửa tại chỗ dòng cũ.
- ANO nối 09:55, xung ads chạy sau 50 giây bằng key Live (ví 54.510 → 33.382₫, số 16–17/09 về). **DarkMan chưa nối.**
- Giao diện ủy quyền (72ad21b): bỏ thẻ to → MỘT nút cạnh "Làm mới" (cam Kết nối / vàng Kết nối lại / xám "✓ Hubsell Ads · Gỡ"); "Cập nhật lúc" dời xuống mép phải hàng tab; thẻ Trung tâm điều hành + chuông `ads-app-not-linked` / `ads-app-expired` cho gian ĐANG chạy ads mà chưa nối (`detectHubsellAdsLinkGaps`).
- Callback nới (cbf4be7): đăng nhập tài khoản gian Shopee KHÁC của cùng chủ shop thì nối luôn gian đó; chỉ chặn khi shop_id không thuộc gian nào của chủ shop.
- Anh chốt định hướng: khách phải dùng TRỌN Hubsell, Ads chỉ gắn trên gian đã nối app chính — không làm luồng Ads-only.

### Khảo sát đủ 26 endpoint Ads API + lộ trình 4 đợt → `docs/ADS-SHOPEE-KHAI-THAC-API.md`
- **Đợt A (809fbef) — mục tiêu ROAS trên sàn thấp hơn hòa vốn:** `assessRoasTarget` thuần; cột "Mục tiêu" đỏ/vàng, dải vàng đếm campaign, khối cảnh báo + nút "Nâng lên X" trong modal (`POST campaigns/:id/roas-target` → `change_roas_target`, sổ mode manual), cột "Đang đặt" ở tab hòa vốn SP. 0 call sàn mới.
- **Đợt D (2b36391 → 09bf776 → e32a57c) — tab "Gợi ý chạy ads" (chỉ Shopee):** bộ chấm thuần 3 tầng `ads-recommend.ts` (cổng loại → điểm → đề xuất 3 mức mục tiêu + ngân sách chặn trần), hộp thoại căn cứ + MỘT nút "Tạo chiến dịch"; bảng mới `ads_item_signals` + `AdsCampaign.createdByHubsellAt/hubsellProposal` (migration 20260917140000); đồng bộ tín hiệu thật của sàn (`ads-item-signals.ts`: nền 1 lần/ngày trong worker, nút "Lấy số của sàn", tự lấy riêng SP khi mở hộp thoại); route đọc thử.
- **Probe thật trên ANO chỉnh 4 chỗ khác tài liệu:** `views` không phải trọn đời (→ tỉ lệ chuyển đổi = số bán 30 ngày Hubsell ÷ views); `ongoing_ad_type_list` thật là `no_ongoing_promotion`; ngân sách tối thiểu sàn 100.000₫/ngày; `max_budget` 9999999999 = không giới hạn. ANO 65/67 SP đang bán thiếu giá vốn → cả bảng "Chưa nên" → thêm dải nhắc + nút sang Cấu hình Giá vốn.
- DataTable thêm `stickyHeader` (bảng cuộn trong hộp, tiêu đề bám dính, thanh ngang luôn thấy) cho 3 bảng ads; bỏ `overscroll-contain` ở DataTable (6b49f1b) và Lãi/Lỗ thực hiện (7a5ff1a) vì lăn chuột đứng im khi bảng hết chỗ cuộn — anh thử tay xác nhận mượt hơn.

### 🔜 Gác lại (anh chốt: khách yêu cầu thì làm) — đủ 14 mục ở `docs/ADS-SHOPEE-KHAI-THAC-API.md` mục 7
1. Hai lệnh ghi chưa bắn sống: `create_manual_product_ads` (cần 1 SP ANO có giá vốn), `change_roas_target`.
2. Từ khóa gợi ý của sàn trả rỗng (thử `input_keyword`); đợt B (hạ ngân sách trước khi tắt + cờ ví tự nạp); đợt C (bảng từ khóa); GMS/GMV Max cấp shop.
3. DarkMan nối Hubsell Ads; nhập giá vốn ANO để bảng gợi ý có nội dung.

---

## Phiên 16/09/2026 tối — Vận đơn TikTok có danh sách SP + nộp lại xét duyệt app TikTok + đăng ký TikTok Marketing API

### Vận đơn TikTok (d0be52f)
- Anh in thử đơn thật: tem `SHIPPING_LABEL` trần không có danh sách sản phẩm như bản Seller Center in. Adapter `fulfillment/tiktok.ts` nay xin `SHIPPING_LABEL_AND_PACKING_SLIP` trước, sàn/hãng từ chối mới lùi về tem trần (`fetchTikTokLabelPdf`, +6 test). Anh in lại prod xác nhận OK — shop bán 1 món/đơn không cần in thêm phiếu xuất hàng Hubsell.

### Xét duyệt app TikTok Shop bị từ chối → nộp lại (e7e1d10)
- Lý do sàn: ảnh/video không thấy dữ liệu TikTok (mã đơn phải 18 số đầu 57/58, ID sản phẩm đầu 17) — bộ ảnh cũ lấy từ tour Shopee/Lazada chung.
- Sửa: tab "Sản phẩm trên sàn" hiện `ID sàn <externalId>` cạnh SKU (route `/api/mappings` vốn đã trả externalId); seed reviewer sinh mã đơn TikTok 18 số `5860…` + externalId `17…` (19 số); script `scripts/fix-reviewer-tiktok-ids.ts` (xem trước / `--apply`) chữa tại chỗ 1.072 đơn + 12 SKU của gian "Hubsell Demo Store" trên prod — anh đã chạy.
- Đã nộp lại ~22h55 với 5 ảnh anh tự chụp + video anh quay (ffmpeg cắt bỏ thanh Chrome/taskbar), hướng dẫn kiểm thử EN 498/500. Chờ 10-12 ngày. Bài học: ảnh/video nộp sàn KHÔNG chụp qua Chrome đang bật tiện ích Claude (icon/con trỏ cam lẫn vào).

### Chat API Shopee — đóng hẳn
- Shopee trả lời ticket: từ 18/11/2024 Chat API chỉ cấp cho app loại Seller, KHÔNG cấp cho ISV/Third-party. Anh chốt hoãn xử lý (ẩn chat Shopee / deep link / chuyển trọng tâm chat sang TikTok), gom làm khi app TikTok được duyệt.

### TikTok Marketing API (GMV Max) — khảo sát + đăng ký
- GMV Max có API đầy đủ ở hệ riêng business-api.tiktok.com (không phải TikTok Shop Partner API): report từng video `/gmv_max/report/get/`, loại/khôi phục video `/campaign/gmv_max/creative/update/`, bật tắt campaign `/campaign/status/update/`. Chi tiết endpoint + điều kiện Business Center ghi trong memory `hubsell-tiktok-gmv-max-api`.
- Đã đăng ký developer (CÔNG TY TNHH CÔNG NGHỆ HUBSELL, dev@hubsell.tech, Technology Company) + tạo app "Hubsell" (Pending): redirect `https://app.hubsell.tech/ads/tiktok/callback`, scope chỉ đọc + loại video (Ad account information, GMV Max › Store management + Identity and video, Reporting › GMV Max reports). Chưa xin nhóm Campaign (tắt/bật campaign).

### Landing (repo hubsell-landing, a086e5a)
- Thêm TikTok Shop vào bullet 5 gói bảng giá, hero, meta SEO/OG, khối tour.

### 🔜 Còn lại
1. Kết quả xét duyệt app TikTok Shop (≈26-28/09): duyệt → and.not.or ủy quyền lại, 11 scope hiệu lực; tắt worker reviewer-demo-topup.
2. App ID/Secret TikTok Marketing API về dev@hubsell.tech → module `integrations/tiktok-ads/` + nút "Kết nối TikTok Ads" → T1 với TKQC nhà.
3. Chat Shopee: chọn hướng khi làm chat TikTok.

---

## Phiên 06/08/2026 — Fix re-connect + dọn sandbox + webhook Lazada + nâng cấp Auth toàn diện

### Fix bug "Kết nối lại" gian hàng (c1d7983) — nguyên nhân KHÁC giả định ban đầu
- Thủ phạm: nút "Kết nối lại" FE gọi nhầm `POST /api/channels` (kết nối GIẢ LẬP) dò gian theo TÊN MẶC ĐỊNH sàn → kích hoạt nhầm shop trùng tên ("Test Lazada") với token ảo. Nay: gian OAuth thật đi lại luồng uỷ quyền của đúng sàn, `channelId` gian đích ký vào state; callback đối chiếu seller_id/shop_id (CẢ 3 SÀN — Shopee đối chiếu TRƯỚC khi đốt code), lệch → báo "đăng nhập sai tài khoản" rõ ràng. `auth-url` kiểm quyền sở hữu channelId trước khi ký.
- Sửa nốt việc sót đợt dọn Oregon: env `LAZADA_REDIRECT_URI` trên Render SG vẫn trỏ domain cũ (authorize về "Not Found") — Lazada ưu tiên redirect_uri param hơn Callback URL Console. **DarkMan reconnect verify sống OK.**
- **Dọn sạch test/sandbox cả local + Supabase production** (script `cleanup-test-shops.ts`, 6bf5218 — dry-run mặc định): prod xoá 4 gian (2 OpenSANDBOX Shopee + 2 "Lazada" giả lập) + 10 đơn test. Prod còn đúng 3 gian thật: DarkMan Store (Shopee, 963 đơn), DarkMan + Hi.Bé (Lazada) — vào giai đoạn theo dõi số thật.

### Webhook đơn real-time Lazada (LPM) + phí Shopee tức thì (0a7a3c5)
- `POST /api/webhook/lazada`: chữ ký = hex HMAC-SHA256(app_secret, **app_key + raw body**); ràng buộc ack 200 trong **500ms** → route chỉ verify + ack, xử lý nền fire-and-forget (không hàng đợi bền — cron 10' vét miss, đúng khuyến nghị "consume push, pull with low frequency" của docs LPM). Client thêm `/order/get`; dùng chung `upsertLazadaOrderTx` (idempotent — LPM push "at least once"). 4 unit test chữ ký. Đăng ký Console (tab Push Mechanism) + subscribe Order Information — **ping Verify xuyên qua chữ ký thành công** (log "seller 9999… đơn 123456"); cert Let's Encrypt (DV) của Render được chấp nhận dù docs đòi OV/EV.
- **Shopee Live Push VERIFIED bằng đơn sống**: Push Log Console 4 success/0 fail, đơn 260806M5NAMV6Q nhảy UNPAID→READY_TO_SHIP real-time.
- **Phí P&L đơn mới hết chậm**: `syncShopeeEscrowEstimateForOrder` — worker webhook kéo ngay số ước tính khi đơn có sự kiện; vòng quét ước tính đôn từ mỗi giờ xuống MỖI NHỊP 10' (cửa sổ 2 ngày). Verify log prod: "22/22 đơn chờ đối soát nhận số tạm tính" ngay lượt đầu.

### Nâng cấp Auth: username/email + quên mật khẩu + Google OAuth + country (180912c)
- **Chốt kiến trúc**: `username` unique nullable LƯU LOWERCASE **cấm "@"** (ô đăng nhập chung tự phân biệt: có @ = email); Google OAuth code-flow TỰ VIẾT (không NextAuth — 2 hệ session; không Passport — codebase sẵn 3 luồng OAuth cùng pattern); `country` ISO alpha-2 mặc định VN; reset = **token link** (SHA-256 trong DB, hạn 30', dùng 1 lần, response chống dò email) — không OTP.
- Migration `20260806140000_auth_username_country_reset` (username/country/googleId/resetTokenHash+ExpiresAt — nullable/default, an toàn dữ liệu thật, tự áp Supabase qua migrate deploy). User Google mới: tự sinh username từ email + passwordHash ngẫu nhiên (muốn đặt pass → đi luồng quên mật khẩu).
- FE: ô "Tên đăng nhập hoặc Email", nút "Quên mật khẩu?", icon mắt ẩn/hiện (PasswordInput dùng chung), CountrySelect tìm kiếm ~80 nước (VN 🇻🇳 +84 mặc định), divider "Hoặc tiếp tục với" + 4 nút Google/Facebook/Apple/GitHub (3 nút sau toast "sắp ra mắt" — Apple $99/năm, FB cần App Review), màn Quên mật khẩu + trang `/reset-password`. Login cũ bằng email tương thích ngược 100%.
- **Hạ tầng bật sống trong phiên**: Google Cloud consent screen "Hubsell" + client "Hubsell Web" (redirect -sg) + app **En production** (scope cơ bản, không cần review); Render env GOOGLE_* + SMTP_* (Gmail App Password). **Quên mật khẩu verify sống — email về Gmail thật**; sender đổi sang hubselltech@gmail.com (SMTP_USER + App Password của chính tài khoản đó — Gmail không cho mạo danh From).

### 🔜 Còn lại
1. Verify webhook Lazada bằng đơn sống (đơn Lazada mới phải về Hubsell trong vài giây).
2. Nút Google test end-to-end trên hubsell.tech (sau khi Render deploy env xong).
3. Các mục cũ: nhập giá vốn SKU DarkMan Store, gắn nhãn đơn hoàn seller_return_refund, mời beta.

---

## Phiên 05-06/08/2026 — Shopee LIVE + shop thật đầu tiên + đối soát P&L khớp từng đồng

### Kích hoạt Live & shop thật (8 commit đầu ngày, 92508c1 → ededf3b)
- **Gia cố multi-shop cho beta 5-10 shop**: unique `(userId, channelName, externalShopId)` + upsert atomic ở callback OAuth (hết race bấm Liên kết 2 lần); mutex refresh token per-shop (refresh_token Shopee rotate 1 lần dùng — chống race webhook × cron); worker mới `token-refresh.ts` (30'/lượt, quét token sắp hết hạn, quá hạn → DISCONNECTED); stagger + jitter giữa các gian trong auto-sync (chống burst pattern); CORS allowlist (hubsell.tech + localhost + env `CORS_ORIGINS`). **DB local + Supabase đã CREATE INDEX tay.**
- **Chuyển Render sang bộ key Live** (partner 2040029): lỗi "bấm Log In không tác dụng" = env còn sandbox → trang login sandbox không nhận tài khoản thật. **3 bẫy webhook Live đã vượt**: push code authorization là **1/2 không phải 5**; verify nhận chữ ký cả Push Key lẫn API Key; **ping Verify (code 0) ký bằng key nội bộ Shopee không công bố** (đối chiếu HMAC đủ 4 key app × 3 kiểu chuỗi ký đều trượt) → trả 200 rỗng TRƯỚC bước kiểm chữ ký. Live Push **ON** (URL hubsell-backend-sg, khu vực Singapore, 4 push codes). `APP_FRONTEND_URL` sửa về hubsell.tech (redirect sau uỷ quyền hết văng localhost).
- **Shop thật đầu tiên: DarkMan Store (shop 128600269)** — 958 đơn/90 ngày + 808 SKU sàn + 744 đơn đối soát; 2 gian sandbox DISCONNECTED.

### Đối soát P&L khớp từng đồng (b3310fd, 38e4414) — chân lý là đơn thật, không phải docs
- Đối chiếu 3 chiều (Seller Center ↔ raw `order_income` qua route debug mới `escrow-debug/:orderSn` ↔ Hubsell) đơn 2607303CGEHBCA lộ **6 lỗi mapping**: phí giao dịch đếm đôi (seller + credit_card cùng 1 khoản); PiShip (`shipping_seller_protection_fee_amount`) chưa map → cột mới `Order.sellerProtectionFee` (ALTER 2 DB); cột UI "PiShip (Xtra)" hiện nhầm service_fee → "Phí DV (Xtra)" + cột PiShip riêng; thuế VN ở `withholding_vat/pit_tax`; `final_shipping_fee` không gồm phần khách trả; "Trợ giá Shopee" thật = `shopee_discount` (sàn bù vào escrow) chứ KHÔNG phải `voucher_from_shopee` (bù cho người mua, không vào ví).
- `netRevenue` ("Doanh thu ước tính") tái lập từ cột phí → **đơn settled khớp `actualPayout` từng đồng** (47/49 trang 1; toàn bộ lệch còn lại = 16 đơn hoàn 3,21tr — có task chip gắn nhãn hoàn từ `seller_return_refund`). E2E script dùng nguyên văn payload đơn thật làm chuẩn.

### P&L real-time + UX + Ads (c225412, 0a76b4f, 2dda047)
- **Đơn CHƯA giải ngân hiện số ƯỚC TÍNH của chính Shopee** (`syncShopeePendingEscrowEstimates` — get_escrow_detail trả bản nháp phí; isSettled vẫn false; verify đơn 260805J458S868 khớp từng đồng Seller Center). computePnlRow bỏ gating isSettled trên cột phí — vẫn cấm tự bịa %.
- FE: ô tìm mã đơn (search server-side, debounce), DateRangePicker sang phải, tick chọn tô đậm dòng (4 bảng), tooltip HintIcon 2 cột doanh thu tab Shopee + màu emerald/rose đồng bộ Lazada.
- **Chi phí quảng cáo sàn**: bảng `AdSpend` (channelId, date — CREATE TABLE 2 DB) sync từ Ads API `get_all_cpc_ads_daily_performance` (app CÓ quyền, không cần xin thêm); dòng mới trong cột Chi phí của Báo cáo dòng tiền + trừ vào lợi nhuận. **DarkMan 30 ngày = 0đ (chủ shop xác nhận không chạy CPC ads — số đúng).** Vá thác nước dòng tiền sau real-time: Phí nền tảng += PiShip, các bucket SUM cả đơn chờ.

### 🔜 Còn lại
1. **Nhập giá vốn SKU DarkMan Store** (chưa nhập → Lợi nhuận = Doanh thu; nhập đến đâu `applyCostPrice` vá ngược đơn cũ đến đó).
2. Đặt 1 đơn nhỏ verify Live Push tự chảy end-to-end (webhook đơn mới real-time).
3. Task chip: gắn nhãn đơn hoàn từ `seller_return_refund` khi sync đối soát.
4. Mời 5-10 shop bạn bè vào beta.

---

## Phiên 28/07/2026 (tối) — Trau chuốt trang Giá vốn + sửa tận gốc kết nối Lazada từ local

### Trang Cấu hình Giá vốn (`cost-price-table.tsx`) — 3 commit ec569ef, 1432438
- **Highlight nhóm đang mở**: dòng cha `bg-muted/60` + toàn bộ dòng con `bg-muted/40` nổi thành một khối xám; tên cha tự `font-bold` khi mở làm điểm neo. Gotcha: `TableRow` gốc có `has-aria-expanded:bg-slate-50/80` nằm sau trong stylesheet đè mất màu → phải dùng modifier `!` cục bộ (đo computed style mới phát hiện).
- **Hết khuất nút "Áp dụng"**: bảng auto bị tên phân loại dài (không truncate) kéo tràn ngang 42px → chuyển `table-fixed` + chia lại cột, **Giá vốn đứng TRƯỚC Giá bán** (cột thao tác chính phải luôn thấy), truncate + title cho tên/SKU. Sửa luôn lỗi cũ: dòng cha hiển thị khoảng GIÁ VỐN dưới header "Giá bán" → nay tính đúng khoảng giá bán.
- Badge "Chưa nối kho" → **"Chưa nối kho vật lý"** (chuẩn thuật ngữ); placeholder "Nhập cho tất cả" → "Giá vốn chung" (hết cắt chữ).
- `.claude/launch.json`: frontend thêm `autoPort` để phiên Claude chạy song song không giành cổng 3000 (Next 16 vẫn khoá 2 dev server cùng thư mục — verify qua Chrome thật với server phiên khác + HMR).

### Kết nối Lazada từ app local — trạm trung chuyển code (commit c9cf70b, ĐÃ LIVE Render)
- **Chẩn đoán lỗi người dùng gặp**: callback đăng ký là URL Render; kết nối từ local → state ký secret local, Render verify fail → "Phiên uỷ quyền hết hạn hoặc không hợp lệ"; rồi redirect nhầm default `https://localhost:3000` (sai giao thức → ERR_SSL_PROTOCOL_ERROR). Màn đen Render chỉ là free tier thức dậy, vô hại.
- **Fix**: state mang thêm `fe` (APP_FRONTEND_URL môi trường ký). Callback Render `jwt.decode` không verify, thấy origin localhost (regex chặt, chống open-redirect) khác FE của nó → 302 nguyên code về `<fe>/channels?lazada=code&code=...`; FE tự mở dialog Kết nối với code điền sẵn — bấm 1 nút là backend local đổi token (ownerId từ JWT đăng nhập, không tin state). Sửa default APP_FRONTEND_URL → http.
- Test: FE prefill qua Chrome thật OK; poll callback Render bằng state giả + code TESTCODE → 302 đúng về localhost. **Người dùng đã kết nối thành công shop mới.**
- Ghi nhớ cho bản THƯƠNG MẠI: khi frontend deploy domain thật + set `APP_FRONTEND_URL` trên Render → luồng OAuth một mạch không dán code (nhánh `lazada=connected` có sẵn); cần nộp app Lazada lên status chính thức (bỏ whitelist 5 seller) + Render trả phí/cron ping cho hết cold start.

---

## Phiên 28/07/2026 — Tích hợp Lazada TRỌN GÓI + Giá vốn không cần liên kết kho

### Lazada Open Platform: từ số 0 → chạy thật production trong một phiên
- **App "Hubsell"** (Seller In-house APP, App Key 140639, status Testing): logo 120×120 tự sinh (`frontend/public/hubsell-logo-120.png`), callback `https://hubsell-backend.onrender.com/api/auth/lazada/callback` (Lazada BẮT BUỘC https → không dùng được mẹo hosts hubsell.tech như Shopee).
- **Code** `backend/src/integrations/lazada/` mirror Shopee: config (host auth + api.lazada.vn) / client (đổi-refresh token, /seller/get, /orders/get, /orders/items/get, /products/get) / service (state CSRF, tự refresh trước hạn 30', handleLazadaCallback idempotent theo seller_id, syncLazadaOrders). **Chữ ký KHÁC Shopee**: HMAC-SHA256 trên `apiPath + concat(key+value sort ASCII, gồm CẢ access_token)`, hex CHỮ HOA, timestamp MILI-giây — kiểm chứng với server thật (code giả trả InvalidCode, không phải IncompleteSignature).
- **2 luồng uỷ quyền**: production tự động qua callback Render; LOCAL dán code (Lazada không kiểm redirect_uri khi đổi token → copy `?code=` từ URL callback dán vào dialog Kết nối). Gotcha đã ăn đủ: trang authorize phải chọn **Site=Vietnam** trước khi login (kẻo "Thiếu Tham số"); app Testing phải thêm seller vào **Authorized Seller Whitelist** (nằm CUỐI trang App Overview isvconsole, phải cuộn; cần email+mật khẩu Seller Center; tối đa 5); phiên SSO console rất dễ văng khi gõ URL thẳng.
- **ĐÃ NỐI SHOP THẬT "DarkMan"** (seller 200158131632, VN33VZ685X): sync sản phẩm qua `marketplace/adapters/lazada-adapter.ts` → **980 SKU**; sync đơn → **1004 đơn / 1104 dòng hàng** (3 năm, 11 trang, idempotent kiểm chứng chạy lại 0 tạo mới). Đặc thù Lazada: mỗi dòng order item = MỘT đơn vị (tự đếm quantity); `statuses` là MẢNG theo kiện → chọn trạng thái đại diện (huỷ chỉ khi mọi kiện huỷ); field /products/get viết hoa đầu (SellerSku/Status).
- **Deploy**: 4 commit đã push, Render build xong + env LAZADA_* đã điền, callback production trả 302 chuẩn.

### Giá vốn KHÔNG cần liên kết kho gốc (quyết định kiến trúc theo yêu cầu)
- Lý do: nhiều khách không muốn quản tồn kho tập trung — liên kết kho là VIỆC TUỲ CHỌN, giá vốn phải nhập được độc lập để tính lãi/lỗ.
- `ChannelProduct.costPrice` (Decimal?, migration `20260728113155`): giá vốn cấp SKU sàn khi chưa nối kho; đã nối thì Product vẫn là nguồn chân lý. Trang Giá vốn hiện CẢ SKU chưa liên kết (badge "Chưa nối kho"); mọi đường nhập (tay / bulk / Excel / popup SKU P&L) đều lưu đúng chỗ + vá đơn cũ theo (gian, mã SKU, snapshot=0). Sync đơn 3 sàn snapshot `product.costPrice ?? cp.costPrice ?? 0`. Khi liên kết, giá vốn cấp sàn kế thừa sang Product đang 0.
- **2 công cụ mới ở Liên kết SP**: nút "Tự khớp SKU" (`POST /api/mappings/auto-match` — trùng mã không phân hoa-thường, không ghi đè liên kết tay) + nút "Tạo SKU kho (n)" trên thanh bulk (`POST /api/mappings/create-products` — sinh SP kho từ dữ liệu sàn rồi nối luôn, trùng mã dùng lại, ≤200/lần).
- **Supabase production quản schema THỦ CÔNG** (Render chỉ tsc, không migrate deploy): đã ALTER thêm cột trên SQL Editor + cập nhật `supabase-schema.sql`. Thêm cột mới lần sau NHỚ bước này.
- Verify toàn bộ trên dữ liệu DarkMan thật qua HTTP route: 986 SKU hiện ở Giá vốn, auto-match 6, nhập giá vốn SKU chưa nối vá 1 dòng đơn cũ, tạo+nối 2 SP kho (số liệu test đều đã hoàn trả).

### 🔜 Còn lại của Lazada: webhook đơn real-time + trừ tồn kho, settlements (gác chung 3 sàn); `APP_FRONTEND_URL` trên Render chờ khi nào deploy frontend.

---

## Phiên 27/07/2026 (chiều) — Trợ lý quảng cáo 3 sàn + Trợ lý thông minh GMV Max TikTok

(Sync Settlements Shopee + TikTok GÁC LẠI theo chỉ đạo — làm sau cùng Lazada rồi đẩy server một thể.)

### Khung UI Trợ lý quảng cáo (3 sàn, ADMIN-only)
- Sidebar thêm nhóm "Trợ lý quảng cáo" (icon Megaphone, dưới Kênh bán): 3 trang `/ads/{tiktok,shopee,lazada}` dùng chung `components/ads/ads-assistant-page.tsx` (chỉ khác prop platform, mock ở PLATFORM_PRESETS). 3 tab: Tổng quan (5 StatCard + danh sách chiến dịch) / Quản lý ngân sách (Switch + ô nhập, disable khi tắt) / Báo cáo (AreaChart 14 ngày + bảng). Banner Preview violet. Mock series tất định (không Math.random — SSR/CSR khớp).

### Trợ lý thông minh GMV Max (TikTok) — chống "cắn tiền vô độ"
- **Rule engine 2 lớp** port từ thiết kế đã test 13 ca PASS ở dự án tiền thân (`D:\FatherBot\AutoControlAdsTiktok\poc\rules.py`): Lớp 1 sàn dữ liệu (chưa đủ chi tiêu/giờ → KHÔNG phán xét), Lớp 2 gồm Quy tắc 1 loại thẳng tay (tiêu >X mà 0 đơn / ROAS <Y / CPA >trần, OR) + Quy tắc 2 chờ phê duyệt (≥N đơn nhưng CPA vượt % mục tiêu). Mọi cờ kèm `reasons` minh bạch + luôn khôi phục được. Logic thuần ở `components/ads/tiktok-assistant.ts` (types + engine + mock 3 tầng).
- **Override theo chiến dịch** (`CampaignRuleOverrides`): mỗi SP một biên lãi — SP 100k trần CPA 30k, SP 1 triệu trần 200k vẫn lãi. Tab "Cấu hình Trợ lý Tự động" = bộ luật MẶC ĐỊNH hệ thống; trong modal từng chiến dịch có switch "Tùy chỉnh Quy tắc riêng" (bật = seed từ mặc định rồi sửa, tắt = kế thừa). Mock sẵn tt-1/TC054 trần CPA 150k → 2 video CPA 47–50k thoát cờ, banner tụt 3→1 video review — bằng chứng override chạy. Ô nhập luật dùng chung 2 nơi: `tiktok-assistant-rule-fields.tsx`.
- **Modal "Phân tích kế hoạch quảng cáo" 3 tầng** đúng luồng TikTok (`tiktok-campaign-modal.tsx`): Tầng 1 chỉ số + LineChart; Tầng 2 bảng sản phẩm (chế độ tối ưu); Tầng 3 bảng video (ID bài đăng, badge "Kém hiệu quả — Chờ loại trừ"/"Chi phí cao — Cần xem xét"/"Chưa đủ dữ liệu", nút Loại trừ/Giữ lại/Khôi phục từng dòng + "Áp dụng" hàng loạt). Gotcha: DialogContent là grid — section phải `min-w-0` không thì bảng ép modal mọc thanh cuộn ngang.
- **Banner "Đề xuất từ Trợ lý Hubsell"** trên dashboard + chip đếm cờ trên tab; mọi số đếm/cờ cập nhật sống theo từng phím gõ cấu hình và từng quyết định.
- Verify E2E qua Chrome thật (đăng nhập sẵn): bulk exclude, giữ lại, toggle override off/on, đổi trần CPA — tất cả phản ứng đúng; tsc + ESLint sạch. Mock chỉ sống trong phiên (reload là về preset).

---

## Phiên 27/07/2026 — Test Order sandbox: ĐÓNG HỒ SƠ, chờ ticket Shopee

Kiểm chứng nốt 4 giả thuyết cuối về "request dependency fail" và loại trừ hết:
1. **model_id**: 2 sản phẩm từng thử đều có phân loại, nghi form console không gửi model → thử item ĐƠN duy nhất **TC015 (802688852, has_model=false, stock 250k)** vẫn fail; shop SG trước đó cũng fail → loại trừ.
2. **Stock = 0 / kho khoá**: gọi live get_item_base_info/get_model_list — mọi item/model tồn 50–250.000; chưa từng có đơn test nào tạo thành công nên không có kho bị giữ → loại trừ.
3. **Token/shop_id lệch** & 4. **Sign/timestamp local**: không áp dụng — Test Order tạo qua web console Shopee (session của họ, không đi qua localhost); sign phía mình đã chứng minh đúng (product sync, logistics, update_stock thật đều chạy).

→ **Chốt: lỗi backend sandbox Shopee. Ngưng đào, chờ Shopee trả lời ticket rồi tính tiếp.** Luồng đơn không bị block (đã nghiệm thu bằng payload chuẩn e2e99f4).

---

## Phiên 24/07/2026 (11) — Test đơn thật Shopee: kẹt ở tool sandbox

### Đã làm
- **Refactor khoá SKU** (`shopeeChannelSku` trong client.ts) dùng chung product & order sync: SKU riêng → theo SKU; nhiều model chung 1 SKU → gộp (đúng `@@unique`); **KHÔNG có SKU → tách theo `SPE-{item}-{model_id}`**. Thêm `model_id` vào ShopeeOrderItem. Verify data thật: TC054 (không SKU) tách đúng 4 biến thể theo model_id; mô phỏng mua từng biến thể → khớp 4/4.
- **Script `backend/scripts/shopee-sandbox-logistics.ts`**: gọi logistics API bằng token DB → kiểm địa chỉ pickup + bật kênh vận chuyển. Kết quả: shop 227774404 ĐÃ có pickup address (id 23339, VN) + cả 3 kênh (SPX/Economy Express, SPF Mart) enabled ở cả shop lẫn product.
- **Điều khiển console Shopee (Claude in Chrome)**: Test Account-Sandbox có 2 shop test Local-VN (227774404 nối Hubsell, 227775379); Create Test Order form = Shop+Item+Shipping (KHÔNG có ô buyer).

### 🔴 BLOCKER (phía Shopee, không phải code)
Create Test Order **luôn báo "request dependency fail, please try again"** dù đã đủ MỌI prerequisite (đối chiếu doc Sandbox Testing V2 https://open.shopee.com/developer-guide/644): shop authorized ✓, sản phẩm published + tồn kho ✓, 3 shipping bật ✓ (thử cả 3, cả product Tất lẫn TC054), KHÔNG cần buyer ✓. Doc không có lỗi này → **lỗi backend sandbox Shopee** (chữ "please try again" = transient). → Cần **Raise Ticket** cho Shopee.

### 🔜 CHIỀU LÀM TIẾP
1. **Nghiệm thu order-sync bằng payload chuẩn** `get_order_detail` (dựng theo schema đã lấy từ API) → chạy `syncShopeeOrders` thật → kiểm `OrderItem.channelSku` khớp biến thể model_id, bắt lỗi mapping. (Test code thật, không cần đơn live.)
2. Thử lại Create Test Order (transient?) / gửi **Raise Ticket** Shopee về "request dependency fail" (kèm: shop 227774404, đủ prerequisite). Khi có đơn live → pull payload verify.
3. (Tuỳ chọn) Viết **Sync Settlements Shopee** (mirror TikTok, dùng `getValidShopeeAccessToken`) — code-only, không cần đơn live.

### Trạng thái tổng: Hubsell Shopee = OAuth ✅ + Product sync THẬT ✅ + Order sync (code + logic biến thể) ✅. Chỉ thiếu 1 đơn LIVE để soi payload (kẹt tool Shopee).

---

## Phiên 24/07/2026 (10) — Adapter Pattern đa sàn + Sync Products Shopee thật

### Kiến trúc mới: `backend/src/marketplace/` (Adapter Pattern)
Tách logic API từng sàn khỏi logic kho nội bộ.
- `types.ts` — `NormalizedChannelProduct` (cấu trúc chuẩn trung lập) + interface `MarketplaceProductAdapter`.
- `registry.ts` — `getProductAdapter(channel)`: Shopee có refreshToken → adapter thật; còn lại → mock (giữ data demo).
- `adapters/shopee-adapter.ts` — gọi API thật + phân trang + **transformer** Shopee→chuẩn + tự refresh token.
- `adapters/mock-adapter.ts` — bọc MOCK_CATALOG cho gian chưa nối API.
- `product-sync.ts` — tầng kho TRUNG LẬP SÀN: upsert ChannelProduct, giữ productId/costPrice, delist SKU cũ.

### Shopee Product API (client.ts)
- `getItemList` (offset/has_next_page, `item_status` LẶP đủ NORMAL/UNLIST/BANNED/DELETED), `getItemBaseInfo` (≤50), `getModelList`. Refactor `callShopGet` sang mảng pair để hỗ trợ param lặp.
- `finance.ts /sync-products`: bỏ vòng lặp mock → gọi `syncChannelProducts` (adapter). Bỏ import MOCK_CATALOG/mockImageFor.

### Verify thật ✅
Trigger sync trên shop sandbox 227774404 → kéo **8 SKU thật** (Áo gió, Tất 3 màu, Túi TC015, Túi TC055 3 màu), tách model đúng; **5 mock cũ tự DELISTED**. Xử lý ca người bán đặt CHUNG 1 SKU cho nhiều model (Áo gió 9 biến thể → gộp về 1 SKU, variant null). `scanned:8` khớp.

### Việc cần làm 🔜
- Người dùng vào Liên kết SP → nối 8 SKU thật về kho gốc → tạo đơn test → đồng bộ đơn nghiệm thu trọn vòng.
- Adapter Orders/Settlements có thể gom vào marketplace/ tương tự (hiện Orders vẫn ở integrations/shopee/service).

---

## Phiên 24/07/2026 (9) — Shopee Sync Orders + OAuth chạy thật

### Cột mốc ✅
- **OAuth Shopee chạy END-TO-END**: kết nối được shop sandbox thật `OpenSANDBOX11505875978db55c3b6` (shop_id 227774404) sau khi fix host `.cn`.
- **Sync Orders Shopee** (mirror TikTok):
  - `client.ts`: `getOrderList` (get_order_list, cửa sổ ≤15 ngày + cursor), `getOrderDetail` (≤50 sn/lần, response_optional_fields), helper `callShopGet` (ký shop-API dùng chung, refactor cả getShopInfo).
  - `service.ts`: `syncShopeeOrders` — chia cửa sổ 15 ngày, phân trang cursor, batch chi tiết 50, upsert idempotent theo `(channelId, order_sn)`, map trạng thái Shopee→Hubsell, snapshot giá vốn qua mapping SKU. KHÔNG trừ kho (đồng bộ lô).
  - `routes/channels.ts`: `POST /:id/sync-orders` giờ **dispatch TikTok/Shopee** theo channelName.
  - Frontend: nút "Đồng bộ đơn" hiện cho cả Shopee (`isOAuth`); đổi tên api `syncTiktokOrders`→`syncChannelOrders` (endpoint generic); toast theo tên sàn.
- **Verify thật**: chạy `syncShopeeOrders` trên gian sandbox → `fetched:0` (shop 0 đơn) **không lỗi chữ ký** → get_order_list + auto-refresh token OK.

### Dữ liệu
- Chốt **giữ nguyên** data cũ (10 gian mock + 15 đơn mock) để nhìn UI — KHÔNG xoá.

### Việc cần làm 🔜
- Tạo đơn test trong Shopee sandbox → bấm "Đồng bộ đơn" nghiệm thu kéo đơn thật.
- Sau đó: Sync Settlements Shopee + webhook Shopee (nếu cần).

---

## Phiên 24/07/2026 (8) — FIX Shopee error_sign: host sandbox cũ bị khai tử

### Triệu chứng & chẩn đoán
Bấm kết nối Shopee → `{"error":"error_sign","message":"Wrong sign."}`. Debug rất sâu, loại trừ hết phía mình: sign scheme đúng chuẩn (HMAC-SHA256 partner_id+path+timestamp, hex lowercase), key đúng (đối chiếu Console + regenerate + tạo hẳn app mới 1239199 vẫn lỗi), clock lệch 0s, thử mọi encoding key/base-string/host. Phát hiện chốt: **`error_sign` là phản hồi CHUNG** (partner_id giả cũng bị) → không suy ra được host đúng.

### Nguyên nhân thật
**Domain sandbox `partner.test-stable.shopeemobile.com` ĐÃ BỊ KHAI TỬ.** (Con "Ask AI Assistant" của Shopee Open Platform xác nhận + đưa domain mới.) Host mới = **`https://openplatform.sandbox.test-stable.shopee.cn`** — đã kiểm chứng: chữ ký QUA (trả `invalid_code` cho code giả thay vì `error_sign`).

### Đã sửa ✅
- `shopee/config.ts`: `SHOPEE_HOSTS.sandbox` → `https://openplatform.sandbox.test-stable.shopee.cn`. Không đụng sign scheme/logic (đúng sẵn).
- `.env`: đang dùng credential app mới **Hubsell ANO 2** (partner_id 1239199).
- Verify: `token/get` trả `invalid_code` (chữ ký OK). Auth URL gen ra trỏ đúng host mới.

### Việc cần làm 🔜
- **Test luồng OAuth thật**: bấm Kết nối Shopee → uỷ quyền shop test → callback lưu Channel. (hosts hubsell.tech→127.0.0.1 + listener :80 đã sẵn.)
- Production host (`partner.shopeemobile.com`) chưa verify — xem lại lúc Go-Live.

---

## Phiên 24/07/2026 (7) — Tích hợp Shopee Open Platform OAuth (Sandbox)

### Mục tiêu
Dựng module Shopee OAuth (mirror cấu trúc TikTok): sinh URL uỷ quyền có ký, route callback, đổi code→token, lưu Channel.

### Đã hoàn thành ✅
- **`backend/src/integrations/shopee/`**: `config.ts` (env + host theo `SHOPEE_ENV`, override `SHOPEE_API_BASE`, paths), `client.ts` (`signPublic`/`signShop` HMAC-SHA256, `buildAuthorizeUrl`, `getAccessToken`, `refreshAccessToken`, `getShopInfo`), `service.ts` (`signOauthState`/`verifyOauthState` mang ownerId, `getValidShopeeAccessToken` tự refresh, `handleShopeeCallback` đổi token + upsert Channel).
- **Routes**: `GET /api/channels/shopee/auth-url` (Admin, ký + state JWT) trong channels.ts; `GET /api/auth/shopee/callback` (công khai, verify state → đổi token → lưu → redirect FE) trong auth.ts.
- **`apiConnected`** đổi từ `Boolean(shopCipher)` → `Boolean(refreshToken)` để đúng cho MỌI sàn (Shopee không có shop_cipher).
- **Env**: thêm `SHOPEE_PARTNER_ID/KEY/ENV/REDIRECT_URI` + `APP_FRONTEND_URL` vào `.env` + `.env.example`.
- **Frontend**: `getShopeeAuthUrl()`; ConnectDialog generalize `isTiktok`→`isOAuth` (TikTok+Shopee đều OAuth); toast handler đọc `?shopee=connected|error` sau redirect rồi dọn query.

### Kiểm chứng
- `tsc` backend + frontend + `eslint`: sạch ✅.
- Smoke-test: `signPublic`/`signShop` **khớp HMAC tính tay**, URL uỷ quyền chuẩn (encode redirect+state), state JWT verify OK / tampered→null ✅.
- Boot backend test (:4103): auth-url chưa auth → 401; callback thiếu param / state rác → 302 redirect FE với `shopee=error` đúng ✅.
- **CHƯA test end-to-end với Shopee thật** — cần domain `hubsell.tech` (đã đăng ký Console) trỏ về backend; redirect localhost không được Shopee chấp nhận.

### Quyết định & lưu ý
- Redirect user cho là `:3000` nhưng callback là **route backend** → đặt `:4000` (giải thích: `:3000` là Next FE, không có route này). Domain thật phải khớp `hubsell.tech`.
- Sandbox host mặc định `partner.test-stable.shopeemobile.com` (KHÁC `partner.shopeemobile.com` = production mà user tưởng là sandbox) — cho ghi đè qua `SHOPEE_API_BASE`.

### Việc cần làm phiên sau 🔜
1. Trỏ `hubsell.tech` về backend (hosts/tunnel/deploy) + đổi `SHOPEE_REDIRECT_URI` khớp domain → test OAuth end-to-end.
2. Dựng đồng bộ đơn/đối soát Shopee (dùng `getValidShopeeAccessToken`).

---

## Phiên 24/07/2026 (6) — Chuẩn hoá endpoint OAuth + chẩn đoán lỗi khu vực

### Bối cảnh
Bấm uỷ quyền TikTok báo *"Không khả dụng tại khu vực của cửa hàng bạn"*. Điều tra qua nhiều bước để tách lỗi code vs lỗi cấu hình tài khoản.

### Kết quả chẩn đoán (quan trọng cho phiên sau)
- **KHÔNG phải lỗi code.** Bằng chứng từ URL uỷ quyền thật:
  `seller-vn.tiktok.com/services/market/custom-authorize/{service_id}?is_draft=true&region_check=1&shop_region=VN&target_countries=...country_vietnam_selection&...`
  → request tới đúng trang VN, `shop_region=VN` nhận đúng, `target_countries` CÓ Vietnam.
- **Nút thắt thật (ảnh Partner Center):** app "Hubsell" (Bản nháp, Tùy chỉnh, người bán VN) — mục **Người bán mục tiêu → Việt Nam** hiện *"Vui lòng hoàn thiện biểu mẫu đăng ký đối tác — Cần hoàn tất"*; checklist *"Xét duyệt đăng ký đối tác"* chưa xong. → Thị trường VN chưa kích hoạt nên shop bị chặn.
- **Chặn ở phía TikTok:** tài khoản Partner Center kẹt ở **xét duyệt Doanh nghiệp**. Kế hoạch của chủ shop: tạo tài khoản Partner Center **Cá nhân (Individual)** bằng email khác, gửi duyệt lại. Khi có app mới → **chỉ thay `TIKTOK_APP_KEY`/`TIKTOK_APP_SECRET`/`TIKTOK_SERVICE_ID` trong `.env`**, KHÔNG cần sửa code.

### Đã hoàn thành (code) ✅
- Chuẩn hoá `buildAuthorizeUrl` về hệ Custom App nội địa: `services.tiktokshop.com/open/authorize` + `service_id` + **`app_type=custom`**. (Đã thử `auth.tiktok-shops.com/oauth/authorize`+`app_key` — không hợp, đã revert.)
- Sửa comment trong `config.ts` cho đúng thực tế (lỗi khu vực do `target_countries`/đăng ký đối tác ở Partner Center, không phải tham số URL).
- `tsc` sạch. Không file tạm. Servers dev đã tắt.

### Trạng thái
🔒 **Code luồng OAuth coi như hoàn thiện & ổn định** — đóng băng phần code TikTok, chờ tài khoản Partner Center mới được duyệt. Toàn bộ luồng (OAuth → đồng bộ đơn/đối soát → webhook) đã dựng xong từ các phiên trước, chỉ chờ app "sống" để test thật.

### Việc cần làm khi app mới được duyệt 🔜
1. Thay 3 biến TikTok trong `backend/.env`, khởi động lại backend.
2. Chạy `dev-https.sh` (hoặc để Claude boot) → bấm Kết nối TikTok chạy OAuth end-to-end.
3. Test đồng bộ đơn/đối soát; dựng tunnel để nghiệm thu webhook trừ/hoàn kho.

---

## Phiên 24/07/2026 (5) — Tự động hóa boot môi trường test HTTPS

### Mục tiêu
Một lệnh duy nhất: tắt tiến trình cũ, boot Backend+Frontend HTTPS, phơi tunnel (nếu có), in link để click test ngay.

### Đã hoàn thành ✅
- **Sửa `scripts/gen-certs.sh`** — lỗi `MSYS_NO_PATHCONV` + đường dẫn tuyệt đối khiến openssl-Windows không mở được file. Fix: `cd ROOT` + dùng đường dẫn tương đối `certs/...`. Đã chạy lại, cert mới, cặp key/cert khớp (verify modulus md5).
- **`scripts/dev-https.sh`** (bash thuần, zero-install vì máy không có concurrency/tunnel tool):
  1. `kill_port` tắt tiến trình LISTENING trên 4000/3000 (netstat + `taskkill /F /PID`, `MSYS_NO_PATHCONV`).
  2. Tự tạo cert nếu thiếu.
  3. Boot backend (`npm run dev` → HTTPS) + frontend (`npm run dev:https`) song song, log ra `.dev-logs/`.
  4. `wait_url` chờ cả hai `curl -sk` sẵn sàng.
  5. Tunnel best-effort: dùng cloudflared/ngrok/lt NẾU có (parse URL public), không có thì bỏ qua + hướng dẫn.
  6. In hộp link (Frontend/Backend/Callback/Tunnel/Webhook). `trap cleanup INT TERM` (có guard `CLEANED`) tắt sạch khi Ctrl+C.
- **`start-https.bat`** — wrapper double-click gọi `bash scripts/dev-https.sh`.
- **`.gitignore`** thêm `.dev-logs/`. README thêm mục "MỘT lệnh" + hướng dẫn cài cloudflared.

### Kiểm chứng
- Chạy thật launcher có `timeout 95s`: tắt PID cũ 21404 (:4000) → backend HTTPS lên → **frontend Next 16 `dev:https` Ready in 390ms, phục vụ `GET / 200`** → health cả hai qua → tunnel skip gọn → in hộp link → Ctrl+C(SIGTERM) dọn sạch, ports 4000/3000 FREE lại. ✅
- `bash -n` cả hai script sạch. tsc không đổi (chỉ script/docs).

### Môi trường hiện tại ⚠️
- **Chưa cài** ngrok/cloudflared/localtunnel → bước tunnel bị bỏ qua; webhook thật cần cài 1 tool (khuyến nghị cloudflared) rồi chạy lại.
- Server cũ trên :4000 đã bị launcher tắt; hiện KHÔNG có server nào chạy — anh chạy `bash scripts/dev-https.sh` để bật lại.

### Việc cần làm phiên sau 🔜
1. Cài cloudflared → chạy `dev-https.sh` → lấy URL tunnel khai webhook lên Partner Center.
2. Bấm Kết nối TikTok chạy OAuth end-to-end; tạo đơn test nghiệm thu webhook trừ/hoàn kho.

---

## Phiên 24/07/2026 (4) — Cấu hình HTTPS local để test OAuth/webhook

### Mục tiêu
Dựng môi trường HTTPS ở local cho khớp Redirect URL của TikTok (https) và tránh mixed-content khi trang callback https gọi API.

### Đã hoàn thành ✅
- **Cert tự ký** — `scripts/gen-certs.sh` (OpenSSL, xử lý `MSYS_NO_PATHCONV` cho Git Bash) sinh `certs/localhost-key.pem` + `certs/localhost.pem`, SAN `localhost` + `127.0.0.1`, hạn 2028. Đã tạo cert. `certs/` đã vào `.gitignore` (không commit khóa riêng).
- **Backend HTTPS có điều kiện** — `src/index.ts`: có `SSL_KEY_FILE` + `SSL_CERT_FILE` (trỏ tới file tồn tại) → `https.createServer`; thiếu → fallback HTTP (không phá luồng cũ). `backend/.env` + `.env.example` thêm 2 biến (trỏ `../certs/...`).
- **Frontend HTTPS** — thêm script `dev:https` (`next dev --experimental-https --experimental-https-key/cert` dùng chung cert). `.env.local` đổi `NEXT_PUBLIC_API_URL=https://localhost:4000` (kèm hướng dẫn quay lại http).
- **README** — thêm mục "🔒 Chạy HTTPS ở local" (tạo cert, chạy 2 phía https, tin cert tự ký, quay lại http, và lưu ý webhook thật cần tunnel).

### Kiểm chứng
- Backend HTTPS boot (port 4101): `curl -k https://…/health` OK; HTTP bị từ chối trên cổng HTTPS. ✅
- Fallback: SSL_* trỏ file không tồn tại → chạy HTTP + cảnh báo, không crash. ✅ (Boot HTTPS thành công cũng chứng minh cặp key/cert hợp lệ để Node/Next TLS nạp.)
- `tsc` backend + frontend: sạch ✅.

### Lưu ý vận hành ⚠️
- Cert **tự ký** → trình duyệt cảnh báo; phải mở `https://localhost:4000/health` và `https://localhost:3000` mỗi cổng một lần bấm "vẫn tiếp tục" để tin cert.
- **Webhook thật cần tunnel** (ngrok/cloudflared) vì TikTok không tới được `localhost`; HTTPS local chỉ phục vụ luồng OAuth callback (chạy trong trình duyệt người dùng).
- Server backend cũ trên :4000 (từ phiên trước) vẫn cần **khởi động lại** để nạp code HTTPS + webhook.

### Việc cần làm phiên sau 🔜
1. Chạy `gen-certs` → backend `npm run dev` (https) → frontend `npm run dev:https`, tin cert, bấm Kết nối TikTok để chạy OAuth end-to-end thật.
2. Dựng tunnel + khai webhook URL trên Partner Center, tạo đơn test nghiệm thu trừ/hoàn kho.

---

## Phiên 24/07/2026 (3) — Webhook TikTok real-time + tự động trừ kho

### Mục tiêu
Nhận webhook TikTok khi đơn đổi trạng thái, xác thực chữ ký, upsert đơn và tự động trừ/hoàn kho theo thời gian thực (idempotent).

### Đã hoàn thành ✅
- **Endpoint** `POST /api/webhooks/tiktok` (công khai, trong `routes/webhooks.ts`) — xử lý event `ORDER_STATUS_CHANGE` (type 1); loại khác ack 200.
- **Verify chữ ký** — `verifyWebhookSignature()` (client.ts): `HMAC-SHA256(app_key + rawBody, app_secret)` so khớp header `Authorization` theo kiểu hằng-thời-gian. Giữ body thô qua `express.json({ verify })` trong `app.ts` (serialize lại là sai chữ ký).
- **Lấy chi tiết đơn** — `getOrderDetail()` (client.ts, GET /order/202309/orders?ids=) vì payload webhook chỉ có order_id + trạng thái.
- **`processTiktokOrderEvent()`** (service.ts) — refactor `upsertOrder` → `upsertOrderTx(tx,…)` để GỘP upsert + tồn kho vào MỘT transaction. Trừ kho khi trạng thái đã chốt (AWAITING_SHIPMENT…COMPLETED), hoàn kho khi CANCELLED.
- **Idempotent tồn kho** — thêm cột `Order.stockDeductedAt` (migration `order_stock_deducted_at`); trừ kho một lần (guard `stockDeductedAt`, `decrement` nguyên tử, cho phép âm = phơi bày bán vượt kho); hoàn kho một lần (guard `stockRestoredAt`, mirror luồng hủy đơn thủ công ở orders.ts). Chỉ trừ dòng đã liên kết SKU (productId != null).
- **`findTiktokChannelByShopId()`** — định danh gian theo `shop_id` trong payload đã ký.

### Kiểm chứng
- Backend `tsc` ✅. Runtime: query `stockDeductedAt` OK; `verifyWebhookSignature` valid→true, tampered/missing→false.
- **Test end-to-end webhook** (instance mới port 4100, ký bằng app_secret thật): chữ ký hợp lệ + shop lạ → 200 ack; thiếu/sai chữ ký → **401**; event type khác → 200 ack. ✅
- **CHƯA test đường trừ/hoàn kho với đơn TikTok thật** (cần shop đã kết nối + đơn thật để `getOrderDetail` trả dữ liệu) — logic mirror luồng mock/hủy đơn đã kiểm chứng, có guard idempotent.
- ⚠️ Server cũ trên :4000 (từ trước) không có code mới & đang giữ DLL (gây EPERM `prisma generate`, vô hại). **Cần khởi động lại dev server backend** để nạp webhook + rawBody.

### Việc cần làm phiên sau 🔜
1. Cấu hình URL webhook trên Partner Center (`https://.../api/webhooks/tiktok`), chạy đơn test thật để nghiệm thu trừ/hoàn kho.
2. Đối chiếu tên trường payload webhook thật (type số, `data.order_id`, `data.order_status`) nếu TikTok đổi.
3. Lịch cron tự đồng bộ; bóc tách chi tiết phí đối soát.

---

## Phiên 24/07/2026 (2) — Đồng bộ dữ liệu thật TikTok Shop

### Mục tiêu
Hoàn thiện luồng kéo dữ liệu thật sau khi đã có OAuth: (1) tự refresh token, (2) `fetchOrders()` ghi thẳng DB, (3) `fetchSettlements()` cập nhật Cash Flow.

### Đã hoàn thành ✅
- **Tự refresh token** — `getValidAccessToken(channel)` (mới, trong `service.ts`): còn <5 phút hết hạn thì gọi `refreshAccessToken()` + lưu token mới xuống DB; `refresh_token` hết hạn → ném lỗi buộc uỷ quyền lại. Được gọi TRƯỚC mọi lượt đồng bộ.
- **`syncTiktokOrders()`** — phân trang `next_page_token`, **upsert idempotent** theo `(channelId, orderCode)`. Thêm migration `order_channel_ordercode_unique` (unique index; đã kiểm tra 0 bản ghi trùng trước khi áp). Map `order_status` TikTok → `ShippingStatus`; gộp `line_items` theo SKU; snapshot `costPriceAtSale` qua `ChannelProduct` mapping. **Cố ý KHÔNG trừ tồn kho** khi đồng bộ lô.
- **`syncTiktokSettlements()`** — kéo `statements` → `statement_transactions` **202501** (breakdown đặt tên), gom theo `order_id` trong cả lượt chạy rồi GHI ĐÈ (idempotent): sao kê chi tiết `TiktokOrderSettlement` (số có dấu, tên cột theo Seller Center) + cột gộp `Order`. **`syncTiktokUnsettledEstimates()`** — số ước tính của sàn cho đơn chờ (202507). Làm lại 16/09/2026 sau khi đối chiếu số thật (xem README mục Tích hợp TikTok).
- **`client.ts`**: types mạnh cho `fetchOrders`/`fetchSettlements` + thêm `fetchStatementTransactions()`.
- **2 route** `POST /api/channels/:id/sync-orders` + `/sync-settlements` (chỉ Admin, chỉ gian TikTok đã có `shopCipher`).
- **Frontend**: `syncTiktokOrders`/`syncTiktokSettlements` trong `api.ts`; 2 nút "Đồng bộ đơn" / "Đồng bộ đối soát" trên trang Kênh bán (chỉ hiện với gian TikTok `apiConnected`), có trạng thái loading + toast kết quả.

### Kiểm chứng
- Backend `tsc` ✅, runtime query `channelId_orderCode` chạy được (DB). Frontend `tsc`+`eslint` ✅.
- Backend boot + 2 route sync trả 401 khi chưa auth (route đăng ký đúng).
- **CHƯA test với dữ liệu TikTok thật** (cần OAuth end-to-end qua https). Tên trường payload cần đối chiếu lại khi chạy thật (parser đã defensive).
- ⚠️ `prisma generate` báo EPERM đổi tên DLL engine (do dev server đang giữ file) — **vô hại**: types đã cập nhật, engine cũ vẫn chạy.

### Việc cần làm phiên sau 🔜
1. Chạy OAuth thật → bấm "Đồng bộ đơn"/"Đồng bộ đối soát", **đối chiếu payload** thực tế, chỉnh mapping trạng thái & tên trường nếu lệch.
2. **Trừ tồn kho cho đơn TikTok mới**: webhook "đơn mới" riêng (không dùng đồng bộ lô).
3. **Lịch tự động** (cron) đồng bộ định kỳ thay vì bấm tay.
4. Bóc tách chi tiết từng loại phí khi có nguồn dữ liệu (hiện dồn vào `serviceFee`).

---

## Phiên 24/07/2026 — Kết nối TikTok Shop API (OAuth2)

### Mục tiêu
Thiết lập module tích hợp TikTok Shop thật (App "Dịch vụ tùy chỉnh" trên Partner Center, bản API `202309`): luồng lấy Access Token qua OAuth2 khi bấm kết nối gian hàng, và dựng khung hàm API để chuẩn bị kéo Đơn hàng + Dòng tiền/Đối soát.

### Đã hoàn thành ✅

**Backend**
- **Schema `Channel`** (migration `20260724022413_tiktok_oauth_channel_fields`): thêm `refreshToken`, `accessTokenExpireAt`, `refreshTokenExpireAt`, `shopCipher`, `externalShopName`.
- **`src/integrations/tiktok/config.ts`**: đọc env (`TIKTOK_APP_KEY/SECRET/SERVICE_ID/REDIRECT_URI`), `buildAuthorizeUrl(state)`, `isTikTokConfigured()`, endpoint cố định. Ném lỗi rõ ràng khi thiếu cấu hình.
- **`src/integrations/tiktok/client.ts`**:
  - `signRequest()` — **ký HMAC-SHA256** đúng thuật toán TikTok (loại `sign`/`access_token`, sort key, nối path+params+body, bọc app_secret). Đã smoke-test: hex 64 ký tự, xác định.
  - `getAccessToken(authCode)` / `refreshAccessToken(refreshToken)` — gọi máy chủ auth (không cần ký).
  - `getAuthorizedShops(accessToken)` — lấy danh sách gian + `shop_cipher`.
  - `callApi()` — helper gọi API nghiệp vụ có ký + header `x-tts-access-token`.
  - **KHUNG** `fetchOrders()` / `fetchSettlements()` — đã dựng chữ ký + endpoint, **chưa ghi DB**.
- **`src/routes/channels.ts`**: `GET /api/channels/tiktok/auth-url` + `POST /api/channels/tiktok/callback` (chỉ Admin). Callback đổi token → lấy shop_cipher → upsert `Channel` theo `externalShopId`. `GET /api/channels` đã **lọc bỏ secret** (`refreshToken`/`shopCipher`), thêm cờ `apiConnected`.
- **`.env` / `.env.example`**: thêm 4 khóa TikTok (giá trị thật KHÔNG commit).

**Frontend**
- **`lib/api.ts`**: `getTiktokAuthUrl()`, `tiktokCallback(code)`, type `TiktokConnectedChannel`; `Channel` thêm `apiConnected`/`externalShopName`/`accessTokenExpireAt`.
- **`app/channels/page.tsx`**: nhánh TikTok trong dialog kết nối → gọi auth-url, lưu `state` vào `sessionStorage`, chuyển hướng sang TikTok (ẩn ô nhập tên, nút "Tiếp tục với TikTok").
- **`app/channels/tiktok/callback/page.tsx`** (mới): nhận `?code&state`, đối chiếu state chống CSRF, gọi backend, hiển thị kết quả. Đọc qua `window.location.search` để khỏi cần Suspense (Next 16). Có `useRef` chặn StrictMode gọi 2 lần (auth_code dùng 1 lần).

### Kiểm chứng
- Backend `tsc --noEmit`: ✅ pass. Migration áp thành công.
- Frontend `tsc` + `eslint` các file đổi: ✅ pass.
- Smoke-test module TikTok (sign/authUrl/config throw): ✅ đúng.
- **CHƯA test luồng OAuth end-to-end thật** (cần điền App Key/Secret + chạy https).

### Việc cần làm phiên sau 🔜
1. **Điền `TIKTOK_APP_KEY/SECRET/SERVICE_ID`** vào `backend/.env`, chạy frontend `--experimental-https`, chạy thử uỷ quyền thật bằng shop test.
2. **Tự refresh token**: trước mỗi call API, kiểm tra `accessTokenExpireAt`, gọi `refreshAccessToken()` nếu sắp hết hạn (helper `getValidAccessToken(channel)`).
3. **Nối `fetchOrders()` vào DB**: ánh xạ đơn TikTok → model `Order`/`OrderItem` (thay webhook giả lập).
4. **Nối `fetchSettlements()`**: kéo đối soát thật cắm vào bảng Cash Flow / Lãi-Lỗ Thực Hiện (thay `mockSettlement`).
5. Cân nhắc **mã hoá secret** khi lưu (hiện lưu thô cho môi trường dev).
