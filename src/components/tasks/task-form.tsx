"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { criarMinhaTaskAction } from "@/core/tasks/actions";
import { registrarFalhaDeRede, type ResultadoAcao } from "@/lib/acao";
import { parseDataCivil } from "@/lib/date";

export type OpcaoDeContato = { id: string; nome: string };

// `<select>` nativo e não `ui/select.tsx` (Base UI). O componente da casa
// renderiza um listbox em portal, que não existe sem JavaScript e complica o
// teste sem entregar nada aqui: são poucos contatos numa lista simples. O
// nativo é acessível por padrão, funciona antes da hidratação e é
// alcançável por `getByLabelText` sem truque. Se um dia a lista precisar de
// busca dentro do campo, aí sim o Base UI paga o próprio custo.
const CLASSES_SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

// Validação client-side deliberadamente rasa (só "tem título" e "tem
// alguma data") — mesmo raciocínio de `lead-form.tsx` (Task 14): a
// validação real e definitiva mora no servidor (`criarTask`, service.ts:
// título aparado/não-vazio; `parseDataCivil`, `src/lib/date.ts`: formato e
// calendário real). Este schema só evita o roundtrip óbvio de campo vazio.
const schema = z.object({
  titulo: z.string().min(1, "Informe o título"),
  vencimento: z.string().min(1, "Informe a data"),
  // Sem `min`: descrição e contato são opcionais. O teto de tamanho da
  // descrição é conferido no servidor (`core/tasks/schema.ts`) — repetir o
  // número aqui criaria duas verdades para o mesmo limite, e a que vale é a
  // que o cliente não controla.
  descricao: z.string(),
  contactId: z.string(),
});

type FormValues = z.infer<typeof schema>;

/**
 * Traduz o que `parseDataCivil` lança — e SÓ isso.
 *
 * Esta função era uma escada de seis comparações contra `erro.message`:
 * "Título obrigatório", "Lead não encontrado", "Contato não encontrado",
 * "Descrição ...", "Não autenticado". Todas essas frases nascem no servidor, e
 * casá-las por texto aqui significava que renomear uma mensagem em
 * `service.ts` apagaria a tradução em silêncio — sem erro de tipo, sem teste
 * vermelho no ponto da mudança, e a pessoa passaria a ler "Não foi possível
 * salvar a tarefa" para um campo que ela consegue corrigir. Agora
 * `criarMinhaTaskAction` devolve a mensagem pronta em `resultado.erro`.
 *
 * `parseDataCivil` (`src/lib/date.ts`) fica: ele roda AQUI, no navegador,
 * antes de qualquer chamada — o texto que ele lança é nosso, deste lado, e não
 * atravessa fronteira nenhuma.
 */
function mensagemDeDataInvalida(erro: unknown): string {
  if (erro instanceof Error && /^Data inválida/.test(erro.message)) {
    return erro.message;
  }
  return "Data inválida.";
}

/**
 * Formulário de criação de tarefa. Reusado em duas telas: `/tasks` (sem
 * `leadId`) e a seção "Tarefas" de `/leads/[id]` (`leadId` vindo da própria
 * URL da página — não é segredo, mesmo raciocínio de `LeadNoteForm` para
 * `leadId` de nota).
 *
 * `responsavelId` NUNCA é enviado por este formulário: `criarMinhaTaskAction`
 * (Server Action) deriva quem age da sessão (Task 13/18) — não há campo
 * escondido nem `<input type="hidden">` para isso, ao contrário de
 * `LeadForm`, porque a Fase 1 nem oferece a escolha de atribuir a outra
 * pessoa (ver comentário em `actions.ts`).
 */
