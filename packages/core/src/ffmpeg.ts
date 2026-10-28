import { execFile } from "node:child_process";

export interface FfmpegStatus {
  available: boolean;
  version?: string;
  encoders: { libx264: boolean; aac: boolean; libass: boolean };
  error?: string;
}

function run(bin: string, args: string[], timeout = 15000): Promise<string> {
  // execFile sem shell: argumentos nunca são interpretados como comandos.
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message));
      else resolve(stdout.toString());
    });
  });
}

/** Verifica FFmpeg real: versão e codificadores necessários. Sem FFmpeg, devolve instruções. */
export async function checkFfmpeg(bin = "ffmpeg"): Promise<FfmpegStatus> {
  try {
    const ver = await run(bin, ["-version"]);
    const encoders = await run(bin, ["-hide_banner", "-encoders"]);
    return {
      available: true,
      version: ver.split("\n")[0]?.trim(),
      encoders: {
        libx264: /\blibx264\b/.test(encoders),
        aac: /\baac\b/.test(encoders),
        libass: /--enable-libass/.test(ver) || (await run(bin, ["-hide_banner", "-filters"]).then((f) => /\bsubtitles\b/.test(f)).catch(() => false)),
      },
    };
  } catch (e) {
    return {
      available: false,
      encoders: { libx264: false, aac: false, libass: false },
      error: `FFmpeg não encontrado ou não executável (${(e as Error).message}). Instale: macOS "brew install ffmpeg"; Ubuntu/Debian "sudo apt install ffmpeg"; Windows "winget install Gyan.FFmpeg".`,
    };
  }
}
