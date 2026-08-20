# n8necrm — arquitetura do programa e Ciclo 0 (Fundação)

Data: 2026-08-19
Status: aprovado nas seções, aguardando revisão do documento escrito

## 1. O que é isto

Copiar a base do CRM em `RodrigoLR1/CRM` para `nathanfvidal/n8necrm` e evoluí-la
em quatro frentes: multi-empresa por baixo, conexões multi-instância da Evolution
API, chat ao vivo e um módulo de fluxos integrado ao n8n da VPS.

Este documento cobre **a arquitetura do programa inteiro** e **o Ciclo 0 em
detalhe implementável**. Cada ciclo seguinte recebe seu próprio spec.

## 2. Ponto de partida — o que foi verificado ao vivo

Tudo abaixo foi conferido nesta sessão, com o comando e a saída obtidos. Nada
aqui é presumido.

| Fato | Como foi verificado |
| --- | --- |
| `RodrigoLR1/CRM` é clonável, HEAD `d2a44dc` | `git ls-remote` |
| `nathanfvidal/n8necrm` existe e **não tem nenhuma ref** | `git ls-remote` (exit 0, saída vazia) |
| Supabase `uzumzfxjcxrbxaucvfsr`, schema `public` **vazio** | `list_tables` via MCP |
| Evolution API viva em `https://evolution.nateksoft.com`, **versão 2.3.7** | `curl /` → `{"status":200,"message":"Welcome to the Evolution API...","version":"2.3.7"}` |
| n8n vivo em `https://n8n.nateksoft.com`, API pública responde | `n8n_health_check` |
| n8n serve **`X-Frame-Options: SAMEORIGIN`** (nginx/1.24.0) | `curl -I` |
| CSP do CRM: `frame-ancestors 'none'`, `connect-src 'self'`, **sem `frame-src`** | `src/proxy.ts:128-136` |
| A fila do WhatsApp é **`@vercel/queue`** + `experimentalTriggers: queue/v2beta` | `src/modules/whatsapp/fila.ts`, `vercel.json` |
| `config/client.ts` está configurado como **"CRM Autus", vertical automotivo** | leitura do arquivo |
| `RodrigoLR1/CRM` **não tem arquivo de licença** | listagem da raiz |

### A base, resumida

Next.js 16 / React 19 / Prisma 7 / Postgres / Auth.js v5 / Tailwind 4 / shadcn.
Separação deliberada `src/core/` (núcleo) vs `src/modules/` (opcionais, ligados
por `config/client.ts`, com `exigirModulo()` devolvendo 404 na rota — não só
escondendo do menu).

Já funcionando: leads, funil kanban, contatos, tarefas, usuários e papéis,
notificações, auditoria, rate limit, e um módulo `whatsapp` completo com gateway
Evolution, webhook, fila, ingest idempotente, agente de IA (OpenAI), inbox de
conversas, pausar/retomar IA e responder como humano. Suíte vitest + playwright.

O `AGENTS.md` da base impõe auditoria de segurança antes de integrar qualquer
branch. **Essa regra é herdada e vale para todos os ciclos deste documento.**

## 3. Decisões travadas

Cada uma foi decidida explicitamente. Reabrir qualquer uma delas invalida os
ciclos que dependem dela.

1. **Utmify fora de escopo.** Rastreamento de UTM, integração com plataformas de
   anúncio, taxas, despesas e ROI não fazem parte deste programa.
2. **Multi-empresa por baixo, UI de empresa única.** `companyId` em todo modelo e
   RLS ligado desde o Ciclo 1; a interface continua servindo uma empresa só.
3. **n8n: painel via API + editor em iframe.** As duas coisas, com o painel como
   base de sustentação se o iframe falhar.
4. **Evolution: conexões com QR Code pelo CRM.** Criar instância, exibir QR,
   acompanhar pareamento, ver status, desconectar, apagar.
5. **Tempo real: Supabase Realtime.** Assinatura de mudanças da tabela direto do
   navegador, com RLS como a trava do canal.
