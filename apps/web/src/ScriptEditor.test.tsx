import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, ScriptState } from "@replica/shared";

vi.mock("./api", async (orig) => {
  const real = await orig<typeof import("./api")>();
  return { ...real, api: { script: vi.fn(), generators: vi.fn(), saveScript: vi.fn(), approveScript: vi.fn(), generate: vi.fn(), job: vi.fn(), scriptVersion: vi.fn() } };
});
import { api, ApiError } from "./api";
import { ScriptEditor } from "./components/ScriptEditor";

const channel = { id: "c", language: "pt-MZ", targetDurationSeconds: 600 } as Channel;
const scene = { id: "s1", kind: "hook" as const, title: "Gancho", narration: "", visual: "", sourceIds: [] };
const base: ScriptState = { exists: true, latestVersion: 1, content: { scenes: [scene] }, origin: "template", approved: false, approvedVersion: null, versions: [{ version: 1, origin: "template", note: "", createdAt: new Date().toISOString(), approved: false }], issues: [{ level: "error", sceneId: "s1", message: "Cena 1: sem texto de narração" }], totalSeconds: 0 };
const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.script!.mockResolvedValue(base);
  mocked.generators!.mockResolvedValue([{ id: "template", label: "Esqueleto (sem IA)", aiGenerated: false, ok: true }, { id: "ollama", label: "Ollama local", aiGenerated: true, ok: false, reason: "Defina OLLAMA_MODEL" }]);
});
const renderIt = () => render(<ScriptEditor ideaId="i" channel={channel} sources={[]} onChange={() => {}} />);

describe("ScriptEditor", () => {
  it("mostra erros do servidor, desativa gerador indisponível com o motivo", async () => {
    renderIt();
    expect(await screen.findByText("Cena 1: sem texto de narração")).toBeInTheDocument();
    const ollama = screen.getByRole("button", { name: /Ollama local/ });
    expect(ollama).toBeDisabled();
    expect(ollama).toHaveAttribute("title", "Defina OLLAMA_MODEL");
  });

  it("editar ativa Guardar e bloqueia Aprovar; guardar chama a API e adota o novo estado", async () => {
    mocked.saveScript!.mockResolvedValue({ ...base, latestVersion: 2, content: { scenes: [{ ...scene, narration: "Olá" }] }, issues: [] });
    renderIt();
    await screen.findByLabelText("Narração");
    const save = screen.getByRole("button", { name: "Guardar nova versão" });
    const approve = screen.getByRole("button", { name: "Aprovar roteiro" });
    expect(save).toBeDisabled();
    expect(approve).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Narração"), "Olá");
    expect(save).toBeEnabled();
    expect(approve).toBeDisabled();
    await userEvent.click(save);
    await waitFor(() => expect(mocked.saveScript).toHaveBeenCalledTimes(1));
    expect(mocked.saveScript!.mock.calls[0]![1][0].narration).toBe("Olá");
    expect(await screen.findByText("Versão guardada.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeDisabled();
  });

  it("aprovação recusada pelo servidor mostra os erros bloqueantes", async () => {
    mocked.approveScript!.mockRejectedValue(new ApiError("Corrija os erros antes de aprovar", 422, { "0": "Cena 1: sem texto de narração" }));
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: "Aprovar roteiro" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Corrija os erros antes de aprovar");
    expect(alert).toHaveTextContent("Cena 1: sem texto de narração");
  });

  it("aviso de IA aparece em rascunhos gerados por modelo; aprovado mostra estado", async () => {
    mocked.script!.mockResolvedValue({ ...base, origin: "ollama" });
    const { unmount } = renderIt();
    expect(await screen.findByText(/Texto gerado por IA/)).toBeInTheDocument();
    unmount();
    mocked.script!.mockResolvedValue({ ...base, approved: true, approvedVersion: 1, issues: [] });
    renderIt();
    expect(await screen.findByRole("button", { name: "Aprovado" })).toBeDisabled();
  });
});
