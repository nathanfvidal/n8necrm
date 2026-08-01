"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarMinhaTask } from "@/core/tasks/actions";
import { parseDataCivil } from "@/lib/date";

// Validação client-side deliberadamente rasa (só "tem título" e "tem
// alguma data") — mesmo raciocínio de `lead-form.tsx` (Task 14): a
// validação real e definitiva mora no servidor (`criarTask`, service.ts:
// título aparado/não-vazio; `parseDataCivil`, `src/lib/date.ts`: formato e
// calendário real). Este schema só evita o roundtrip óbvio de campo vazio.
const schema = z.object({
  titulo: z.string().min(1, "Informe o título"),
  vencimento: z.string().min(1, "Informe a data"),
});

type FormValues = z.infer<typeof schema>;

/**
 * Traduz o que `criarMinhaTask`/`parseDataCivil` podem lançar numa mensagem
 * segura para exibir a quem preencheu o formulário, sem vazar detalhe de
 * infraestrutura no caso genérico — mesmo padrão de `mensagemDeErro` em
 * `lead-form.tsx` (Task 14).
 */
function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error) {
    if (/^Data inválida/.test(erro.message)) {
      return erro.message;
    }
    if (/^Título obrigatório/.test(erro.message)) {
      return erro.message;
    }
    if (/^Lead não encontrado/.test(erro.message)) {
      return "Esse lead não existe mais. Atualize a página.";
    }
    if (erro.message === "Não autenticado") {
      return "Sua sessão expirou ou sua conta foi desativada. Atualize a página e faça login novamente.";
    }
  }
  return "Não foi possível salvar a tarefa. Tente novamente em instantes.";
}

/**
 * Formulário de criação de tarefa. Reusado em duas telas: `/tasks` (sem
 * `leadId`) e a seção "Tarefas" de `/leads/[id]` (`leadId` vindo da própria
 * URL da página — não é segredo, mesmo raciocínio de `LeadNoteForm` para
 * `leadId` de nota).
 *
 * `responsavelId` NUNCA é enviado por este formulário: `criarMinhaTask`
 * (Server Action) deriva quem age da sessão (Task 13/18) — não há campo
 * escondido nem `<input type="hidden">` para isso, ao contrário de
 * `LeadForm`, porque a Fase 1 nem oferece a escolha de atribuir a outra
 * pessoa (ver comentário em `actions.ts`).
 */
export function TaskForm({ leadId }: { leadId?: string }) {
  const router = useRouter();
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { titulo: "", vencimento: "" },
  });

  async function onSubmit(data: FormValues) {
    setErroEnvio(null);

    try {
      // `parseDataCivil` (src/lib/date.ts) ancora a string "AAAA-MM-DD" do
      // <input type="date"> em meia-noite UTC daquele dia civil — ver o
      // comentário lá sobre o deslocamento de um dia que essa escolha
      // evita. PODE lançar (formato inválido, dia que não existe no
      // calendário) — por isso fica dentro do mesmo try que a action.
      await criarMinhaTask({
        titulo: data.titulo,
        vencimento: parseDataCivil(data.vencimento),
        leadId,
      });
      reset({ titulo: "", vencimento: "" });
      router.refresh();
    } catch (erro) {
      // De propósito NÃO chamamos `reset` aqui: em caso de erro a pessoa
      // não pode perder o que já preencheu.
      setErroEnvio(mensagemDeErro(erro));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="titulo">Título</Label>
        <Input id="titulo" {...register("titulo")} />
        {errors.titulo && <p className="text-xs text-red-600">{errors.titulo.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="vencimento">Vencimento</Label>
        <Input id="vencimento" type="date" {...register("vencimento")} />
        {errors.vencimento && <p className="text-xs text-red-600">{errors.vencimento.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-end">
        {isSubmitting ? "Salvando..." : "Adicionar tarefa"}
      </Button>

      {erroEnvio && (
        <p role="alert" className="w-full text-sm text-red-600">
          {erroEnvio}
        </p>
      )}
    </form>
  );
}