6. **Hospedagem: Vercel agora.** O runtime continua sendo Vercel Queues; o que
   muda no Ciclo 0 é que `@vercel/queue` deixa de ser importado direto e passa a
   ser **um adaptador atrás de uma interface**, para a VPS continuar sendo uma
   opção barata depois. Nada de comportamento muda.
7. **Cópia do repositório: histórico completo, sem vínculo de fork.**
   Só `main` + tags. As branches de feature em aberto **não** são copiadas.
8. **Identidade do produto: em aberto.** `config/client.ts` fica genérico. Isto é
   uma decisão adiada de propósito, não um esquecimento — ver a seção 5 para os
   valores concretos, porque o schema Zod não aceita "vazio".

### Nota de licença

`RodrigoLR1/CRM` não tem `LICENSE`, o que por padrão significa "todos os
direitos reservados". A cópia prossegue por decisão do dono do projeto, que
declarou ter direito sobre o código. Registrado aqui para não ser descoberto
depois como surpresa.

## 4. Arquitetura do programa

### Os ciclos

| Ciclo | Entrega | Depende de |
| --- | --- | --- |
| **0 — Fundação** | Repo copiado, Supabase migrado, app subindo, testes verdes, fila neutra | — |
| **4 — Fluxos n8n** | Painel via API + editor em iframe | 0 |
| **1a — Tenancy** | `Company`, `Membership`, `companyId`, papel no vínculo, escopo obrigatório de query | 0 |
| **1b — JWT e isolamento** | Emissão do JWT do Supabase pelo Auth.js, testes de isolamento entre empresas | 1a |
| **1c — Config no banco** | Entidade, funil e marca saem de `config/client.ts` para tabela por empresa | 1a |
| **2 — Conexões** | Tela de Conexões: Evolution (QR) **e WhatsApp oficial (Meta Cloud API)**, ciclo de vida, webhook por conexão | 1 |
| **3 — Chat ao vivo** | Realtime na thread e na inbox | 1, melhor depois de 2 |

### Ordem de execução: 0 → 4 → 1a → 1b → 1c → 2 → 3

O Ciclo 1 foi decomposto em 2026-08-19, depois de medir o tamanho real do
que as decisões dele implicavam: 26 chamadas a `hasPermission`, 25 arquivos
tocando `.papel`, 14 importando `config/client`. Três subsistemas
independentes num ciclo só, e o mais arriscado deles — mover o papel é
refatoração de autorização, e errar não dá erro de compilação, dá permissão
errada em silêncio — merece revisão própria.

O Ciclo 4 é o único totalmente independente dos outros e o mais visível, então
sobe cedo sem custar dívida a ninguém.

O Ciclo 1 vem **antes** do 2 e do 3 porque acrescentar `companyId` a `Connection`
e a `WhatsappMessage` depois que elas existirem com dados dentro é exatamente a
migração dolorosa que a decisão 2 existe para evitar.

O RLS fica **no Ciclo 1**, não empurrado para o 3. Ele é a única coisa entre a
chave anônima no navegador e os dados de todas as empresas; escrito às pressas no
ciclo que precisa dele, com tabelas já povoadas, é onde essa classe de falha
nasce.

### As quatro costuras entre ciclos

**RLS não protege o caminho do Prisma.** O Prisma conecta pelo pooler com um
papel que ignora políticas de linha. Portanto o isolamento por empresa é
**duas** defesas independentes, não uma: no caminho Prisma, uma camada de query
em `src/core/` que injeta o escopo obrigatoriamente; no caminho do navegador
(Supabase Realtime), o RLS de verdade. Ciclo 1 entrega as duas.

**Auth.js não emite JWT do Supabase.** O login é cookie do Auth.js v5; o
Realtime com RLS espera um JWT que o Supabase reconheça. A documentação do
Supabase suporta isto pela opção `accessToken` do `createClient` e por
`realtime.setAuth(jwt)`. O CRM emite um JWT de vida curta, assinado com o segredo
do projeto, com `role: "authenticated"`, `sub` e `company_id`; as políticas leem
`auth.jwt() ->> 'company_id'`. O caminho de "third-party auth provider"
registrado exige JWT assimétrico com OIDC discovery, que o Auth.js não expõe —
descartado.

