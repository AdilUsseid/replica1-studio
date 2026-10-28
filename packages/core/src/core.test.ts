import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { openDb, migrate, ChannelRepo, JobRepo, AppError, safeJoin, canTransition, listEvents, type Db } from "./index.ts";

const valid = { name: "Canal Teste", niche: "Tech", audience: "Estudantes", language: "pt-MZ" };
let db: Db, dir: string, channels: ChannelRepo, jobs: JobRepo;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "replica-"));
  db = openDb(dir, ":memory:");
  channels = new ChannelRepo(db, dir);
  jobs = new JobRepo(db);
});

describe("migrações", () => {
  it("são idempotentes", () => {
    expect(migrate(db)).toEqual([]);
  });
});

describe("canais", () => {
  it("cria com defaults, cria diretório próprio e regista evento", () => {
    const c = channels.create(valid);
    expect(c.targetDurationSeconds).toBe(600);
    expect(existsSync(path.join(dir, "channels", c.id))).toBe(true);
    expect(listEvents(db).some((e) => e.channelId === c.id)).toBe(true);
  });

  it("rejeita dados inválidos com erros por campo", () => {
    try {
      channels.create({ ...valid, name: "", primaryColor: "azul" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(400);
      expect(Object.keys((e as AppError).fields!)).toEqual(expect.arrayContaining(["name", "primaryColor"]));
    }
  });

  it("PATCH não repõe campos não enviados nos valores por omissão", () => {
    const c = channels.create({ ...valid, targetDurationSeconds: 120, primaryColor: "#112233", formats: ["short"] });
    const u = channels.update(c.id, { tone: "Sério" });
    expect(u.tone).toBe("Sério");
    expect(u.targetDurationSeconds).toBe(120);
    expect(u.primaryColor).toBe("#112233");
    expect(u.formats).toEqual(["short"]);
  });

  it("nome duplicado (sem distinguir maiúsculas) dá conflito; arquivado liberta o nome", () => {
    const c = channels.create(valid);
    expect(() => channels.create({ ...valid, name: "canal teste" })).toThrow(/Já existe/);
    channels.archive(c.id);
    expect(() => channels.create({ ...valid, name: "canal teste" })).not.toThrow();
    expect(() => channels.restore(c.id)).toThrow(/Já existe/);
  });

  it("arquivar não apaga e esconde da lista por omissão", () => {
    const c = channels.create(valid);
    channels.archive(c.id);
    expect(channels.list()).toHaveLength(0);
    expect(channels.list(true)).toHaveLength(1);
    expect(() => channels.update(c.id, { tone: "x" })).toThrow(/arquivado/);
  });

  it("canal inexistente dá 404", () => {
    expect(() => channels.get("nope")).toThrow(AppError);
  });
});

describe("máquina de estados dos jobs", () => {
  it("só permite transições válidas", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("succeeded", "running")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(canTransition("queued", "succeeded")).toBe(false);
  });

  it("ciclo normal: fila → execução → concluído", () => {
    const j = jobs.enqueue("x");
    const c = jobs.claimNext()!;
    expect(c.id).toBe(j.id);
    expect(c.status).toBe("running");
    expect(c.attempts).toBe(1);
    jobs.setProgress(j.id, 0.5);
    expect(jobs.get(j.id).progress).toBe(0.5);
    const done = jobs.succeed(j.id, { ok: true });
    expect(done.status).toBe("succeeded");
    expect(done.progress).toBe(1);
    expect(done.result).toEqual({ ok: true });
    expect(() => jobs.succeed(j.id)).toThrow(/Transição inválida/);
  });

  it("claimNext respeita ordem e não entrega o mesmo job duas vezes", () => {
    const a = jobs.enqueue("x");
    const b = jobs.enqueue("x");
    expect(jobs.claimNext()!.id).toBe(a.id);
    expect(jobs.claimNext()!.id).toBe(b.id);
    expect(jobs.claimNext()).toBeNull();
  });

  it("falha volta à fila até esgotar tentativas, depois fica falhado e pode ser repetido", () => {
    const j = jobs.enqueue("x", {}, { maxAttempts: 2 });
    jobs.claimNext();
    expect(jobs.fail(j.id, "boom").status).toBe("queued");
    jobs.claimNext();
    const f = jobs.fail(j.id, "boom2");
    expect(f.status).toBe("failed");
    expect(f.error).toBe("boom2");
    expect(jobs.retry(j.id).status).toBe("queued");
    expect(jobs.get(j.id).attempts).toBe(0);
  });

  it("cancelar em fila é imediato; em execução é cooperativo", () => {
    const a = jobs.enqueue("x");
    expect(jobs.cancel(a.id).status).toBe("cancelled");
    const b = jobs.enqueue("x");
    jobs.claimNext();
    expect(jobs.cancel(b.id).status).toBe("running");
    expect(jobs.isCancelRequested(b.id)).toBe(true);
    expect(jobs.fail(b.id, "parado").status).toBe("cancelled");
    expect(() => jobs.cancel(b.id)).toThrow(/Não é possível/);
  });

  it("recupera jobs interrompidos no arranque", () => {
    const j = jobs.enqueue("x", {}, { maxAttempts: 3 });
    jobs.claimNext();
    expect(jobs.recoverInterrupted()).toBe(1);
    const r = jobs.get(j.id);
    expect(r.status).toBe("queued");
    expect(r.error).toMatch(/Interrompido/);
  });
});

describe("caminhos seguros", () => {
  it("bloqueia path traversal", () => {
    expect(() => safeJoin(dir, "..", "etc")).toThrow(AppError);
    expect(() => safeJoin(dir, "a/../../b")).toThrow(AppError);
    expect(() => safeJoin(dir, "/etc/passwd")).toThrow(AppError);
    expect(safeJoin(dir, "channels", "abc-123")).toBe(path.join(dir, "channels", "abc-123"));
  });
});

describe("persistência em disco", () => {
  it("os dados sobrevivem a fechar e reabrir a base", () => {
    const d = mkdtempSync(path.join(tmpdir(), "replica-persist-"));
    const db1 = openDb(d);
    const c = new ChannelRepo(db1, d).create(valid);
    db1.close();
    const db2 = openDb(d);
    expect(new ChannelRepo(db2, d).get(c.id).name).toBe("Canal Teste");
    db2.close();
  });
});

describe("configuração", () => {
  it("o diretório de dados não depende do diretório atual do processo", async () => {
    const { resolveStorageDir, REPO_ROOT } = await import("./index.ts");
    const cwd = process.cwd();
    process.chdir("/tmp");
    try {
      expect(resolveStorageDir({})).toBe(path.join(REPO_ROOT, "storage"));
    } finally {
      process.chdir(cwd);
    }
    expect(resolveStorageDir({ REPLICA_STORAGE_DIR: "dados" })).toBe(path.join(REPO_ROOT, "dados"));
  });
});
