import bcrypt from "bcryptjs";
// Importado de `@auth/core/errors` e não de `next-auth` de propósito: o
// barril do `next-auth` puxa `next-auth/lib/env.js`, que importa
// `next/server` e só resolve dentro do pipeline de build do Next — sob
// Vitest ele lança na importação, e este módulo ficaria intestável (foi
// exatamente o que aconteceu na primeira versão deste arquivo). É a MESMA
// classe: `next-auth` apenas reexporta daqui, então o `instanceof` que o
// @auth/core faz internamente continua valendo.
import { CredentialsSignin } from "@auth/core/errors";

import { prisma } from "@/lib/prisma";
import { obterIpDaRequisicao } from "@/lib/ip";
import { checarLimiteLogin } from "@/core/rate-limit/login";
import { auditarLogin, registrarTentativaRecusada } from "./auditoria-login";

/**
 * Hash bcrypt inerte, usado só para gastar tempo quando o e-mail não existe.
 *
 * ## Por que isto existe
 *
 * A mensagem de erro do login já era genérica, mas o RELÓGIO entregava a
 * resposta: quando o e-mail não existia, a função retornava antes do
 * `bcrypt.compare`, e a requisição respondia ~3x mais rápido. Cronometrando
 * o login, um atacante separava e-mails reais de inventados sem precisar
 * acertar senha nenhuma — e aí concentrava a força bruta só nas contas que
 * existem. Medido neste projeto: ~0,24s para e-mail real contra ~0,08s para
 * inexistente.
 *
 * Comparar contra este hash no caminho "usuário não encontrado" faz os dois
 * casos custarem o mesmo trabalho de CPU.
 *
 * ## Detalhes que fazem isto funcionar (ou não)
 *
 * - O **custo tem que ser o mesmo** dos hashes reais (`$2b$10$`, conferido
 *   no banco). Um hash de custo menor aqui recriaria a diferença de tempo
 *   que ele existe para apagar.
 * - Não é segredo e não precisa ser: é o hash de 32 bytes aleatórios
 *   descartados no ato de gerar. Nenhuma senha corresponde a ele, então
 *   `compare` sempre devolve `false` — inclusive se alguém tentar usá-lo
 *   como senha, já que o que se compara é a senha em texto puro.
 * - É constante em vez de gerado no carregamento do módulo de propósito:
 *   gerar custaria ~100ms em cada partida a frio de função serverless.
 */
const HASH_INERTE = "$2b$10$UWBECdqqk2IpPruChkYh4OvBw6V1qUYOHSz5PdsJ.CDTrhlO/hTf6";

/**
 * Código de erro que chega ao cliente como `?code=muitas_tentativas` e é lido
 * em `signIn(..., { redirect: false })` (o retorno do next-auth/react expõe
 * `code` junto de `error`). Serve só para a tela de login dizer "aguarde" em
 * vez de "senha inválida" — não vaza nada, porque o bloqueio acontece igual
 * para e-mail existente e inexistente (ver `checarLimiteLogin`).
 */
export class MuitasTentativasDeLoginError extends CredentialsSignin {
  code = "muitas_tentativas";
}

/**
 * A função `authorize` do provedor de credenciais. Mora aqui, e não inline
 * dentro do `NextAuth({...})` em `src/lib/auth.ts`, para poder ser chamada
 * direto num teste. O que o teste precisa fixar não é o resultado, é a
 * **ordem**: o limite de tentativas tem que ser consumido antes da consulta
 * ao banco e do bcrypt. Inline, essa ordem seria só uma convenção que a
 * próxima edição desfaz sem ninguém notar
 * (tests/unit/login-rate-limit.test.ts).
 */
