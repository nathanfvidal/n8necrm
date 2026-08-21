import "server-only";

import crypto from "node:crypto";

/**
 * O carregador da chave mestra do cofre.
 *
 * ## Por que a chave fica no AMBIENTE e o segredo no BANCO
 *
 * O Prisma conecta como dono da tabela e ignora RLS (`CLAUDE.md`, e a migração
 * `20260730212500_enable_rls_and_revoke_anon_grants` diz que `FORCE ROW LEVEL
 * SECURITY` está desligada de propósito). Dump, backup automático e vazamento
 * da `service_role` entregam a coluna inteira. Cifrar só ajuda enquanto a
 * chave NÃO estiver no mesmo lugar que o texto cifrado — por isso ela é a
 * única peça que continua fora do banco.
 *
 * ## Por que NADA aqui é memoizado
 *
 * `process.env` é lido a cada chamada. Custo: dois `Buffer.from` e um `sha256`
 * de 32 bytes — irrelevante ao lado da ida ao banco que sempre acompanha.
 * Ganhos, e os dois importam: rotação passa a valer sem reiniciar processo, e
 * o módulo não tem binding mutável para envenenar entre testes. O caso "lê
 * `process.env` a CADA chamada" (`tests/unit/cofre-chave.test.ts`) é o que
 * prende isso.
 *
 * ## Por que NADA aqui roda no escopo do módulo
 *
 * `next build` avalia todo módulo alcançável para coletar a configuração das
 * rotas. Validar env no topo derrubou o deploy deste projeto por três dias —
 * o relato inteiro está em `src/modules/whatsapp/gateway/index.ts`. Aqui vale
 * igual: importar este arquivo num ambiente sem `COFRE_CHAVE_MESTRA` não pode
 * lançar; USAR sem ela tem de lançar.
 */
export class CofreError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class CofreSemChaveError extends CofreError {}
export class CofreChaveInvalidaError extends CofreError {}
export class CofreChaveDesconhecidaError extends CofreError {}

export type ChaveMestra = {
  /** 8 primeiros caracteres hex de `sha256(bytes)`. Derivado, nunca digitado. */
  id: string;
  bytes: Buffer;
};

/** AES-256 exige 32 bytes. Chave mais curta é erro de configuração, não "chave fraca". */
const TAMANHO_DA_CHAVE = 32;

const COMO_GERAR =
  "Gere com `openssl rand -base64 32` e defina COFRE_CHAVE_MESTRA " +
  "(lista separada por vírgula; a PRIMEIRA cifra, qualquer uma decifra).";

/**
 * O `id` é `sha256` dos BYTES, não do texto base64 — reencodar a mesma chave
 * (com ou sem padding, com quebra de linha) não pode mudar o id, senão os
 * blobs antigos deixariam de encontrar a chave que os cifrou. O caso "o
 * `keyId` é derivado da chave, não digitado" é o que exercita essa
 * estabilidade: a mesma chave em outra POSIÇÃO da lista mantém o id.
 *
 * Expor 32 bits do `sha256` de uma chave de 256 bits não é caminho para a
 * chave; o que ele compra é rotação sem reescrever blob nenhum.
 */
function idDaChave(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

/**
 * As chaves configuradas, na ordem em que aparecem. A primeira é a que cifra;
 * qualquer uma da lista pode decifrar, escolhida pelo `keyId` do próprio blob
 * — é o que os casos de rotação de `tests/unit/cofre-segredo.test.ts`
 * exercitam.
 *
 * Rotacionar é acrescentar a nova NA FRENTE: nada é reescrito, e os blobs
 * antigos continuam abrindo. A chave antiga sai da lista quando todos os
 * blobs tiverem passado por uma substituição normal pela tela.
 */
export function chavesDoAmbiente(): ChaveMestra[] {
  const bruto = process.env.COFRE_CHAVE_MESTRA;

  // String vazia DEFINIDA não é o mesmo que ausente para `process.env`, e
  // tratá-las diferente já mordeu este repositório antes (ver o comentário de
  // SEED_PASSWORD em `.env.example`). As duas são "não configurado", e há um
  // caso de teste para cada uma.
  if (!bruto || bruto.trim().length === 0) {
    throw new CofreSemChaveError(
      `COFRE_CHAVE_MESTRA ausente ou vazia — o cofre de credenciais não abre sem ela. ${COMO_GERAR}`
    );
  }

  const chaves = bruto
    .split(",")
    .map((entrada) => entrada.trim())
    .filter((entrada) => entrada.length > 0)
    .map((entrada, indice) => {
      const bytes = Buffer.from(entrada, "base64");
      if (bytes.length !== TAMANHO_DA_CHAVE) {
        // A mensagem carrega a POSIÇÃO e o TAMANHO, nunca o valor. Quem opera
        // precisa saber qual entrada consertar; ninguém precisa ver a chave —
        // e uma mensagem de erro pode acabar num log de terceiros. O caso
        // "NENHUMA mensagem de erro carrega material de chave" afirma isto
        // para as duas mensagens que este arquivo sabe produzir com uma chave
        // em mãos.
        throw new CofreChaveInvalidaError(
          `A ${indice + 1}ª entrada de COFRE_CHAVE_MESTRA decodifica para ${bytes.length} bytes, ` +
            `e AES-256 exige ${TAMANHO_DA_CHAVE}. ${COMO_GERAR}`
        );
      }
      return { id: idDaChave(bytes), bytes };
    });

  if (chaves.length === 0) {
    throw new CofreSemChaveError(
      `COFRE_CHAVE_MESTRA não tem nenhuma entrada utilizável. ${COMO_GERAR}`
    );
  }

  // Dois ids iguais fariam `chavePorId` devolver "alguma" das duas. Como ids
  // iguais só acontecem com chaves iguais, isto é erro de configuração (a
  // mesma chave repetida na lista) — e falhar alto é melhor que escolher em
  // silêncio, mesmo quando a escolha daria certo por acaso.
  const ids = new Set(chaves.map((c) => c.id));
  if (ids.size !== chaves.length) {
    throw new CofreChaveInvalidaError(
      `COFRE_CHAVE_MESTRA tem ${chaves.length} entradas e apenas ${ids.size} identificadores ` +
        `distintos — há chave repetida na lista. Remova a duplicata.`
    );
  }

  return chaves;
}

export function chaveAtiva(): ChaveMestra {
  return chavesDoAmbiente()[0];
}

export function chavePorId(id: string): ChaveMestra {
  const encontrada = chavesDoAmbiente().find((chave) => chave.id === id);
  if (!encontrada) {
    // As DUAS saídas ditas em voz alta, de propósito. Degradar isto para
    // "credencial não configurada" convidaria alguém a recadastrar por cima de
    // um segredo que continua lá, quando o problema era só a chave fora do
    // ambiente.
    throw new CofreChaveDesconhecidaError(
      `O segredo foi cifrado com a chave ${id}, que não está em COFRE_CHAVE_MESTRA. ` +
        `Ou a chave volta para a lista (acrescente-a, mesmo que não seja a primeira), ` +
        `ou a credencial é substituída pela tela de Configurações. ` +
        `Sem a chave, o segredo não abre.`
    );
  }
  return encontrada;
}
