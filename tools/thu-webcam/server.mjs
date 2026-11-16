// Máy chủ tĩnh cho trang thử webcam. Node 24, không phụ thuộc gì.
// Chạy: node server.mjs --port 4321 --out "D:\HubsellVideo\thu-webcam"
// Chỉ nghe trên 127.0.0.1. Không phải mã sản phẩm.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_SAVE_BYTES = 600 * 1024 * 1024;
const HOST = '127.0.0.1';

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.wasm': 'application/wasm',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.md': 'text/markdown; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
};

function parseArgs(argv) {
	const args = { port: 4321, out: path.join(ROOT, 'out') };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--port') args.port = Number(argv[++i]);
		else if (a.startsWith('--port=')) args.port = Number(a.slice(7));
		else if (a === '--out') args.out = path.resolve(argv[++i] ?? '');
		else if (a.startsWith('--out=')) args.out = path.resolve(a.slice(6));
	}
	if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
		throw new Error('Tham số --port không hợp lệ');
	}
	return args;
}

const { port: PORT, out: OUT_DIR } = parseArgs(process.argv.slice(2));

function sendJson(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(text),
		'Cache-Control': 'no-store',
	});
	res.end(text);
}

function sendText(res, status, text) {
	res.writeHead(status, {
		'Content-Type': 'text/plain; charset=utf-8',
		'Content-Length': Buffer.byteLength(text),
		'Cache-Control': 'no-store',
	});
	res.end(text);
}

// Chỉ giữ [A-Za-z0-9._-]; ký tự khác đổi thành "_". Trả null nếu không còn gì dùng được.
function sanitiseName(raw) {
	let name = String(raw ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
	name = name.replace(/^\.+/, '').slice(0, 180);
	if (!name || /^[._-]*$/.test(name)) return null;
	if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(name)) name = '_' + name;
	return name;
}

// Chống trang web khác gọi vào (DNS rebinding / CSRF): Host phải là máy này,
// và nếu có Origin thì Origin phải trùng.
function isLocalRequest(req) {
	const allowed = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
	if (!allowed.has(String(req.headers.host ?? '').toLowerCase())) return false;
	const origin = req.headers.origin;
	if (origin) {
		try {
			if (!allowed.has(new URL(origin).host.toLowerCase())) return false;
		} catch {
			return false;
		}
	}
	return true;
}

// Phục vụ một tệp, có hỗ trợ Range để tua video.
async function serveFile(req, res, filePath) {
	let stat;
	try {
		stat = await fsp.stat(filePath);
	} catch {
		return sendText(res, 404, 'Không tìm thấy');
	}
	if (!stat.isFile()) return sendText(res, 404, 'Không tìm thấy'); // không liệt kê thư mục

	const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
	const headers = {
		'Content-Type': type,
		'Cache-Control': 'no-store',
		'Accept-Ranges': 'bytes',
		'X-Content-Type-Options': 'nosniff',
	};

	let start = 0;
	let end = stat.size - 1;
	let status = 200;
	const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
	if (range && stat.size > 0 && (range[1] !== '' || range[2] !== '')) {
		if (range[1] === '') {
			start = Math.max(0, stat.size - Number(range[2]));
		} else {
			start = Number(range[1]);
			if (range[2] !== '') end = Math.min(end, Number(range[2]));
		}
		if (start > end || start >= stat.size) {
			res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
			return res.end();
		}
		status = 206;
		headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
	}
	headers['Content-Length'] = stat.size === 0 ? 0 : end - start + 1;
	res.writeHead(status, headers);
	if (req.method === 'HEAD' || stat.size === 0) return res.end();
	try {
		await pipeline(fs.createReadStream(filePath, { start, end }), res);
	} catch {
		res.destroy();
	}
}

// Đổi đường dẫn URL thành đường dẫn tệp nằm TRONG thư mục gốc; ra ngoài thì trả null.
function resolveInside(baseDir, urlPath) {
	let decoded;
	try {
		decoded = decodeURIComponent(urlPath);
	} catch {
		return null;
	}
	if (decoded.includes('\0') || decoded.includes('\\')) return null;
	const target = path.resolve(baseDir, '.' + path.posix.normalize('/' + decoded));
	if (target !== baseDir && !target.startsWith(baseDir + path.sep)) return null;
	return target;
}

async function handleSave(req, res, url) {
	const name = sanitiseName(url.searchParams.get('name'));
	if (!name) return sendJson(res, 400, { ok: false, error: 'Thiếu tên tệp hoặc tên không hợp lệ' });

	const declared = Number(req.headers['content-length']);
	if (Number.isFinite(declared) && declared > MAX_SAVE_BYTES) {
		req.resume();
		return sendJson(res, 413, { ok: false, error: 'Tệp vượt 600 MB' });
	}

	await fsp.mkdir(OUT_DIR, { recursive: true });
	const finalPath = path.join(OUT_DIR, name);
	const partPath = finalPath + '.part';
	const file = fs.createWriteStream(partPath);
	let bytes = 0;
	let tooBig = false;

	try {
		await pipeline(
			req,
			async function* (source) {
				for await (const chunk of source) {
					bytes += chunk.length;
					if (bytes > MAX_SAVE_BYTES) {
						tooBig = true;
						throw new Error('Tệp vượt 600 MB');
					}
					yield chunk;
				}
			},
			file,
		);
		await fsp.rename(partPath, finalPath);
	} catch (err) {
		await fsp.rm(partPath, { force: true }).catch(() => {});
		if (tooBig) return sendJson(res, 413, { ok: false, error: 'Tệp vượt 600 MB' });
		return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
	}
	console.log(`[save] ${finalPath} (${bytes} byte)`);
	sendJson(res, 200, { ok: true, path: finalPath, bytes, name });
}

async function handleList(res) {
	let names = [];
	try {
		names = await fsp.readdir(OUT_DIR);
	} catch {
		// chưa có thư mục = chưa lưu gì
	}
	const files = [];
	for (const name of names) {
		try {
			const stat = await fsp.stat(path.join(OUT_DIR, name));
			if (stat.isFile()) files.push({ name, bytes: stat.size, modified: stat.mtime.toISOString() });
		} catch {
			// tệp vừa bị xóa
		}
	}
	files.sort((a, b) => a.modified.localeCompare(b.modified));
	sendJson(res, 200, { ok: true, dir: OUT_DIR, files });
}

const server = http.createServer(async (req, res) => {
	try {
		if (!isLocalRequest(req)) return sendText(res, 403, 'Chỉ nhận yêu cầu từ máy này');
		const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

		if (url.pathname === '/save') {
			if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Chỉ nhận POST' });
			return await handleSave(req, res, url);
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Không hỗ trợ');
		if (url.pathname === '/list') return await handleList(res);

		// Xem lại tệp đã lưu: /out/<tên>
		if (url.pathname.startsWith('/out/')) {
			const name = sanitiseName(decodeURIComponent(url.pathname.slice(5)));
			if (!name) return sendText(res, 404, 'Không tìm thấy');
			return await serveFile(req, res, path.join(OUT_DIR, name));
		}

		const target = resolveInside(ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
		if (!target) return sendText(res, 403, 'Không được phép');
		return await serveFile(req, res, target);
	} catch (err) {
		console.error('[lỗi]', err);
		if (!res.headersSent) sendText(res, 500, 'Lỗi máy chủ');
		else res.destroy();
	}
});

server.listen(PORT, HOST, () => {
	console.log(`Trang thử webcam: http://${HOST}:${PORT}/`);
	console.log(`Thư mục lưu tệp: ${OUT_DIR}`);
});
