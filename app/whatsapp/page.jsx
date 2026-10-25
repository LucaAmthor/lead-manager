import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WhatsApp from "./whatsapp";
import Softphone from "../_telefon/softphone";
import "../buchungen/buchungen.css";
import "../telefon/telefon.css";
import "./whatsapp.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp · Lokalpilot" };

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
      <WhatsApp email={user.email} />
      <Softphone />
    </>
  );
}
