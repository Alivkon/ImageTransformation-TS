import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  findUserByEmail,
  createWebUser,
  createWebSession,
  validateWebSession,
  deleteWebSession,
  type DbUser,
} from "../database.js";

const BCRYPT_ROUNDS = 10;

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<DbUser | null> {
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  const token = auth.slice(7);
  const user = await validateWebSession(token);
  if (!user) {
    await reply.code(401).send({ error: "Session expired" });
    return null;
  }
  return user;
}

export function registerAuthRoutes(fastify: FastifyInstance): void {
  fastify.post("/api/auth/register", async (req, reply) => {
    const body = req.body as { email?: unknown; password?: unknown };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email.includes("@") || password.length < 6) {
      return reply.code(400).send({ error: "Invalid email or password too short" });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await createWebUser(email, passwordHash);
    const session = await createWebSession(user.user_id);

    return reply.code(201).send({
      token: session.token,
      expires_at: session.expiresAt.toISOString(),
      user: {
        user_id: user.user_id,
        email,
        balance: user.balance,
        free_generations: user.free_generations,
        total_generations: user.total_generations,
      },
    });
  });

  fastify.post("/api/auth/login", async (req, reply) => {
    const body = req.body as { email?: unknown; password?: unknown };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    const user = await findUserByEmail(email);
    if (!user || !user.password_hash) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const session = await createWebSession(user.user_id);

    return reply.send({
      token: session.token,
      expires_at: session.expiresAt.toISOString(),
      user: {
        user_id: user.user_id,
        email: user.email,
        balance: user.balance,
        free_generations: user.free_generations,
        total_generations: user.total_generations,
      },
    });
  });

  fastify.post("/api/auth/logout", async (req, reply) => {
    const auth = req.headers["authorization"] ?? "";
    if (auth.startsWith("Bearer ")) {
      await deleteWebSession(auth.slice(7));
    }
    return reply.send({ ok: true });
  });

  fastify.get("/api/auth/me", async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    return reply.send({
      user_id: user.user_id,
      email: (user as unknown as { email?: string }).email ?? null,
      balance: user.balance,
      free_generations: user.free_generations,
      total_generations: user.total_generations,
    });
  });
}

// Suppress unused import warning
void crypto;
