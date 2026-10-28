import type { ApiErrorBody, Channel, ChannelInput } from "@replica/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Não foi possível contactar o servidor. Confirme que a API está a correr.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    throw new ApiError(e?.message ?? `Erro ${res.status}`, res.status, e?.fields);
  }
  return data as T;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface Job {
  id: string; type: string; status: JobStatus; progress: number; result: unknown; error: string | null;
  attempts: number; maxAttempts: number; cancelRequested: boolean; createdAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface AppEvent { id: number; at: string; level: "info" | "warn" | "error"; source: string; message: string }
export interface FfmpegStatus { available: boolean; version?: string; encoders: Record<string, boolean>; error?: string }

export const api = {
  channels: (archived = false) => req<Channel[]>("GET", `/api/channels${archived ? "?archived=1" : ""}`),
  createChannel: (c: ChannelInput) => req<Channel>("POST", "/api/channels", c),
  updateChannel: (id: string, c: Partial<ChannelInput>) => req<Channel>("PATCH", `/api/channels/${id}`, c),
  archiveChannel: (id: string) => req<Channel>("POST", `/api/channels/${id}/archive`),
  restoreChannel: (id: string) => req<Channel>("POST", `/api/channels/${id}/restore`),
  jobs: () => req<Job[]>("GET", "/api/jobs"),
  createJob: (type: string) => req<Job>("POST", "/api/jobs", { type }),
  cancelJob: (id: string) => req<Job>("POST", `/api/jobs/${id}/cancel`),
  retryJob: (id: string) => req<Job>("POST", `/api/jobs/${id}/retry`),
  events: () => req<AppEvent[]>("GET", "/api/events"),
  ffmpeg: () => req<FfmpegStatus>("GET", "/api/system/ffmpeg"),
};
