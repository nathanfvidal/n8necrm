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
6. **Hospedagem: a própria VPS `76.13.224.40`**, sob systemd, ao lado de n8n e
   Evolution (2026-08-21). **Reaberta e refechada duas vezes:** era Vercel
   (2026-08-19), virou "em aberto" no Ciclo 2d (2026-08-21), e fechou na VPS no
   mesmo dia. A fila é uma tabela do Postgres desde o Ciclo 2d (`TurnoJob`,
   lease atômico, zero infra nova — pg-boss numa VPS e o próprio n8n foram
   considerados e recusados), e o gatilho é o **worker**
   (`npm run fila:worker`) como serviço supervisionado — não agendador.
   **Consequência que não pode ser esquecida:** a fila **não drena sozinha**.
   Worker parado é mensagem que entra, vira linha em `TurnoJob` e nunca é
   respondida, sem erro aparecer em lugar nenhum. Quem acusa isso é
   `n8necrm-saude.timer`, que pergunta ao BANCO e não ao systemd.
   **O que continuava bloqueado e destravou:** `frame-ancestors` (Ciclo 4) e
   `SUPABASE_JWT_ISSUER` (Ciclo 1b) esperavam a origem pública, que agora é
   `https://crm.nateksoft.com`. Ver `docs/DEPLOY.md` e
   `docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md`.
   *(O histórico fica escrito aqui de propósito: decisão travada sem histórico
   é decisão que alguém reabre de novo sem saber que já foi discutida — e esta
   já foi reaberta uma vez. Um leitor que encontre só "em aberto" pergunta de
   novo; um que encontre só "Vercel" age errado.)*
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
10. **O produto é um CRM com o WhatsApp como canal. `nathanfvidal/zapz`
    considerado como base alternativa e recusado** (2026-08-21). Medido no
    repositório: 63.427 linhas, 51 tabelas, 36 Edge Functions, RLS de verdade
    (36 arquivos habilitam, 197 políticas) — e **zero testes**, último commit
    em 2026-03-07, e o dono não sabe se ainda sobe. Como *produto de WhatsApp*
    ele é mais completo que este: tem `embedded-signup` da Meta, campanhas com
    opt-out, agente com RAG, CSAT, operadores com permissão, push e cobrança
    por uso. **O que não transfere é o que importa:** ele é SPA Vite +
    Supabase, com toda a autorização em política RLS, contra Next.js
    renderizado no servidor com Prisma e escopo obrigatório aqui — portar é
    reescrever, e os 1.679 testes não atravessam. E os modelos de tenancy são
    incompatíveis: `crm_deals` usa `auth.uid() = user_id`, ou seja **o negócio
    pertence a uma pessoa e a equipe não enxerga**, o oposto dos oito ciclos
    que tornaram `companyId` obrigatório aqui.
    **O zapz continua valendo como REFERÊNCIA**, e a mais útil que existe para
    o Ciclo 2b: `supabase/functions/embedded-signup/` e
    `supabase/functions/whatsapp-api-v2/` já resolvem o onboarding oficial da
    Meta, que é a parte mais chata da API oficial. Também tem
    `source: 'ctwa'` em `crm_deals` — atribuição de clique-para-WhatsApp.

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
- **`AUTH_URL` e `AUTH_TRUST_HOST` não são opcionais em produção.** Sem elas o
  Auth.js v5 recusa **todo** login com `UntrustedHost` — a checagem é
  `config.trustHost` em `node_modules/@auth/core/lib/utils/env.js`, que cai
  para `NODE_ENV !== "production"` quando nenhuma das duas existe. Ou seja:
  `next dev` NUNCA mostra o problema e `next start` sempre mostra, e o erro sai
  só no log do servidor. O aviso viveu meses dentro de `playwright.config.ts`,
  onde quem faz deploy não olha. `AUTH_URL` é **só a origem**, sem caminho:
  `next-auth/lib/env.js` deriva `basePath` do pathname, e um caminho ali apaga
  as rotas `/api/auth/*`. Travado em `tests/unit/supabase-jwt-chave.test.ts`.
- **Mexer em `/opt/nateksoft/nginx/nateksoft.conf` pode derrubar n8n e
  Evolution.** O CRM vive num arquivo **separado** em `sites-available/`, e a
  precedência de `server_name` exato sobre curinga é o que torna isso possível
  sem editar aquele arquivo. `nginx -t` antes de todo `reload`.
- **A VPS não tem `ufw` ativo** (medido em 2026-08-21). É por isso que
  `next start` escuta em `127.0.0.1` e não em qualquer endereço: sem esse bind,
  qualquer um fala com a aplicação direto, contorna o nginx, e escreve o
  `X-Real-IP` que quiser — e o `AuditLog` passa a guardar IP forjado, que é
  pior que campo vazio. Travado em `tests/unit/deploy-units.test.ts`.

