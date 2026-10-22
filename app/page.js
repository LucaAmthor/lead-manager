import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Lokalpilot from "./lokalpilot";

export const dynamic = "force-dynamic";

export default async function Seite() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: mitglied } = await supabase.from("lp_members").select("email, rolle").limit(1);
  if (!mitglied?.length) {
    return (
      <main className="lp-auth">
        <div className="lp-auth-card">
          <Logo />
          <h1>Noch kein Zugang</h1>
          <p>
            Du bist als <b>{user.email}</b> angemeldet, aber noch nicht für Lokalpilot freigeschaltet. Bitte Luca oder Flo, dich
            als Mitglied einzutragen.
          </p>
          <form action="/auth/abmelden" method="post">
            <button className="b ghost" type="submit">Abmelden</button>
          </form>
        </div>
      </main>
    );
  }
  return <Lokalpilot email={user.email} />;
}

function Logo() {
  return (
    <div className="lp-auth-logo">
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill="#2b30e6" />
        <circle cx="20" cy="20" r="11" fill="none" stroke="#e6ff3d" strokeWidth="3" />
        <path d="M16.5 13.5v13h8" fill="none" stroke="#e6ff3d" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>lokalpilot</span>
    </div>
  );
}
