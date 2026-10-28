export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, "not_found", `${what} não encontrado`);
export const conflict = (message: string) => new AppError(409, "conflict", message);
