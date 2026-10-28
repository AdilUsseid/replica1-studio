import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChannelForm } from "./components/ChannelForm";

describe("ChannelForm", () => {
  it("mostra erros por campo e não submete dados inválidos", async () => {
    const onSubmit = vi.fn();
    render(<ChannelForm onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Criar canal" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("O nome é obrigatório")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("valida a duração mínima", async () => {
    render(<ChannelForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText("Nome"), "A");
    await userEvent.type(screen.getByLabelText("Nicho"), "B");
    await userEvent.type(screen.getByLabelText("Público-alvo"), "C");
    const dur = screen.getByLabelText(/Duração pretendida/);
    await userEvent.clear(dur);
    await userEvent.type(dur, "5");
    await userEvent.click(screen.getByRole("button", { name: "Criar canal" }));
    expect(await screen.findByText("A duração mínima é 15 segundos")).toBeInTheDocument();
  });

  it("submete dados válidos com os defaults do canal", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ChannelForm onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText("Nome"), "Meu Canal");
    await userEvent.type(screen.getByLabelText("Nicho"), "Tecnologia");
    await userEvent.type(screen.getByLabelText("Público-alvo"), "Estudantes");
    await userEvent.click(screen.getByRole("button", { name: "Criar canal" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ name: "Meu Canal", targetDurationSeconds: 600, formats: ["horizontal"], language: "pt-MZ" });
  });

  it("mostra erro do servidor sem perder o formulário", async () => {
    const { ApiError } = await import("./api");
    const onSubmit = vi.fn().mockRejectedValue(new ApiError("Já existe um canal ativo com esse nome", 409));
    render(<ChannelForm onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText("Nome"), "X");
    await userEvent.type(screen.getByLabelText("Nicho"), "Y");
    await userEvent.type(screen.getByLabelText("Público-alvo"), "Z");
    await userEvent.click(screen.getByRole("button", { name: "Criar canal" }));
    expect(await screen.findByText(/Já existe um canal/)).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("X");
  });
});
