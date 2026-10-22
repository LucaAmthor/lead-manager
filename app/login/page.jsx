"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fehler = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fehler");

  async function senden(e) {
    e.preventDefault();
    setBusy(true);
    setStatus("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    setStatus(error ? "Das hat nicht geklappt. Bitte gleich nochmal versuchen." : "Link ist unterwegs. Öffne die E-Mail auf diesem Gerät und klick auf den Link.");
  }

  return (
    <main className="lp-auth">
      <form className="lp-auth-card" onSubmit={senden}>
        <div className="lp-auth-logo">
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
            <rect width="40" height="40" rx="11" fill="#2b30e6" />
            <circle cx="20" cy="20" r="11" fill="none" stroke="#e6ff3d" strokeWidth="3" />
            <path d="M16.5 13.5v13h8" fill="none" stroke="#e6ff3d" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>lokalpilot</span>
        </div>
        <p className="lp-auth-claim">Lokale Kampagnen auf Autopilot</p>
        <h1>Anmelden</h1>
        <p>Wir schicken dir einen Anmelde-Link per E-Mail. Kein Passwort nötig.</p>
        {fehler ? <p className="lp-auth-err">Der Link war abgelaufen oder wurde in einem anderen Browser geöffnet. Bitte neu anfordern.</p> : null}
        <label className="f">
          E-Mail
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" />
        </label>
        <button className="b primary big" type="submit" disabled={busy}>
          {busy ? "Sende …" : "Login-Link schicken"}
        </button>
        {status ? <p className="lp-auth-ok">{status}</p> : null}
      </form>
    </main>
  );
}
