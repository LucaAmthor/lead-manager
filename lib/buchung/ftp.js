// Druckdaten per FTP / FTPS / SFTP beim Verlag abliefern.
// Zugang je Blatt: blatt.buchung.ftp = { protokoll: "ftp"|"ftps"|"sftp", host, port, benutzer, pfad }
// Passwort liegt nur in lp_secrets unter `ftp:<blattId>` (nie in lp_docs, nie im Verlauf).
import { Readable } from "node:stream";
import { geheimnis } from "./db";

const ZEIT = 30_000;

export function ftpZiel(blatt) {
  const f = blatt?.buchung?.ftp || {};
  const host = String(f.host || "").trim().replace(/^s?ftps?:\/\//i, "").replace(/\/.*$/, "");
  if (!host) return null;
  const protokoll = ["ftp", "ftps", "sftp"].includes(f.protokoll) ? f.protokoll : "ftp";
  return { protokoll, host, port: Number(f.port) || (protokoll === "sftp" ? 22 : 21), benutzer: String(f.benutzer || "anonymous"), pfad: String(f.pfad || "").trim() };
}

async function passwortVon(blattId) {
  const g = await geheimnis(`ftp:${blattId}`);
  return g?.passwort || "";
}

async function mitVerbindung(ziel, passwort, arbeit) {
  if (ziel.protokoll === "sftp") {
    const { default: SftpClient } = await import("ssh2-sftp-client");
    const c = new SftpClient();
    try {
      await c.connect({ host: ziel.host, port: ziel.port, username: ziel.benutzer, password: passwort, readyTimeout: ZEIT });
      return await arbeit({
        liste: async () => (await c.list(ziel.pfad || ".")).map((e) => e.name),
        hoch: async (name, bytes) => {
          const ziel_ = `${(ziel.pfad || ".").replace(/\/$/, "")}/${name}`;
          await c.put(Buffer.from(bytes), ziel_);
          return ziel_;
        },
      });
    } finally {
      await c.end().catch(() => {});
    }
  }
  const { Client } = await import("basic-ftp");
  const c = new Client(ZEIT);
  try {
    await c.access({ host: ziel.host, port: ziel.port, user: ziel.benutzer, password: passwort, secure: ziel.protokoll === "ftps" });
    if (ziel.pfad) await c.cd(ziel.pfad);
    return await arbeit({
      liste: async () => (await c.list()).map((e) => e.name),
      hoch: async (name, bytes) => {
        await c.uploadFrom(Readable.from(Buffer.from(bytes)), name);
        return `${ziel.pfad ? ziel.pfad.replace(/\/$/, "") + "/" : ""}${name}`;
      },
    });
  } finally {
    c.close();
  }
}

// Verbindung prüfen (anmelden, Verzeichnis lesen) – lädt nichts hoch.
export async function ftpTesten(blatt) {
  const ziel = ftpZiel(blatt);
  if (!ziel) throw Object.assign(new Error("Kein FTP-Server hinterlegt"), { code: "invalid_argument" });
  const passwort = await passwortVon(blatt.id);
  const namen = await mitVerbindung(ziel, passwort, (v) => v.liste());
  return { ok: true, ziel: `${ziel.protokoll}://${ziel.benutzer}@${ziel.host}:${ziel.port}/${ziel.pfad}`, eintraege: namen.length };
}

// Dateien hochladen: dateien = [{ name, bytes }]. Gibt die Pfade zurück.
export async function ftpHochladen(blatt, dateien) {
  const ziel = ftpZiel(blatt);
  if (!ziel) throw Object.assign(new Error("Kein FTP-Server hinterlegt"), { code: "invalid_argument" });
  const passwort = await passwortVon(blatt.id);
  return mitVerbindung(ziel, passwort, async (v) => {
    const pfade = [];
    for (const d of dateien) pfade.push(await v.hoch(d.name, d.bytes));
    return { ziel, pfade };
  });
}
