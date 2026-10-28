# Plano de implementação

Regra: um marco só fecha com o que foi **executado e verificado**.

- [x] **A — Fundação executável**: monorepo, API, SQLite com migrações, canais persistentes, jobs + worker, interface, testes, docs.
- [x] **B — Fluxo editorial**: fila de ideias por canal, fontes manuais (URL http(s), data de consulta, citação), roteiros por cenas com versões imutáveis, verificações, aprovação ligada ao hash exato e geração em segundo plano (esqueleto sem IA; Ollama local opcional). **Pesquisa web automática: não implementada** (ver DECISIONS #10).
- [ ] **C — Primeiro vídeo real**: avaliação de vozes locais gratuitas, templates de cena, render FFmpeg (~1 min), legendas, validações básicas. **Critério:** um .mp4 reproduzível.
- [ ] **D — Produção avançada**: correção de pronúncia, Shorts 9:16, thumbnails, metadados e pacote de exportação.
- [ ] **E — Revisão e publicação**: painel de aprovação ligada à versão exata; YouTube (OAuth, privado primeiro); bloqueio sem aprovação.
- [ ] **F — Automação**: agendador, limites, retoma, histórico. Nunca aprova nem publica sozinho.
- [ ] **G — Consolidação**: testes completos, segurança, acessibilidade, OpenAPI, docs finais.

## Verificado no Marco B
`npm run verify`: typecheck limpo; testes shared 14, core 34, api 8, worker 6, web 8; build; smoke ponta a ponta OK (inclui ideia → fonte → geração pelo worker → aprovação bloqueada/permitida → reinício → edição invalida aprovação → versão antiga intacta). Percurso completo na interface em Chromium real (canal, ideia, fonte com URL perigoso rejeitado, geração, aprovação, edição, recarregar).

**Não verificado com serviço real:** o adaptador Ollama foi testado só contra um servidor HTTP local que simula a API (o Ollama não está instalado neste ambiente). Teste-o com o seu modelo antes de confiar nele.

## Verificado no Marco A
`npm run verify`: typecheck limpo; testes shared 6, core 16, api 4, worker 4, web 4; build; smoke ponta a ponta OK; fluxo de UI em Chromium real (criar canal, job FFmpeg, recarregar) sem erros de consola.
