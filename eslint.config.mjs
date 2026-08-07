import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  // Fronteira arquitetural: src/core não pode importar de src/modules.
  // Este é um projeto clonado por cliente — core é compartilhado por todos os
  // forks, modules contém funcionalidades opcionais. Um import de core para
  // modules quebra a possibilidade de desligar o módulo e de aplicar patches
  // de core entre forks. Ver spec seção 3.3.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules", "@/modules/*", "**/modules", "**/modules/*"],
              message: "src/core não pode importar de src/modules — ver spec seção 3.3",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
