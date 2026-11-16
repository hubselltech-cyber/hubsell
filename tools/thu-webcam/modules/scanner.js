// Bộ đọc mã phía luồng chính: cứ 200 ms lấy khung hình ĐỦ độ phân giải hiện tại,
// gửi sang Worker đọc Code 128 + QR, ghi nhật ký từng lần đọc được và vẽ khung bao lên ô xem trước.
// Không bao giờ vẽ vào canvas quay.

import { counters, errText, log, makeStat, round } from './core.js';

export const SCAN_INTERVAL_MS = 200;
const WORKER_INIT_TIMEOUT_MS = 15000;
const MAX_DECODE_LOG = 300;

export class Scanner {
	constructor({ boxCanvas }) {
		this.boxCanvas = boxCanvas;
		this.worker = null;
		this.mainDetector = null;
		this.info = { ready: false, thread: null, engine: null };
		this.active = false;
		this.busy = false;
		this.lastAttemptAt = -Infinity;
		this.seq = 0;
		this.pending = new Map();
		this.timer = null;
		this.clearBoxesTimer = null;
		this.onRead = null;
		this.decodes = [];
		this.resetCounters();
	}

	resetCounters() {
		this.c = { attempts: 0, successes: 0, skippedBusy: 0, errors: 0, lastError: null, codesRead: 0 };
		this.decodeMs = makeStat();
		this.bitmapMs = makeStat();
		this.totalMs = makeStat();
		this.frameSize = null;
	}

	// Khởi động một lần. Thử Worker trước; Worker hỏng thì đọc trên luồng chính và ghi rõ.
	async init({ forcePonyfill = false, forceMainThread = false } = {}) {
		if (this.info.ready) return this.info;
		if (typeof createImageBitmap !== 'function') {
			this.info = { ready: false, thread: null, engine: null, error: 'Trình duyệt không có createImageBitmap' };
			return this.info;
		}
		let workerError = null;
		if (!forceMainThread && typeof Worker === 'function') {
			try {
				const info = await this.#startWorker(forcePonyfill);
				this.info = { ready: true, thread: 'worker', ...info };
				log(`Bộ đọc mã sẵn sàng: ${info.engine}, chạy trong Worker`, info);
				return this.info;
			} catch (err) {
				workerError = errText(err);
				log(`Không chạy được Worker đọc mã (${workerError}) – chuyển sang luồng chính`, undefined, 'warn');
				this.worker?.terminate();
				this.worker = null;
			}
		}
		try {
			const { createDetector, plainCodes } = await import('./scan-core.js');
			const { info, detect } = await createDetector({ forcePonyfill });
			this.mainDetector = { detect, plainCodes };
			this.info = { ready: true, thread: 'main', workerError, ...info };
			log(`Bộ đọc mã sẵn sàng: ${info.engine}, chạy trên luồng chính`, this.info, 'warn');
		} catch (err) {
			this.info = { ready: false, thread: null, engine: null, workerError, error: errText(err) };
			log(`Không khởi động được bộ đọc mã: ${this.info.error}`, undefined, 'error');
		}
		return this.info;
	}

	// Tắt hẳn để khởi động lại theo cách khác (ví dụ ép chạy trên luồng chính để so chi phí).
	reset() {
		this.stop();
		this.worker?.terminate();
		this.worker = null;
		this.mainDetector = null;
		this.pending.clear();
		this.busy = false;
		this.info = { ready: false, thread: null, engine: null };
	}

