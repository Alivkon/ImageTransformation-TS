import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  getReviewGenerationsBySources,
  getUserReviewGenerations,
  markReviewGenerationFilesDeleted,
} from "../database.js";
import { requireAuth, requireMediaReviewer } from "./auth.js";
import { createSignedMediaPath } from "./mediaRoute.js";

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const SOURCE_PATTERN = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_([a-f0-9-]+)_src\.jpg$/i;

interface LocalPair {
  sourceFilename: string;
  resultFilename: string;
  createdAt: Date;
}

function scanLocalPairs(): LocalPair[] {
  let filenames: string[];
  try {
    filenames = fs.readdirSync(UPLOADS_DIR);
  } catch {
    return [];
  }
  const available = new Set(filenames);

  return filenames.flatMap((sourceFilename) => {
    const match = SOURCE_PATTERN.exec(sourceFilename);
    if (!match) return [];

    const resultFilename = sourceFilename.replace(/_src\.jpg$/i, "_result.jpg");
    if (!available.has(resultFilename)) return [];

    const [, year, month, day, hour, minute, second] = match;
    const createdAt = new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
    );
    if (Number.isNaN(createdAt.getTime())) return [];

    return [{ sourceFilename, resultFilename, createdAt }];
  }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function registerReviewRoutes(fastify: FastifyInstance): void {
  fastify.get(
    "/api/web/review-generations",
    async (req, reply) => {
      const user = await requireAuth(req, reply);
      if (!user) return;

      const rows = await getUserReviewGenerations(user.user_id);
      const items = rows.flatMap((row) => {
        const sourceFilename = path.basename(row.source_file_id);
        const resultFilename = path.basename(row.result_file_id);
        if (
          !SOURCE_PATTERN.test(sourceFilename) ||
          resultFilename !== sourceFilename.replace(/_src\.jpg$/i, "_result.jpg")
        ) return [];

        const sourceUrl = createSignedMediaPath(sourceFilename);
        const resultUrl = createSignedMediaPath(resultFilename);
        if (!sourceUrl || !resultUrl) return [];

        return [{
          id: row.id,
          user: { email: null, telegram_username: null, telegram_id: null },
          prompt: row.prompt ?? "",
          metadata_available: true,
          pair_key: sourceFilename,
          source_url: sourceUrl,
          result_url: resultUrl,
          created_at: row.created_at.toISOString(),
          completed_at: row.completed_at?.toISOString() ?? null,
          can_delete: false,
        }];
      });

      return reply.header("Cache-Control", "private, no-store").send({
        items,
        has_more: false,
        next_page: null,
      });
    },
  );

  fastify.get<{ Querystring: { page?: string } }>(
    "/api/internal/generations",
    async (req, reply) => {
      const reviewer = await requireMediaReviewer(req, reply);
      if (!reviewer) return;

      const allPairs = scanLocalPairs();
      const rows = await getReviewGenerationsBySources(
        allPairs.map((pair) => pair.sourceFilename),
      );
      const rowsBySource = new Map(rows.map((row) => [row.source_file_id, row]));
      const items = allPairs.flatMap((pair) => {
        const row = rowsBySource.get(pair.sourceFilename);
        const sourceUrl = createSignedMediaPath(pair.sourceFilename);
        const resultUrl = createSignedMediaPath(pair.resultFilename);
        if (!sourceUrl || !resultUrl) return [];
        return [{
          id: row?.id ?? null,
          user: {
            email: row?.email ?? null,
            telegram_username: row?.username ?? null,
            telegram_id: row && !row.email ? row.user_id : null,
          },
          prompt: row?.prompt ?? "",
          metadata_available: Boolean(row),
          pair_key: pair.sourceFilename,
          source_url: sourceUrl,
          result_url: resultUrl,
          created_at: (row?.created_at ?? pair.createdAt).toISOString(),
          completed_at: row?.completed_at?.toISOString() ?? null,
          can_delete: true,
        }];
      });

      req.log.info(
        { reviewerUserId: reviewer.user_id, itemCount: items.length, ip: req.ip },
        "media review gallery viewed",
      );

      return reply
        .header("Cache-Control", "private, no-store")
        .send({
          items,
          has_more: false,
          next_page: null,
        });
    },
  );

  fastify.delete<{ Params: { sourceFilename: string } }>(
    "/api/internal/media-pairs/:sourceFilename",
    async (req, reply) => {
      const reviewer = await requireMediaReviewer(req, reply);
      if (!reviewer) return;

      const sourceFilename = req.params.sourceFilename;
      if (!SOURCE_PATTERN.test(sourceFilename) || path.basename(sourceFilename) !== sourceFilename) {
        return reply.code(400).send({ error: "Invalid media pair" });
      }

      const resultFilename = sourceFilename.replace(/_src\.jpg$/i, "_result.jpg");
      const sourcePath = path.join(UPLOADS_DIR, sourceFilename);
      const resultPath = path.join(UPLOADS_DIR, resultFilename);

      try {
        const [sourceStat, resultStat] = await Promise.all([
          fs.promises.stat(sourcePath),
          fs.promises.stat(resultPath),
        ]);
        if (!sourceStat.isFile() || !resultStat.isFile()) {
          return reply.code(404).send({ error: "Media pair not found" });
        }
      } catch {
        return reply.code(404).send({ error: "Media pair not found" });
      }

      try {
        await Promise.all([
          fs.promises.unlink(sourcePath),
          fs.promises.unlink(resultPath),
        ]);
      } catch (error) {
        req.log.error(
          { error, sourceFilename, reviewerUserId: reviewer.user_id },
          "failed to delete media pair",
        );
        return reply.code(500).send({ error: "Failed to delete media pair" });
      }

      try {
        await markReviewGenerationFilesDeleted(sourceFilename);
      } catch (error) {
        req.log.error(
          { error, sourceFilename, reviewerUserId: reviewer.user_id },
          "media files deleted but database metadata cleanup failed",
        );
      }

      req.log.warn(
        {
          sourceFilename,
          resultFilename,
          reviewerUserId: reviewer.user_id,
          ip: req.ip,
        },
        "media pair permanently deleted",
      );
      return reply.header("Cache-Control", "private, no-store").send({ deleted: true });
    },
  );
}
