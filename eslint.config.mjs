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
