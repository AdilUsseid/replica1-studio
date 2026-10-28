import { checkFfmpeg, type Job, type JobRepo } from "@replica/core";

export interface HandlerContext {
  jobs: JobRepo;
  job: Job;
}
export type Handler = (ctx: HandlerContext) => Promise<unknown>;

/** Registo de handlers por tipo de job. Cada fase acrescenta os seus. */
export const handlers: Record<string, Handler> = {
  "system.ffmpeg-check": async ({ jobs, job }) => {
    jobs.setProgress(job.id, 0.2);
    const status = await checkFfmpeg();
    if (!status.available) throw new Error(status.error);
    return status;
  },
};
