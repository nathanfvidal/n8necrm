import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// Auth.js v5 (beta) tipa `Session`, `User` e `JWT` com campos mínimos
// (id/name/email/image). O campo `role` é carregado a partir do usuário
// autenticado (ver src/lib/auth.ts) e é consumido por hasPermission()
// (src/core/auth/permissions.ts) em todas as camadas de autorização.
// Sem esta augmentation, `session.user.role` e `token.role` cairiam em
// `any`/erro de tipo — e o brief exige tipagem real, não `as any`.
declare module "next-auth" {
  interface Session {
    user: {
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

// A assinatura do callback `jwt` em @auth/core/index.d.ts importa o tipo
// `JWT` de "@auth/core/jwt" (não de "next-auth/jwt", que apenas faz
// `export * from "@auth/core/jwt"`). Augmentar somente "next-auth/jwt"
// não propaga para essa origem — o campo `token.role` continuava `unknown`
// em `tsc --noEmit`. Augmentando o módulo de origem resolve nas duas pontas.
declare module "@auth/core/jwt" {
  interface JWT {
    role: Role;
  }
}
