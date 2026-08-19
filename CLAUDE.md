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
4. **Evolution: conexões com QR Code pelo CRM**, multi-instância.
5. **Tempo real: Supabase Realtime**, com RLS como trava do canal.
6. **Hospedagem: Vercel.** A fila continua Vercel Queues; o que mudou no Ciclo 0
   é que ela virou adaptador atrás de uma interface.
7. **Cópia da base: histórico completo, sem vínculo de fork.** As branches de
   feature em aberto da origem não vieram.
8. **Identidade do produto: EM ABERTO.** `config/client.ts` está genérico de
   propósito. Isto é uma decisão adiada, não um esquecimento.

## Armadilhas conhecidas

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