export function TaskForm({
  leadId,
  contatos = [],
  contactIdPadrao,
}: {
  leadId?: string;
  contatos?: OpcaoDeContato[];
  /**
   * Pré-seleciona um contato. É onde a decisão de ligar tarefa a lead E
   * contato paga: em `/leads/[id]`, o contato do próprio lead já vem
   * escolhido, e criar "ligar para o cliente" não exige achá-lo numa lista.
   */
  contactIdPadrao?: string | null;
}) {
  const router = useRouter();
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [atualizando, iniciarAtualizacao] = useTransition();

  const vazio = {
    titulo: "",
    vencimento: "",
    descricao: "",
    contactId: contactIdPadrao ?? "",
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: vazio,
  });

  async function onSubmit(data: FormValues) {
    setErroEnvio(null);

    // `parseDataCivil` (src/lib/date.ts) ancora a string "AAAA-MM-DD" do
    // <input type="date"> em meia-noite UTC daquele dia civil — ver o
    // comentário lá sobre o deslocamento de um dia que essa escolha evita.
    // PODE lançar (formato inválido, dia que não existe no calendário), e é a
    // única coisa deste envio que ainda lança — por isso o `try` encolheu para
    // caber só ela. Mesma forma de `salvarEdicao` em `task-list.tsx`.
    let vencimento: Date;
    try {
      vencimento = parseDataCivil(data.vencimento);
    } catch (erro) {
      setErroEnvio(mensagemDeDataInvalida(erro));
      return;
    }

    let resultado: ResultadoAcao;
    try {
      resultado = await criarMinhaTaskAction({
        titulo: data.titulo,
        // `|| undefined` e não a string crua: o `<textarea>` vazio manda `""`,
        // e o `<select>` sem escolha também. Mandar `""` como `contactId`
        // reprovaria na validação do servidor ("Contato inválido") por um
        // campo que a pessoa simplesmente não preencheu.
        descricao: data.descricao || undefined,
        contactId: data.contactId || undefined,
        vencimento,
        leadId,
      });
    } catch (erro) {
      // A action não lança — a REDE lança. Ver `registrarFalhaDeRede` em
      // `src/lib/acao.ts`.
      setErroEnvio(registrarFalhaDeRede("Falha ao criar tarefa", erro));
      return;
    }

    if (!resultado.ok) {
      // De propósito NÃO chamamos `reset` aqui: em caso de erro a pessoa
      // não pode perder o que já preencheu.
      setErroEnvio(resultado.erro);
      return;
    }

    reset(vazio);
    // Na transição, e não solto: `isSubmitting` cai quando a action responde,
    // mas a lista só muda quando o render do servidor chega. Ver o comentário
    // equivalente em `lead-form.tsx`.
    iniciarAtualizacao(() => router.refresh());
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor="titulo">Título</Label>
          <Input id="titulo" {...register("titulo")} />
          {errors.titulo && <p className="text-xs text-red-600">{errors.titulo.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="vencimento">Vencimento</Label>
          <Input id="vencimento" type="date" {...register("vencimento")} />
          {errors.vencimento && <p className="text-xs text-red-600">{errors.vencimento.message}</p>}
        </div>

        {/* Some quando não há contato nenhum cadastrado: um `<select>` com uma
            única opção "Nenhum" não é escolha, é ruído. */}
        {contatos.length > 0 && (
          <div className="min-w-48 space-y-1">
            <Label htmlFor="contactId">Contato</Label>
            <select id="contactId" className={CLASSES_SELECT} {...register("contactId")}>
              <option value="">Nenhum</option>
              {contatos.map((contato) => (
                <option key={contato.id} value={contato.id}>
                  {contato.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* O campo que o dono foi buscar: "não tem objetivo, uma caixa de texto".
          `<Textarea>` e não `<Input>` — o texto tem quebra de linha, e um
          campo de uma linha só ensina a pessoa a não escrever nada. */}
      <div className="space-y-1">
        <Label htmlFor="descricao">Descrição</Label>
        <Textarea
          id="descricao"
          rows={3}
          placeholder="O que precisa ser feito, e por quê."
          {...register("descricao")}
        />
      </div>

      <Button type="submit" disabled={isSubmitting || atualizando}>
        {isSubmitting || atualizando ? "Salvando..." : "Adicionar tarefa"}
      </Button>

      {erroEnvio && (
        <p role="alert" className="text-sm text-red-600">
          {erroEnvio}
        </p>
      )}
    </form>
  );
}
