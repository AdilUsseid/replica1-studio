import type { ApiErrorBody, Channel, ChannelInput, Idea, IdeaStatus, Scene, ScriptContent, ScriptState, Source } from "@replica/shared";

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

export interface GeneratorInfo { id: string; label: string; aiGenerated: boolean; ok: boolean; reason?: string }
export interface VersionDetail { version: number; origin: string; note: string; createdAt: string; content: ScriptContent }

export const api = {
  ideas: (channelId: string) => req<Idea[]>("GET", `/api/ideas?channelId=${encodeURIComponent(channelId)}`),
  idea: (id: string) => req<Idea>("GET", `/api/ideas/${id}`),
  createIdea: (i: { channelId: string; title: string; description: string }) => req<Idea>("POST", "/api/ideas", i),
  updateIdea: (id: string, p: { title?: string; description?: string; status?: IdeaStatus }) => req<Idea>("PATCH", `/api/ideas/${id}`, p),
  moveIdea: (id: string, direction: "up" | "down") => req<Idea>("POST", `/api/ideas/${id}/move`, { direction }),
  archiveIdea: (id: string) => req<Idea>("POST", `/api/ideas/${id}/archive`),
  sources: (ideaId: string) => req<Source[]>("GET", `/api/ideas/${ideaId}/sources`),
  addSource: (ideaId: string, s: { title: string; url: string; note: string; quote: string; accessedAt: string }) =>
    req<Source>("POST", `/api/ideas/${ideaId}/sources`, s),
  removeSource: (id: string) => req<null>("DELETE", `/api/sources/${id}`),
  script: (ideaId: string) => req<ScriptState>("GET", `/api/ideas/${ideaId}/script`),
  scriptVersion: (ideaId: string, v: number) => req<VersionDetail>("GET", `/api/ideas/${ideaId}/script/versions/${v}`),
  saveScript: (ideaId: string, scenes: Scene[], note = "") => req<ScriptState>("PUT", `/api/ideas/${ideaId}/script`, { scenes, note }),
  approveScript: (ideaId: string, v: number) => req<ScriptState>("POST", `/api/ideas/${ideaId}/script/versions/${v}/approve`),
  generators: () => req<GeneratorInfo[]>("GET", "/api/generators"),
  generate: (ideaId: string, adapter: string) => req<Job>("POST", `/api/ideas/${ideaId}/script/generate`, { adapter }),
  job: (id: string) => req<Job>("GET", `/api/jobs/${id}`),
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
