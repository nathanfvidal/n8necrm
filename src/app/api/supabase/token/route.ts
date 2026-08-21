import { usuarioAtual } from "@/core/auth/session";
import { EmpresaAmbiguaError, type UsuarioAtivo } from "@/core/auth/usuario-ativo";
import { checarRateLimit } from "@/core/rate-limit/limiter";
import { emitirTokenSupabase } from "@/core/supabase-jwt/emitir";
import { ehSessaoInvalida } from "@/lib/acao";

/**
 * Emite o JWT do Supabase para quem já está logado no CRM.
 *
 * ## A empresa vem de `usuarioAtual()`, e de mais lugar nenhum
 *
 * Repare que `GET` **não recebe a requisição**. Não é estilo: é a garantia de
 * que o cliente não escolhe a empresa — não existe parâmetro a forjar. Um route
 * handler é endpoint HTTP público, exatamente como uma Server Action, e o Ciclo
 * 1a fechou um defeito desta forma: `redefinirSenha` recebia o id do alvo do
 * cliente, provava que QUEM AGE tinha permissão e nunca provava nada sobre o
 * ALVO — um ADMIN da empresa A redefinia a senha do ADMIN da B (auditoria do
 * Ciclo 1a, § 5.2).
 *
 * Aqui a aposta é maior. O `company_id` deste token é literalmente o que as
 * políticas do Ciclo 3 vão confiar: se o cliente puder escolhê-lo, o RLS
 * inteiro vira decoração. `emitirTokenSupabase` não tem como se defender
 * sozinha — ela recebe uma string e assina, e o JSDoc dela diz isso. A trava é
 * este arquivo.
 *
 * Um route handler tem DOIS canais por onde entrada do cliente chega, e os dois
 * estão fechados aqui, cada um com caso próprio em
 * `tests/unit/rota-token-supabase.test.ts`:
 *
 * 1. **o parâmetro** — ausente, travado por `GET.length === 0` e por um caso
 *    que chama `GET` com uma requisição forjada (query, corpo e cabeçalho
 *    carregando `companyId` ao mesmo tempo) e confere que o token continua o da
 *    sessão;
 * 2. **o ambiente** — `cookies()` e `headers()` de `next/headers` não chegam por
 *    parâmetro, então nenhum caso de comportamento os alcançaria; o teste afirma
 *    sobre o TEXTO deste arquivo que ele não importa `next/headers`. A sessão
 *    chega por esse mesmo mecanismo, mas um salto acima: quem lê o cookie é
 *    `auth()`, dentro de `usuarioAtual()`, que devolve a empresa já resolvida.
 *
 * ## Por que route handler e não Server Action
 *
 * O consumidor é o callback `accessToken` do cliente Supabase — uma função
 * async de JavaScript comum, que precisa de um valor. Server Action acopla o
 * token ao protocolo de ações do RSC e não deixa controlar cabeçalho de
 * resposta, e esta resposta PRECISA de `no-store`: o corpo é credencial
 * portadora, e credencial em cache compartilhado é credencial de outra pessoa.
 *
 * ## O teto de taxa, e o que ele custa
 *
 * 120 emissões por 5 minutos, por `User.id`. O uso legítimo consome ~1,25 por
 * janela por aba (token de 300 s, margem de renovação de 60 s), então 120 cabe
 * dez abas com folga de ordem de grandeza. Existe porque um endpoint que minta
 * credencial sem teto transforma um cookie de sessão roubado em fábrica de
 * tokens.
 *
 * Chave pelo id do usuário e **não** pelo IP: um escritório atrás de um NAT
 * dividiria o orçamento. Custo aceito: quando o teto estoura, o canal do
 * Realtime cai na expiração do último token, sem mensagem na tela — é o
 * comportamento correto, e é por isso que o limite é folgado.
 *
 * ## Por que `force-dynamic`
 *
 * Um handler que não lê a requisição é justamente o que o Next se sente livre
 * para avaliar em tempo de build — e em tempo de build `SUPABASE_JWT_PRIVATE_JWK`
 * não existe. Mesmo modo de falha documentado em
 * `src/modules/whatsapp/gateway/index.ts`, que derrubou o deploy por três dias
 * em 2026-08-07. Explícito para ninguém "otimizar" isto depois.
 */
