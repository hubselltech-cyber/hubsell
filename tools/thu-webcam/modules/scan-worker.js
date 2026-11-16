// Worker đọc mã: nhận ImageBitmap của khung hình đủ độ phân giải, trả mã đọc được + số mili giây.
// Chạy ngoài luồng chính để việc đọc mã không làm giật đường quay.

import { createDetector, plainCodes } from './scan-core.js';

let detectorPromise = null;

self.onmessage = async (event) => {
	const msg = event.data;
	if (msg?.type === 'init') {
		try {
			detectorPromise = createDetector({ forcePonyfill: !!msg.forcePonyfill });
			const { info } = await detectorPromise;
			self.postMessage({ type: 'ready', info });
		} catch (err) {
			detectorPromise = null;
			self.postMessage({ type: 'init-error', error: String(err?.message ?? err) });
		}
		return;
	}
	if (msg?.type === 'detect') {
		const { id, bitmap } = msg;
		const started = performance.now();
		try {
			if (!detectorPromise) throw new Error('Worker chưa khởi động');
			const { detect } = await detectorPromise;
			const detected = await detect(bitmap);
			self.postMessage({ type: 'result', id, ms: performance.now() - started, codes: plainCodes(detected) });
		} catch (err) {
			self.postMessage({ type: 'result', id, ms: performance.now() - started, codes: [], error: String(err?.message ?? err) });
		} finally {
			try {
				bitmap?.close();
			} catch {
				// đã đóng
			}
		}
	}
};
