@AGENTS.md

# n8necrm

CRM de atendimento por WhatsApp com automação. Derivado de `RodrigoLR1/CRM`
em 2026-08-19, sem vínculo de fork no GitHub.

## Stack

Next.js 16.3 · React 19.2 · Prisma 7.9 (`@prisma/adapter-pg`) · Postgres 17.6
no Supabase `uzumzfxjcxrbxaucvfsr` (região `sa-east-1`) · Auth.js v5 beta ·
Tailwind 4 · shadcn · Zod 4 · Vitest 4 · Playwright 1.62 · Vercel (deploy e fila)

## Infra externa

| Serviço | Onde | Verificado em |
| --- | --- | --- |
| n8n | `https://n8n.nateksoft.com` | 2026-08-19, API pública responde |
| Evolution API | `https://evolution.nateksoft.com`, v2.3.7 | 2026-08-19, `GET /` |
| Supabase | projeto `uzumzfxjcxrbxaucvfsr` | 2026-08-19, Postgres 17.6.1 |

## Skills que se aplicam

- Banco, RLS, migrations, schema: `supabase`, `supabase-postgres-best-practices`,
  `auditing-supabase-security` — **sempre as três juntas**
- n8n e workflows: família `n8n-*`, `using-n8n-mcp-skills`
- Processo: `superpowers:brainstorming` antes de desenhar,
  `superpowers:writing-plans` antes de codar,
  `superpowers:test-driven-development` ao implementar
- Revisão e debug: `code-review`, `adversarial-review`, `diagnosing-bugs`
- React e performance de front: `vercel-react-best-practices`

## Decisões travadas

Decididas no brainstorm de 2026-08-19. Reabrir qualquer uma invalida os ciclos
que dependem dela — ver `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md`.

1. **Utmify fora de escopo.** Sem rastreamento de UTM, plataformas de anúncio,
   taxas, despesas ou ROI.
2. **Multi-empresa por baixo, UI de empresa única.** `companyId` em todo modelo
   e RLS desde o Ciclo 1; a interface serve uma empresa só.
3. **n8n: painel via API + editor em iframe.** O painel é a base de sustentação
   se o iframe cair.
4. **Evolution: conexões com QR Code pelo CRM**, multi-instância. O Ciclo 2a
   entregou o cofre, a tabela por empresa e a aba de administração; **o QR Code
   e o estado de pareamento ficaram para o Ciclo 2c** — nada disso é provável
   sem uma instância Evolution acessível, e este ambiente não tem uma.
5. **Tempo real: Supabase Realtime**, com RLS como trava do canal.
6. **Hospedagem: EM ABERTO. A fila é Postgres.** *(Reaberta em 2026-08-21 —
   ver `docs/superpowers/specs/2026-08-21-ciclo-2d-fila-em-postgres-design.md`.)*
   Até essa data a decisão era "Vercel agora, com Vercel Queues atrás de um
   adaptador". O dono decidiu **não usar a Vercel**. O que passou a valer: a
   fila de turnos vive numa tabela do Postgres do Supabase que já existe
   (`TurnoJob`, lease atômico, zero infra nova — pg-boss numa VPS e o próprio
   n8n foram considerados e recusados), e **o app é agnóstico de hospedagem**:
   roda em qualquer Node. Onde publicar é decisão adiada, e nada pode passar a
   depender dela.
   **Consequência que não pode ser esquecida:** a fila **não drena sozinha**.
   Alguém tem de ligar `npm run fila:worker` ou um agendador batendo em
   `POST /api/queues/whatsapp-turn`. Sem isso, mensagem entra e nunca é
   respondida, sem erro nenhum aparecer.
   **O que aconteceu com os ciclos que dependiam dela** (esta regra existe no
   topo desta seção e foi cumprida, um a um, na §11 do spec do Ciclo 2d):
   o **Ciclo 0** saiu **vindicado, não invalidado** — a fila já era adaptador
   atrás de uma interface, e é isso que fez a troca custar uma linha nos três
   importadores de `publicarTurno`; os **Ciclos 4 e 1b** continuam bloqueados,
   com outro dono — `frame-ancestors` e `SUPABASE_JWT_ISSUER` precisam da
   origem pública, que passou a depender da hospedagem em vez do domínio da
   Vercel. Nada a refazer em nenhum dos três.
   *(O histórico fica escrito aqui de propósito: decisão travada sem histórico
   é decisão que alguém reabre de novo sem saber que já foi discutida.)*
7. **Cópia da base: histórico completo, sem vínculo de fork.** As branches de
   feature em aberto da origem não vieram.
8. **Identidade do produto: EM ABERTO.** `config/client.ts` está genérico de
   propósito. Isto é uma decisão adiada, não um esquecimento.
9. **O chat mora no CRM. Chatwoot considerado e recusado** (2026-08-20). Não
   por ser ruim — por já existirem 1.603 linhas em `src/modules/whatsapp/`,
   16 arquivos de teste, três telas e os modelos `Conversation`,
   `WhatsappMessage` e `BotConfig`. Receber, responder, pausar e religar a IA
   e o repasse para humano já funcionam; falta só o push, que é o Ciclo 3.
   Integrar o Chatwoot daria a `Contact` dois donos, poria a máquina de estado
   dele contra as 498 linhas de lease IA/humano de `turno.ts`, e traria um
   segundo modelo de isolamento (`accounts`) ao lado do `companyId` do Ciclo
   1a — e o mais fraco dos dois define o piso. Os recursos de caixa de entrada
   que motivaram a pergunta (atribuição, etiquetas, respostas prontas, notas,
   CSAT) viram ciclo próprio dentro deste modelo de dados. Instagram Direct sai
   pela Graph API que o Ciclo 2 já liga para a Meta Cloud API.

