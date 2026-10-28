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
- **Editorial**: `ideas` (fila por canal com `position`), `sources` (manuais), `scripts` → `script_versions` (conteúdo JSON + sha256, **imutáveis**; editar cria sempre versão nova) e `approvals` (`target_id` = versão exata, `content_hash`). Uma aprovação só é válida se não foi invalidada **e** o hash do conteúdo guardado ainda coincide (deteta adulteração). Qualquer nova versão invalida aprovações anteriores. IA nunca aprova.
- **Geração**: interface `Generator` (`template`, `ollama`). A API valida e enfileira `script.generate`; o worker executa, valida a saída (Zod), descarta fontes inventadas pelo modelo e grava nova versão. Uma geração ativa por ideia.
- **Contratos**: erros sempre como `{ error: { code, message, fields? } }`. OpenAPI fica para o Marco G, quando a API estabilizar.
