import { logEvent, type Db, JobRepo } from "@replica/core";
import { handlers as defaultHandlers, type Handler } from "./handlers.ts";

/** Processa no máximo um job. Devolve true se havia trabalho. */
export async function runOnce(db: Db, handlers: Record<string, Handler> = defaultHandlers): Promise<boolean> {
  const jobs = new JobRepo(db);
  const job = jobs.claimNext(Object.keys(handlers));
  if (!job) return false;
  try {
    const result = await handlers[job.type]!({ jobs, job });
    if (jobs.isCancelRequested(job.id)) jobs.cancelRunning(job.id);
    else jobs.succeed(job.id, result);
  } catch (e) {
    jobs.fail(job.id, e instanceof Error ? e.message : String(e));
  }
  return true;
}

export async function runLoop(db: Db, opts: { pollMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const poll = opts.pollMs ?? 1000;
  const recovered = new JobRepo(db).recoverInterrupted();
  if (recovered) logEvent(db, { level: "warn", source: "worker", message: `${recovered} job(s) recuperado(s) no arranque` });
  while (!opts.signal?.aborted) {
    const worked = await runOnce(db);
    if (!worked) await new Promise((r) => setTimeout(r, poll));
  }
}
