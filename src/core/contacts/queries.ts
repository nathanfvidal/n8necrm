import { prisma } from "@/lib/prisma";

/**
 * Consultas da agenda de contatos.
 *
 * ## Por que `Contact` virou entidade de primeira classe
 *
 * Até esta fatia, um `Contact` só nascia como efeito colateral de criar um
 * lead (`encontrarOuCriarContact`, `core/leads/dedupe.ts`). Não havia tela,
 * listagem nem edição: um telefone digitado errado ficava errado para sempre,
 * e não havia como responder "quem é essa pessoa e o que já aconteceu com
 * ela" sem caçar lead por lead.
 *
 * ## O que estas consultas NÃO fazem
 *
 * Não tocam `Conversation`, que é conceito do módulo `whatsapp`. A tela de
 * detalhe mostra as conversas da pessoa, mas busca esse dado pelo módulo
 * (`listarConversasDoContato`), não por aqui — `src/core` não conhece módulo,
 * e um fork com WhatsApp desligado não deve nem consultar aquela tabela.
 */

export type ContatoListado = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  criadoEm: Date;
  totalLeads: number;
};

/**
 * Lista os contatos, mais recentes primeiro, opcionalmente filtrados por
 * `busca`.
 *
 * A busca cobre nome, e-mail e telefone. Para telefone, compara **só os
 * dígitos** do que foi digitado: quem procura por "(11) 99999-8888" não
 * encontraria nada num banco que guarda "11999998888". É a mesma assimetria
 * que `normalizarTelefone` resolve na escrita, aplicada agora à leitura — mas
 * aqui sem normalização completa de propósito, porque busca parcial é o caso
 * comum ("quem tem DDD 11?") e normalizar exigiria um número inteiro e
 * válido.
 *
 * `mode: "insensitive"` no nome e no e-mail: procurar "maria" tem que achar
 * "Maria Silva". O Postgres compara maiúsculas por padrão.
 */
export async function listarContatos(busca?: string): Promise<ContatoListado[]> {
  const termo = busca?.trim() ?? "";
  const digitos = termo.replace(/\D/g, "");

  const contatos = await prisma.contact.findMany({
    where:
      termo.length === 0
        ? undefined
        : {
            OR: [
              { nome: { contains: termo, mode: "insensitive" } },
              { email: { contains: termo, mode: "insensitive" } },
              // Só entra no OR quando há dígito no termo: `contains: ""`
              // casaria com TODOS os telefones e anularia o filtro inteiro,
              // fazendo uma busca por "maria" devolver o banco completo.
              ...(digitos.length > 0 ? [{ telefone: { contains: digitos } }] : []),
            ],
          },
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      nome: true,
      telefone: true,
      email: true,
      criadoEm: true,
      _count: { select: { leads: true } },
    },
  });

  return contatos.map(({ _count, ...contato }) => ({ ...contato, totalLeads: _count.leads }));
}

export type ContatoComHistorico = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  criadoEm: Date;
  leads: Array<{
    id: string;
    canal: string;
    criadoEm: Date;
    etapaNome: string;
    responsavelNome: string;
  }>;
};

/**
 * Um contato com o histórico de leads dele. `null` quando não existe — a tela
 * chama `notFound()`.
 */
export async function buscarContatoComHistorico(id: string): Promise<ContatoComHistorico | null> {
  const contato = await prisma.contact.findUnique({
    where: { id },
    select: {
      id: true,
      nome: true,
      telefone: true,
      email: true,
      criadoEm: true,
      leads: {
        orderBy: { criadoEm: "desc" },
        select: {
          id: true,
          canal: true,
          criadoEm: true,
          stage: { select: { nome: true } },
          // `select` explícito no responsável, NUNCA `include: { responsavel: true }`:
          // aquilo traria a linha inteira de `User`, com `senhaHash`, para
          // mostrar um nome — o mesmo achado que já apareceu neste projeto.
          responsavel: { select: { nome: true } },
        },
      },
    },
  });

  if (!contato) return null;

  const { leads, ...dados } = contato;
  return {
    ...dados,
    leads: leads.map((lead) => ({
      id: lead.id,
      canal: lead.canal,
      criadoEm: lead.criadoEm,
      etapaNome: lead.stage.nome,
      responsavelNome: lead.responsavel?.nome ?? "Sem responsável",
    })),
  };
}
