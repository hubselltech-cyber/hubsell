// Kho R2 GIẢ cho test — giữ tệp và lượt tải theo mảnh trong bộ nhớ, không gọi mạng.
// Test đóng vai "app": gọi put() / putPart() thay cho việc tải lên đường dẫn ký sẵn.
import { R2Error, type R2Part, type R2Storage } from "../../../integrations/r2/client";

export interface FakeStorage extends R2Storage {
  /** App tải một lần. */
  put(key: string, size: number): void;
  /** App tải một mảnh. */
  putPart(key: string, uploadId: string, partNumber: number, size: number): void;
  objects: Map<string, number>;
  uploads: Map<string, { key: string; parts: Map<number, number> }>;
  calls: string[];
}

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, number>();
  const uploads = new Map<string, { key: string; parts: Map<number, number> }>();
  const calls: string[] = [];
  let seq = 0;

  return {
    objects,
    uploads,
    calls,
    put: (key, size) => void objects.set(key, size),
    putPart(key, uploadId, partNumber, size) {
      const u = uploads.get(uploadId);
      if (!u || u.key !== key) throw new Error("lượt tải giả không tồn tại");
      u.parts.set(partNumber, size);
    },

    async presignPut(key, contentLength) {
      calls.push("presignPut");
      return `https://fake.r2/${key}?len=${contentLength}`;
    },
    async presignPart(key, uploadId, partNumber, contentLength) {
      calls.push("presignPart");
      return `https://fake.r2/${key}?uploadId=${uploadId}&partNumber=${partNumber}&len=${contentLength}`;
    },
    async presignGet(key, downloadName) {
      calls.push("presignGet");
      return `https://fake.r2/${key}${downloadName ? `?download=${downloadName}` : ""}`;
    },
    async head(key) {
      calls.push("head");
      const size = objects.get(key);
      return size === undefined ? null : { size };
    },
    async remove(key) {
      calls.push("remove");
      objects.delete(key);
    },
    async createMultipart(key) {
      calls.push("createMultipart");
      const id = `up-${++seq}`;
      uploads.set(id, { key, parts: new Map() });
      return id;
    },
    async completeMultipart(key, uploadId, parts) {
      calls.push("completeMultipart");
      const u = uploads.get(uploadId);
      if (!u || u.key !== key) throw new R2Error("NoSuchUpload", 404, "NoSuchUpload");
      let total = 0;
      for (const p of parts) {
        const size = u.parts.get(p.partNumber);
        if (size === undefined) throw new R2Error("InvalidPart", 400, "InvalidPart");
        total += size;
      }
      objects.set(key, total);
      uploads.delete(uploadId);
    },
    async abortMultipart(_key, uploadId) {
      calls.push("abortMultipart");
      uploads.delete(uploadId);
    },
    async listParts(key, uploadId): Promise<R2Part[]> {
      calls.push("listParts");
      const u = uploads.get(uploadId);
      if (!u || u.key !== key) throw new R2Error("NoSuchUpload", 404, "NoSuchUpload");
      return [...u.parts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([partNumber, size]) => ({ partNumber, size, etag: `"etag-${partNumber}"` }));
    },
  };
}