export const dynamic = "force-dynamic";

export const LIMITE_POR_JANELA = 120;
export const JANELA_MS = 5 * 60_000;

function json(corpo: unknown, status: number): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * O corpo de toda falha que não é do chamador.
 *
 * Genérico de propósito: `chave.ts` nomeia a variável de ambiente e o formato
 * dela, e o Prisma cita host e porta do banco. Isso é informação de operação,
 * vai para o log do servidor e não para quem pediu — mesmo padrão de
 * `src/modules/automation/actions.ts` e dos irmãos que ele cita.
 */
const INDISPONIVEL = { erro: "indisponivel" };

/**
 * Traduz a rejeição de `usuarioAtual()` sem colapsar os três casos em um.
 *
 * O caminho óbvio seria `catch { return 401 }`, e ele está errado por dois
 * motivos independentes:
 *
 * - **`EmpresaAmbiguaError` não é sessão inválida.** A sessão é legítima; o que
 *   falta é a aplicação saber qual empresa servir. `core/auth/usuario-ativo.ts`
 *   separa os dois de propósito e explica: tratá-los como o mesmo manda a pessoa
 *   para o login num laço, sem nunca dizer o que está errado. O que importa para
 *   a segurança é igual nos dois — com duas empresas possíveis, escolher uma
 *   seria inventar escopo, então nenhum token sai.
 * - **Banco fora do ar não é "faça login de novo".** `usuarioAtual()` faz
 *   `findUniqueOrThrow`; um 401 aí manda o cliente para um login que também está
 *   fora do ar, e apaga o rastro da indisponibilidade.
 *
 * `ehSessaoInvalida` (`src/lib/acao.ts`) é a única comparação com a string
 * "Não autenticado" do lado do servidor, e é por ela que este arquivo pergunta.
 */
function respostaDeSessao(erro: unknown): Response {
  if (ehSessaoInvalida(erro)) {
    return json({ erro: "nao_autenticado" }, 401);
  }

  if (erro instanceof EmpresaAmbiguaError) {
    console.warn(
      "JWT do Supabase não emitido: a conta está vinculada a mais de uma empresa e o " +
        "seletor ainda não existe. Escolher uma delas seria inventar escopo.",
      erro
    );
    return json({ erro: "empresa_ambigua" }, 409);
  }

  console.error("Não foi possível resolver quem está pedindo o JWT do Supabase:", erro);
  return json(INDISPONIVEL, 503);
}

export async function GET(): Promise<Response> {
  let usuario: UsuarioAtivo;
  try {
    usuario = await usuarioAtual();
  } catch (erro) {
    return respostaDeSessao(erro);
  }

  try {
    const permitido = await checarRateLimit(
      `jwt-supabase:${usuario.id}`,
      LIMITE_POR_JANELA,
      JANELA_MS
    );

    if (!permitido) {
      console.warn(
        `Teto de emissão de JWT do Supabase atingido para o usuário ${usuario.id}. ` +
          "O canal de Realtime dele cai na expiração do último token."
      );
      return json({ erro: "limite_excedido" }, 429);
    }

    const { token, expiraEm } = await emitirTokenSupabase({
      sub: usuario.id,
      companyId: usuario.companyId,
    });

    // `expiraEm` vai junto para o cliente não precisar decodificar o JWT no
    // navegador só para saber quando renovar. Decodificar token no cliente para
    // tomar decisão é padrão que não vale a pena ensinar.
    return json({ token, expiraEm }, 200);
  } catch (erro) {
    // Falha FECHADA, e o `checarRateLimit` dentro do `try` é o motivo de o bloco
    // começar onde começa: se o contador cai, o teto some, e emitir mesmo assim
    // transformaria uma falha de infraestrutura no "endpoint que minta credencial
    // sem limite" que o teto existe para fechar.
    console.error("Emissão do JWT do Supabase falhou:", erro);
    return json(INDISPONIVEL, 503);
  }
}
