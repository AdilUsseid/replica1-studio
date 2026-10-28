import express, { type ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  AppError, ChannelRepo, JobRepo, checkFfmpeg, listEvents, conflict, type Db, type JobStatus,
} from "@replica/core";
import type { ApiErrorBody } from "@replica/shared";

/** Tipos de job que a API aceita criar. O worker tem de ter um handler para cada um. */
export const USER_JOB_TYPES = ["system.ffmpeg-check"] as const;

const STATUSES: JobStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

export interface AppDeps {
  db: Db;
  storageDir: string;
  webDist?: string;
}

export function createApp({ db, storageDir, webDist }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  const channels = new ChannelRepo(db, storageDir);
  const jobs = new JobRepo(db);
  const api = express.Router();

  api.get("/health", (_req, res) => {
    const v = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    res.json({ ok: true, schemaVersion: v.v });
  });

  api.get("/system/ffmpeg", async (_req, res) => res.json(await checkFfmpeg()));

  // Canais
  api.get("/channels", (req, res) => res.json(channels.list(req.query.archived === "1")));
  api.post("/channels", (req, res) => res.status(201).json(channels.create(req.body)));
  api.get("/channels/:id", (req, res) => res.json(channels.get(req.params.id)));
  api.patch("/channels/:id", (req, res) => res.json(channels.update(req.params.id, req.body)));
  api.post("/channels/:id/archive", (req, res) => res.json(channels.archive(req.params.id)));
  api.post("/channels/:id/restore", (req, res) => res.json(channels.restore(req.params.id)));

  // Jobs
  api.get("/jobs", (req, res) => {
    const s = req.query.status as JobStatus | undefined;
    if (s && !STATUSES.includes(s)) throw new AppError(400, "validation_error", "Estado inválido");
    res.json(jobs.list({ status: s }));
  });
  api.post("/jobs", (req, res) => {
    const type = req.body?.type;
    if (!USER_JOB_TYPES.includes(type)) {
      throw new AppError(400, "validation_error", "Tipo de job desconhecido", { type: `Use um de: ${USER_JOB_TYPES.join(", ")}` });
    }
    res.status(201).json(jobs.enqueue(type, {}));
  });
  api.get("/jobs/:id", (req, res) => res.json({ ...jobs.get(req.params.id), events: listEvents(db, { jobId: req.params.id }) }));
  api.post("/jobs/:id/cancel", (req, res) => res.json(jobs.cancel(req.params.id)));
  api.post("/jobs/:id/retry", (req, res) => res.json(jobs.retry(req.params.id)));

  api.get("/events", (_req, res) => res.json(listEvents(db, { limit: 100 })));

  api.use((_req, _res, next) => next(new AppError(404, "not_found", "Rota não encontrada")));
  app.use("/api", api);

  if (webDist && existsSync(path.join(webDist, "index.html"))) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
      const body: ApiErrorBody = { error: { code: err.code, message: err.message, fields: err.fields } };
      res.status(err.status).json(body);
      return;
    }
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      const body: ApiErrorBody = { error: { code: "bad_request", message: err.type === "entity.too.large" ? "Pedido demasiado grande" : "JSON inválido" } };
      res.status(err.status ?? 400).json(body);
      return;
    }
    console.error("[api] erro inesperado:", err);
    const body: ApiErrorBody = { error: { code: "internal_error", message: "Erro interno" } };
    res.status(500).json(body);
  };
  app.use(onError);
  return app;
}
export { conflict };
