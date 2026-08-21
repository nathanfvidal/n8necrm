// `import "server-only"` pelo mesmo motivo de `dispatch.ts`, de onde este
// arquivo saiu: o SDK do Resend espera rodar em servidor e a chave de API
// mora aqui. Sem esta linha, o único motivo pelo qual um Client Component não
// conseguiria importar isto seria coincidência do bundler.
import "server-only";

import { Resend } from "resend";
import type { ReactElement } from "react";

/**
 * O envio de e-mail, extraído de `dispatch.ts` no reparo do achado 40 da
 * auditoria de segurança (`docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`).
 *
 * ## Por que houve extração, em vez de o alerta chamar `dispatch.ts`
 *
 * O achado é que `core/audit/alerta.ts` fazia `notification.createMany` direto
 * e nunca passava por aqui: **lead novo rendia e-mail, rajada destrutiva
 * rendia só um badge no sino** — o canal mais fraco para o evento mais grave.
 *
 * A correção óbvia seria o alerta chamar `notificarNovoLead`. Ela não serve, e
 * a razão é a forma das duas coisas: `notificarNovoLead` busca UM lead, deduz
 * UM destinatário (o responsável) e grava UMA notificação. O alerta parte de
 * uma contagem de `AuditLog`, tem N destinatários (todo ADMIN ativo da
 * empresa, menos o autor) e grava N linhas num `createMany`. Encaixar um no
 * outro só sairia com um parâmetro "modo" decidindo metade do corpo da função.
 *
 * O que os dois têm de fato em comum é ESTE pedaço: "mande um e-mail se houver
 * chave configurada, e nunca deixe a falha do e-mail derrubar quem chamou".
 * Isso é o que foi extraído — nada mais. Os dois continuam donos do próprio
 * destinatário, do próprio corpo e da própria decisão de gravar in-app.
 *
 * ## A regra de resiliência, que agora vale para os dois caminhos
 *
 * - **`resend` é `null` quando `RESEND_API_KEY` não está definida** — o caso
 *   real deste projeto hoje: a Task 19 é explícita que a chave fica de fora do
 *   `.env` (não há conta Resend real disponível). `null` em vez de
 *   `new Resend("")` é deliberado: o SDK não valida a chave na construção,
 *   então um `new Resend("")` "funcionaria" até a primeira chamada de rede
 *   falhar com erro de autenticação genérico — pior sinal para debugar do que
 *   simplesmente nunca tentar enviar.
 * - **A falha do envio é registrada e engolida.** `console.error` é o único
 *   registro (sem retry, sem fila — a spec descreve entrega com retry via
 *   QStash como alvo futuro). Quem chama SEMPRE grava a notificação in-app
 *   ANTES: o canal que não depende de terceiro é o que não pode faltar.
 *
 * Devolve `true` só quando o SDK aceitou a mensagem. O retorno existe para o
 * chamador poder registrar quantos e-mails saíram de fato (é o que
 * `core/audit/alerta.ts` faz), não para decidir se a operação deu certo — a
 * operação já deu certo quando a notificação in-app foi gravada.
 */
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Remetente único dos dois caminhos. Estava literal em `dispatch.ts`; virou
 * constante porque agora há dois usos, e dois literais divergem calado.
 */
export const REMETENTE = "CRM <notificacoes@exemplo.com>";

export async function enviarEmailMelhorEsforco(input: {
  para: string;
  assunto: string;
  react: ReactElement;
  /** Aparece no `console.error` — sem ele, uma linha de log não diz qual envio falhou. */
  contexto: string;
}): Promise<boolean> {
  if (!resend) return false;

  try {
    await resend.emails.send({
      from: REMETENTE,
      to: input.para,
      subject: input.assunto,
      react: input.react,
    });
    return true;
  } catch (erro) {
    console.error(`Falha ao enviar e-mail (${input.contexto}):`, erro);
    return false;
  }
}
