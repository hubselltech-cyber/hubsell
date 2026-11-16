// Lõi đọc mã – dùng được cả trong Worker lẫn luồng chính.
// Ưu tiên BarcodeDetector có sẵn của trình duyệt; không có (Chrome trên Windows thường không có)
// thì dùng ponyfill "barcode-detector" (zxing-wasm), tệp .wasm lấy từ máy chủ thử, không gọi ra mạng.

export const SCAN_FORMATS = ['code_128', 'qr_code'];
export const PONYFILL_URL = '/node_modules/barcode-detector/dist/es/ponyfill.js';
export const READER_WASM_URL = '/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm';

export async function createDetector({ forcePonyfill = false } = {}) {
	const info = { engine: null, nativePresent: false, nativeFormats: null, wasmUrl: null, zxingWasmVersion: null };
	const scope = globalThis;

	if ('BarcodeDetector' in scope) {
		info.nativePresent = true;
		try {
			info.nativeFormats = await scope.BarcodeDetector.getSupportedFormats();
			if (!forcePonyfill && SCAN_FORMATS.every((f) => info.nativeFormats.includes(f))) {
				const native = new scope.BarcodeDetector({ formats: SCAN_FORMATS });
				info.engine = 'native';
				return { info, detect: (image) => native.detect(image) };
			}
		} catch (err) {
			info.nativeError = String(err?.message ?? err);
		}
	}

	const mod = await import(PONYFILL_URL);
	// Chỉ đường cho zxing-wasm lấy .wasm ngay trên máy chủ thử (mặc định nó gọi jsDelivr).
	// fireImmediately: nạp wasm ngay để lỗi (nếu có) lộ ra lúc khởi động chứ không phải lúc đọc mã đầu tiên.
	await mod.prepareZXingModule({
		overrides: {
			locateFile: (path, prefix) => (path.endsWith('.wasm') ? READER_WASM_URL : prefix + path),
		},
		fireImmediately: true,
	});
	const detector = new mod.BarcodeDetector({ formats: SCAN_FORMATS });
	info.engine = 'ponyfill';
	info.wasmUrl = READER_WASM_URL;
	info.zxingWasmVersion = mod.ZXING_WASM_VERSION ?? null;
	return { info, detect: (image) => detector.detect(image) };
}

// Đổi kết quả DetectedBarcode về JSON thuần.
export function plainCodes(detected) {
	return (detected ?? []).map((d) => ({
		format: d.format,
		rawValue: d.rawValue,
		box: d.boundingBox
			? {
					x: Math.round(d.boundingBox.x),
					y: Math.round(d.boundingBox.y),
					w: Math.round(d.boundingBox.width),
					h: Math.round(d.boundingBox.height),
				}
			: null,
		corners: Array.isArray(d.cornerPoints)
			? d.cornerPoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
			: null,
	}));
}
