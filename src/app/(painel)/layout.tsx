import { PainelNav } from "@/components/painel-nav";
import { auth } from "@/lib/auth";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen">
      {session && <PainelNav />}
      <main>{children}</main>
    </div>
  );
}
