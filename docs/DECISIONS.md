# Decisões

| # | Decisão | Razão |
|---|---|---|
| 1 | **`node:sqlite`** em vez de `better-sqlite3` | Zero dependências nativas, nada a compilar, gratuito, funciona em macOS Intel. Contrapartida: aviso "experimental" no Node 22. |
| 2 | **Sem Redis/filas**: fila na tabela `jobs` | Uma máquina, um utilizador. Complexidade só quando demonstrada. |
| 3 | **Zod 4** partilhado (web + api) | Uma só fonte de verdade para validação. |
| 4 | Esquema de PATCH **sem defaults** | O `.partial()` do Zod 4 mantém defaults e repunha cor/duração/formatos num PATCH (bug encontrado e corrigido, com teste). |
| 5 | Caminhos resolvidos **a partir da raiz do repo** | `npm -w` muda o cwd; API e worker acabariam com bases de dados diferentes (bug encontrado e corrigido, com teste). |
| 6 | Hash routing, CSS simples, sem biblioteca de UI/router | Menos dependências; a UI é pequena. Reavaliar no Marco B se o editor de roteiros o justificar. |
| 7 | Arquivar em vez de apagar | Regra do projeto: nunca eliminar dados sem autorização. |
| 8 | Sem agentes `.claude/agents/` por agora | Opcionais; não trazem vantagem no Marco A. |
| 9 | Vozes (Piper/VoxCPM2): **por avaliar** no Marco C | Não assumir padrão antes de testar naturalidade, pronúncia, desempenho e licença em pt. |
