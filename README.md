# n8necrm

CRM de atendimento por WhatsApp com automação, derivado da base `RodrigoLR1/CRM`.

## Stack

Next.js 16 · React 19 · Prisma 7 · Postgres (Supabase) · Auth.js v5 · Tailwind 4 · shadcn · Zod 4 · Vitest · Playwright

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencher os valores — ver comentários no arquivo
npx prisma migrate deploy
# Antes do seed: gere e preencha SEED_PASSWORD em .env (openssl rand -base64 24).
# Sem ela, o admin nasce com a senha padrão do repositório — ver o comentário
# de SEED_PASSWORD em .env.example.
npx prisma db seed
npm run dev
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Suíte unitária (Vitest) |
| `npm run test:e2e` | Suíte end-to-end (Playwright) — exige `E2E_SENHA` |
| `npx prisma db seed` | Seed real (usuários, funil, config do bot) |

## Arquitetura

`src/core/` é o núcleo, sempre presente. `src/modules/` são módulos opcionais,
ligados por `config/client.ts` e barrados na rota por `exigirModulo()`, que
devolve 404 — módulo desligado não some só do menu.

## Documentação

Specs em `docs/superpowers/specs/`, planos em `docs/superpowers/plans/`,
auditorias em `docs/auditorias/`. O spec do programa atual é
`docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md`.
