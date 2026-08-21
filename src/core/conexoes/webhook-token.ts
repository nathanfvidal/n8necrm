import crypto from "node:crypto";

/**
 * O token que compõe o path público do webhook, e o hash que vai para o banco.
 *
 * ## Cofre para o que precisa ser LIDO de volta; hash para o que só precisa ser CONFERIDO
 *
 * A apikey da Evolution vai para o cofre porque é USADA — viaja no header de
 * toda chamada à API dela. O token do webhook nunca é usado, só comparado;
 * guardá-lo cifrado seria dar a ele uma capacidade de que ele não precisa. Com
 * o hash, um dump do banco não entrega uma URL de webhook funcional. O desenho
 * anterior — token em texto puro no `.env` — entregava.
 *
 * ## O que se perde, dito em voz alta
 *
 * A comparação deixa de ser de tempo constante: vira busca por índice, sem
 * `timingSafeEqual` no caminho. A defesa contra adivinhação NUNCA foi a
 * comparação e sim os 256 bits de entropia — quem não adivinha o token em
 * tempo nenhum também não tira proveito de um canal lateral sobre ele. Trocar
 * "dump inútil" por isso é ganho, e está registrado como D5 do spec
 * (`docs/superpowers/specs/2026-08-20-ciclo-2a-cofre-credenciais-design.md`).
 */

/**
 * 32 bytes em hex. Hex e não base64url porque o valor vai num PATH de URL e
 * precisa sobreviver a cópia, colagem e log sem nenhuma pergunta sobre
 * codificação — `.env.example` já pedia `openssl rand -hex 32` para o token
 * atual pelo mesmo motivo.
 */
export function gerarWebhookToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * `sha256` puro, sem sal e sem custo, e as duas ausências são deliberadas.
 *
 * Sem KDF caro (bcrypt/scrypt): esses existem para segredo de BAIXA entropia,
 * onde o custo por tentativa é a defesa. Um token de 256 bits aleatórios não é
 * adivinhável em tempo nenhum, e um KDF aqui só tornaria CADA webhook recebido
 * mais lento — a Evolution manda todo tipo de evento nesta rota, não só
 * mensagem.
 *
 * Sem sal: o hash precisa ser DETERMINÍSTICO para virar busca por índice. Sal
 * exigiria varrer a tabela comparando linha a linha, que é o oposto do que uma
 * rota de webhook pode pagar.
 */
export function hashWebhookToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
