// Canvas ghép hình: vẽ từng khung camera + ngày giờ ở góc trên bên trái.
// Cả hai đường quay (MediaRecorder và WebCodecs) đều lấy hình từ canvas này khi bật ngày giờ.

import { formatStamp, makeStat } from './core.js';

// Chiều cao hộp ngày giờ so với chiều cao khung hình (đề bài: khoảng 3,5 %).
export const STAMP_BOX_RATIO = 0.035;

export class Composer {
	constructor() {
		// Phải là HTMLCanvasElement (không phải OffscreenCanvas) vì MediaRecorder cần captureStream().
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d', { alpha: false });
		this.layout = null;
		this.lastText = null;
		this.resetStats();
	}

	resetStats() {
		this.frames = 0;
		this.drawImageMs = makeStat();
		this.textMs = makeStat();
		this.totalMs = makeStat();
	}

	resize(width, height) {
		if (this.canvas.width !== width) this.canvas.width = width;
		if (this.canvas.height !== height) this.canvas.height = height;
		const boxH = Math.max(12, Math.round(height * STAMP_BOX_RATIO));
		const fontPx = Math.max(9, Math.round(boxH * 0.72));
		const font = `600 ${fontPx}px Consolas, "Cascadia Mono", "Courier New", monospace`;
		this.ctx.font = font;
		// Chuỗi luôn dài 19 ký tự, phông đơn cách → đo một lần là đủ.
		const textW = Math.ceil(this.ctx.measureText('00/00/0000 00:00:00').width);
		const padX = Math.round(boxH * 0.3);
		const margin = Math.round(height * 0.012);
		this.layout = { width, height, boxH, fontPx, font, padX, margin, boxW: textW + padX * 2 };
	}

	// Vẽ một khung. source: VideoFrame hoặc HTMLVideoElement.
	draw(source, withStamp = true, now = new Date()) {
		const L = this.layout;
		if (!L) throw new Error('Chưa đặt kích thước canvas');
		const ctx = this.ctx;
		const t0 = performance.now();
		ctx.drawImage(source, 0, 0, L.width, L.height);
		const t1 = performance.now();
		if (withStamp) {
			const text = formatStamp(now);
			ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
			ctx.fillRect(L.margin, L.margin, L.boxW, L.boxH);
			ctx.font = L.font;
			ctx.textBaseline = 'middle';
			ctx.textAlign = 'left';
			ctx.fillStyle = '#ffffff';
			ctx.fillText(text, L.margin + L.padX, L.margin + L.boxH / 2 + 1);
			this.lastText = text;
		}
		const t2 = performance.now();
		this.frames++;
		this.drawImageMs.add(t1 - t0);
		if (withStamp) this.textMs.add(t2 - t1);
		this.totalMs.add(t2 - t0);
	}

	// Tự kiểm: đọc lại vùng hộp ngày giờ trên canvas, đếm điểm ảnh trắng (chữ) và tối (nền hộp).
	// Chỉ gọi MỘT lần sau khi quay, không gọi theo từng khung (đọc ngược điểm ảnh rất chậm).
	inspectStamp() {
		const L = this.layout;
		if (!L || !this.frames) return null;
		try {
			const img = this.ctx.getImageData(L.margin, L.margin, L.boxW, L.boxH).data;
			let white = 0;
			let dark = 0;
			const total = img.length / 4;
			for (let i = 0; i < img.length; i += 4) {
				const lum = (img[i] * 299 + img[i + 1] * 587 + img[i + 2] * 114) / 1000;
				if (lum > 200) white++;
				else if (lum < 110) dark++;
			}
			return {
				text: this.lastText,
				boxX: L.margin,
				boxY: L.margin,
				boxW: L.boxW,
				boxH: L.boxH,
				boxHeightPercent: Math.round((L.boxH / L.height) * 1000) / 10,
				fontPx: L.fontPx,
				whitePixelPercent: Math.round((white / total) * 1000) / 10,
				darkPixelPercent: Math.round((dark / total) * 1000) / 10,
				// Chữ trắng chiếm một phần, phần còn lại của hộp phải tối.
				looksRight: white / total > 0.03 && white / total < 0.6 && dark / total > 0.25,
			};
		} catch (err) {
			return { error: String(err?.message ?? err), looksRight: false };
		}
	}

	stats() {
		return {
			framesDrawn: this.frames,
			drawImageMs: this.drawImageMs.toJSON(),
			textMs: this.textMs.toJSON(),
			totalMs: this.totalMs.toJSON(),
		};
	}
}
