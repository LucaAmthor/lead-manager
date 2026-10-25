import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Telefon from "./telefon";
import Softphone from "../_telefon/softphone";
import "../buchungen/buchungen.css";
import "./telefon.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Telefon · Lokalpilot" };

export default async function Seite() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: mitglied } = await supabase.from("lp_members").select("email").limit(1);
  if (!mitglied?.length) redirect("/");
  return (
    <>
      <Telefon email={user.email} />
      <Softphone />
    </>
  );
}
