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
 * Redige dado pessoal de um texto livre.
 *
 * A ordem importa: o hash bcrypt sai primeiro porque contém sequências que o
 * padrão de telefone poderia recortar pela metade, deixando o resto do hash
 * visível.
 */
export function redigirPii(texto: string): string {
  return texto
    .replace(BCRYPT, "[hash]")
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
