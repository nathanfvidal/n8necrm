import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Fronteira arquitetural: src/core não pode importar de src/modules.
// Este é um projeto clonado por cliente — core é compartilhado por todos os
// forks, modules contém funcionalidades opcionais. Um import de core para
// modules quebra a possibilidade de desligar o módulo e de aplicar patches
// de core entre forks. Ver spec seção 3.3.
//
// Extraído para uma constante porque `no-restricted-imports` NÃO se acumula
// entre blocos do flat config: o último bloco que casa com o arquivo
// SUBSTITUI a configuração da regra inteira. As exceções de prisma mais
// abaixo precisam re-declarar esta fronteira, ou os arquivos listados lá
// perderiam a proteção de core↛modules sem ninguém perceber.
const FRONTEIRA_CORE_MODULES = {
  group: ["@/modules", "@/modules/*", "**/modules", "**/modules/*"],
  message: "src/core não pode importar de src/modules — ver spec seção 3.3",
};

// O prisma cru ignora o escopo por empresa. `prismaDaEmpresa(companyId)`
// (`src/core/tenancy/escopo.ts`) injeta `where.companyId`/`data.companyId` nas
// operações onde a injeção é sólida e LANÇA nas que não são escopáveis. Quem
// importa `@/lib/prisma` direto pula as duas coisas.
//
// O padrão é largo pelo mesmo motivo que o de modules: pegar tanto o alias
// (`@/lib/prisma`) quanto qualquer caminho relativo que chegue no mesmo
// arquivo (`../lib/prisma`, `../../lib/prisma`). Medido em 2026-08-20, todo
// import atual usa o alias — o padrão relativo está aqui para o dia em que
// alguém contorne, não porque exista hoje.
const PRISMA_CRU = {
  group: ["@/lib/prisma", "**/lib/prisma"],
  message:
    "Não importe o prisma cru aqui — ele ignora o escopo por empresa. " +
    "Use `prismaDaEmpresa(companyId)` de `@/core/tenancy/escopo`, com o " +
    "`companyId` vindo de `UsuarioAtivo` (`@/core/auth/usuario-ativo`). " +
    "Se este arquivo realmente não puder ser escopado, acrescente-o à " +
    "exceção NOMEADA em eslint.config.mjs, com o motivo.",
};

// A exceção TEMPORÁRIA. Estes arquivos importam o prisma cru hoje porque
// aplicar o escopo em todos os serviços é o próximo ciclo — o Ciclo 1a
// entrega o mecanismo, não a migração dos chamadores.
//
// São 22 (17 em core, 5 em modules), medidos em 2026-08-20 com
// `grep -rln 'from "@/lib/prisma"' src/core src/modules`. O próximo ciclo os
// remove um a um, e o tamanho desta lista é o contador de quanto falta:
// quando ela esvaziar, os dois blocos somem junto. Exceção nomeada conta;
// disciplina não conta nada.
const VIOLADORES_TEMPORARIOS_CORE = [
  "src/core/audit/alerta.ts",
  "src/core/audit/log.ts",
  "src/core/auth/credenciais.ts",
  "src/core/contacts/queries.ts",
  "src/core/contacts/service.ts",
  "src/core/leads/dedupe.ts",
  "src/core/leads/notes.ts",
  "src/core/leads/queries.ts",
  "src/core/leads/service.ts",
  "src/core/notifications/dispatch.ts",
  "src/core/pipeline/service.ts",
  "src/core/pipeline/stages.ts",
  "src/core/tasks/queries.ts",
  "src/core/tasks/service.ts",
  // `users/empresa.ts` está aqui, e NÃO na exceção permanente, de propósito.
  // Ele resolve `companyIdDoUsuario(usuarioId)` lendo `Membership`, o que o
  // faz parecer parente de `auth/session.ts` — mas o próprio arquivo se
  // documenta como PONTE que desaparece quando os chamadores passarem
  // `UsuarioAtivo.companyId` explícito. Exceção permanente sobreviveria ao
  // arquivo e viraria mentira no dia em que ele fosse apagado.
  "src/core/users/empresa.ts",
  "src/core/users/queries.ts",
  "src/core/users/service.ts",
];

const VIOLADORES_TEMPORARIOS_MODULES = [
  "src/modules/whatsapp/agente.ts",
  "src/modules/whatsapp/ingest.ts",
  "src/modules/whatsapp/notificacoes.ts",
  "src/modules/whatsapp/queries.ts",
  "src/modules/whatsapp/turno.ts",
];

// A exceção PERMANENTE. Nada aqui vai para o cliente escopado, nunca:
//
// - `core/auth/session.ts` resolve QUEM é a pessoa. O escopo é derivado do
//   vínculo dela; exigir escopo aqui é circular.
// - `core/rate-limit/limiter.ts` opera em `RateLimit`, tabela sem
//   `companyId` (confirmado em prisma/schema.prisma): é defesa global,
//   consultada antes de existir sessão e portanto antes de existir empresa.
// - `core/tenancy/escopo.ts` É o cliente escopado. É o único arquivo cujo
//   import do prisma cru é o ponto.
const EXCECAO_PERMANENTE = [
  "src/core/auth/session.ts",
  "src/core/rate-limit/limiter.ts",
  "src/core/tenancy/escopo.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `Bots/` é material de referência colocado ali de propósito: fluxos do
    // n8n que rodam em produção e worktrees de OUTROS projetos, com stack e
    // convenções próprias (`require()`, JSX solto, scripts `.cjs`). Sem esta
    // linha o eslint varre tudo aquilo e `npm run lint` sai com 30 erros que
    // nenhum deles é deste projeto — o portão nunca fica verde, e um portão
    // que nunca fica verde deixa de ser lido. Nada em `Bots/` é compilado,
    // importado ou publicado por este CRM.
    "Bots/**",
    // Mesma história, outra pasta: material de referência do desenvolvedor
    // largado na raiz do projeto. `Skills Claude/` são skills do Claude Code
    // exportadas do ambiente local (já instaladas em `~/.claude/skills`), e os
    // exemplos que vêm dentro delas rendem 17 erros de lint e 99 de
    // TypeScript — nenhum deste CRM. Estar no `.gitignore` não basta: nem o
    // eslint nem o `tsc` leem o `.gitignore`, então a exclusão precisa ser
    // dita nos dois lugares (aqui e em `tsconfig.json#exclude`).
    "Skills Claude/**",
  ]),
  // src/core: fronteira core↛modules + proibição do prisma cru.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [FRONTEIRA_CORE_MODULES, PRISMA_CRU] },
      ],
    },
  },
  // src/modules: só a proibição do prisma cru. A fronteira core↛modules não
  // se aplica na direção contrária — modules PODE importar de core, é o
  // sentido permitido.
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [PRISMA_CRU] }],
    },
  },
  // As exceções. Cada bloco RE-DECLARA o que continua valendo para aqueles
  // arquivos, porque o flat config substitui a configuração da regra inteira
  // em vez de mesclá-la.
  {
    files: [...VIOLADORES_TEMPORARIOS_CORE, ...EXCECAO_PERMANENTE],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [FRONTEIRA_CORE_MODULES] },
      ],
    },
  },
  {
    files: VIOLADORES_TEMPORARIOS_MODULES,
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
