import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 moveu a config de seed pra cá — o campo "prisma.seed" no
    // package.json (convenção do Prisma 5/6) não é mais lido pelo CLI
    // (`npx prisma db seed` avisa "No seed command configured" se só o
    // package.json tiver esse campo). Ver node_modules/@prisma/config/dist/index.d.ts
    // (MigrationsConfigShape.seed).
    //
    // `--conditions=react-server`: sem isto, `npx prisma db seed` (e o
    // README, que documenta esse comando) QUEBRA sempre, incondicionalmente.
    // `npm run dev` (`next dev`) e o deploy (`prisma migrate deploy`) não
    // rodam seed em momento nenhum, então esta flag não afeta nenhum dos
    // dois -- só quem invoca `npx prisma db seed` diretamente passa por
    // aqui. `prisma/seed.ts` importa
    // `src/lib/prisma.ts`, que começa com `import "server-only"` — esse
    // pacote lança na hora da resolução do módulo (não em runtime) sempre que
    // é carregado fora da condição de exportação "react-server" que o
    // bundler do Next.js aplica durante o build. Fora desse pipeline — que é
    // exatamente o caso de `tsx` rodando este script como processo Node
    // comum — o import lança antes de qualquer linha do seed rodar.
    // Confirmado isolando o problema num arquivo mínimo (só `import
    // "server-only"; console.log("ok")`): `npx tsx` puro lança, `npx tsx
    // --conditions=react-server` importa normalmente.
    //
    // A flag vai direto no comando do `tsx`, não em `NODE_OPTIONS`, porque
    // `NODE_OPTIONS=--conditions=react-server npx tsx ...` depende de
    // sintaxe de shell (`VAR=valor comando`) que não existe no `cmd` do
    // Windows — e este comando roda em qualquer máquina que clonar o repo,
    // não só na deste ambiente de desenvolvimento.
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    // Este arquivo é lido SÓ pelo CLI do Prisma (migrate, db push, studio,
    // generate). A aplicação em runtime não passa por aqui: ela monta o
    // próprio client em src/lib/prisma.ts a partir de `DATABASE_URL`.
    //
    // Por isso os dois usam conexões diferentes de propósito: a aplicação vai
    // pelo pooler em transaction mode (porta 6543), e a migração precisa de
    // uma conexão com SESSÃO (porta 5432), porque o motor de migração toma
    // advisory lock e guarda estado entre comandos — coisas que o transaction
    // mode não sustenta. Ver .env.example para o detalhe de cada URL.
    url: urlDeMigracao(),
  },
});

/**
 * Resolve a URL das migrações e avisa alto quando ela está errada.
 *
 * O aviso existe porque a falha silenciosa aqui é cruel: apontando as
 * migrações para a porta 6543, `prisma migrate` não dá erro — ele PENDURA,
 * sem imprimir nada. Quem estiver rodando conclui que o banco está lento, ou
 * que a rede caiu, e perde bastante tempo antes de suspeitar da porta.
 *
 * O fallback para `DATABASE_URL` é mantido para não quebrar o `prisma
 * generate` do `postinstall` em ambiente que não define `DIRECT_URL` (CI,
 * build da Vercel) — generate não abre conexão nenhuma, então ali o valor é
 * irrelevante.
 */
function urlDeMigracao(): string | undefined {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

  if (process.env.DIRECT_URL === undefined && url?.includes(":6543")) {
    console.warn(
      "\n[prisma] DIRECT_URL não definida e DATABASE_URL aponta para a porta 6543 " +
        "(pooler em transaction mode).\n" +
        "[prisma] Comandos de migração vão TRAVAR sem mensagem de erro.\n" +
        "[prisma] Defina DIRECT_URL com a conexão de porta 5432 (session pooler) — ver .env.example.\n"
    );
  }

  return url;
}
