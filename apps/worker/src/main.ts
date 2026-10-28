import { openDb, resolveStorageDir } from "@replica/core";
import { runLoop } from "./runner.ts";

const storageDir = resolveStorageDir();
const db = openDb(storageDir);
const ac = new AbortController();
const stop = () => ac.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log(`[worker] a processar jobs (dados: ${storageDir})`);
await runLoop(db, { signal: ac.signal });
db.close();
