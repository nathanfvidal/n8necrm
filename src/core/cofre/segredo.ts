import crypto from "node:crypto";

import { chaveAtiva, chavePorId, CofreError } from "./chave";

/**
 * A cifra do cofre. Não sabe o que é WhatsApp, o que é Evolution nem o que é
 * uma conexão — recebe texto, um `companyId` e um rótulo de propósito.
 *
 * ## `aes-256-gcm`, e por que um AEAD
 *
 * O segredo mora numa coluna que quem tem `service_role` pode REESCREVER
 * (§4.1 do spec `2026-08-20-ciclo-2a-cofre-credenciais-design.md`). Cifra sem
 * autenticação aceita em silêncio o blob de outra linha; um AEAD recusa.
 * Autenticar aqui não é luxo — é a defesa contra exatamente o mesmo atacante
 * que a cifra pressupõe.
 *
 * GCM e não `chacha20-poly1305`, embora os dois existam no runtime (M15 do
 * spec: medido em 2026-08-20, Node v22.21.0, `crypto.getCiphers()`): AES-GCM
 * tem aceleração de hardware no host, é o AEAD que mais gente sabe revisar, e
 * o volume aqui é ridículo (uma cifragem por troca de credencial). Trocar é
 * mudar uma constante — o `v1` do formato existe para isso.
 *
 * `node:crypto` e não dependência nova: uma biblioteca de cofre traria
 * superfície de supply-chain para as ~40 linhas que `createCipheriv` resolve.
 * Se um dia for preciso KMS/HSM, o ponto de troca é `./chave.ts`, não o
 * formato.
 *
 * ## Nonce de 96 bits, aleatório, um por cifragem
 *
 * O limite de aniversário para nonce aleatório de 96 bits fica na casa de 2^32
 * cifragens COM A MESMA CHAVE (§5.1 do spec). Este sistema cifra na ordem de
 * dezenas por ano. O caso "cifrar o MESMO texto duas vezes dá blobs
 * DIFERENTES" é o que impede alguém de "otimizar" isto para um nonce fixo, que
 * com GCM é catastrófico.
 *
 * ## O que a AAD prende, e o que ela NÃO prende
 *
 * A AAD é `v1|<keyId>|<companyId>|<proposito>` — autenticada, não cifrada.
 * Com ela, três movimentos falham na tag, e cada um tem caso de teste em
 * `tests/unit/cofre-segredo.test.ts`: mover o blob da empresa A para a linha
 * da B, mover o blob de um propósito para outro, e editar o cabeçalho.
 *
 * O que ela **não** cobre: trocar o blob entre DUAS CONEXÕES DA MESMA EMPRESA,
 * do mesmo propósito. Isso passa. Cobrir exigiria pôr o `id` da linha na AAD,
 * e o `id` não existe antes de o Prisma criar a linha. Está registrado em §5.1
 * do spec — dizer que está fechado quando não está desliga a desconfiança de
 * quem lê depois, que é pior que a lacuna.
 */
export class CofreFormatoInvalidoError extends CofreError {}
export class CofreDecifragemError extends CofreError {}

/**
 * O rótulo que separa este segredo de qualquer outro que o cofre venha a
 * guardar. Ele entra na AAD, então mudá-lo torna ilegíveis os blobs antigos —
 * é identificador de formato, não texto de interface. O caso "blob de um
 * propósito NÃO abre com outro" é o que demonstra essa dependência.
 */
export const PROPOSITO_APIKEY_CONEXAO = "whatsapp-connection:apiKey";

export type ContextoDoSegredo = {
  companyId: string;
  proposito: string;
};

const VERSAO = "v1";
const ALGORITMO = "aes-256-gcm";
/** 96 bits — o tamanho para o qual o GCM foi especificado e otimizado. */
const TAMANHO_DO_NONCE = 12;

function montarAad(keyId: string, contexto: ContextoDoSegredo): Buffer {
  return Buffer.from(`${VERSAO}|${keyId}|${contexto.companyId}|${contexto.proposito}`, "utf8");
}

export function cifrar(texto: string, contexto: ContextoDoSegredo): string {
  const chave = chaveAtiva();
  const nonce = crypto.randomBytes(TAMANHO_DO_NONCE);

  const cifrador = crypto.createCipheriv(ALGORITMO, chave.bytes, nonce);
  cifrador.setAAD(montarAad(chave.id, contexto));

  const conteudo = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  return [
    VERSAO,
    chave.id,
    nonce.toString("base64url"),
    conteudo.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decifrar(blob: string, contexto: ContextoDoSegredo): string {
  const partes = blob.split(".");
  if (partes.length !== 5 || partes[0] !== VERSAO) {
    // A mensagem NÃO ecoa o blob. Ele não é texto claro, mas também não tem
    // por que sair daqui — `src/lib/sentry-scrub.ts` redige valores sensíveis
    // justamente porque uma mensagem de erro pode acabar num serviço de
    // terceiros.
    throw new CofreFormatoInvalidoError(
      `Valor cifrado fora do formato esperado \`${VERSAO}.<keyId>.<iv>.<ct>.<tag>\` ` +
        `(recebido: ${partes.length} campos, versão ${JSON.stringify(partes[0] ?? "")}). ` +
        `Ou a coluna foi editada à mão, ou este valor nunca passou pelo cofre.`
    );
  }

  const [, keyId, nonceB64, conteudoB64, tagB64] = partes as [string, string, string, string, string];

  // `chavePorId` lança `CofreChaveDesconhecidaError`, e o erro sobe INTACTO.
  // Convertê-lo em `CofreDecifragemError` apagaria a distinção que importa
  // para quem opera: chave sumida tem conserto, tag quebrada não. O caso
  // "chave RETIRADA da lista lança `CofreChaveDesconhecidaError`" é o que
  // impede alguém de "uniformizar" os dois erros.
  const chave = chavePorId(keyId);

  try {
    const decifrador = crypto.createDecipheriv(ALGORITMO, chave.bytes, Buffer.from(nonceB64, "base64url"));
    decifrador.setAAD(montarAad(keyId, contexto));
    decifrador.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decifrador.update(Buffer.from(conteudoB64, "base64url")),
      decifrador.final(),
    ]).toString("utf8");
  } catch {
    // O erro original é engolido de propósito: ele é do OpenSSL, não diz nada
    // acionável, e repassá-lo só aumenta a chance de material sensível chegar
    // a um log. O que a mensagem precisa dizer é o que aconteceu e o que
    // fazer.
    throw new CofreDecifragemError(
      `A verificação de integridade do segredo falhou (chave ${keyId}). ` +
        `Isso acontece quando o valor cifrado foi alterado, quando ele pertence a OUTRA empresa ` +
        `ou a outro propósito, ou quando a chave mestra não é a que o cifrou. ` +
        `O cofre RECUSA em vez de devolver conteúdo parcial.`
    );
  }
}