## Armadilhas conhecidas

- **Não existe IP confiável sem `IP_CABECALHO_CONFIAVEL`.** Desde o Ciclo 2d
  nenhum cabeçalho é lido até alguém nomear o que a borda SOBRESCREVE (não o
  que ela ACRESCENTE — `x-forwarded-for` atrás de `proxy_add_x_forwarded_for`
  ainda tem o valor do cliente na frente). Ausente: o login **pula** o limite
  por IP, o balde do webhook passa a ser por empresa e `AuditLog.ip` fica nulo.
  É o estado seguro, e é reversível com uma linha no ambiente.
- **`TurnoJob` é modelo de tenant, mas a REIVINDICAÇÃO é cross-tenant.** É a
  única exceção permanente de prisma cru fora de `src/core/`, e o motivo é
  circularidade: a empresa é o RESULTADO da reivindicação, não a entrada dela.
- **RLS não protege o caminho do Prisma.** Ele conecta com papel dono de tabela,
  que ignora política de linha. O isolamento por empresa são DUAS defesas: escopo
  obrigatório de query em `src/core/` e RLS para o caminho do navegador.
- **A base é blindada contra `anon`/`authenticated`** por três migrations e um
  teste e2e (`tests/e2e/banco-blindado.spec.ts`). O Realtime do Ciclo 3 precisa
  abrir uma exceção NOMEADA: `SELECT` numa tabela só, com política junto, e o
  teste atualizado para afirmar essa exceção — nunca afrouxado.
- **`DIRECT_URL` nunca aponta para `db.<projeto>.supabase.co`**: esse host
  resolve só em IPv6 (medido em 2026-08-19) e dá `ENETUNREACH`. Usar o session
  pooler.
- **`DATABASE_URL` na porta 6543, `DIRECT_URL` na 5432.** Trocar as duas faz
  `prisma migrate` ficar PENDURADO sem imprimir nada — parece lentidão, é falha.
- **Validar env em escopo de módulo derruba o build.** `next build` avalia
  módulos alcançáveis; validação no topo do arquivo roda sem as variáveis. O
  padrão da base é construção preguiçosa (ver `gateway/index.ts` e `fila/`).
  O último arquivo que ainda faz do jeito antigo é `src/lib/env.ts`
  (`DATABASE_URL` e `AUTH_SECRET`, parseadas no topo) — não é dívida do Ciclo
  2a e está nomeada em `gateway/index.ts` para não ser lida como esquecimento.
- **Credencial de canal não mora no ambiente.** `EVOLUTION_*` morreram no Ciclo
  2a. A apikey vive cifrada em `WhatsappConnection.segredoCifrado`, por empresa,
  e a chave mestra é `COFRE_CHAVE_MESTRA` — a única peça que continua fora do
  banco, e a razão de o dump valer nada sozinho. **Sem ela o WhatsApp não sobe**,
  e não existe fallback: um padrão por deploy responderia clientes de uma
  empresa pela instância de outra.
- **O webhook da Evolution carrega `companyId` E token no path.** O `companyId`
  é hipótese, não autoridade — quem decide é o token, porque a busca é escopada
  naquela empresa. Trocar a URL do webhook no painel da Evolution é parte de
  cadastrar uma conexão.
- **`auth.uid()` é inutilizável neste projeto.** Ela faz cast de `sub` para
  `uuid` e o `User.id` desta base é **cuid**. Medido em 2026-08-20 contra
  `uzumzfxjcxrbxaucvfsr`: `ERROR: 22P02: invalid input syntax for type uuid:
  "cmt11hfuu0000gc6jy1sbu1f7"`. Uma política que a chame não devolve falso —
  **levanta exceção** e derruba a consulta, com uma mensagem que fala de UUID
  e não de política. Toda política usa `auth.jwt() ->> 'sub'` e
  `auth.jwt() ->> 'company_id'` (este último também medido no mesmo dia: lê o
  claim customizado). Registrado no JSDoc de `src/core/supabase-jwt/emitir.ts`;
  o e2e que trava isso contra o Postgres real, `tests/e2e/claims-jwt.spec.ts`,
  é criado na Task 7 deste ciclo e **ainda não existe**.
- **O schema `realtime` já concede 8 privilégios a `anon`/`authenticated` de
  fábrica**, e isso não é defeito: `realtime.messages` e `realtime.subscription`
  nascem assim quando o Supabase instala o Realtime. Medido em 2026-08-20. O
  que tranca a porta é `realtime.messages` estar com RLS ligada e ZERO
  políticas — mesma postura do schema `public`. Por isso a vigilância desse
  schema em `tests/e2e/banco-blindado.spec.ts` fixa o CONJUNTO EXATO de grants
  em vez de exigir lista vazia: exigir vazio seria vermelho no primeiro dia e
  o "conserto" arrancaria o Realtime que o Ciclo 3 precisa.
