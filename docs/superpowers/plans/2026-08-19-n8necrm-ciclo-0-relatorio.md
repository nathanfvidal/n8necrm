# Ciclo 0 — Relatório de fechamento

Data: 2026-08-19 (atualizado na revisão final do branch, mesma data)
Branch: `ciclo-0-fundacao`
HEAD na hora da Task 5 (portão de verificação): `7589219` — "fix: corrigir
`npx prisma db seed` quebrado por import "server-only""
HEAD na hora desta atualização: `e8d18af` — "docs: polimento -- comentário
vencido, consistência de fila e comando faltante" (mais os commits que
corrigem os achados desta seção, na sequência imediatamente após este). O
HEAD original (`7589219`) era anterior aos commits de remediação do
incidente de segurança descrito abaixo — este documento estava, até esta
atualização, fechando o ciclo sem registrar esse incidente.

Este documento fecha o Ciclo 0 (fundação) do programa n8necrm e registra o que
fica **pendente e bloqueando** os ciclos seguintes. Os seis critérios de
aceite do spec foram conferidos um a um na Task 5 (portão de verificação) —
evidência completa (comando + saída de cada critério) na seção "Evidência dos
portões" abaixo, para que um clone novo do repositório consiga conferir tudo
sem depender de `.superpowers/sdd/task-5-report.md` (esse diretório está no
`.gitignore` e não existe fora de quem rodou a Task 5 localmente).

## Resumo dos portões

| Portão | Resultado |
|---|---|
| `npm run typecheck` | Sem erro |
| `npm test` | 94 arquivos passaram, 1 pulado por escolha de design (ver abaixo) — 923 testes passaram, 13 pulados, 0 falharam |
| `npm run build` | Concluiu, 17 rotas geradas |
| `npm run dev` + login | Login funcionou com `admin@exemplo.com` (seed), painel carregou com dados reais do seed |
| Histórico de `main` herdado em `nathanfvidal/n8necrm` | Confirmado: `origin/main` é ancestral do HEAD da branch |
| Schema do Supabase com as tabelas do Prisma | Confirmado: 12 tabelas em `public`, 1:1 com os 12 `model` do `schema.prisma`, migrations em dia |

## Evidência dos portões (Task 5)

Trazido para dentro deste documento versionado (antes só existia em
`.superpowers/sdd/task-5-report.md`, gitignorado — inacessível num clone
novo). Regra seguida: comando executado + saída obtida.

**Typecheck** — `npm run typecheck` (`tsc --noEmit`): saída vazia, código de
saída 0.

**Suíte unitária** — `npm test` (`vitest run`): `Test Files 94 passed | 1
skipped (95)` · `Tests 923 passed | 13 skipped (936)`. Comparado contra a
Task 2 (rodada sem `.env`, antes de a Task 4 entregar os segredos): 66 → 94
arquivos coletando e passando (+28), 677 → 923 testes passados (+246). Os 28
arquivos que não coletavam nenhum teste sem `.env` agora coletam e passam
integralmente (`numFailedTestSuites: 0`). O único arquivo pulado por
completo é `tests/unit/seed-demo.test.ts` (13 testes `pending`) —
`describe.skipIf(!funilEhOSemeado)` (linha 91 do arquivo) checa se o funil
tem exatamente 5 etapas terminando em `ehGanho: true`; o funil desta
identidade tem 4. Skip legítimo por condição de dados, documentado no
próprio arquivo, não uma falha.

**Build de produção** — `npm run build` (`next build`): concluiu com
sucesso, 17 rotas geradas (16 dinâmicas + `/_not-found` estática). Único
aviso, informativo: `[QueueClient] Region not detected` (a região é
injetada pela Vercel via `VERCEL_REGION` em produção).

