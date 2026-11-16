// Vẽ giao diện từ state. Không chứa logic thử – chỉ đọc state và hiện ra.

const STATUS_LABEL = {
	'not-run': 'Chưa chạy',
	running: 'Đang chạy',
	pass: 'Đạt',
	fail: 'Không đạt',
	unsupported: 'Không hỗ trợ',
};

const AUTO_BUSY = 'tự cắt theo tem';
const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

const num = (v, unit = '') => (typeof v === 'number' && Number.isFinite(v) ? `${nf.format(v)}${unit}` : '—');
const yesNo = (v) => (v === true ? 'Có' : v === false ? 'Không' : '—');
const bytes = (v) => (typeof v === 'number' ? `${nf.format(v)} byte (${nf.format(v / 1048576)} MB)` : '—');
const stat = (s, unit = ' ms') => (s && s.n ? `trung bình ${num(s.avg, unit)}, lớn nhất ${num(s.max, unit)} (${nf.format(s.n)} lần)` : '—');
const text = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function createUi(state, { video }) {
	const $ = (id) => document.getElementById(id);
	const logEl = $('log');
	const gateEl = (n) => document.querySelector(`.gate[data-gate="${n}"]`);
	const part = (n, role) => gateEl(n).querySelector(`[data-role="${role}"]`);

	function setBadge(el, status) {
		el.dataset.status = status;
		el.textContent = STATUS_LABEL[status] ?? status;
	}

	function setReason(n, gate) {
		const el = part(n, 'reason');
		el.dataset.status = gate.status;
		el.textContent = gate.reason ?? '';
	}

	// rows: [nhãn, giá trị, lớp màu tùy chọn]
	function setKv(el, rows) {
		// Không đổi thì không vẽ lại – để còn bôi đen chép được chữ.
		const sig = JSON.stringify(rows);
		if (el.dataset.sig === sig) return;
		el.dataset.sig = sig;
		const frag = document.createDocumentFragment();
		for (const row of rows) {
			if (!row) continue;
			const [label, value, cls] = row;
			const dt = document.createElement('dt');
			dt.textContent = label;
			const dd = document.createElement('dd');
			dd.textContent = text(value);
			if (cls) dd.className = cls;
			frag.append(dt, dd);
		}
		el.replaceChildren(frag);
	}

	// columns: [tiêu đề, hàm lấy giá trị, lớp ô]
	function setTable(el, caption, columns, items) {
		const sig = JSON.stringify(items ?? null);
		if (el.dataset.sig === sig) return;
		el.dataset.sig = sig;
		if (!items?.length) {
			el.replaceChildren();
			return;
		}
		const cap = document.createElement('caption');
		cap.textContent = caption;
		const head = document.createElement('tr');
		for (const [title, , cls] of columns) {
			const th = document.createElement('th');
			th.textContent = title;
			if (cls) th.className = cls;
			head.append(th);
		}
		const thead = document.createElement('thead');
		thead.append(head);
		const tbody = document.createElement('tbody');
		for (const item of items) {
			const tr = document.createElement('tr');
			for (const [, get, cls] of columns) {
				const td = document.createElement('td');
				td.textContent = text(get(item));
				if (cls) td.className = cls;
				tr.append(td);
			}
			tbody.append(tr);
		}
		el.replaceChildren(cap, thead, tbody);
	}

	function gate1Rows(g) {
		const cam = g.result?.camera ?? (state.camera ? state.camera : null);
		const fps = g.result?.fps;
		const sup = g.result?.support ?? state.support;
		const rows = [];
		if (cam?.open) {
			const req = cam.requested;
			const sizeOk = cam.videoWidth === req.width && cam.videoHeight === req.height;
			rows.push(
				['Camera', cam.label],
				['Yêu cầu', `${req.width}×${req.height} @ ${req.frameRate} khung/giây`],
				['getSettings trả về', `${text(cam.settings.width)}×${text(cam.settings.height)} @ ${num(cam.settings.frameRate)} khung/giây`],
				['Kích thước khung thật', `${cam.videoWidth}×${cam.videoHeight}`, sizeOk ? 'good' : 'bad'],
				['Camera cho tối đa', cam.capabilities ? `${text(cam.capabilities.widthMax)}×${text(cam.capabilities.heightMax)} @ ${num(cam.capabilities.frameRateMax)}` : '—'],
				['deviceId', cam.deviceId],
				cam.note ? ['Ghi chú', cam.note, 'warn'] : null,
			);
		}
		if (fps) {
			rows.push(
				['Tốc độ khung đo được', fps.ok ? `${num(fps.fps)} khung/giây (${fps.frames} khung trong ${fps.seconds} giây)` : fps.error, fps.ok ? null : 'bad'],
				fps.ok ? ['Khoảng cách giữa hai khung', `trung bình ${num(fps.avgIntervalMs, ' ms')}, dài nhất ${num(fps.maxIntervalMs, ' ms')}`] : null,
			);
		}
		if (sup) {
			rows.push(
				["'BarcodeDetector' in window", `${sup.barcodeDetectorInWindow}${sup.barcodeDetectorFormats ? ` – ${[].concat(sup.barcodeDetectorFormats).join(', ') || 'không có định dạng nào'}` : ''}`],
				['typeof VideoEncoder', sup.typeofVideoEncoder],
				['typeof MediaStreamTrackProcessor', sup.typeofMediaStreamTrackProcessor],
				['requestVideoFrameCallback', yesNo(sup.requestVideoFrameCallback)],
			);
			for (const [type, ok] of Object.entries(sup.mediaRecorderTypes ?? {})) {
				rows.push([`MediaRecorder ${type}`, yesNo(ok), ok ? 'good' : 'warn']);
			}
			for (const [size, row] of Object.entries(sup.h264Encoder ?? {})) {
				rows.push([
					`Mã hóa H.264 ${size.replace('x', '×')}`,
					`tự chọn: ${yesNo(row.noPreference)}, phần cứng: ${yesNo(row.hardware)}, phần mềm: ${yesNo(row.software)}`,
					row.noPreference ? null : 'warn',
				]);
			}
		}
		return rows;
	}

	function recordingRows(r) {
		if (!r) return [];
		if (!r.ok) return [['Lỗi', r.error, 'bad']];
		const rows = [
			['Kiểu tệp', r.mime, r.fallbackToWebm ? 'warn' : null],
			r.fallbackToWebm ? ['Lưu ý', 'Không quay được MP4, đã lùi về WebM', 'warn'] : null,
			r.codec ? ['Codec', r.codec] : null,
			['Dung lượng', bytes(r.bytes)],
			['Thời gian quay', `${num(r.wallSeconds)} giây theo đồng hồ${r.mediaSeconds != null ? `, ${num(r.mediaSeconds)} giây trong tệp` : ''}`],
		];
		if (r.path === 'webcodecs') {
			rows.push(
				['Số khung đã mã hóa', `${r.framesEncoded} (đưa vào ${r.framesFed}, khung khóa ${r.keyFrames})`],
				['Khung rớt', `${r.droppedBeforeEncode} do bộ mã hóa bận, ${r.droppedByEncoder} do bộ mã hóa tự bỏ`, r.droppedBeforeEncode + r.droppedByEncoder ? 'warn' : null],
				['Thiếu so với nhịp yêu cầu', `${text(r.missingVsRequestedFps)} khung (lẽ ra ${text(r.expectedFrames)})`, r.missingVsRequestedFps > 2 ? 'warn' : null],
				['Thời gian mã hóa mỗi khung', stat(r.pipeline?.encodeMs)],
				['Hàng chờ bộ mã hóa dài nhất', r.pipeline?.encodeQueueMax],
				['Cách lấy khung hình', r.pipeline?.pumpMode],
				['Ghép tệp + gửi lưu', `${num(r.finalizeMs, ' ms')} + ${num(r.uploadMs, ' ms')}`],
			);
		} else {
			rows.push(
				['Số khung đã mã hóa', r.framesDrawnToCanvas != null ? `không biết (đã vẽ ${r.framesDrawnToCanvas} khung vào canvas)` : 'không biết (MediaRecorder không báo)'],
				['Khung rớt', r.previewDroppedFrames != null ? `không biết (ô xem trước rớt ${r.previewDroppedFrames})` : 'không biết'],
				['Đường tiếng', r.audioTracks],
			);
		}
		rows.push(
			['Thứ tự hộp MP4', r.boxOrder],
			['moov nằm trước mdat', yesNo(r.moovBeforeMdat), r.moovBeforeMdat === true ? 'good' : r.moovBeforeMdat === false ? 'bad' : null],
			r.fragmented ? ['Lưu ý', 'Tệp MP4 dạng phân mảnh (có moof)', 'warn'] : null,
			['In ngày giờ', yesNo(r.overlay)],
			r.draw ? ['Chi phí vẽ canvas mỗi khung', stat(r.draw.totalMs)] : null,
			['Tệp đã lưu', r.savedPath],
		);
		return rows;
	}

	function gate3Rows(g) {
		const r = g.result;
		if (!r) return [];
		const a = r.withStamp;
		const b = r.withoutStamp;
		const frames = (x) => (x?.ok ? (x.framesEncoded != null ? `${x.framesEncoded} khung` : `${bytes(x.bytes)}`) : `lỗi: ${x?.error}`);
		return [
			['Đường quay', r.path === 'mediarecorder' ? 'MediaRecorder' : 'WebCodecs'],
			['Chi phí vẽ canvas mỗi khung', `trung bình ${num(r.avgDrawMsPerFrame, ' ms')}, lớn nhất ${num(r.maxDrawMsPerFrame, ' ms')}`],
			['Trong đó', `chép hình camera ${num(r.avgDrawImageMs, ' ms')}, vẽ hộp + chữ ${num(r.avgTextMs, ' ms')}`],
			['Mức cho phép', num(r.drawBudgetMs, ' ms')],
			['Chữ in gần nhất', r.stamp?.text],
			['Hộp ngày giờ', r.stamp ? `${r.stamp.boxW}×${r.stamp.boxH} điểm ảnh tại (${r.stamp.boxX}, ${r.stamp.boxY}), cao ${num(r.stamp.boxHeightPercent, ' %')} khung hình` : '—'],
			['Tự kiểm vùng hộp trên canvas', r.stamp ? `${r.stamp.looksRight ? 'đúng' : 'sai'} (trắng ${num(r.stamp.whitePixelPercent, ' %')}, tối ${num(r.stamp.darkPixelPercent, ' %')})` : '—', r.stamp?.looksRight ? 'good' : 'bad'],
			['Có ngày giờ', `${frames(a)}, mã hóa ${stat(a?.pipeline?.encodeMs)}`],
			['Không có ngày giờ', `${frames(b)}, mã hóa ${stat(b?.pipeline?.encodeMs)}`],
			['Tệp có ngày giờ', a?.savedPath],
			['Tệp không có ngày giờ', b?.savedPath],
		];
	}

	function scanRows(s) {
		if (!s) return [];
		return [
			['Bộ đọc', s.ready ? `${s.engine === 'native' ? 'BarcodeDetector có sẵn' : 'ponyfill barcode-detector (zxing-wasm)'}, chạy ${s.thread === 'worker' ? 'trong Worker' : 'trên luồng chính'}` : 'chưa khởi động'],
			['Khung đem đọc', s.frameSize ? `${s.frameSize.width}×${s.frameSize.height}` : '—'],
			['Số lần thử', s.attempts],
			['Số lần đọc được', `${s.successes} (${s.codesRead} mã)`, s.successes ? 'good' : null],
			['Bỏ lượt vì lần trước chưa xong', s.skippedBusy, s.skippedBusy ? 'warn' : null],
			['Thời gian giải mã', stat(s.decodeMs)],
			['Thời gian chụp khung', stat(s.bitmapMs)],
			['Tổng từ lúc lấy khung tới lúc có kết quả', stat(s.totalMs)],
			s.errors ? ['Lỗi', `${s.errors} lần – ${s.lastError}`, 'bad'] : null,
		];
	}

	function gate5Rows(a) {
		if (!a) return [];
		return [
			['Trạng thái', a.phase === 'recording' ? `đang quay ${a.currentCode}` : 'nghỉ, chờ mã vận đơn'],
			['Mã đang chờ xác nhận', a.candidate ? `${a.candidate.code} (${a.candidate.count}/${a.confirmReads} lần đọc)` : '—'],
			['Mã đã có clip', a.doneCodes?.length ? a.doneCodes.join(', ') : '—'],
			['Mã đọc được', `${a.reads.total} (hợp lệ ${a.reads.valid}, bỏ qua ${a.reads.ignored})`],
			['Lần báo "Tem này đã quay rồi"', a.reads.repeats],
			['Từ lúc quyết định cắt tới khung đầu clip mới', a.cuts?.length ? `trung bình ${num(a.cutMsAvg, ' ms')}, chậm nhất ${num(a.cutMsMax, ' ms')}` : '—'],
			a.scan ? ['Đọc mã', `${a.scan.successes}/${a.scan.attempts} lần, giải mã ${stat(a.scan.decodeMs)}`] : null,
			a.pipeline ? ['Bộ mã hóa', `${a.pipeline.codec}, ra ${a.pipeline.chunksOut} gói, mã hóa ${stat(a.pipeline.encodeMs)}`] : null,
		];
	}

	function renderLive() {
		const cam = state.camera;
		$('preview-empty').hidden = !!cam?.open;
		const parts = [];
		if (cam?.open) {
			parts.push(`${video.videoWidth}×${video.videoHeight}`);
			parts.push(`${num(cam.liveFps)} khung/giây`);
			if (cam.ended) parts.push('CAMERA BỊ NGẮT');
		}
		const c = state.counters;
		parts.push(`khung xem trước ${c.monitorFrames}`, `khung vào đường quay ${c.pumpFrames}`, `gói đã mã hóa ${c.encodedChunks}`, `lần thử đọc mã ${c.scanAttempts}`);
		if (state.visibility.events.length) {
			const last = state.visibility.events[state.visibility.events.length - 1];
			parts.push(`lần ẩn tab gần nhất: ${last.hiddenMs} ms, khung ${last.framesKeptArriving ? 'vẫn về' : 'không về'}`);
		}
		$('live').textContent = parts.join(' · ');

		const busy = $('busy');
		busy.hidden = !state.busy;
		busy.textContent = state.busy ? `Đang chạy: ${state.busy}` : '';

		const notice = $('notice');
		const n = state.auto?.notice;
		const fresh = n && state.busy === AUTO_BUSY;
		notice.hidden = !fresh;
		if (fresh) {
			notice.dataset.kind = n.kind;
			notice.textContent = n.text;
		}
	}

	function renderButtons() {
		const autoOn = state.busy === AUTO_BUSY;
		for (const btn of document.querySelectorAll('.gate button')) {
			if (btn.id === 'btn-g5-finish') btn.disabled = !autoOn || state.auto?.phase !== 'recording';
			else if (btn.id === 'btn-g5-stop') btn.disabled = !autoOn;
			else if (btn.id === 'btn-fake-show' || btn.id === 'btn-fake-hide') btn.disabled = false;
			else btn.disabled = !!state.busy;
		}
	}

	function render() {
		const g = state.gates;
		for (const n of [1, 2, 3, 4, 5]) {
			setBadge(part(n, 'badge'), g[n].status);
			setReason(n, g[n]);
		}
		setKv(part(1, 'kv'), gate1Rows(g[1]));

		setBadge(part(2, 'badge-a'), g[2].a.status);
		setBadge(part(2, 'badge-b'), g[2].b.status);
		setKv(part(2, 'kv-a'), [g[2].a.reason ? ['Kết quả', g[2].a.reason, g[2].a.status === 'pass' ? 'good' : 'bad'] : null, ...recordingRows(g[2].a.result)]);
		setKv(part(2, 'kv-b'), [g[2].b.reason ? ['Kết quả', g[2].b.reason, g[2].b.status === 'pass' ? 'good' : 'bad'] : null, ...recordingRows(g[2].b.result)]);

		setKv(part(3, 'kv'), gate3Rows(g[3]));

		const scanning = state.busy === 'quay và đọc mã';
		setKv(part(4, 'kv'), scanRows(scanning ? state.scan : g[4].result?.scan));
		setTable(
			part(4, 'decodes'),
			'Các lần đọc được gần nhất',
			[
				['Lúc', (d) => d.t.slice(11, 23)],
				['Loại', (d) => d.format],
				['Giá trị', (d) => d.value],
				['Giải mã (ms)', (d) => num(d.decodeMs), 'num'],
				['Tổng (ms)', (d) => num(d.totalMs), 'num'],
			],
			(scanning ? state.decodes : g[4].result?.decodes)?.slice(-12).reverse(),
		);

		const auto = state.busy === AUTO_BUSY ? state.auto : g[5].result;
		setKv(part(5, 'kv'), gate5Rows(auto));
		setTable(
			part(5, 'clips'),
			'Các clip',
			[
				['Mã', (c) => c.code],
				['Tình trạng', (c) => (c.status === 'saved' ? 'đã lưu' : c.status === 'failed' ? `hỏng: ${c.error}` : 'đang quay')],
				['Giây', (c) => num(c.seconds), 'num'],
				['Byte', (c) => (c.bytes != null ? nf.format(c.bytes) : '—'), 'num'],
				['Khung', (c) => text(c.frames), 'num'],
				['Tệp đã lưu', (c) => c.path, 'path'],
			],
			auto?.clips,
		);
		setTable(
			part(5, 'cuts'),
			'Các lần cắt',
			[
				['Từ', (c) => c.from],
				['Sang', (c) => c.to],
				['Quyết định → khung đầu (ms)', (c) => num(c.msDecisionToFirstFrame), 'num'],
				['Quyết định → gói đầu ra khỏi bộ mã hóa (ms)', (c) => num(c.msDecisionToFirstChunk), 'num'],
			],
			auto?.cuts,
		);

		renderLive();
		renderButtons();
	}

	function appendLog(entry) {
		const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
		const line = document.createElement('div');
		if (entry.level !== 'info') line.className = entry.level;
		const time = document.createElement('time');
		const d = new Date(entry.t);
		time.textContent = `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}  `;
		line.append(time, entry.msg);
		logEl.append(line);
		while (logEl.childElementCount > 600) logEl.firstElementChild.remove();
		if (atBottom) logEl.scrollTop = logEl.scrollHeight;
	}

	function clearLog() {
		logEl.replaceChildren();
	}

	// Danh sách camera: "tự chọn" + camera thật + camera giả. Giữ nguyên lựa chọn đang có.
	function fillCameras(cams, fakeId, fakeLabel) {
		const select = $('sel-camera');
		const previous = select.value;
		const options = [new Option('Tự chọn (ưu tiên tên có "Web Camera")', '')];
		for (const cam of cams) {
			if (cam.deviceId) options.push(new Option(cam.label, cam.deviceId));
		}
		options.push(new Option(`${fakeLabel} – để thử khi không có camera`, fakeId));
		select.replaceChildren(...options);
		if ([...select.options].some((o) => o.value === previous)) select.value = previous;
	}

	function setFakeTools(visible) {
		$('fake-tools').hidden = !visible;
	}

	return { render, appendLog, clearLog, fillCameras, setFakeTools };
}
