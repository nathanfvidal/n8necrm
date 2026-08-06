"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setErro(null);
    const resultado = await signIn("credentials", {
      email: formData.get("email"),
      senha: formData.get("senha"),
      redirect: false,
    });

    if (!resultado || resultado.error) {
      // A mensagem padrão é genérica de propósito (não confirma se a conta
      // existe). O caso do limite de tentativas é a exceção: dizer "senha
      // inválida" a quem já foi bloqueado faz a pessoa tentar de novo sem
      // parar, e não esconde nada de um atacante — ele já sabe que está
      // sendo barrado, e o bloqueio é idêntico para e-mail que existe e
      // e-mail inventado.
      setErro(
        resultado?.code === "muitas_tentativas"
          ? "Muitas tentativas de login. Aguarde alguns minutos e tente de novo."
          : "E-mail ou senha inválidos."
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form action={handleSubmit} className="w-full max-w-sm space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="senha">Senha</Label>
          <Input id="senha" name="senha" type="password" required />
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <Button type="submit" className="w-full">Entrar</Button>
      </form>
    </div>
  );
}
