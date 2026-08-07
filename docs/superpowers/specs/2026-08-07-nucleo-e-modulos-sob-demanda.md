# Núcleo e módulos sob demanda

Data: 2026-08-07 · **Supera a § 9 (Fases) de `2026-07-28-crm-base-design.md`**

## 1. Por que esta spec existe

A spec base organizou o produto em sete fases lineares, com a **Fase 2 — catálogo +
site mostruário** como próximo passo obrigatório e as fases 3 a 6 empilhadas atrás
dela. Aquele desenho não era arbitrário: nasceu de uma demanda concreta — ligar o CRM
ao site de catálogo de uma loja de carros.

A demanda saiu do plano. E com ela cai a premissa que sustentava a ordem inteira,
porque a Fase 2 não era só a próxima entrega: era o pré-requisito declarado de tudo
que vinha depois. Analytics media eventos do site. Automação reagia a esses eventos.
Campanhas anunciavam os itens do catálogo.

O que sobrou, na prática, foi outra coisa — e a evidência é o próprio histórico. O
módulo `whatsapp`, que é hoje a parte comercialmente mais forte do sistema, **não
existia em nenhuma das sete fases**. Foi construído porque um cliente precisava dele.
Três fatias depois, funciona em produção.

Isso não foi um desvio do plano. Foi o plano real se revelando.

## 2. O modelo

**Um núcleo fechado, mais módulos construídos quando a demanda aparece.**

O núcleo é o CRM que todo cliente recebe igual: pessoas, oportunidades, funil,
tarefas, avisos, quem pode o quê. Ele não tem fases — tem um estado, *completo* ou
*incompleto*, e a única pergunta que importa sobre ele é se dá para instalar num
cliente novo sem programador junto.

Módulo é funcionalidade que **alguns** clientes têm. Não existe ordem entre módulos,
não existe módulo obrigatório, e nenhum módulo é promessa até alguém pedir.

### 2.1 Por que isto e não fases

Fase é uma aposta sobre o que o mercado vai querer, feita antes de o mercado falar. O
custo de errar é alto e assimétrico: a Fase 2 travou as fases 3 a 6 atrás de um site
mostruário que nunca foi construído, e nenhuma delas era impossível — só estavam
esperando na fila errada.

Módulo sob demanda inverte isso. O trabalho começa depois do pedido, o que significa
que ninguém constrói catálogo para um cliente que queria financeiro.

**Descartado:** manter as fases e só reordenar. Reordenar preserva o defeito — a
ordem continuaria sendo um palpite, só que um palpite diferente. O problema não era a
ordem escolhida, era existir uma ordem fixa.

### 2.2 O que "sob demanda" não quer dizer

Não quer dizer improvisar por cliente. O mecanismo de módulos existe desde a Fase 0 e
tem regra de verdade sustentando a fronteira: `modules/` pode importar de `core/`, e
`core/` **nunca** importa de `modules/`, garantido por ESLint em nível de erro.

É essa regra que faz o modelo funcionar. Sem ela, "módulo" seria pasta, e desligar o
catálogo num fork quebraria o funil. Com ela, um módulo desligado some do menu e sua
rota devolve 404 — não é CSS escondendo botão.

O `whatsapp` provou o caminho inteiro: enum, pasta, gate, rota, testes. A receita
está em `docs/receita-modulo.md`, escrita a partir do que ele fez de fato.

### 2.3 O núcleo tem um critério, não uma lista de desejos

Está completo quando um cliente novo consegue ser instalado e operado sem que ninguém
edite código. Concretamente: cadastrar a equipe, cadastrar quem é cliente, mover
negócio pelo funil, não perder tarefa, e ficar sabendo quando algo quebra.

Esse critério tem consequência imediata — e desconfortável. Pelo roteiro antigo, a
Fase 1 estava concluída. Pelo critério novo, **não está**: não existe tela de
usuários (a equipe só nasce no seed), `Contact` não é entidade de primeira classe (só
existe pendurado num lead) e não há observabilidade nenhuma. Um cliente novo hoje
exige um desenvolvedor para tarefas que são de recepcionista.

## 3. O núcleo

| Área | Estado |
|---|---|
| Autenticação, papéis, permissões | Pronto |
| Funil configurável por `config/client.ts` | Pronto |
| Leads: lista, filtro, kanban, notas, exportação | Pronto |
| Tarefas | Pronto |
| Notificações in-app | Pronto |
| Dashboard | Pronto |
| Auditoria, RLS, rate limit | Pronto |
| **Gestão de usuários** | **Falta** — a permissão existe, a tela não |
| **Contatos como entidade própria** | **Falta** — só nasce colado num lead |
| **Observabilidade** | **Falta** — Sentry consta da Fase 0 e nunca foi instalado |

O e-mail de notificação está codado mas nunca foi exercitado: sem `RESEND_API_KEY`,
o despacho sai pelo caminho de "não configurado". Não conta como pronto até um
e-mail real chegar em alguém.

## 4. Módulos

Um existe. Os outros são nomes plausíveis, não compromissos.

| Módulo | Estado |
|---|---|
| `whatsapp` | **Construído** — atendente com IA, controle pelo CRM, aviso de conversa esperando |
| `catalog` | Candidato. Era a Fase 2; volta se um cliente pedir vitrine de produtos |
| `analytics` | Candidato. Depende de haver site público para medir |
| `automation` | Candidato |
| `campaigns` | Candidato |
| `finance` | Candidato |

As entradas de `catalog` e `analytics` continuam no enum de `config/client.schema.ts`
e as pastas vazias continuam em `src/modules/`. Custam nada e nomeiam intenção. O que
sai são os links de menu que apontavam para rotas inexistentes — esses davam 404 e
prometiam o que não existe.

## 5. O que fica reservado no modelo de dados

Três colunas de `Lead` foram criadas para a Fase 2 e ficaram sem dono:

| Coluna | Para que era |
|---|---|
| `itemId` | Apontar o item do catálogo que originou o lead |
| `sessionId` | Costurar a visita anônima ao lead convertido |
| `utm` | Origem da campanha que trouxe a pessoa |

Ficam onde estão. São nuláveis, sem chave estrangeira, e não custam nada — remover
exigiria migração para resolver um problema que não existe. Ganham comentário no
`schema.prisma` explicando a origem, para que quem chegar depois não precise
arqueologia.

Se o rastreio de origem voltar, `sessionId` e `utm` servem a qualquer vertical, não
só a catálogo — são a parte reaproveitável do plano antigo.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| "Sob demanda" virar desculpa para não decidir nada | O núcleo tem critério objetivo e fechado (§ 2.3). É ele que precisa acabar; módulo é que espera pedido |
| Módulo feito às pressas para fechar venda | A receita (`docs/receita-modulo.md`) fixa o mínimo: gate, fronteira, testes. O `whatsapp` levou três fatias e nenhuma foi supérflua |
| Fork divergir do núcleo e travar propagação de correção | O mesmo que a spec base já mitigava: núcleo pequeno e isolado por regra de lint. O modelo novo reduz o risco, porque tira do núcleo o que era vertical |
| Cliente pedir algo que não cabe em módulo | Aí é decisão de negócio, não de arquitetura — e fica visível como tal em vez de virar exceção escondida no núcleo |
