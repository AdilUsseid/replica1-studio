# Plano de testes

`npm run verify` executa tudo.

| Camada | Ferramenta | Cobre (Marco A) |
|---|---|---|
| Unitário `shared` | Vitest | Validação de canais, defaults, PATCH |
| Integração `core` | Vitest (SQLite em memória/disco) | Migrações idempotentes, canais, máquina de estados, tentativas, cancelamento, retoma, path traversal, persistência após reabrir, config |
| Integração `api` | Vitest + `fetch` num servidor real | CRUD, erros estruturados, regras de estado dos jobs, JSON inválido |
| Integração `worker` | Vitest | Job real de FFmpeg, falha+tentativas, tipos sem handler, cancelamento |
| Componente `web` | Testing Library | Validação do formulário, erros do servidor |
| Ponta a ponta | `scripts/smoke.mjs` (processos reais) | Arranque, UI servida, criar canal, job FFmpeg real, reinício e persistência |

**Real vs simulado:** FFmpeg e SQLite são reais em todos os testes. Não há integrações externas ainda. Testes de browser manuais com Playwright foram feitos à mão no Marco A (não estão automatizados no repositório).

**Por testar nos marcos seguintes:** geração de voz, render, legendas, Shorts, relatórios de qualidade, aprovação e invalidação, publicação duplicada ou sem aprovação.
