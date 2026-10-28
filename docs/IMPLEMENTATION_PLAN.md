# Plano de implementação

Regra: um marco só fecha com o que foi **executado e verificado**.

- [x] **A — Fundação executável**: monorepo, API, SQLite com migrações, canais persistentes, jobs + worker, interface, testes, docs.
- [ ] **B — Fluxo editorial**: ideias, fontes (manuais; pesquisa externa opcional), roteiros por cenas com versões e aprovação.
- [ ] **C — Primeiro vídeo real**: avaliação de vozes locais gratuitas, templates de cena, render FFmpeg (~1 min), legendas, validações básicas. **Critério:** um .mp4 reproduzível.
- [ ] **D — Produção avançada**: correção de pronúncia, Shorts 9:16, thumbnails, metadados e pacote de exportação.
- [ ] **E — Revisão e publicação**: painel de aprovação ligada à versão exata; YouTube (OAuth, privado primeiro); bloqueio sem aprovação.
- [ ] **F — Automação**: agendador, limites, retoma, histórico. Nunca aprova nem publica sozinho.
- [ ] **G — Consolidação**: testes completos, segurança, acessibilidade, OpenAPI, docs finais.

## Verificado no Marco A
`npm run verify`: typecheck limpo; testes shared 6, core 16, api 4, worker 4, web 4; build; smoke ponta a ponta OK; fluxo de UI em Chromium real (criar canal, job FFmpeg, recarregar) sem erros de consola.
