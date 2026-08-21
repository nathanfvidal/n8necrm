// Testa o `matcher` de src/proxy.ts diretamente como regex — sem importar
// o módulo (que puxa `@/lib/auth`, dependência pesada de Auth.js) — mesmo
// espírito de login-page-guard.test.tsx, mas focado só na expressão
// regular que decide QUAIS paths o proxy intercepta.
//
// Existe por causa de um achado real durante a Fatia 1 do WhatsApp: o
// matcher original (antes de `api/whatsapp`/`api/queues` entrarem na lista
// de exceções) interceptava as duas rotas novas — confirmado rodando a
// regex contra os paths antes do fix. Sem a exceção, o proxy redirecionaria
// toda chamada da Evolution (sem sessão de usuário nenhuma) para `/login`,
// e o webhook nunca processaria mensagem alguma.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Extrai o literal do matcher direto do arquivo fonte, em vez de duplicar a
// string aqui — uma mudança futura no matcher real automaticamente
// atualiza o que este teste exercita, sem precisar lembrar de copiar de
// novo.
function extrairMatcher(): string {
  const conteudo = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "proxy.ts"),
    "utf-8"
  );
  const match = /matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(conteudo);
  if (!match) throw new Error("Não encontrei o array `matcher` em src/proxy.ts");
  return match[1]!.replace(/\\\\/g, "\\");
}

function interceptado(pathname: string): boolean {
  const regex = new RegExp(`^${extrairMatcher()}$`);
  return regex.test(pathname);
}

// `montarCsp` não é exportada por src/proxy.ts, e exportá-la só para este
// teste NÃO destravaria nada: qualquer import do módulo (mesmo só de tipo
// de função) arrasta `@/lib/auth`, que importa o barril de `next-auth`, que
// falha ao carregar sob Vitest — comprovado rodando um import isolado deste
// arquivo (`Cannot find module '.../node_modules/next/server' imported from
// next-auth/lib/env.js`), a mesma classe de problema já documentada em
// src/core/auth/credenciais.ts. Por isso este teste segue o mesmo espírito
// de `extrairMatcher()` acima: extrai o literal do array que monta o CSP
// direto do arquivo fonte e o executa isolado, sem importar o módulo. Uma
// mudança futura no array real atualiza este teste sozinha, sem precisar
// lembrar de copiar de novo.
function extrairMontarCsp(): (nonce: string, ehDev: boolean) => string {
  const conteudo = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "proxy.ts"),
    "utf-8"
  );
  const match = /return \[([\s\S]*?)\]\.join\("; "\);/.exec(conteudo);
  if (!match) throw new Error("Não encontrei o array que monta o CSP em src/proxy.ts");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- monta a
  // função a partir do próprio literal do array extraído do arquivo fonte
  // (não de input externo), só para testar o array sem importar `@/lib/auth`.
  return new Function("nonce", "ehDev", `return [${match[1]}].join("; ");`) as (
    nonce: string,
    ehDev: boolean
  ) => string;
}

describe("CSP de src/proxy.ts (montarCsp)", () => {
  it("o CSP permite embutir o n8n e continua proibindo embutir o CRM", () => {
    const montarCsp = extrairMontarCsp();
    const csp = montarCsp("nonce-de-teste", false);

    expect(csp).toContain("frame-src https://n8n.nateksoft.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self' 'nonce-nonce-de-teste' 'strict-dynamic'");
  });
});

describe("matcher de src/proxy.ts", () => {
  it("NÃO intercepta o webhook público do WhatsApp (Evolution não tem sessão de usuário)", () => {
    expect(interceptado("/api/whatsapp/evolution/token-imprevisivel-123")).toBe(false);
  });

  it("NÃO intercepta o consumidor da fila do WhatsApp (invocado pela Vercel, sem sessão)", () => {
    expect(interceptado("/api/queues/whatsapp-turn")).toBe(false);
  });

  it("NÃO intercepta api/auth (Auth.js precisa disso pro login funcionar)", () => {
    expect(interceptado("/api/auth/session")).toBe(false);
  });

  it(
    "AINDA intercepta um path que só começa parecido (âncora (?:/|$) obrigatória — mesma classe de " +
      "bug corrigida na Task 6): /api/whatsapp-debug e /api/queues-debug não são os endpoints reais",
    () => {
      expect(interceptado("/api/whatsapp-debug")).toBe(true);
      expect(interceptado("/api/queues-debug")).toBe(true);
      expect(interceptado("/api/whatsappXYZ")).toBe(true);
    }
  );

  it("continua interceptando rotas comuns do painel (protegidas por sessão)", () => {
    expect(interceptado("/leads")).toBe(true);
    expect(interceptado("/")).toBe(true);
    expect(interceptado("/conversas")).toBe(true);
  });

  it("continua liberando assets estáticos internos do Next e de primeiro nível", () => {
    expect(interceptado("/_next/static/chunk.js")).toBe(false);
    expect(interceptado("/_next/image")).toBe(false);
    expect(interceptado("/favicon.ico")).toBe(false);
  });
});
