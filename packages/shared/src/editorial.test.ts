import { describe, expect, it } from "vitest";
import { checkScript, estimateSeconds, ideaInputSchema, scriptContentSchema, sourceInputSchema } from "./editorial.ts";

const scene = (o: object = {}) => ({ id: "a", kind: "development" as const, title: "", narration: "Texto da cena.", visual: "Imagem", sourceIds: ["s1"], ...o });

describe("fontes", () => {
  it("aceita só URLs http(s)", () => {
    const base = { title: "Wikipedia" };
    expect(sourceInputSchema.safeParse({ ...base, url: "https://pt.wikipedia.org/wiki/IA" }).success).toBe(true);
    expect(sourceInputSchema.safeParse({ ...base, url: "" }).success).toBe(true);
    for (const u of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "ftp://x.org", "não é url"])
      expect(sourceInputSchema.safeParse({ ...base, url: u }).success).toBe(false);
  });
  it("não inventa data de acesso", () => {
    expect(sourceInputSchema.parse({ title: "x" }).accessedAt).toBe("");
    expect(sourceInputSchema.safeParse({ title: "x", accessedAt: "ontem" }).success).toBe(false);
  });
});

describe("ideias", () => {
  it("exige canal e título", () => {
    expect(ideaInputSchema.safeParse({ channelId: "", title: "x" }).success).toBe(false);
    expect(ideaInputSchema.safeParse({ channelId: "c", title: " " }).success).toBe(false);
    expect(ideaInputSchema.parse({ channelId: "c", title: "x" }).description).toBe("");
  });
});

describe("duração estimada", () => {
  it("150 palavras/min em português, 160 em inglês", () => {
    const t = Array(150).fill("palavra").join(" ");
    expect(estimateSeconds(t, "pt-MZ")).toBe(60);
    expect(estimateSeconds(Array(160).fill("w").join(" "), "en")).toBe(60);
    expect(estimateSeconds("")).toBe(0);
  });
});

describe("verificação do roteiro", () => {
  it("rejeita roteiro sem cenas", () => {
    expect(scriptContentSchema.safeParse({ scenes: [] }).success).toBe(false);
  });
  it("narração vazia e fonte inexistente são erros", () => {
    const issues = checkScript(scriptContentSchema.parse({ scenes: [scene({ narration: " " }), scene({ id: "b", sourceIds: ["zzz"] })] }), ["s1"]);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(2);
  });
  it("cena de desenvolvimento sem fonte e sem visual dão avisos, não erros", () => {
    const issues = checkScript(scriptContentSchema.parse({ scenes: [scene({ sourceIds: [], visual: "" })] }), ["s1"]);
    expect(issues.map((i) => i.level)).toEqual(["warning", "warning"]);
  });
  it("deteta texto repetido", () => {
    const t = "Esta frase é suficientemente longa para ser comparada.";
    const issues = checkScript(scriptContentSchema.parse({ scenes: [scene({ narration: t }), scene({ id: "b", narration: t })] }), ["s1"]);
    expect(issues.some((i) => /repetido/.test(i.message))).toBe(true);
  });
});
