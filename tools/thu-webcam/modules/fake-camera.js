// Camera giả: một canvas tự vẽ, phát thành luồng video bằng captureStream().
// Chỉ để chạy thử toàn bộ trang khi không có camera / không cấp được quyền camera.
// Có thể "đưa một tem ra trước camera": vẽ mã vạch Code 128 hoặc QR (tạo bằng zxing-wasm, phần ghi mã).
// KHÔNG dùng camera giả để kết luận về camera thật (tốc độ khung, tab ẩn, độ nét).

import { errText, log } from './core.js';

const WRITER_URL = '/node_modules/zxing-wasm/dist/es/writer/index.js';
const WRITER_WASM_URL = '/node_modules/zxing-wasm/dist/writer/zxing_writer.wasm';
export const FAKE_CAMERA_LABEL = 'Camera giả (hình tự vẽ)';

let writerPromise = null;

function loadWriter() {
	writerPromise ??= (async () => {
		const mod = await import(WRITER_URL);
		await mod.prepareZXingModule({
			overrides: {
				locateFile: (path, prefix) => (path.endsWith('.wasm') ? WRITER_WASM_URL : prefix + path),
			},
			fireImmediately: true,
		});
		return mod;
	})();
	writerPromise.catch(() => {
		writerPromise = null;
	});
	return writerPromise;
}

export function createFakeCamera({ width, height, frameRate }) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { alpha: false });
	let frameNo = 0;
	let shown = null; // { code, format, bitmap }
	const startedAt = performance.now();

	const draw = () => {
		frameNo++;
		const t = (performance.now() - startedAt) / 1000;
		// Nền đổi màu chậm + một thanh chạy ngang để hình luôn thay đổi (bộ mã hóa có việc để làm).
		ctx.fillStyle = `hsl(${Math.round((t * 12) % 360)} 25% 32%)`;
		ctx.fillRect(0, 0, width, height);
		const barX = ((t * 0.25) % 1) * width;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
		ctx.fillRect(barX, 0, Math.round(width * 0.04), height);

		if (shown?.bitmap) {
			// "Tem": thẻ trắng ở giữa hình, mã vạch phóng to theo số nguyên để vạch không nhòe.
			const maxW = width * 0.5;
			const maxH = height * 0.42;
			const scale = Math.max(1, Math.floor(Math.min(maxW / shown.bitmap.width, maxH / shown.bitmap.height)));
			const w = shown.bitmap.width * scale;
			const h = shown.format === 'qr_code' ? shown.bitmap.height * scale : Math.max(shown.bitmap.height * scale, Math.round(height * 0.16));
			const pad = Math.round(height * 0.04);
			const x = Math.round((width - w) / 2);
			const y = Math.round((height - h) / 2);
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(shown.bitmap, x, y, w, h);
			ctx.imageSmoothingEnabled = true;
		}

		const fontPx = Math.round(height * 0.03);
		ctx.font = `${fontPx}px Consolas, monospace`;
		ctx.textBaseline = 'bottom';
		ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
		ctx.fillText(`CAMERA GIẢ  khung ${frameNo}  ${t.toFixed(2)} s`, Math.round(width * 0.02), height - Math.round(height * 0.02));
	};

	draw();
	const timer = setInterval(draw, 1000 / frameRate);
	const stream = canvas.captureStream(frameRate);

	return {
		stream,
		label: FAKE_CAMERA_LABEL,
		get shownCode() {
			return shown ? { code: shown.code, format: shown.format } : null;
		},
		// Đưa một mã ra trước camera giả. code = null/'' → cất mã đi.
		async showCode(code, format = 'code_128') {
			if (!code) {
				shown?.bitmap?.close();
				shown = null;
				return { ok: true, shown: null };
			}
			try {
				const writer = await loadWriter();
				const result = await writer.writeBarcode(String(code), {
					format: format === 'qr_code' ? 'QRCode' : 'Code128',
					scale: format === 'qr_code' ? 4 : 2,
				});
				if (result.error || !result.image) throw new Error(result.error || 'Không tạo được ảnh mã');
				const bitmap = await createImageBitmap(result.image);
				shown?.bitmap?.close();
				shown = { code: String(code), format, bitmap };
				log(`Camera giả: đưa mã ${format} "${code}" ra trước ống kính`);
				return { ok: true, shown: { code: String(code), format, imageWidth: bitmap.width, imageHeight: bitmap.height } };
			} catch (err) {
				return { ok: false, error: errText(err) };
			}
		},
		stop() {
			clearInterval(timer);
			for (const track of stream.getTracks()) track.stop();
			shown?.bitmap?.close();
			shown = null;
		},
	};
}
