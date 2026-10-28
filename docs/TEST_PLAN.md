# Plano de testes

`npm run verify` executa tudo.

| Camada | Ferramenta | Cobre (Marco A) |
|---|---|---|
| Unitário `shared` | Vitest | Validação de canais, defaults, PATCH |
| Integração `core` | Vitest (SQLite em memória/disco) | Migrações idempotentes, canais, máquina de estados, tentativas, cancelamento, retoma, path traversal, persistência após reabrir, config |
| Integração `api` | Vitest + `fetch` num servidor real | CRUD, erros estruturados, regras de estado dos jobs, JSON inválido |
| Integração `worker` | Vitest | Job real de FFmpeg, falha+tentativas, tipos sem handler, cancelamento |
| Componente `web` | Testing Library | Formulário de canal; editor de roteiro (guardar/aprovar/bloqueios, gerador indisponível, aviso de IA) |
| Ponta a ponta | `scripts/smoke.mjs` (processos reais) | Arranque, UI servida, criar canal, job FFmpeg real, reinício e persistência |

**Real vs simulado:** FFmpeg, SQLite, worker e HTTP são reais. **Simulado:** a API do Ollama (servidor HTTP local de teste). Não há outras integrações externas ainda. Os percursos de UI em Chromium (Playwright) foram corridos à mão nos Marcos A e B; não estão automatizados no repositório.

**Por testar nos marcos seguintes:** geração de voz, render, legendas, Shorts, relatórios de qualidade, aprovação e invalidação, publicação duplicada ou sem aprovação.