**Dev + login** — `npm run dev` subiu em `http://localhost:3000` (`Ready in
952ms`). Login via Playwright com `admin@exemplo.com` e a senha padrão do
seed (não impressa, por instrução da task): URL mudou de `/login` para `/`
após ~3s, painel carregou com sidebar "n8necrm", usuário "Admin Exemplo" e
dados reais do seed (4 leads, cartões "Novo: 4 / Em contato: 0 / Proposta: 0
/ Fechado: 0", taxa de conversão 0%). Achado não bloqueante: o overlay de dev
do Next 16 sinalizou 1 issue conhecida de `next-themes` (script inline para
evitar flash de tema), sem impacto no login nem no carregamento.

**Histórico de `main` herdado** —

```
$ git fetch origin main
$ git merge-base --is-ancestor origin/main HEAD && echo SIM
SIM
```

`origin/main` (`1fea1fc`) é ancestral do HEAD da branch.

**Schema do Supabase** —

```
$ npx prisma migrate status
14 migrations found in prisma/migrations
Database schema is up to date!
```

Confirmado de forma independente via `list_tables` (MCP do Supabase) no
projeto `uzumzfxjcxrbxaucvfsr`, schema `public`: `User, Contact,
PipelineStage, Lead, LeadNote, Task, Notification, AuditLog, RateLimit,
Conversation, WhatsappMessage, BotConfig` (+ `_prisma_migrations`) — 12
tabelas, 1:1 com os 12 `model` de `prisma/schema.prisma`.

## Incidente de segurança: conta ADMIN com senha pública

Descoberto depois deste portão de verificação, antes do fechamento do ciclo:
o seed criou `admin@exemplo.com` (papel ADMIN) com a senha padrão
`"senha123"` — literal público em `prisma/seed.ts` — porque `SEED_PASSWORD`
(o mecanismo que evita isso) não estava documentada em `.env.example` na
hora de montar o `.env` deste ciclo. A senha foi rotacionada e a rotação foi
verificada (`bcrypt.compare` da senha nova → `true`, de `"senha123"` →
`false`, para ADMIN e VENDEDOR). A remediação inicial (documentar
`SEED_PASSWORD` em `.env.example`) introduziu um segundo defeito
(`SEED_PASSWORD=""`, uma variável definida com string vazia, não ausente),
já corrigido.

Relato completo — causa raiz, procedimento de remediação e de verificação,
sem expor a senha em momento nenhum — em
`docs/auditorias/2026-08-19-ciclo-0-fundacao.md`.

## Pendências que bloqueiam os ciclos seguintes

### 1. Chave da API do n8n — bloqueia o Ciclo 4

Não existe nenhuma variável de ambiente relacionada a n8n em `.env.example`
nem em `.env` (`grep -c "^N8N" .env .env.example` → 0 em ambos). O módulo
`automation` já está previsto no enum de `modulos` de
`config/client.schema.ts` (comentário em `config/client.ts` linha 33-35), mas
não há client, credencial nem endpoint de integração implementados.

**O que destrava:** o dono do projeto precisa gerar uma API key na instância
n8n (self-hosted ou cloud) que vai servir o CRM, decidir o nome da variável
(`N8N_API_URL`/`N8N_API_KEY` ou equivalente) e entregá-la do mesmo jeito que
entregou os segredos do Supabase na Task 4.

### 2. Domínio do projeto na Vercel — bloqueia o `frame-ancestors` do Ciclo 4

Não há projeto Vercel linkado localmente (`.vercel/` não existe,
`vercel.json` presente mas sem binding de projeto). O CSP atual em
`src/proxy.ts` (linha 136) está com `frame-ancestors 'none'` — ninguém pode
embutir o painel em iframe, o que é a postura correta *enquanto* não há
decisão sobre embutir o CRM em outro produto (o caso de uso do Ciclo 4, que
motiva abrir o `frame-ancestors` para um domínio específico).

**O que destrava:** decidir e comunicar (a) o domínio de produção definitivo
na Vercel e (b) se algum outro domínio precisa embutir o painel via iframe —
sem isso, `frame-ancestors` não tem para onde abrir com segurança.

### 3. Segredo JWT do Supabase (legado simétrico vs. moderno assimétrico) — bloqueia o Ciclo 1

Verificado via `mcp__claude_ai_Supabase__get_publishable_keys` no projeto
`uzumzfxjcxrbxaucvfsr`: o projeto tem **duas** chaves ativas —

- uma chave `anon` **legada**, tipo `legacy`, formato JWT completo com header
  `alg: HS256` (assinatura simétrica — o segredo que assina é compartilhado
  entre quem assina e quem verifica), `disabled: false`;
- uma chave `publishable` **moderna**, formato `sb_publishable_...` (não é
  JWT, é uma chave opaca do sistema novo de API keys do Supabase).

**Achado concreto:** o projeto está rodando com o sistema de chaves **legado
(simétrico) ainda ativo**, não migrado para o esquema assimétrico novo. Isto
não é presunção — é o que o `type: "legacy"` e o header `HS256` decodificado
da própria chave `anon` mostram.

O que este ambiente **não permite provar**: o valor do segredo JWT em si
(`SUPABASE_JWT_SECRET`, usado para assinar/verificar tokens fora do SDK
oficial) não é exposto por nenhuma ferramenta MCP disponível aqui — só as
chaves publicáveis (`anon`/`publishable`), que são desenhadas para serem
públicas. Se o Ciclo 1 precisar verificar JWTs do Supabase manualmente (fora
do `supabase-js`), alguém com acesso ao painel precisa copiar o valor em
**Project Settings → API → JWT Settings** e decidir explicitamente se
migra para o par de chaves assimétrico antes de construir sobre o legado.

**Comando que um humano precisa rodar/decidir:** abrir o painel do Supabase
(`https://supabase.com/dashboard/project/uzumzfxjcxrbxaucvfsr/settings/api`),
copiar `JWT Secret` de **Legacy JWT Secret**, e decidir se o Ciclo 1 migra
para "JWT Signing Keys" (assimétrico) antes de depender do legado.

### 4. Suíte E2E (`npm run test:e2e`) — não rodada, por instrução explícita do controlador

**Não foi executada nesta tarefa.** Não por falta de configuração: a
variável `E2E_SENHA` **já está presente e preenchida em `.env`**, verificado
por comprimento sem imprimir o valor durante a Task 5 (sessão local, não
reproduzido nesta atualização do relatório — esta revisão final teve
instrução explícita de nunca ler o `.env` real). Então o bloqueio de
infraestrutura que
impediria a suíte de rodar (`tests/e2e/global-setup.ts` provisiona
`e2e-admin@teste.invalid`/`e2e-vendedor@teste.invalid` com essa senha) **não
existe mais**.

A suíte não rodou porque o brief da Task 5 instruiu explicitamente: *"Não
rode `npm run test:e2e`. Está fora do escopo desta tarefa; se você achar que
deveria rodar, registre isso como item pendente"*. Portanto isto é uma
decisão de escopo, não uma limitação técnica.

**Comando que um humano (ou uma próxima task) precisa rodar:**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run test:e2e
```

Atenção ao aviso já documentado em `.env.example` sobre a porta do Postgres:
a suíte E2E rodando em paralelo contra a porta 6543 (transaction pooler) já
reproduziu `(EMAXCONNSESSION) max clients reached in session mode` neste
projeto — não é um cenário hipotético.

## Achado da Task 5 que vale registrar aqui: `entidade.campos` é código morto

Não é uma pendência que bloqueia ciclo nenhum, mas é relevante para quem for
desenhar o Ciclo 1 (que mexe em identidade/entidade) e não deveria descobrir
isso de novo do zero: `client.entidade.campos` (a lista de campos
configuráveis da entidade genérica, hoje `titulo`/`valor`) **não tem nenhum
consumidor em `src/`**.

```
$ grep -rn "client\.entidade\|entidade\.campos\|entidade\.singular\|entidade\.plural" src/
(sem resultado)
```

Os candidatos óbvios foram inspecionados diretamente: `lead-form.tsx` não
referencia `client`/`entidade` (campos hard-coded); `export-leads.test.ts` e
`lead-actions.test.ts` não importam `config/client`; `listagem.test.ts`
importa a cadeia do Prisma mas também não referencia `client.entidade` em
lugar nenhum. O único lugar que lê `.campos` fora deste arquivo é
`tests/unit/client-config.test.ts:129`, que testa a validação do próprio
schema Zod — não um consumidor funcional. O próprio `prisma/schema.prisma`
(linhas 75-78) documenta a decisão: o caminho de campos configuráveis "foi
desenhado e descartado" em favor de colunas fixas no modelo `Lead`.

**Atualização desta revisão final:** o comentário em `config/client.ts` que
justificava os dois campos citando "testes e telas [que] iteram sobre
`client.entidade.campos`" foi corrigido — essa citação era a evidência
inventada que este próprio achado já tinha desmentido; a decisão de manter
dois campos continua válida, com a razão real (paridade de forma + exercício
da validação do schema).

## Referências

- Plano do Ciclo 0: `docs/superpowers/plans/2026-08-19-n8necrm-ciclo-0-fundacao.md`
- Auditoria de segurança deste ciclo, incluindo o incidente da senha do
  ADMIN: `docs/auditorias/2026-08-19-ciclo-0-fundacao.md`
- `.superpowers/sdd/task-{2,3,4,5}-report.md` guardam o log bruto e mais
  detalhado de cada task (comandos, saídas completas, screenshots) — **não
  versionados** (`.gitignore:4`, `.superpowers/`), então só existem em quem
  rodou o trabalho localmente. Toda evidência necessária para conferir os
  critérios de aceite e o incidente de segurança deste ciclo está embutida
  neste documento e em `docs/auditorias/`, não depende deles.
