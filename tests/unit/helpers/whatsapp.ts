// Helpers de teste compartilhados por vários arquivos que tocam o Postgres
// real do WhatsApp (Conversation/WhatsappMessage) — extraídos de
// tests/unit/whatsapp-turno.test.ts (Task 4 da Fatia 2) para não duplicar
// entre ele, tests/unit/whatsapp-agente.test.ts e o que vier depois.
//
// Este arquivo importa src/lib/prisma.ts, que tem `import "server-only"` e
// lança fora do runtime Next.js — precisa do mesmo mock e do mesmo
// `dotenv/config` que cada arquivo de teste que toca banco já carrega (ver
// tests/unit/whatsapp-turno.test.ts e tests/unit/seed.test.ts). O `vi.mock`
// abaixo é hoistado para o topo DESTE arquivo pelo transform do Vitest, o
// que protege a importação de `prisma` alguns linhas abaixo; cada arquivo de
// teste que importa daqui continua precisando do próprio `vi.mock` no seu
// topo também (mesmo padrão já usado em whatsapp-turno.test.ts), porque a
// ordem de avaliação dos imports desse arquivo pode alcançar `server-only`
// por outro caminho (ex.: importando o módulo testado) antes de chegar
// neste helper.
import "dotenv/config";

import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../../src/lib/prisma";

// Mesmo literal que tests/unit/whatsapp-turno.test.ts já usava como PREFIXO
// antes desta extração — preservado aqui para que a limpeza local dele
// (`limparDadosDeTeste`, que continua declarada naquele arquivo) continue
// encontrando exatamente as linhas que `criarConversation`/
// `criarMensagemEntrada` criam por padrão, sem nenhuma outra mudança de
// comportamento.
const PREFIXO = "teste-turno-";

/** Ids das contas semeadas — ver prisma/seed.ts. Resolvidos por e-mail para não
 *  fixar cuid nenhum no teste. */
export async function idsDeUsuariosSemeados() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
  const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });
  return { ID_DO_ADMIN: admin.id, ID_DO_VENDEDOR: vendedor.id };
}

export async function criarConversation(
  overrides: Partial<{ waId: string; bufferSeq: number; iaAtiva: boolean }> = {}
) {
  return prisma.conversation.create({
    data: {
      waId: overrides.waId ?? `${PREFIXO}${crypto.randomUUID()}`,
      bufferSeq: overrides.bufferSeq ?? 1,
      iaAtiva: overrides.iaAtiva ?? true,
    },
  });
}

export async function criarMensagemEntrada(
  conversationId: string,
  overrides: Partial<{ tipo: "TEXTO" | "AUDIO"; texto: string | null; idExterno: string }> = {}
) {
  return prisma.whatsappMessage.create({
    data: {
      conversationId,
      idExterno: overrides.idExterno ?? `${PREFIXO}${crypto.randomUUID()}`,
      direcao: "ENTRADA",
      autor: "CLIENTE",
      tipo: overrides.tipo ?? "TEXTO",
      texto: overrides.texto ?? "Olá, tudo bem?",
    },
  });
}

/** Remove só o que os testes criaram (qualquer `waId` com prefixo `teste-`,
 *  não só `teste-turno-` — ver comentário do `PREFIXO` acima). O banco de
 *  desenvolvimento é real e compartilhado. Só apaga `Conversation`: o
 *  `onDelete: Cascade` de `WhatsappMessage` (ver prisma/schema.prisma) cuida
 *  das mensagens associadas. */
export async function limparConversasDeTeste() {
  await prisma.conversation.deleteMany({ where: { waId: { startsWith: "teste-" } } });
}
