import { UPLOAD_SIZE_HEADERS } from "@jam/shared";
import type { getStorage } from "firebase-admin/storage";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

/** Audio files in the private samples bucket. Clients only ever see signed URLs. */
export interface SampleBlobs {
  /** A signed PUT URL. The client must send the same Content-Type and UPLOAD_SIZE_HEADERS. */
  uploadUrl(path: string, contentType: string): Promise<string>;
  /** A signed GET URL, valid for one hour. */
  readUrl(path: string): Promise<string>;
  /** Size in bytes, or null when the object does not exist. */
  size(path: string): Promise<number | null>;
  /** Removes the object. A missing object is not an error. */
  remove(path: string): Promise<void>;
}

const UPLOAD_TTL_MS = 15 * 60_000;
const READ_TTL_MS = 60 * 60_000;

/** Signs with the runtime service account (IAM signBlob), so it needs Token Creator on itself. */
export class GcsBlobs implements SampleBlobs {
  constructor(private readonly bucket: Pick<Bucket, "file">) {}

  async uploadUrl(path: string, contentType: string) {
    const [url] = await this.bucket.file(path).getSignedUrl({
      version: "v4",
      action: "write",
      contentType,
      extensionHeaders: UPLOAD_SIZE_HEADERS,
      expires: Date.now() + UPLOAD_TTL_MS,
    });
    return url;
  }

  async readUrl(path: string) {
    const [url] = await this.bucket
      .file(path)
      .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + READ_TTL_MS });
    return url;
  }

  async size(path: string) {
    const file = this.bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [meta] = await file.getMetadata();
    return Number(meta.size ?? 0);
  }

  async remove(path: string) {
    await this.bucket.file(path).delete({ ignoreNotFound: true });
  }
}

/** In-memory blobs for tests: put() stands in for the client's signed PUT. */
export class MemoryBlobs implements SampleBlobs {
  readonly objects = new Map<string, number>();

  put(path: string, bytes: number) {
    this.objects.set(path, bytes);
  }

  async uploadUrl(path: string, contentType: string) {
    return `https://storage.test/${path}?put&type=${encodeURIComponent(contentType)}`;
  }

  async readUrl(path: string) {
    return `https://storage.test/${path}?get`;
  }

  async size(path: string) {
    return this.objects.get(path) ?? null;
  }

  async remove(path: string) {
    this.objects.delete(path);
  }
}
