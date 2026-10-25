# Ca thực tế: trợ lý quảng cáo trên shop ANO, trước và sau (đo 25/10/2026)

Nguồn: Supabase prod, chỉ SELECT, câu ở [SQL-CA-THUC-TE-TRO-LY-QUANG-CAO.sql](SQL-CA-THUC-TE-TRO-LY-QUANG-CAO.sql).
Câu hỏi khách: "Trợ lý quảng cáo của Hubsell có thực sự làm tăng lượng đơn không?"

## 1. Trợ lý thật sự đã làm gì trên shop ANO

| Gian | Sàn | Trợ lý chạy thật? | Ghi chú |
|---|---|---|---|
| and.not.or (thương hiệu ANO) | TikTok GMV Max | **Có**: tự loại video từ 17–18/09 trên TC054; TC079 bật thật từ 22/10 | TC040 NEW và chiến dịch "Doanh thu gộp" vẫn diễn tập → dùng làm **nhóm đối chứng** |
| ANO Official Store | Shopee | **Không**: chỉ diễn tập. 2 lệnh dừng thật 21/08 và 14/09 (sự cố 14/09), còn lại anh tự bấm | Không dùng làm bằng chứng cho trợ lý |
| ANO Official (TikTok), DarkMan | — | Không có chiến dịch / chỉ diễn tập | — |

Sổ lệnh TC054: loại tay 4 video 17–18/09, rồi tự loại 18/09, 20/09, 11/10, 13/10, 24/10 (mỗi lần 1–3 video ROI dưới hòa vốn ~5,9).
Trợ lý **không** tăng ngân sách hay đổi ROI thay khách. Kết luận ROI và ngân sách (từ 15/10) chỉ là gợi ý, còn quá mới để đo.

## 2. Chiến dịch TC054 (trợ lý tự loại video) và nhóm đối chứng

Trước = 3 tuần trọn 24/08–13/09. Sau = 4 tuần trọn 21/09–18/10. Tuần 14–20/09 là tuần chuyển nên bỏ.
Số của TikTok (GMV Max, ROI trộn), mỗi tuần.

| | Chi ads/tuần | Đơn/tuần | GMV/tuần | ROI | Chi phí mỗi đơn |
|---|---|---|---|---|---|
| **TC054 trước** | 1,40 tr | 62,7 | 15,57 tr | 11,1 | 22.400đ |
| **TC054 sau** | 1,28 tr (−9%) | 65,0 (+4%) | 16,22 tr (+4%) | 12,6 (+14%) | 19.700đ (−12%) |
| Đối chứng trước (TC025 NEW + TC040 NEW + TC079) | 1,84 tr | 83,3 | 23,61 tr | 12,8 | 22.100đ |
| Đối chứng sau | 1,87 tr | 85,0 | 24,08 tr | 12,9 | 22.000đ |

ROI từng tuần của TC054. Trước: 12,9 · 13,0 · 13,2 · **9,0** (tuần 07/09 đốt 2,0 tr). Sau: 11,1 · 12,8 · 13,4 · 13,3 · tuần đang chạy 19–25/10 là **14,8** (72 đơn, 16.800đ/đơn, chưa trọn tuần).

Lãi ước tính theo công thức của app (GMV × 1/hòa vốn 5,9 − chi ads): trước ~1,24 tr/tuần, sau ~1,47 tr/tuần (**+0,23 tr/tuần, khoảng +1 tr/tháng**). Đây là ước tính, chưa phải lãi sổ cái từng chiến dịch.

## 3. Cả gian and.not.or (sổ cái đơn + chi ads)

| | Đơn không hủy/tuần | GMV/tuần | Lãi trước ads/tuần | Chi ads/tuần | ROI ads | **Lãi sau ads/tuần** |
|---|---|---|---|---|---|---|
| Trước (24/08–13/09) | 168 | 61,2 tr | 9,61 tr | 3,24 tr | 12,1 | **6,36 tr** |
| Sau (21/09–18/10) | 158 (−6%) | 56,9 tr (−7%) | 9,83 tr | 3,15 tr | 12,8 | **6,68 tr (+5%)** |

Đơn đã đối soát 95–100% ở cả hai khoảng, nên lãi là số thật, không phải ước tính. 0 đơn thiếu giá vốn.
Tổng đơn của gian **giảm** 6%. Đơn gán cho ads giữ nguyên (146 → 150/tuần), đơn ngoài ads giảm.

## 4. Shopee ANO Official Store: số để cảnh giác, không phải bằng chứng cho trợ lý

Anh tự chạy ads từ giữa 09/2026 (trợ lý chỉ diễn tập). So 3 tuần gần như không ads (24/08–13/09) với 4 tuần có ads (21/09–18/10):
đơn không hủy 219 → 251/tuần (**+14%**), nhưng lãi sau ads 8,28 → 7,60 tr/tuần (**−8%**). ROAS broad 9,8, chi 2,16 tr/tuần.
Đơn tăng mà lãi giảm. Có lẫn tuần sale 10.10 nên chưa kết luận chắc, nhưng đây chính là lý do không bán bằng câu "tăng đơn".

## 5. Kết luận (nói đúng mức)

- **Không có bằng chứng trợ lý làm tăng tổng số đơn.** Tổng đơn gian TikTok giảm 6% trong cùng khoảng.
- Có dấu hiệu trợ lý làm **mỗi đồng ads hiệu quả hơn** trên đúng chiến dịch nó chạy: TC054 chi phí mỗi đơn −12%, ROI +14%. Trong khi đó nhóm đối chứng cùng gian, cùng thời gian gần như đứng yên (ROI 12,8 → 12,9).
- Giới hạn: 1 chiến dịch, 3 tuần trước / 4 tuần sau. Phần cải thiện phần lớn đến từ việc **không còn tuần đốt tiền** như tuần 07/09 (bỏ tuần đó thì ROI trước là 13,1, ngang mức sau). Nói đúng là "chặn được tuần lỗ", chưa phải "ROI tăng đều".

## 6. Câu dùng được với khách (đã khớp số)

> Shop của chính tôi trên TikTok: chiến dịch bật trợ lý tự loại video thì chi phí mỗi đơn từ khoảng 22.400đ xuống 19.700đ trong 4 tuần, và không còn tuần nào ROI tụt xuống 9 như trước. Các chiến dịch không bật thì đứng yên. Trợ lý không tự đẻ thêm đơn. Nó cắt chỗ đốt tiền để cùng ngân sách ra nhiều đơn có lãi hơn, rồi anh/chị dồn tiền vào chỗ đó.

Không dùng: "tăng X% đơn", "tăng lãi X%" cho cả shop. Số không đỡ được những câu đó.

## 7. Đo lại để có ca chắc hơn

- TC079 bật tự loại thật từ 22/10 → thành chiến dịch thử thứ hai. TC040 NEW giữ diễn tập làm đối chứng.
- Đo lại khoảng **22/11/2026** (4 tuần trọn sau 22/10) bằng câu 3 trong tệp SQL. Muốn khẳng định thì cần 2 chiến dịch cùng cải thiện trong khi đối chứng đứng yên.
- Muốn trả lời câu "tăng đơn" cho đúng thì phải đo khi trợ lý **tăng ngân sách chỗ có lãi** (kết luận "Ngân sách đang chặn", +30%). Hiện chưa có ca nào khách làm theo gợi ý đó. [CHƯA CÓ SỐ]
