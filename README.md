# Replica Studio

Plataforma **local e gratuita** de produção audiovisual assistida por IA: da ideia ao vídeo revisto e exportado.

> **Estado: Marcos A e B concluídos** (fundação + fluxo editorial). A produção de vídeo ainda **não** existe — ver [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Nada na interface é simulado: o que não está implementado aparece desativado com o marco em que chega.

## Requisitos (tudo gratuito)
- Node.js **≥ 22.13** (usa o SQLite embutido do Node: sem compilar nada, sem servidor de base de dados)
- npm
- FFmpeg (só necessário a partir do Marco C; a app verifica e diz como instalar)

## Executar
```bash
npm install
npm run build      # compila a interface
npm start          # API + worker em http://127.0.0.1:3001
```
Para desenvolver (recarrega ao editar; interface em http://localhost:5173):
```bash
npm run dev
```
Os dados ficam em `storage/` (SQLite + ficheiros), na raiz do repositório, fora do Git. Para fazer backup basta copiar essa pasta com a app parada.

## O que já funciona
- Criar, editar, arquivar e restaurar canais (validação no cliente e no servidor, persistência em SQLite).
- Fila de jobs persistente com worker separado: estados válidos, tentativas, cancelamento, retoma após reinício.
- Job real de verificação do FFmpeg (versão e codificadores).
- Registo de eventos e dashboard com números reais.
- **Ideias, fontes e roteiros:** fila por canal, fontes manuais, roteiro por cenas com histórico de versões, verificações (narração em falta, fontes, texto repetido, duração estimada) e aprovação ligada à versão exata.
- **Geração opcional:** "Esqueleto" (sem IA, só estrutura) e **Ollama local** (grátis) se o configurar.

## Verificação
```bash
npm run verify     # typecheck + testes + build + teste ponta a ponta com processos reais
```

## Configuração (`.env`, opcional)
| Variável | Omissão | Descrição |
|---|---|---|
| `PORT` | 3001 | Porta da API |
| `REPLICA_HOST` | 127.0.0.1 | Endereço. A app **não tem autenticação**: não exponha na rede |
| `REPLICA_STORAGE_DIR` | `storage` | Dados (relativo à raiz do repositório) |
| `OLLAMA_MODEL` | — | Ativa a geração com LLM local (ex.: `llama3.2`). Instale o Ollama e `ollama pull <modelo>` |
| `OLLAMA_URL` | http://127.0.0.1:11434 | Endereço do Ollama |

## Custos
Zero. Nenhum serviço pago ou conta é necessária. Integrações futuras (YouTube, pesquisa web, LLM) são opcionais e documentadas com os seus custos/limites quando forem implementadas.

## Limitações conhecidas
- Sem autenticação (uso local de um só utilizador).
- Sem pesquisa web automática: as fontes são introduzidas por si.
- O adaptador Ollama só foi testado contra um servidor simulado; a qualidade do texto depende do modelo e tem de ser revista.
- `node:sqlite` é marcado "experimental" pelo Node 22 (a API usada é estável; aparece um aviso no arranque).
