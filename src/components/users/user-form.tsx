"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarUsuarioAction } from "@/core/users/actions";
import { PAPEIS } from "./papeis";
import type { Role } from "@prisma/client";

// Validação de cliente deliberadamente rasa — mesmo raciocínio de
// `lead-form.tsx` e `task-form.tsx`: a regra real mora no servidor
// (`core/users/service.ts` valida nome, formato de e-mail, tamanho de senha e
// o teto de 72 bytes do bcrypt). Este schema só evita o roundtrip de campo
// vazio. Um POST direto, fora do navegador, não passa por nada disto.
const schema = z.object({
  nome: z.string().min(1, "Informe o nome"),
  email: z.string().min(1, "Informe o e-mail"),
  senha: z.string().min(8, "Mínimo de 8 caracteres"),
});

type FormValues = z.infer<typeof schema>;

/**
 * Cadastro de uma pessoa da equipe.
 *
 * A senha é definida por quem cadastra e entregue à pessoa por fora — não há
 * envio de e-mail de convite (o caminho de e-mail existe, mas nunca foi
 * exercitado: `RESEND_API_KEY` não está configurada). É a solução simples que
 * funciona para uma equipe de três a cinco pessoas que se conhecem; um convite
 * por link só se justifica quando alguém entrar sem estar na mesma sala.
 */
export function UserForm() {
  const router = useRouter();
  const [papel, setPapel] = useState<Role>("VENDEDOR");
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nome: "", email: "", senha: "" },
  });

  async function onSubmit(data: FormValues) {
    setErroEnvio(null);

    const resultado = await criarUsuarioAction({ ...data, papel });

    if (!resultado.ok) {
      // Sem `reset` no erro: quem preencheu não pode perder o que digitou —
      // em especial porque o erro mais provável ("já existe uma conta com
      // este e-mail") pede corrigir um campo, não recomeçar.
      setErroEnvio(resultado.erro);
      return;
    }

    reset({ nome: "", email: "", senha: "" });
    setPapel("VENDEDOR");
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
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="off" {...register("email")} />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="senha">Senha inicial</Label>
        {/* `autoComplete="new-password"` impede o gerenciador de senhas do
            navegador de preencher aqui a senha de quem está LOGADO — o campo
            está numa tela de administração, não num formulário de cadastro
            próprio, e o preenchimento automático criaria a conta nova com a
            senha do administrador. */}
        <Input id="senha" type="password" autoComplete="new-password" {...register("senha")} />
        {errors.senha && <p className="text-xs text-red-600">{errors.senha.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="papel">Papel</Label>
        <select
          id="papel"
          value={papel}
          onChange={(e) => setPapel(e.target.value as Role)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {PAPEIS.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Adicionar pessoa"}
      </Button>

      {erroEnvio && (
        <p role="alert" className="w-full text-sm text-red-600">
          {erroEnvio}
        </p>
      )}
    </form>
  );
}
