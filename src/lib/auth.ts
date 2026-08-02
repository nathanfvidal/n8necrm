import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        senha: { label: "Senha", type: "password" },
      },
      authorize: async (credentials) => {
        // `credentials` chega como `Record<string, unknown>` — Auth.js não
        // valida o formato do corpo do POST antes de entregar aqui. Sem
        // este `typeof`, um corpo como `{ email: ["a"], senha: {} }` (array
        // ou objeto em vez de string) passava direto pelo `as string`, que
        // é só uma anotação de tipo em tempo de compilação, sem checagem em
        // runtime — `prisma.user.findUnique({ where: { email } })` recebe
        // um valor de tipo errado e o Prisma lança, virando 500 num
        // endpoint não autenticado (achado da revisão final de branch).
        // Falha fechada com o mesmo `return null` genérico de credenciais
        // ausentes/erradas — Auth.js já traduz `null` numa rejeição sem
        // vazar qual parte do formato estava errada.
        if (typeof credentials?.email !== "string" || typeof credentials?.senha !== "string") {
          return null;
        }
        const email = credentials.email;
        const senha = credentials.senha;
        if (!email || !senha) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.ativo) return null;

        const senhaValida = await bcrypt.compare(senha, user.senhaHash);
        if (!senhaValida) return null;

        return { id: user.id, name: user.nome, email: user.email, role: user.papel };
      },
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
