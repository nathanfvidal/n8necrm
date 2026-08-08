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
Três fatias depois, está construído e coberto por testes.

> **Correção de 2026-08-07.** Esta frase dizia "funciona em produção". Não
> funcionava — nunca chegou lá. Uma auditoria descobriu que o deploy da Vercel
> falhava desde 4 de agosto, então o site público servia uma versão anterior ao
> módulo inteiro. A causa está na § 7. Fica registrado porque o erro é
> instrutivo: "os testes passam" e "está no ar" pareciam a mesma coisa, e
> ninguém tinha como notar a diferença sem olhar.

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
| Gestão de usuários | Pronto — criar, editar papel, ativar/desativar, redefinir senha |
| Contatos como entidade própria | Pronto — agenda com busca, cadastro avulso e detalhe |
| Observabilidade | **Pronto e recebendo** — Sentry só de servidor, com `SENTRY_DSN` na Vercel. Redação de PII confirmada no painel (§ 7) |

Os três últimos eram os buracos que impediam entregar a um segundo cliente, e
foram fechados na branch `feature/nucleo-entregavel` (2026-08-07). O critério da
§ 2.3 — instalar e operar sem que ninguém edite código — passa a valer para
cadastrar equipe e corrigir cadastro de cliente.

O **e-mail de notificação** continua codado e nunca exercitado: sem
`RESEND_API_KEY`, o despacho sai pelo caminho de "não configurado". É a classe de
dívida em que um caminho de integração existe no código e nunca rodou contra o
serviço de verdade — e a única que resta no núcleo.

O Sentry saiu dessa lista em 2026-08-07: recebe evento de verdade e a redação de
PII foi confirmada no painel (§ 7).

### Achado que vale para qualquer rota nova do painel

Acrescentar link ao menu do painel introduziu uma corrida de sessão real, pega
pelo e2e: o `<Link>` do Next pré-carrega, então há requisições às rotas
protegidas em voo o tempo todo; no logout, uma delas chega depois carregando o
cookie recém-invalidado, e o Auth.js **reemite o cookie de sessão** na resposta —
"Sair" deixava de revogar. A navegação inteira passou a usar `prefetch={false}`
(`painel-nav.tsx`), o que custa pouco porque toda página do painel é
`force-dynamic` e o Next não pré-carrega conteúdo de rota dinâmica sem
`loading.tsx`.

## 4. Módulos

Um existe. Os outros são nomes plausíveis, não compromissos.

| Módulo | Estado |
|---|---|
| `whatsapp` | **Construído, inerte em produção** — atendente com IA, controle pelo CRM, aviso de conversa esperando. Falta `EVOLUTION_*`, `OPENAI_API_KEY` e `WHATSAPP_*` na Vercel; sem elas o webhook recusa toda entrada (§ 7) |
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

## 7. O deploy que passou três dias quebrado

Auditoria de segurança de 2026-08-07, primeira rodada da regra do `AGENTS.md`.

Produção servia uma versão de 4 de agosto. Todo deploy desde então falhava, e o
site continuava no ar com o último build bom — que é o comportamento certo da
Vercel e também o que torna a falha invisível: nada quebra, só para de mudar.

**A causa.** `gateway/index.ts` e `llm/index.ts` validavam `EVOLUTION_*` e
`OPENAI_API_KEY` no escopo do módulo. `next build` avalia todo módulo alcançável
para coletar a configuração das rotas, e a cadeia `api/queues/whatsapp-turn` →
`turno.ts` → `gateway` fazia a validação rodar em tempo de build. Sem aquelas
variáveis na Vercel, o build inteiro falhava — inclusive leads, funil e login.

O sintoma só aparece na Vercel: numa máquina de desenvolvimento o `.env` tem
tudo e o build passa. A correção foi adiar a construção para o primeiro uso;
`tests/unit/whatsapp-config-preguicosa.test.ts` trava a regressão.

**O que isto ensina, além do bug.** Nenhum sinal ligava "os testes passam" a
"está no ar". Suíte verde, `main` em dia, e três dias de código não publicado.
A pergunta que faltava não era sobre qualidade do código, era: *o que está
rodando agora no endereço que o cliente acessa?*

Duas mudanças que respondem a isso:

- **Auditoria antes de integrar branch** (`AGENTS.md`), com verificação contra
  o deploy real e não só contra a máquina local.
- **Sentry rotula o ambiente pela `VERCEL_ENV`**, nunca pela `NODE_ENV`.
  `next start` roda com `NODE_ENV=production`, então a suíte e2e local chegava
  ao painel carimbada como produção — o monitoramento mentia sobre a origem.

### O que ficou verificado com evidência

| Item | Estado |
|---|---|
| Rota da fila alcançável da internet | **Não** — 404 em GET e POST no deploy real, enquanto o webhook responde. Confirma o air-gap que a doc da Vercel promete e que o código registrava como não verificável |
| Redação de PII no Sentry | Funciona — os eventos chegam com `[telefone]`, `[e-mail]` e `[hash]` |
| Contas com senha do repositório | Desativadas. `admin@exemplo.com`/`senha123` era ADMIN ativo e alcançável pelo deploy público |
| Autorização de Server Action | As quatro de `core/users` recusam VENDEDOR chamando direto por HTTP, sem passar pela tela |
| RLS e grants | RLS ligada nas 13 tabelas, zero grants para `anon`/`authenticated`, e tabela futura nasce protegida |
