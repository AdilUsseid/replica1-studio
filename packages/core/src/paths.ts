import path from "node:path";
import { AppError } from "./errors.ts";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Junta segmentos a uma raiz e garante que o resultado não sai dela (path traversal). */
export function safeJoin(root: string, ...segments: string[]): string {
  const absRoot = path.resolve(root);
  for (const s of segments) {
    if (!SAFE_SEGMENT.test(s) || s.includes("..")) {
      throw new AppError(400, "invalid_path", "Segmento de caminho inválido");
    }
  }
  const full = path.resolve(absRoot, ...segments);
  if (full !== absRoot && !full.startsWith(absRoot + path.sep)) {
    throw new AppError(400, "invalid_path", "Caminho fora do diretório permitido");
  }
  return full;
}

/** Diretório de artefactos de um canal: <storage>/channels/<channelId>. */
export const channelDir = (storageDir: string, channelId: string) =>
  safeJoin(storageDir, "channels", channelId);
