import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";

import { client } from "../../config/client";
import { derivarTema } from "@/lib/tema";
import { fonteDaMarca } from "@/lib/tema/fontes";
import "./globals.css";

const fonte = fonteDaMarca(client.marca.fonte);
// Mono não entra no config: nenhuma tela mostra código, e o único uso é
// herdado do create-next-app.
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const tema = derivarTema(client.marca);

export const metadata: Metadata = {
  title: client.nome,
  description: `Painel de gestão — ${client.nome}`,
};

/**
 * `suppressHydrationWarning` no `<html>`: o `ThemeProvider` (montado no
 * layout do painel) acrescenta `class="dark"` a ESTE elemento depois da
 * hidratação, e sem isto o React reclama da diferença entre servidor e
 * cliente.
 *
 * O layout raiz continua SÍNCRONO: `client` é importação estática, não há
 * `headers()` aqui. Ler o nonce na raiz tornaria dinâmica a única rota que
 * ainda é estática — medido em 2026-08-20 com `npm run build`: `/_not-found`,
 * e nada mais (as outras já são dinâmicas, `/login` inclusive, porque ela
 * chama `usuarioAtual()`). Esta frase dizia "toda rota dinâmica"; o número
 * medido é 1.
 *
 * O motivo de a raiz não ler a marca da empresa NÃO é esse custo, e sim que
 * ela envolve `/login`, onde não existe sessão e portanto não existe empresa.
 * Quem aplica a marca por empresa é `(painel)/layout.tsx`, que já é
 * `force-dynamic` e já tem `companyId` em mãos — Ciclo 1c, decisão 4.3.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${fonte.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          `dangerouslySetInnerHTML` é a única forma de emitir CSS inline em
          React, e aqui não há superfície de injeção: `tema` é constante de
          build derivada de `config/client.ts` — arquivo versionado, não
          entrada de usuário — e todo valor passa por `formatarOklch`, que
          emite exclusivamente números. Nenhum texto do config chega a este
          string. O painel emite um SEGUNDO bloco, com a marca da empresa
          (`(painel)/layout.tsx`), e lá a origem é o banco — o que fecha o caso
          lá é `formatarOklch` mais a validação de `marcaSchema` na leitura,
          não a origem.
        */}
        <style dangerouslySetInnerHTML={{ __html: tema }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
