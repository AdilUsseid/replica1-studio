import path from "node:path";

/** Raiz do repositório, independente do diretório de onde o processo é lançado. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Caminhos relativos (também os vindos do ambiente) resolvem-se a partir da raiz do repositório. */
export const fromRoot = (p: string) => path.resolve(REPO_ROOT, p);

/** API e worker têm de usar exatamente o mesmo diretório de dados. */
export const resolveStorageDir = (env: NodeJS.ProcessEnv = process.env) =>
  fromRoot(env.REPLICA_STORAGE_DIR ?? "storage");