export async function autorizarCredenciais(
  credentials: Partial<Record<"email" | "senha", unknown>>,
  request: Request
) {
  // `credentials` chega como `Record<string, unknown>` — Auth.js não
  // valida o formato do corpo do POST antes de entregar aqui. Sem
  // este `typeof`, um corpo como `{ email: ["a"], senha: {} }` (array
  // ou objeto em vez de string) passava direto pelo `as string`, que
  // é só uma anotação de tipo em tempo de compilação, sem checagem em
  // runtime — `prisma.user.findUnique({ where: { email } })` recebe
  // um valor de tipo errado e o Prisma lança, virando 500 num
  // endpoint não autenticado (achado da revisão final de branch).
  // Falha fechada com o mesmo `return null` genérico de credenciais
  // ausentes/erradas — Auth.js já traduz `null` numa rejeição sem
  // vazar qual parte do formato estava errada.
  if (typeof credentials?.email !== "string" || typeof credentials?.senha !== "string") {
    return null;
  }
  const email = credentials.email;
  const senha = credentials.senha;
  if (!email || !senha) return null;

  // Limite de tentativas ANTES de qualquer consulta ou bcrypt: é o ponto em
  // que a força bruta é barata para o atacante e cara para nós. `request` é
  // reconstruído pelo @auth/core, mas com os headers ORIGINAIS
  // (`new Request(url, { headers, method, body })` em
  // lib/actions/callback/index.js), então `x-vercel-forwarded-for` chega
  // intacto aqui.
  const ip = obterIpDaRequisicao(request);
  const limite = await checarLimiteLogin(ip, email);
  if (!limite.permitido) {
    // Recusa por limite tambem e tentativa recusada, e e a que mais interessa
    // numa investigacao: e o formato de forca bruta. `conta: "inexistente"` NAO
    // e afirmacao de que a conta nao existe -- e a verdade do que se sabe neste
    // ponto, porque o banco ainda nao foi consultado (e nao pode ser: a ordem
    // "limite antes de tudo" e o que torna a forca bruta cara, ver
    // `core/rate-limit/login.ts`). Registrar "desconhecido" aqui seria mais
    // preciso; usar o mesmo rotulo dos dois lados e o que mantem as duas
    // metades indistinguiveis de fora.
    registrarTentativaRecusada({ email, ip, conta: "inexistente", motivo: "limite" });
    throw new MuitasTentativasDeLoginError();
  }

  // `select` explicito, e `memberships` junto: o vinculo e a UNICA origem sa do
  // `companyId` da linha de auditoria de login (`AuditLog.companyId` e NOT
  // NULL), e traze-lo aqui custa zero consulta a mais -- a alternativa,
  // `companyIdDoUsuario`, seria uma segunda ida ao banco DENTRO do caminho de
  // login. `prisma.company.findFirst()` esta fora de questao: ignora quem esta
  // pedindo e vaza no dia da segunda empresa (proibicao escrita em
  // `core/users/empresa.ts`).
  //
  // Relacao carregada por `select` e nao `include`, pela regra de
  // `tests/unit/consultas-estreitas.test.ts`: `Membership` nao esta na lista de
  // relacoes sensiveis, mas `include` traria a coluna nova do dia em que
  // alguem acrescentar uma -- foi assim que `Contact.documento` (CPF) passou a
  // ser lido sem nenhuma linha mudar.
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      nome: true,
      email: true,
      senhaHash: true,
      ativo: true,
      memberships: { select: { companyId: true } },
    },
  });

  // Compara SEMPRE, mesmo sem usuário e mesmo com usuário desativado, para
  // que os quatro desfechos (e-mail inexistente, conta desativada, senha
  // errada, senha certa) custem o mesmo tempo. Sair mais cedo em qualquer um
  // deles é o que criava o canal de enumeração descrito em `HASH_INERTE`.
  const senhaValida = await bcrypt.compare(senha, user?.senhaHash ?? HASH_INERTE);

  // As três condições são verificadas juntas e falham com o mesmo `null`
  // genérico. `user.ativo` continua sendo barreira real de login — o que
  // mudou é só QUANDO ela é avaliada, não SE ela é avaliada. (A revogação de
  // sessão em andamento é outra camada, em `usuarioAtual()`.)
  if (!user || !user.ativo || !senhaValida) {
    // A MESMA chamada, no MESMO ponto, para conta existente e inexistente. E o
    // que impede esta auditoria de virar o oraculo de enumeracao que
    // `HASH_INERTE` existe para fechar -- ver o bloco longo em
    // `auditoria-login.ts` sobre por que a tentativa recusada NAO vira linha de
    // `AuditLog`. Trabalho identico nos dois ramos: nenhuma ida ao banco aqui.
    registrarTentativaRecusada({
      email,
      ip,
      conta: user ? "existente" : "inexistente",
      motivo: !user ? "credenciais" : !user.ativo ? "desativada" : "credenciais",
    });
    return null;
  }

  // Login aceito -- a linha permanente que faltava. `await` de proposito: um
  // login bem-sucedido nao e uma sonda de enumeracao (quem chega aqui ja sabia
  // a senha), entao o custo da escrita nao vaza nada, e nao esperar por ela
  // arriscaria a funcao serverless congelar antes de o INSERT sair.
  //
  // Vinculo != 1 nao lanca e nao inventa empresa: e a mesma postura de
  // `usuarioAtual()` (zero vinculo e sessao invalida; mais de um LANCA em vez
  // de escolher). Aqui a autorizacao ja terminou, e derrubar o login por causa
  // do rastro seria negar servico -- entao a anomalia vai para o log e o login
  // segue. A pessoa nao passa do `(painel)/layout.tsx` de qualquer forma.
  if (user.memberships.length === 1) {
    await auditarLogin({ userId: user.id, companyId: user.memberships[0]!.companyId, ip });
  } else {
    console.warn(
      `[auditoria] login sem vinculo unico (${user.memberships.length}) -- ` +
        `linha de AuditLog nao gravada para userId=${user.id}`
    );
  }

  // Sem `role`: o campo já foi devolvido aqui, mas nada em `src/` autoriza
  // com `session.user.role`/`token.role` (medido — só a augmentation de tipos
  // em `types/next-auth.d.ts` os mencionava). Depois que o papel passou a
  // morar em `Membership` (Ciclo 1a), o JWT continuaria carregando um valor
  // OBSOLETO — o de `User.papel`, que já não é mais a fonte de verdade — e
  // que ninguém precisa ler: toda autorização usa `usuarioAtual().papel`,
  // resolvido do vínculo a cada requisição (`core/auth/session.ts`).
  return { id: user.id, name: user.nome, email: user.email };
}
