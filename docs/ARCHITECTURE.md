# Arquitetura

```
apps/web     React + Vite  ──HTTP /api──▶  apps/api (Express 5)
                                              │ lê/escreve
packages/shared (esquemas Zod, tipos)         ▼
packages/core  (SQLite, migrações, canais, jobs, caminhos seguros, FFmpeg)
                                              ▲ lê/escreve
                                  apps/worker (processo separado, polling)
storage/  replica.db (WAL) + channels/<id>/…   (fora do Git)
```

- **API e worker comunicam só pela base de dados** (tabela `jobs`). Sem Redis nem filas externas: SQLite em modo WAL chega para uma máquina local.
- **Jobs**: `queued → running → succeeded | failed | cancelled`. Falha com tentativas restantes volta a `queued`. `failed → queued` só por repetição manual. Transições inválidas são rejeitadas (`TRANSITIONS` em `jobs.ts`). O claim é atómico (`BEGIN IMMEDIATE`).
- **Retoma**: no arranque, jobs que ficaram `running` sem worker vivo são recuperados.
- **Cancelamento seguro**: em fila é imediato; em execução marca `cancel_requested` e o worker termina de forma cooperativa.
- **Ficheiros**: `storage/channels/<id>/…`. Todos os caminhos passam por `safeJoin` (bloqueia path traversal).
- **Dados nunca são apagados**: canais são arquivados.
- **Segurança**: escuta em `127.0.0.1`; corpo JSON limitado a 100 kB; criação de jobs só para tipos em lista branca; FFmpeg invocado com `execFile` (sem shell).
- **Contratos**: erros sempre como `{ error: { code, message, fields? } }`. OpenAPI fica para o Marco G, quando a API estabilizar.