**O CSP atual bloqueia os Ciclos 3 e 4.** `connect-src 'self'` impede o
websocket do Realtime; a ausência de `frame-src` impede o iframe do n8n. Cada
ciclo abre a sua diretiva, a mínima necessária, e nenhum dos dois toca em
`script-src`.

**A base já é blindada contra exatamente o que o Ciclo 3 precisa fazer.** Três
migrations existentes fecham o caminho `anon`/`authenticated` de propósito, cada
uma com o raciocínio e a medição escritos no próprio arquivo:

- `20260730212500_enable_rls_and_revoke_anon_grants` — RLS ligada **sem nenhuma
  política** (default-deny) em todas as tabelas, mais `REVOKE ALL ... FROM anon,
  authenticated`. Duas camadas independentes, e o comentário explica que a
  segunda existe para o caso de a primeira ser desligada por acidente
- `20260802000000_revoke_default_privileges_future_tables` e
  `20260813180000_blindar_privilegios_padrao` — `ALTER DEFAULT PRIVILEGES`, para
  que **tabela futura já nasça sem grant**. A medição em `pg_default_acl` que
  motivou isso está no comentário: toda tabela criada pelo papel das migrações
  nascia com privilégio total para `anon` e `authenticated`
- `tests/e2e/banco-blindado.spec.ts` — um teste que **falha** se isso regredir,
  porque RLS não tem equivalente declarativo no Postgres

O Ciclo 3 precisa de `SELECT` para `authenticated` na tabela de mensagens, ou o
Realtime não entrega nada ao navegador. Isso **não é contornar a blindagem, é
abrir uma exceção nomeada dentro dela**, e a forma é obrigatória:

1. grant de **`SELECT` apenas**, em **uma tabela apenas** — nunca `ALL`, nunca no
   schema
2. uma política RLS de verdade na mesma migração, filtrando por
   `auth.jwt() ->> 'company_id'` — grant sem política reabre o buraco inteiro
3. `banco-blindado.spec.ts` **atualizado para afirmar essa exceção exata**, não
   afrouxado nem deletado. Se o teste virar permissivo, a blindagem deixou de
   ser verificada e ninguém vai perceber

Descartar essa blindagem por conveniência anularia o motivo de o RLS estar no
Ciclo 1.

### Ciclo 2 acrescentado: WhatsApp oficial ao lado da Evolution

Pedido do dono em 2026-08-19, depois do Ciclo 4: além das instâncias da
Evolution, o CRM precisa conectar o **WhatsApp oficial (Meta Cloud API)**, e o
chat ao vivo tem que funcionar igual nos dois.

**A base já foi desenhada para isso**, e isso muda o tamanho do trabalho. A
interface `WhatsappGateway` (`src/modules/whatsapp/gateway/tipos.ts:34`) diz,
por escrito, que um adapter da Meta Cloud API implementa **a mesma interface,
sem tocar em `ingest.ts`, `turno.ts` nem nas rotas**. Não é reescrita; é um
segundo adapter ao lado de `evolution.ts`.

Três diferenças concretas que o Ciclo 2 vai ter que absorver, e que o
comentário de `verificarOrigem` (`gateway/tipos.ts:52`) já antecipa:

1. **Autenticidade do webhook é outra.** A Evolution self-hosted não assina
   nada — a defesa é o token imprevisível no path mais a conferência do campo
   `instance`. A Cloud API faz handshake `hub.challenge` na assinatura e assina
   cada entrega com `X-Hub-Signature-256` (HMAC sobre o corpo **cru**). Por isso
   `verificarOrigem` recebe o corpo já parseado e a rota decide como lê-lo:
   a Cloud API precisa do corpo cru para conferir o HMAC.
2. **Não existe QR Code.** O pareamento da Evolution é escanear um código; o da
   Cloud API é cadastro no Meta Business, número verificado e token de acesso.
   A tela de Conexões precisa de **dois fluxos de conexão diferentes**, não de
   um só com um campo a mais.
