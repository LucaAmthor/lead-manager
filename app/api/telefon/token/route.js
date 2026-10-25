import { NextResponse } from "next/server";
import { istMitglied } from "@/lib/telefon/auth";
import * as tw from "@/lib/telefon/twilio";

// Zugangs-Token für das Browser-Telefon (1 Stunde gültig, das Telefon erneuert es selbst).
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await istMitglied();
  if (!user) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  if (!tw.konfiguriert()) return NextResponse.json({ code: "nicht_eingerichtet" }, { status: 409 });
  const z = await tw.browserZugang().catch(() => null);
  if (!z) return NextResponse.json({ code: "nicht_eingerichtet", detail: "Auf /telefon „Einrichten“ klicken." }, { status: 409 });
  const identitaet = tw.identitaetAus(user.email);
  return NextResponse.json({ token: tw.zugangsToken(z, identitaet), identitaet, email: user.email });
}
