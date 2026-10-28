# Visão geral

Replica Studio transforma uma ideia num vídeo editado (narração, cenas, legendas), com verificações de qualidade e **aprovação humana obrigatória** antes de qualquer publicação.

**Princípio de custo:** tem de correr gratuitamente num computador pessoal. Tudo o que é pago é opcional e nunca ativado sem aviso.

**Prova de progresso:** a app só é considerada concluída quando produz, revê e exporta um vídeo real de ponta a ponta. Um dashboard bonito não conta.

## Conceitos
- **Orquestrador**: coordena a ordem das etapas, valida pré-condições, regista falhas e permite repetir só a etapa falhada.
- **Serviços**: módulos de software (pesquisa, roteiro, voz, cenas, render, legendas, qualidade…). Não são agentes de IA.
- **Worker**: processo separado que executa tarefas longas (render) sem bloquear a interface.
- **Ferramentas de IA**: usadas só onde trazem benefício (pesquisa, roteiro, transcrição) através de adaptadores configuráveis.

## Estado
Ver [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
