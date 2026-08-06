import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { autorizarCredenciais } from "@/core/auth/credenciais";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    /**
     * 8 horas em vez dos 30 dias que o Auth.js usa por padrão.
     *
     * A sessão é JWT: não existe registro no servidor para invalidar, então
     * o único limite real de um cookie roubado é o relógio dentro dele. Com
     * o padrão, um notebook esquecido aberto, um cookie copiado de um
     * computador compartilhado da revenda ou um backup de navegador dava
     * acesso ao CRM por um MÊS. Oito horas cobrem um dia de trabalho
     * inteiro e transformam o mesmo vazamento em um problema de horas.
     *
     * Isto NÃO substitui a revogação por desativação de usuário — essa
     * continua sendo feita a cada requisição por `usuarioAtual()`, que
     * consulta `User.ativo` no banco. Os dois resolvem coisas diferentes:
     * aqui é "faz tempo demais que essa sessão nasceu", lá é "esta pessoa
     * não trabalha mais aqui".
     */
    maxAge: 8 * 60 * 60,
    /**
     * Enquanto a pessoa usa o sistema, o token é reemitido no máximo uma vez
     * por hora — então quem está trabalhando não é deslogado no meio de um
     * atendimento, e quem parou perde a sessão 8 horas depois do último uso.
     */
    updateAge: 60 * 60,
  },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        senha: { label: "Senha", type: "password" },
      },
      authorize: autorizarCredenciais,
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
      }
      return session;
    },
  },
});
