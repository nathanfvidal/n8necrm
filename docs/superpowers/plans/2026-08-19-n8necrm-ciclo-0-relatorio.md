# Ciclo 0 — Relatório de fechamento

Data: 2026-08-19
Branch: `ciclo-0-fundacao`
HEAD na hora deste relatório: `7589219` — "fix: corrigir `npx prisma db seed` quebrado por import "server-only""

Este documento fecha o Ciclo 0 (fundação) do programa n8necrm e registra o que
fica **pendente e bloqueando** os ciclos seguintes. Os seis critérios de
aceite do spec foram conferidos um a um na Task 5 (portão de verificação);
ver `.superpowers/sdd/task-5-report.md` para o detalhe de cada comando e
saída.

## Resumo dos portões

| Portão | Resultado |
|---|---|
| `npm run typecheck` | Sem erro |
| `npm test` | 94 arquivos passaram, 1 pulado por escolha de design (ver abaixo) — 923 testes passaram, 13 pulados, 0 falharam |
| `npm run build` | Concluiu, 17 rotas geradas |
| `npm run dev` + login | Login funcionou com `admin@exemplo.com` (seed), painel carregou com dados reais do seed |
| Histórico de `main` herdado em `nathanfvidal/n8necrm` | Confirmado: `origin/main` é ancestral do HEAD da branch |
| Schema do Supabase com as tabelas do Prisma | Confirmado: 12 tabelas em `public`, 1:1 com os 12 `model` do `schema.prisma`, migrations em dia |

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
públicas. Se o Ciclo 1 precisar verificar JWTs do Supabase manualmine (fora
do `supabase-js`), alguém com acesso ao painel precisa copiar o valor em
**Project Settings → API → JWT Settings** e decidir explicitamente se
migra para o par de chaves assimétrico antes de construir sobre o legado.

**Comando que um humano precisa rodar/decidir:** abrir o painel do Supabase
(`https://supabase.com/dashboard/project/uzumzfxjcxrbxaucvfsr/settings/api`),
copiar `JWT Secret` de **Legacy JWT Secret**, e decidir se o Ciclo 1 migra
para "JWT Signing Keys" (assimétrico) antes de depender do legado.

### 4. Suíte E2E (`npm run test:e2e`) — não rodada, por instrução explícita do controlador

**Não foi executada nesta tarefa.** Não por falta de configuração: a
variável `E2E_SENHA` **já está presente e preenchida em `.env`** (32
caracteres, verificado por comprimento sem imprimir o valor — ver
`.superpowers/sdd/task-5-report.md`), então o bloqueio de infraestrutura que
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
consumidor em `src/`**. Grep confirmado em todo o repositório (fora
`config/client.ts` e `tests/unit/client-config.test.ts`, que testam só a
validação do schema) não encontra nenhuma leitura de `entidade.campos` — nem
no formulário de lead (`src/components/leads/lead-form.tsx`), nem no export
de leads, nem nos filtros de listagem. O próprio `prisma/schema.prisma`
(linhas 75-78) documenta a decisão: o caminho de campos configuráveis "foi
desenhado e descartado" em favor de colunas fixas no modelo `Lead`. Ver
`.superpowers/sdd/task-5-report.md`, Step 2, para o detalhe completo dessa
verificação.

## Referências

- Relatório de execução detalhado (todos os 7 steps, comandos e saídas):
  `.superpowers/sdd/task-5-report.md`
- Plano do Ciclo 0: `docs/superpowers/plans/2026-08-19-n8necrm-ciclo-0-fundacao.md`
- Relatórios das Tasks 1-4: `.superpowers/sdd/task-{2,3,4}-report.md`
