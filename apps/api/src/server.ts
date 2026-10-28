import { openDb, JobRepo } from "@replica/core";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const cfg = loadConfig();
const db = openDb(cfg.storageDir);
// Recupera jobs que ficaram 'running' se o processo anterior terminou a meio.
const recovered = new JobRepo(db).recoverInterrupted();
if (recovered) console.log(`[api] ${recovered} job(s) interrompido(s) recuperado(s)`);

const app = createApp({ db, storageDir: cfg.storageDir, webDist: cfg.webDist });
const server = app.listen(cfg.port, cfg.host, () => {
  console.log(`[api] Replica Studio em http://${cfg.host}:${cfg.port}  (dados: ${cfg.storageDir})`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