3. **Janela de 24h e templates.** A Cloud API só permite mensagem livre dentro
   de 24h da última mensagem do cliente; fora disso, só template aprovado pela
   Meta. A Evolution não tem essa restrição. Isso afeta o chat ao vivo do
   Ciclo 3 diretamente: o campo de resposta precisa saber se a janela está
   aberta, e dizer isso a quem está atendendo — em vez de deixar a mensagem
   falhar no envio sem explicação.

O modelo `Connection` do Ciclo 2 nasce, portanto, com um discriminador de
provedor, e a tela de Conexões com dois caminhos. O resto do módulo continua
conhecendo só a interface.

### Dívida declarada: configuração de cliente em arquivo

`config/client.ts` é versionado e lido em tempo de build. Ele carrega o nome do
produto, o funil padrão e a **entidade do negócio** (hoje "Veículo", com
marca/modelo/ano/km/câmbio). Isso serve perfeitamente ao modelo original — um
fork por cliente — e é **incompatível com multi-empresa**: duas empresas no mesmo
banco não podem ter entidades diferentes se a entidade mora num arquivo do
repositório.

O Ciclo 1 move essa configuração de arquivo para tabela. Está registrado aqui,
antes do Ciclo 0 fechar, para não ser descoberto como surpresa no meio do 1.

### Fronteira de licenciamento do n8n

Das docs oficiais: embutir a **UI** do n8n exige um acordo OEM separado, com
marca n8n obrigatória; usar o n8n como **backend** (webhook/API) não exige acordo
nenhum. O SSO de iframe (`N8N_EMBED_LOGIN_ENABLED`, token exchange) exige licença
Enterprise, o feature flag `N8N_ENV_FEAT_TOKEN_EXCHANGE` e par de chaves RSA/EC.

Enquanto o n8necrm for a sua empresa usando a sua instância, é uso interno. **A
linha do OEM é cruzada no dia em que o multi-empresa virar SaaS com clientes
pagantes vendo o editor.** O Ciclo 4 é construído de forma que o painel por API
(que não tem essa questão) continue de pé sozinho se o iframe precisar sair.

## 5. Ciclo 0 — Fundação

### Objetivo

A base de outro projeto vira este projeto e roda. Nenhuma feature nova.

### Escopo

**1. Cópia do repositório.** Clone bare da origem, push de `main` e tags para
`nathanfvidal/n8necrm`. Sem relação de fork no GitHub. Clone de trabalho no
diretório do projeto. As branches de feature em aberto da origem
(`feat/crud-etapas-do-funil`, `feat/funil-ordem-e-exclusao`,
`feat/painel-menos-idas-ao-banco`, `feature/conversa-aguardando-humano`) ficam
para trás — decisão 7.

**2. Identidade.** `package.json` `name` de `crm-geral` para `n8necrm`;
`README.md` (hoje 5 bytes) escrito; `CLAUDE.md` do projeto (hoje 12 bytes)
escrito com stack, skills aplicáveis e as oito decisões travadas da seção 3,
incluindo a de identidade em aberto.

`config/client.ts` genérico — e **genérico aqui tem valores concretos**, porque
`clientConfigSchema` roda de verdade sobre este arquivo (`parse`, não anotação de
tipo) e recusa vazio:

- `vertical: "generico"`, `nome: "n8necrm"`
- `entidade: { singular: "Item", plural: "Itens", campos: [] }` — o schema exige
  os três campos; `campos` pode ser lista vazia, `singular`/`plural` não podem
- `marca.corPrimaria` precisa de um hex com croma acima do piso: cinza é
  **recusado** pelo schema, com a mensagem de que o white-label para de funcionar
  em silêncio. Escolher uma cor de verdade, não um placeholder neutro
- `marca.fonte` só aceita `Geist`, `Inter`, `Manrope` ou `IBM Plex Sans` (lista
  fechada por causa do `font-src 'self'` do CSP)
- `marca.logo` é opcional — sem arquivo, o painel mostra o nome em texto
- `modulos: ["whatsapp"]` no Ciclo 0. O enum do schema **já inclui
  `"automation"`**, que é onde o módulo de fluxos do n8n entra no Ciclo 4 — não
  há enum novo a criar

