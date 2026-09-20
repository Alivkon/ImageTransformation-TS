import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { MEDIA_URL_SECRET } from "../config.js";

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const DEFAULT_TTL_SECONDS = 15 * 60;
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function signature(filename: string, expires: number): string {
  return crypto
    .createHmac("sha256", MEDIA_URL_SECRET)
    .update(`${filename}:${expires}`)
    .digest("hex");
}

export function createSignedMediaPath(
  fileReference: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string | null {
  const filename = path.basename(fileReference);
  const extension = path.extname(filename).toLowerCase();
  if (!filename || !MIME_TYPES[extension]) return null;

  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signature(filename, expires);
  return `/media/${encodeURIComponent(filename)}?expires=${expires}&sig=${sig}`;
}

function isValidSignature(filename: string, expires: number, received: string): boolean {
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  if (expires > Math.floor(Date.now() / 1000) + 60 * 60) return false;

  const expected = signature(filename, expires);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function registerMediaRoute(fastify: FastifyInstance): void {
  fastify.get<{
    Params: { filename: string };
    Querystring: { expires?: string; sig?: string };
  }>("/media/:filename", async (req, reply) => {
    const filename = req.params.filename;
    const extension = path.extname(filename).toLowerCase();
    const expires = Number(req.query.expires ?? "");
    const receivedSignature = req.query.sig ?? "";

    if (
      path.basename(filename) !== filename ||
      !MIME_TYPES[extension] ||
      !isValidSignature(filename, expires, receivedSignature)
    ) {
      return reply.code(403).type("text/plain").send("Forbidden");
    }

    const filePath = path.join(UPLOADS_DIR, filename);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return reply.code(404).type("text/plain").send("Not Found");
    }
    if (!stat.isFile()) return reply.code(404).type("text/plain").send("Not Found");

    req.log.info({ filename, ip: req.ip }, "signed media file viewed");
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .type(MIME_TYPES[extension]!)
      .send(fs.createReadStream(filePath));
  });
}
