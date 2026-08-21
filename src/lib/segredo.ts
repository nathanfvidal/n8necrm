import crypto from "node:crypto";

/**
 * Compara dois segredos sem canal lateral de tempo — nem de conteúdo, nem de
 * COMPRIMENTO.
 *
 * ## Por que o digest, e não `timingSafeEqual` direto nas strings
 *
 * `crypto.timingSafeEqual` **lança** quando os buffers têm tamanhos diferentes.
 * Para não lançar, o consumidor da fila fazia
 * `if (bufferRecebido.length !== bufferEsperado.length) return false` ANTES de
 * comparar (`src/app/api/queues/whatsapp-turn/route.ts`, até o Ciclo 2d) — um
 * ramo cujo tempo depende só do comprimento, e que portanto conta a quem chama
 * quantos bytes tem o segredo. Dois SHA-256 têm sempre 32 bytes, então a
 * comparação é sempre a mesma e não sobra ramo para escrever.
 *
 * Como em `core/conexoes/webhook-token.ts`, a defesa REAL contra adivinhação é
 * a entropia do segredo (`openssl rand -hex 32`), não a forma da comparação —
 * quem não adivinha 256 bits também não tira proveito de um canal lateral sobre
 * eles. O que se ganha aqui é não deixar uma assimetria de graça, agora que a
 * rota perdeu o air-gapping da Vercel e o segredo virou a única defesa dela.
 *
 * O bloco "o oráculo de comprimento não existe mais"
 * (`tests/unit/fila-segredo.test.ts`) é o que trava esta afirmação, e ele varre
 * a FORMA deste arquivo em vez de medir tempo: a diferença é de nanossegundos,
 * menor que o ruído de agendamento do Node, e um caso que a medisse seria
 * intermitente.
 *
 * ## Esperado vazio devolve `false`, sempre
 *
 * Fecha FECHADO. Se a variável de ambiente não estiver definida, ninguém entra.
 * O modo de falha oposto — vazio combinando com vazio — transformaria "esqueci
 * de configurar" em "endpoint aberto", e é justamente o erro que ninguém
 * percebe até alguém de fora perceber. Tem caso de teste próprio.
 *
 * O `esperado.length` aqui é teste de AUSÊNCIA de configuração, não medida do
 * que chegou: ele não compara um comprimento com o outro, e é por isso que a
 * varredura do teste exige `.length` dos DOIS lados para acusar.
 *
 * ## Um chamador só, e mesmo assim módulo próprio
 *
 * `obterIpDaRequisicao` só virou módulo compartilhado ao ganhar o SEGUNDO
 * chamador, e o critério continua o mesmo. Este arquivo existe por outro
 * motivo: um `route.ts` do App Router só pode exportar métodos HTTP e
 * configuração de segmento, então uma função exportável e testável **não cabe**
 * lá dentro — a mesma restrição que criou `core/rate-limit/export-leads.ts` e
 * `modules/whatsapp/agente-limites.ts`.
 */
export function segredoConfere(recebido: string, esperado: string): boolean {
  if (esperado.length === 0) return false;

  const digestRecebido = crypto.createHash("sha256").update(recebido, "utf8").digest();
  const digestEsperado = crypto.createHash("sha256").update(esperado, "utf8").digest();

  return crypto.timingSafeEqual(digestRecebido, digestEsperado);
}
