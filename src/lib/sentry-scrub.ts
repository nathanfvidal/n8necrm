/**
 * Remoção de dado pessoal do que sai para o Sentry.
 *
 * ## Por que isto precisa existir
 *
 * O Sentry recebe a mensagem do erro, e as mensagens deste sistema carregam
 * dado de cliente por construção. `normalizarTelefone` lança
 * `Telefone inválido: "(11) 99999-8888" ...` com o número dentro; o serviço de
 * contatos responde `Este telefone já está cadastrado para Maria Silva.`.
 * Mandar isso para um serviço de terceiros transforma o monitoramento num
 * vazamento lento de agenda de cliente.
 *
 * `sendDefaultPii: false` (padrão do SDK) já impede o Sentry de anexar IP,
 * cookie e corpo de requisição por conta própria. O que ele NÃO faz é olhar
 * dentro do texto do erro — isso é trabalho de quem conhece as mensagens, ou
 * seja, deste arquivo.
 *
 * ## O critério
 *
 * Redigir agressivamente e aceitar falso positivo. Perder um número numa
 * mensagem de erro atrapalha um diagnóstico; vazar o telefone de um cliente
 * real é outra categoria de problema. Na dúvida, redige.
 *
 * Módulo puro, sem import de Sentry nem de Prisma, para ser testável sem
 * nenhum mock.
 */

/**
 * Hash bcrypt. `$2a$`, `$2b$` ou `$2y$`, custo de dois dígitos, e 53
 * caracteres do alfabeto base64 do bcrypt.
 *
 * Nenhum caminho de código deveria colocar um hash numa mensagem de erro —
 * mas "não deveria" já falhou neste projeto antes (uma linha inteira de
 * `User` carregada para mostrar um nome), e um hash que chega ao Sentry fica
 * lá para sempre, fora do controle de quem opera o CRM.
 */
const BCRYPT = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g;

/** Endereços de e-mail em qualquer posição do texto. */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Telefone brasileiro, com ou sem formatação: `+55 (11) 99999-8888`,
 * `(11) 99999-8888`, `11999998888`.
 *
 * O `\d{10,13}` cobre o caso já normalizado (só dígitos). O limite inferior
 * de 10 é o que evita redigir número que não é telefone — id sequencial,
 * quantidade, código de status. Data em ISO não casa porque os dígitos vêm
 * separados por `-` e `:`.
 */
const TELEFONE = /(?:\+?55\s*)?(?:\(\d{2}\)|\d{2})[\s.-]?\d{4,5}[\s.-]?\d{4}|\d{10,13}/g;

/**
 * Um valor cifrado pelo cofre (`src/core/cofre/segredo.ts`, Ciclo 2a Task 2):
 * `v1.<8 hex de keyId>.<base64url>.<base64url>.<base64url>`.
 *
 * O blob não é texto claro — sem a chave mestra ele não abre. Ele é redigido
 * mesmo assim por dois motivos: uma mensagem de erro que carrega o blob dá a
 * um atacante offline o material sobre o qual trabalhar, e o Sentry guarda o
 * evento fora do controle de quem opera o CRM, para sempre. É o mesmo
 * raciocínio que já vale para o hash bcrypt logo acima — "não deveria" já
 * falhou neste projeto antes.
 */
const SEGREDO_CIFRADO = /\bv1\.[0-9a-f]{8}(?:\.[A-Za-z0-9_-]{8,}){3}\b/g;

/**
 * Uma chave de 32 bytes em base64 — o formato de `COFRE_CHAVE_MESTRA` e, por
 * coincidência útil, o de `AUTH_SECRET`.
 *
 * `{43}` EXATOS, com padding opcional, e ancorado por fronteiras de caractere
 * base64 nos dois lados. A precisão não é estética: sem ela, um `sha256` de 64
 * hex (que também é feito de caracteres do alfabeto base64) casaria com um
 * prefixo de 43, e todo hash do sistema sumiria dos relatórios de erro. Há
 * caso de teste para as duas metades — a chave é redigida, o sha256 não.
 *
 * O critério continua sendo o do topo deste arquivo: redigir agressivamente e
 * aceitar falso positivo. Perder um identificador longo atrapalha um
 * diagnóstico; publicar a chave que abre TODAS as credenciais cifradas do
 * banco é outra categoria de problema.
 */
const CHAVE_BASE64 = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{43}={0,2}(?![A-Za-z0-9+/=])/g;

/**
 * Redige dado pessoal e material de segredo de um texto livre.
 *
 * A ordem importa, e cada afirmação sobre ela tem caso que a exercita em
 * `tests/unit/sentry-scrub.test.ts`, describe "segredos do cofre (Ciclo 2a)":
 *
 * - O **blob do cofre** sai PRIMEIRO. Os campos dele são base64url longos, e
 *   um campo de exatamente 43 caracteres sem `-` nem `_` casa com
 *   `CHAVE_BASE64`, que o recortaria e deixaria o resto do blob visível — o
 *   mesmo modo de falha que já justificava o bcrypt vir antes do telefone. O
 *   caso "blob cujo campo do meio tem 43 caracteres" prova esse recorte.
 * - O **hash bcrypt** continua antes de `TELEFONE`, pela razão original: o
 *   `\d{10,13}` recorta dígitos de dentro do hash. E fica também antes de
 *   `CHAVE_BASE64`, porque o alfabeto do bcrypt inclui `.`, que parte o hash
 *   em corridas de caracteres base64 — uma corrida de 43 viraria `[chave]` e
 *   o resto do hash sobreviveria. O caso "hash bcrypt cujo miolo tem uma
 *   corrida de 43" prova essa metade.
 *
 * O que esta função NÃO afirma: que nenhum segredo passe. Ela reconhece o que
 * tem FORMA (blob do cofre, chave de 32 bytes, bcrypt, e-mail, telefone).
 * Credencial de formato livre — a apikey da Evolution, por exemplo — não é
 * reconhecível por expressão regular, e por isso é redigida na origem, pelo
 * único objeto que sabe qual é: ver `redigirApiKey` em
 * `src/modules/whatsapp/gateway/evolution.ts`.
 */
export function redigirPii(texto: string): string {
  return texto
    .replace(SEGREDO_CIFRADO, "[segredo cifrado]")
    .replace(BCRYPT, "[hash]")
    .replace(CHAVE_BASE64, "[chave]")
    .replace(EMAIL, "[e-mail]")
    .replace(TELEFONE, "[telefone]");
}

/**
 * Aplica `redigirPii` em profundidade num valor de qualquer forma — o evento
 * do Sentry é um objeto aninhado (mensagem, valores de exceção, breadcrumbs)
 * e o dado pessoal pode estar em qualquer folha de texto.
 *
 * `profundidade` existe para não travar em estrutura cíclica ou muito
 * aninhada: um evento de erro não tem 12 níveis de profundidade útil, e
 * percorrer o que vier depois disso custa mais do que entrega.
 */
export function redigirPiiProfundo(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 12) return valor;
  if (typeof valor === "string") return redigirPii(valor);
  if (Array.isArray(valor)) return valor.map((item) => redigirPiiProfundo(item, profundidade + 1));
  if (valor !== null && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor)) {
      saida[chave] = redigirPiiProfundo(item, profundidade + 1);
    }
    return saida;
  }
  return valor;
}
