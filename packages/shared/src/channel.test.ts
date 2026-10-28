import { describe, expect, it } from "vitest";
import { channelInputSchema, channelPatchSchema } from "./channel.ts";

const valid = {
  name: "História da Tecnologia",
  niche: "Tecnologia",
  audience: "Estudantes universitários",
  language: "pt-MZ",
};

describe("channelInputSchema", () => {
  it("aplica valores por omissão configuráveis", () => {
    const r = channelInputSchema.parse(valid);
    expect(r.targetDurationSeconds).toBe(600);
    expect(r.formats).toEqual(["horizontal"]);
    expect(r.frequency).toBe("manual");
    expect(r.primaryColor).toBe("#6d5efc");
  });

  it("remove espaços e rejeita nome vazio", () => {
    expect(channelInputSchema.parse({ ...valid, name: "  Canal  " }).name).toBe("Canal");
    expect(channelInputSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejeita cor inválida, idioma desconhecido e duração fora de limites", () => {
    expect(channelInputSchema.safeParse({ ...valid, primaryColor: "azul" }).success).toBe(false);
    expect(channelInputSchema.safeParse({ ...valid, language: "xx" }).success).toBe(false);
    expect(channelInputSchema.safeParse({ ...valid, targetDurationSeconds: 5 }).success).toBe(false);
    expect(channelInputSchema.safeParse({ ...valid, targetDurationSeconds: 99999 }).success).toBe(false);
    expect(channelInputSchema.safeParse({ ...valid, targetDurationSeconds: 60.5 }).success).toBe(false);
  });

  it("rejeita formatos vazios ou repetidos", () => {
    expect(channelInputSchema.safeParse({ ...valid, formats: [] }).success).toBe(false);
    expect(channelInputSchema.safeParse({ ...valid, formats: ["short", "short"] }).success).toBe(false);
  });
});

describe("channelPatchSchema", () => {
  it("aceita actualização parcial e rejeita objeto vazio", () => {
    expect(channelPatchSchema.safeParse({ tone: "Descontraído" }).success).toBe(true);
    expect(channelPatchSchema.safeParse({}).success).toBe(false);
  });

  it("não injecta valores por omissão em campos não enviados", () => {
    const r = channelPatchSchema.parse({ tone: "x" });
    expect(Object.keys(r)).toEqual(["tone"]);
  });
});
