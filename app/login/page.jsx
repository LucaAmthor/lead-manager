"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const Logo = () => (
  <div className="lp-auth-logo">
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="#2b30e6" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#e6ff3d" strokeWidth="3" />
      <path d="M16.5 13.5v13h8" fill="none" stroke="#e6ff3d" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span>lokalpilot</span>
  </div>
);

export default function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [schritt, setSchritt] = useState("email");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fehler = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fehler");

  async function senden(e) {
    e.preventDefault();
    setBusy(true);
    setStatus("");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setStatus("Das hat nicht geklappt. Bitte in einer Minute nochmal versuchen.");
    else setSchritt("code");
  }

  async function pruefen(e) {
    e.preventDefault();
    setBusy(true);
    setStatus("");
    const sb = createClient();
    let { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) ({ error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "signup" }));
    setBusy(false);
    if (error) setStatus("Der Code stimmt nicht oder ist abgelaufen. Bitte neu anfordern.");
    else window.location.href = "/";
  }

  return (
    <main className="lp-auth">
      {schritt === "email" ? (
        <form className="lp-auth-card" onSubmit={senden}>
          <Logo />
          <p className="lp-auth-claim">Lokale Kampagnen auf Autopilot</p>
          <h1>Anmelden</h1>
          <p>Wir schicken dir einen Code per E-Mail. Kein Passwort nötig.</p>
          {fehler ? <p className="lp-auth-err">{fehler === "abgelaufen" ? "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen Code an." : "Der Link hat nicht funktioniert. Fordere einfach einen neuen Code an und gib ihn hier ein."}</p> : null}
          <label className="f">
            E-Mail
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" />
          </label>
          <button className="b primary big" type="submit" disabled={busy}>{busy ? "Sende …" : "Code schicken"}</button>
          {status ? <p className="lp-auth-err">{status}</p> : null}
        </form>
      ) : (
        <form className="lp-auth-card" onSubmit={pruefen}>
          <Logo />
          <h1>Code eingeben</h1>
          <p>Wir haben dir an <b>{email}</b> eine E-Mail geschickt. Gib den Code daraus hier ein. Alternativ klappt auch der Link in der Mail, wenn du ihn in diesem Browser öffnest.</p>
          <label className="f">
            Code aus der E-Mail
            <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" maxLength={10} />
          </label>
          <button className="b primary big" type="submit" disabled={busy}>{busy ? "Prüfe …" : "Anmelden"}</button>
          {status ? <p className="lp-auth-err">{status}</p> : null}
          <button className="b ghost" type="button" onClick={() => { setSchritt("email"); setCode(""); setStatus(""); }}>Andere E-Mail / neuen Code</button>
        </form>
      )}
    </main>
  );
}