	#startWorker(forcePonyfill) {
		return new Promise((resolve, reject) => {
			const worker = new Worker(new URL('./scan-worker.js', import.meta.url), { type: 'module' });
			const timeout = setTimeout(() => reject(new Error('Worker không trả lời sau 15 giây')), WORKER_INIT_TIMEOUT_MS);
			worker.onerror = (event) => {
				clearTimeout(timeout);
				reject(new Error(event.message || 'Worker lỗi khi nạp'));
			};
			worker.onmessage = (event) => {
				const msg = event.data;
				if (msg?.type === 'ready') {
					clearTimeout(timeout);
					worker.onerror = (e) => log(`Worker đọc mã lỗi: ${e.message}`, undefined, 'error');
					resolve(msg.info);
				} else if (msg?.type === 'init-error') {
					clearTimeout(timeout);
					reject(new Error(msg.error));
				} else if (msg?.type === 'result') {
					this.#onResult(msg);
				}
			};
			this.worker = worker;
			worker.postMessage({ type: 'init', forcePonyfill });
		});
	}

	// Bắt đầu đọc. usePumpFrames = true: đường quay tự đưa khung (offer); false: tự lấy từ thẻ <video> bằng đồng hồ.
	start({ video, usePumpFrames, onRead = null }) {
		if (!this.info.ready) return false;
		this.stop();
		this.onRead = onRead;
		this.active = true;
		this.lastAttemptAt = -Infinity;
		if (!usePumpFrames) {
			this.timer = setInterval(() => {
				if (video.readyState >= 2) this.offer(video, 'video');
			}, SCAN_INTERVAL_MS);
		}
		return true;
	}

	stop() {
		this.active = false;
		this.onRead = null;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.clearBoxes();
	}

	clearBoxes() {
		clearTimeout(this.clearBoxesTimer);
		const canvas = this.boxCanvas;
		canvas?.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
	}

	// Đưa một khung cho bộ đọc. Trả Promise (xong khi đã chụp được ảnh từ khung) nếu nhận, null nếu chưa tới lượt.
	// Người gọi phải chờ Promise này rồi mới được đóng VideoFrame.
	offer(source, via) {
		if (!this.active) return null;
		const now = performance.now();
		if (now - this.lastAttemptAt < SCAN_INTERVAL_MS - 4) return null;
		if (this.busy && now - this.busySince > 5000) {
			// Lần đọc trước treo (Worker chết?) – gỡ kẹt để không đứng hẳn.
			this.busy = false;
			this.pending.clear();
			this.c.errors++;
			this.c.lastError = 'Một lần đọc mã treo quá 5 giây';
			log(this.c.lastError, undefined, 'error');
		}
		if (this.busy) {
			// Lần đọc trước chưa xong: bỏ lượt này, không xếp hàng.
			this.lastAttemptAt = now;
			this.c.skippedBusy++;
			return null;
		}
		this.busy = true;
		this.busySince = now;
		this.lastAttemptAt = now;
		this.c.attempts++;
		counters.scanAttempts++;
		const id = ++this.seq;
		return createImageBitmap(source)
			.then((bitmap) => {
				const bitmapMs = performance.now() - now;
				this.bitmapMs.add(bitmapMs);
				this.frameSize = { width: bitmap.width, height: bitmap.height };
				this.pending.set(id, { startedAt: now, via, width: bitmap.width, height: bitmap.height });
				if (this.worker) {
					this.worker.postMessage({ type: 'detect', id, bitmap }, [bitmap]);
				} else {
					this.#detectOnMain(id, bitmap);
				}
			})
			.catch((err) => {
				this.busy = false;
				this.c.errors++;
				this.c.lastError = errText(err);
			});
	}

	async #detectOnMain(id, bitmap) {
		const started = performance.now();
		try {
			const detected = await this.mainDetector.detect(bitmap);
			this.#onResult({ id, ms: performance.now() - started, codes: this.mainDetector.plainCodes(detected) });
		} catch (err) {
			this.#onResult({ id, ms: performance.now() - started, codes: [], error: errText(err) });
		} finally {
			bitmap.close();
		}
	}

	#onResult(msg) {
		const pending = this.pending.get(msg.id);
		this.pending.delete(msg.id);
		this.busy = false;
		if (!pending) return;
		const totalMs = performance.now() - pending.startedAt;
		this.decodeMs.add(msg.ms);
		this.totalMs.add(totalMs);
		if (msg.error) {
			this.c.errors++;
			this.c.lastError = msg.error;
			if (this.c.errors <= 3) log(`Lỗi khi đọc mã: ${msg.error}`, undefined, 'error');
		}
		const codes = msg.codes ?? [];
		if (codes.length) {
			this.c.successes++;
			for (const code of codes) {
				this.c.codesRead++;
				const entry = {
					t: new Date().toISOString(),
					format: code.format,
					value: code.rawValue,
					decodeMs: round(msg.ms, 1),
					totalMs: round(totalMs, 1),
					via: pending.via,
				};
				this.decodes.push(entry);
				if (this.decodes.length > MAX_DECODE_LOG) this.decodes.shift();
				log(`Đọc được mã ${code.format}: ${code.rawValue} (${entry.decodeMs} ms)`);
			}
		}
		if (this.active) this.#drawBoxes(codes, pending.width, pending.height);
		if (this.active && this.onRead) {
			try {
				this.onRead(codes, { decodeMs: msg.ms, totalMs });
			} catch (err) {
				log(`Lỗi khi xử lý mã vừa đọc: ${errText(err)}`, undefined, 'error');
			}
		}
	}

	// Khung bao chỉ vẽ lên lớp phủ của ô xem trước.
	#drawBoxes(codes, width, height) {
		const canvas = this.boxCanvas;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		clearTimeout(this.clearBoxesTimer);
		if (!codes.length) return;
		const line = Math.max(3, Math.round(height / 240));
		ctx.lineWidth = line;
		ctx.font = `600 ${Math.max(14, Math.round(height / 36))}px system-ui, sans-serif`;
		ctx.textBaseline = 'bottom';
		for (const code of codes) {
			ctx.strokeStyle = code.format === 'qr_code' ? '#38bdf8' : '#22c55e';
			ctx.fillStyle = ctx.strokeStyle;
			if (code.corners?.length === 4) {
				ctx.beginPath();
				ctx.moveTo(code.corners[0].x, code.corners[0].y);
				for (let i = 1; i < 4; i++) ctx.lineTo(code.corners[i].x, code.corners[i].y);
				ctx.closePath();
				ctx.stroke();
			} else if (code.box) {
				ctx.strokeRect(code.box.x, code.box.y, code.box.w, code.box.h);
			}
			if (code.box) ctx.fillText(code.rawValue.slice(0, 40), code.box.x, Math.max(20, code.box.y - line));
		}
		this.clearBoxesTimer = setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), 700);
	}

	stats() {
		return {
			ready: this.info.ready,
			thread: this.info.thread,
			engine: this.info.engine,
			intervalMs: SCAN_INTERVAL_MS,
			frameSize: this.frameSize,
			attempts: this.c.attempts,
			successes: this.c.successes,
			codesRead: this.c.codesRead,
			skippedBusy: this.c.skippedBusy,
			errors: this.c.errors,
			lastError: this.c.lastError,
			decodeMs: this.decodeMs.toJSON(),
			bitmapMs: this.bitmapMs.toJSON(),
			totalMs: this.totalMs.toJSON(),
		};
	}
}
