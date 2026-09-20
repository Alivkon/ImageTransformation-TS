import type { FastifyInstance } from "fastify";
import { getReviewGenerations } from "../database.js";
import { requireMediaReviewer } from "./auth.js";
import { createSignedMediaPath } from "./mediaRoute.js";

const PAGE_SIZE = 30;

export function registerReviewRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: { page?: string } }>(
    "/api/internal/generations",
    async (req, reply) => {
      const reviewer = await requireMediaReviewer(req, reply);
      if (!reviewer) return;

      const page = Math.max(0, parseInt(req.query.page ?? "0", 10) || 0);
      const rows = await getReviewGenerations(PAGE_SIZE + 1, page * PAGE_SIZE);
      const hasMore = rows.length > PAGE_SIZE;
      const items = rows.slice(0, PAGE_SIZE).flatMap((row) => {
        const sourceUrl = createSignedMediaPath(row.source_file_id);
        const resultUrl = createSignedMediaPath(row.result_file_id);
        if (!sourceUrl || !resultUrl) return [];
        return [{
          id: row.id,
          user: {
            email: row.email,
            telegram_username: row.username,
            telegram_id: row.email ? null : row.user_id,
          },
          prompt: row.prompt ?? "",
          source_url: sourceUrl,
          result_url: resultUrl,
          created_at: row.created_at.toISOString(),
          completed_at: row.completed_at?.toISOString() ?? null,
        }];
      });

      req.log.info(
        { reviewerUserId: reviewer.user_id, page, ip: req.ip },
        "media review gallery viewed",
      );

      return reply
        .header("Cache-Control", "private, no-store")
        .send({
          items,
          has_more: hasMore,
          next_page: hasMore ? page + 1 : null,
        });
    },
  );
}
