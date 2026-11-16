// Bơm khung hình: lấy từng khung camera đưa cho đường quay.
// Hai cách:
//  - 'mstp': MediaStreamTrackProcessor – đọc thẳng VideoFrame từ track, không phụ thuộc việc vẽ màn hình
//            (kỳ vọng vẫn chạy khi tab bị ẩn).
//  - 'rvfc': requestVideoFrameCallback trên thẻ <video> – gắn với việc vẽ màn hình
//            (kỳ vọng DỪNG khi tab bị ẩn).

import { counters, errText, log } from './core.js';

export function supportedPumpModes() {
	const modes = [];
	if (typeof window.MediaStreamTrackProcessor === 'function') modes.push('mstp');
	if (typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype) {
		modes.push('rvfc');
	}
	return modes;
}

export function resolvePumpMode(wanted) {
	const modes = supportedPumpModes();
	if (wanted && wanted !== 'auto' && modes.includes(wanted)) return wanted;
	return modes[0] ?? null;
}

// onFrame(source, timestampUs, wallMs) – có thể trả Promise; khung chỉ được đóng sau khi Promise xong.
export function startPump({ mode, track, video, onFrame }) {
	const stats = { mode, frames: 0, skippedBusy: 0, errors: 0, lastError: null };
	let running = true;
	let stopImpl = async () => {};

	const fail = (err) => {
		stats.errors++;
		stats.lastError = errText(err);
		if (stats.errors <= 5) log(`Lỗi khi xử lý khung hình: ${stats.lastError}`, undefined, 'error');
	};

	if (mode === 'mstp') {
		// Nhân bản track để việc đọc khung không ảnh hưởng thẻ <video> xem trước.
		const clone = track.clone();
		const processor = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 2 });
		const reader = processor.readable.getReader();
		const loop = (async () => {
			while (running) {
				let result;
				try {
					result = await reader.read();
				} catch (err) {
					if (running) fail(err);
					break;
				}
				if (result.done) break;
				const frame = result.value;
				try {
					if (running) {
						stats.frames++;
						counters.pumpFrames++;
						await onFrame(frame, frame.timestamp ?? performance.now() * 1000, performance.now());
					}
				} catch (err) {
					fail(err);
				} finally {
					frame.close();
				}
			}
		})();
		stopImpl = async () => {
			try {
				await reader.cancel();
			} catch {
				// đã đóng
			}
			await loop.catch(() => {});
			clone.stop();
		};
	} else if (mode === 'rvfc') {
		let busy = false;
		let handle = 0;
		const tick = (now) => {
			if (!running) return;
			handle = video.requestVideoFrameCallback(tick);
			stats.frames++;
			counters.pumpFrames++;
			if (busy) {
				stats.skippedBusy++;
				return;
			}
			busy = true;
			Promise.resolve()
				.then(() => onFrame(video, now * 1000, performance.now()))
				.catch(fail)
				.finally(() => {
					busy = false;
				});
		};
		handle = video.requestVideoFrameCallback(tick);
		stopImpl = async () => {
			try {
				video.cancelVideoFrameCallback(handle);
			} catch {
				// không sao
			}
		};
	} else {
		throw new Error('Trình duyệt không có cách nào lấy từng khung hình (thiếu MediaStreamTrackProcessor và requestVideoFrameCallback)');
	}

	return {
		stats,
		async stop() {
			if (!running) return;
			running = false;
			await stopImpl();
		},
	};
}
