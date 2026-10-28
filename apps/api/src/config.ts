import { fromRoot, resolveStorageDir } from "@replica/core";

export interface Config {
  port: number;
  host: string;
  storageDir: string;
  webDist: string;
}

export function loadConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    // Só escuta em localhost por omissão: a app é local e não tem autenticação.
    host: env.REPLICA_HOST ?? "127.0.0.1",
    storageDir: resolveStorageDir(env),
    webDist: fromRoot(env.REPLICA_WEB_DIST ?? "apps/web/dist"),
  };
}
