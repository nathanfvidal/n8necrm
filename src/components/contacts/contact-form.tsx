"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { atualizarContatoAction, criarContatoAction } from "@/core/contacts/actions";

// Validação de cliente rasa de propósito, como nos outros formulários deste
// projeto: quem decide o que é um telefone válido é `normalizarTelefone` no
// servidor (código do país, 9º dígito do celular, recusa de número
// incompleto). Repetir a regra aqui criaria duas verdades que divergem na
// primeira mudança — e um POST direto não passaria por esta nem por acaso.
const schema = z.object({
  nome: z.string().min(1, "Informe o nome"),
  telefone: z.string().min(1, "Informe o telefone"),
  email: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

/**
 * Formulário de contato, usado nas duas pontas: cadastro avulso em
 * `/contatos` (sem `contato`) e edição em `/contatos/[id]` (com `contato`).
 *
 * Um componente só porque os campos e as regras são idênticos — o que muda é
 * qual action é chamada e se o formulário se limpa no fim. Dois componentes
 * quase iguais divergiriam na primeira vez que alguém acrescentasse um campo
 * num deles.
 */
export function ContactForm({
  contato,
}: {
  contato?: { id: string; nome: string; telefone: string; email: string | null };
}) {
  const router = useRouter();
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: contato?.nome ?? "",
      telefone: contato?.telefone ?? "",
      email: contato?.email ?? "",
    },
  });

  async function onSubmit(data: FormValues) {
    setErroEnvio(null);
    setSalvo(false);

    const resultado = contato
      ? await atualizarContatoAction({ id: contato.id, ...data })
      : await criarContatoAction(data);

    if (!resultado.ok) {
      // Sem `reset` no erro. Vale em dobro aqui: a falha mais provável é o
      // telefone já pertencer a outra pessoa, e a mensagem diz de quem é —
      // apagar o que foi digitado tiraria o contexto junto.
      setErroEnvio(resultado.erro);
      return;
    }

    if (!contato) reset({ nome: "", telefone: "", email: "" });
    setSalvo(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" {...register("nome")} />
        {errors.nome && <p className="text-xs text-red-600">{errors.nome.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="telefone">Telefone</Label>
        <Input id="telefone" placeholder="(11) 99999-8888" {...register("telefone")} />
        {errors.telefone && <p className="text-xs text-red-600">{errors.telefone.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" {...register("email")} />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : contato ? "Salvar alterações" : "Adicionar contato"}
      </Button>

      {erroEnvio && (
        <p role="alert" className="w-full text-sm text-red-600">
          {erroEnvio}
        </p>
      )}

      {salvo && !erroEnvio && (
        <p role="status" className="w-full text-sm text-green-700">
          Contato salvo.
        </p>
      )}
    </form>
  );
}