**3. Banco.** Projeto `uzumzfxjcxrbxaucvfsr`. `DATABASE_URL` no pooler de
transação (`:6543`), `DIRECT_URL` no de sessão (`:5432`) — o `.env.example` da
base documenta por que os dois, incluindo o modo de falha em que
`prisma migrate` fica pendurado sem imprimir nada. Depois: `prisma migrate
deploy` e `npx prisma db seed` (o seed real, declarado em `prisma.config.ts`).
`npm run seed:demo` é outra coisa — dados de demonstração — e **não** roda no
Ciclo 0.

**4. Fila neutra.** `@vercel/queue` sai de `src/modules/whatsapp/fila.ts` e entra
uma interface com um adaptador Vercel. O arquivo já foi escrito como wrapper fino
prevendo esta troca. `vercel.json` e a rota consumidora continuam como estão — o
adaptador Vercel é o que roda hoje. O ganho é que trocar para pg-boss ou BullMQ
depois passa a ser escrever um segundo adaptador, não reescrever o módulo.

**5. Segredos.** `AUTH_SECRET`, service role do Supabase, `OPENAI_API_KEY`,
`EVOLUTION_DOMAIN` / `EVOLUTION_INSTANCE` / `EVOLUTION_APIKEY`,
`WHATSAPP_WEBHOOK_TOKEN`, `WHATSAPP_QUEUE_SECRET`, `E2E_SENHA`. Nenhum valor
entra no repositório; `.env.example` ganha as variáveis novas com a mesma
qualidade de comentário que as existentes.

### Fora de escopo, de propósito

Nenhum `companyId`. Nenhum RLS. Nenhuma mudança no módulo `whatsapp` além da
troca de fila. Nenhuma tela nova. Nenhum deploy em produção.

### Critérios de aceite

O ciclo só fecha com as **saídas coladas** no relatório, não com afirmação de
que deve funcionar:

- `npm run typecheck` sem erro
- `npm test` verde
- `npm run build` conclui
- `npm run dev` sobe e o login com um usuário do seed funciona no navegador
- `nathanfvidal/n8necrm` tem o histórico da `main` da origem
- O schema do Supabase `uzumzfxjcxrbxaucvfsr` tem as tabelas do Prisma

### Riscos e itens a verificar antes de começar

Nenhum destes bloqueia o desenho, mas todos bloqueiam a execução:

- **API key da Evolution.** A URL e a versão estão confirmadas; a chave, não.
  Sem ela o módulo `whatsapp` sobe mas não envia.
- **Segredo JWT do Supabase.** O Ciclo 1 depende de assinar JWT com o segredo do
  projeto. Projetos migrados para chaves assimétricas mudam esse caminho.
  Verificar no painel antes do Ciclo 1, não do 0.
- **Chave da API do n8n para o CRM.** O n8n responde à API, mas o CRM precisa da
  sua própria chave. Bloqueia o Ciclo 4, não o 0.
- **Projeto na Vercel.** Precisa existir para o deploy; não bloqueia o dev local.
- **Contas de teste E2E.** `E2E_SENHA` é obrigatória e a suíte falha alto sem
  ela, de propósito — a base documenta que um fork novo não deve nascer com
  conta de teste ativa no banco do cliente.

## 6. O que vem depois

Ciclo 4 (Fluxos n8n) recebe o próximo spec. Os pontos que já sabemos que ele
precisa resolver, para não serem redescobertos:

- Remover `X-Frame-Options: SAMEORIGIN` do nginx da VPS e trocar por
  `Content-Security-Policy: frame-ancestors` listando a origem do CRM. **Essa
  origem ainda não existe** — depende do domínio que o projeto na Vercel receber,
  que é um dos itens em aberto da seção 5. O Ciclo 4 não pode começar antes dela
  estar definida, porque `frame-ancestors` sem origem concreta não protege nada
- `N8N_SAMESITE_COOKIE=none` (o HTTPS já existe) para o cookie sobreviver ao
  iframe de outra origem
- `frame-src https://n8n.nateksoft.com` no CSP do CRM
- Sem SSO: o time loga no n8n uma vez, dentro do iframe, na tela do próprio n8n
- O painel por API entrega o que o iframe não entrega: lista, status, execuções
  e disparo de teste dentro do CRM
