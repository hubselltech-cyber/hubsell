// Phần dùng chung: nhật ký, bộ đếm, hàm tiện ích.

export const logEntries = [];
const logListeners = new Set();
const MAX_LOG = 5000;

// Bộ đếm toàn trang – dùng để biết khung hình có còn về khi tab bị ẩn hay không.
export const counters = {
	monitorFrames: 0, // khung hình tới thẻ <video> xem trước (requestVideoFrameCallback)
	pumpFrames: 0, // khung hình đi vào đường quay (bơm khung)
	encodedChunks: 0, // gói H.264 bộ mã hóa WebCodecs trả ra
	scanAttempts: 0, // số lần thử đọc mã
};

export function log(msg, data, level = 'info') {
	const entry = {
		t: new Date().toISOString(),
		ms: Math.round(performance.now()),
		level,
		msg: String(msg),
	};
	if (data !== undefined) entry.data = toPlain(data);
	logEntries.push(entry);
	if (logEntries.length > MAX_LOG) logEntries.splice(0, logEntries.length - MAX_LOG);
	for (const fn of logListeners) {
		try {
			fn(entry);
		} catch {
			// người nghe lỗi không được làm hỏng nhật ký
		}
	}
	return entry;
}

export function onLog(fn) {
	logListeners.add(fn);
	return () => logListeners.delete(fn);
}

// Đổi mọi thứ về dạng JSON thuần để đọc được từ phiên điều khiển.
export function toPlain(value) {
	try {
		return JSON.parse(
			JSON.stringify(value, (_key, v) => {
				if (v instanceof Error) return { name: v.name, message: v.message };
				if (typeof v === 'bigint') return Number(v);
				if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength} byte]`;
				if (ArrayBuffer.isView(v)) return `[${v.constructor.name} ${v.byteLength} byte]`;
				return v;
			}),
		);
	} catch {
		return String(value);
	}
}

export function errText(err) {
	if (!err) return 'Lỗi không rõ';
	if (err.name && err.name !== 'Error' && err.message) return `${err.name}: ${err.message}`;
	return String(err.message ?? err);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const pad = (n, len = 2) => String(n).padStart(len, '0');

// dd/MM/yyyy HH:mm:ss – đúng chuỗi in vào hình.
export function formatStamp(d = new Date()) {
	return (
		`${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

// yyyyMMdd-HHmmss – dùng trong tên tệp.
export function fileStamp(d = new Date()) {
	return (
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
		`${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	);
}

export function safeName(raw) {
	return String(raw ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'tep';
}

export const round = (n, digits = 2) => {
	if (typeof n !== 'number' || !Number.isFinite(n)) return null;
	const k = 10 ** digits;
	return Math.round(n * k) / k;
};

// Bộ cộng dồn trung bình / lớn nhất.
export function makeStat() {
	return {
		n: 0,
		sum: 0,
		max: 0,
		add(v) {
			if (!Number.isFinite(v)) return;
			this.n++;
			this.sum += v;
			if (v > this.max) this.max = v;
		},
		toJSON() {
			return { n: this.n, avg: this.n ? round(this.sum / this.n, 2) : null, max: this.n ? round(this.max, 2) : null };
		},
	};
}

// Gửi tệp về máy chủ thử: POST /save?name=...
export async function saveToServer(name, body, contentType = 'application/octet-stream') {
	const started = performance.now();
	const res = await fetch(`/save?name=${encodeURIComponent(safeName(name))}`, {
		method: 'POST',
		headers: { 'Content-Type': contentType },
		body,
	});
	let json = null;
	try {
		json = await res.json();
	} catch {
		// máy chủ trả không phải JSON
	}
	if (!res.ok || !json?.ok) {
		throw new Error(`Lưu tệp thất bại (${res.status}): ${json?.error ?? 'không rõ'}`);
	}
	return { path: json.path, bytes: json.bytes, name: json.name, uploadMs: round(performance.now() - started, 1) };
}

// Đọc các hộp (box) cấp cao nhất của tệp MP4 để biết moov nằm trước hay sau mdat.
export function mp4TopLevelBoxes(buffer, limit = 64) {
	const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
	const boxes = [];
	let offset = 0;
	while (offset + 8 <= view.byteLength && boxes.length < limit) {
		let size = view.getUint32(offset);
		const type = String.fromCharCode(
			view.getUint8(offset + 4),
			view.getUint8(offset + 5),
			view.getUint8(offset + 6),
			view.getUint8(offset + 7),
		);
		if (size === 1) {
			if (offset + 16 > view.byteLength) break;
			size = Number(view.getBigUint64(offset + 8));
		} else if (size === 0) {
			size = view.byteLength - offset;
		}
		if (size < 8 || !/^[\x20-\x7e]{4}$/.test(type)) break;
		boxes.push({ type, offset, size });
		offset += size;
	}
	return boxes;
}

export function describeMp4(buffer) {
	try {
		const boxes = mp4TopLevelBoxes(buffer);
		const order = boxes.map((b) => b.type);
		const moov = order.indexOf('moov');
		const mdat = order.indexOf('mdat');
		return {
			boxOrder: order.slice(0, 12).join(' ') + (order.length > 12 ? ` … (${order.length} hộp)` : ''),
			moovBeforeMdat: moov >= 0 && mdat >= 0 ? moov < mdat : null,
			fragmented: order.includes('moof'),
		};
	} catch (err) {
		return { boxOrder: null, moovBeforeMdat: null, fragmented: null, error: errText(err) };
	}
}
