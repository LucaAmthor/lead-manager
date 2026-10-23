// Backend-Anbindung der Lokalpilot-Oberfläche: Datenbank (Supabase + Realtime), KI-Route, Bildspeicher.
// ---------- Datenbank: Dokumente je Sammlung in Tabelle lp_docs, live über Supabase Realtime ----------
let dbInstanz = null;
export function makeDb(sb) {
  if (dbInstanz) return dbInstanz;
  const state = new Map(); // collection -> { rows: Map(id -> data), listeners: Set, ready, err }
  const fail = (e) => { const err = new Error(e?.message || "db"); err.code = "invalid_argument"; return err; };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
  const clone = (x) => JSON.parse(JSON.stringify(x ?? {}));
  const notify = (st) => st.listeners.forEach((f) => f());

  sb.channel("lp-docs")
    .on("postgres_changes", { event: "*", schema: "public", table: "lp_docs" }, (p) => {
      const col = p.new?.collection || p.old?.collection; const st = state.get(col); if (!st) return;
      if (p.eventType === "DELETE") st.rows.delete(p.old.id); else st.rows.set(p.new.id, p.new.data);
      notify(st);
    })
    .subscribe();

  function watch(col, onChange, onErr) {
    let st = state.get(col);
    if (!st) {
      st = { rows: new Map(), listeners: new Set(), ready: false };
      state.set(col, st);
      sb.from("lp_docs").select("id, data").eq("collection", col).then(({ data, error }) => {
        if (error) { st.err = error; st.listeners.forEach((f) => f(error)); return; }
        (data || []).forEach((r) => st.rows.set(r.id, r.data)); st.ready = true; notify(st);
      });
    }
    const f = (err) => { if (err) { onErr && onErr(err); return; } onChange(st); };
    st.listeners.add(f); if (st.ready) f();
    return () => st.listeners.delete(f);
  }
  const local = (col, id, data) => { const st = state.get(col); if (!st) return; if (data === null) st.rows.delete(id); else st.rows.set(id, data); notify(st); };
  const snap = (st) => { const docs = [...st.rows].map(([id, d]) => ({ id, data: () => clone(d) })); return { docs, size: docs.length, empty: !docs.length }; };

  const docRef = (col, id) => ({
    async set(data) { const { error } = await sb.from("lp_docs").upsert({ collection: col, id, data, updated_at: new Date().toISOString() }); if (error) throw fail(error); local(col, id, clone(data)); },
    async update(patch) { const { data, error } = await sb.rpc("lp_merge", { p_collection: col, p_id: id, p_patch: patch }); if (error) throw fail(error); local(col, id, data); },
    async delete() { const { error } = await sb.from("lp_docs").delete().eq("collection", col).eq("id", id); if (error) throw fail(error); local(col, id, null); },
    onSnapshot(cb, onErr) { return watch(col, (st) => cb({ exists: st.rows.has(id), id, data: () => clone(st.rows.get(id)) }), onErr); },
  });

  dbInstanz = {
    collection: (col) => ({
      onSnapshot: (cb, onErr) => watch(col, (st) => cb(snap(st)), onErr),
      async add(data) { const id = rid(); const { error } = await sb.from("lp_docs").insert({ collection: col, id, data }); if (error) throw fail(error); local(col, id, clone(data)); return { id }; },
      doc: (id) => docRef(col, id),
    }),
    doc: (path) => { const [col, id] = String(path).split("/"); return docRef(col, id); },
  };
  return dbInstanz;
}

// ---------- KI: Server-Route mit Anthropic-Schlüssel ----------
export const sample = {
  async json(prompt, opts = {}) {
    let res;
    try {
      res = await fetch("/api/ki", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }), signal: opts.signal });
    } catch (e) {
      throw { code: e?.name === "AbortError" ? "cancelled" : "unavailable" };
    }
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      if (!j) throw { code: "unavailable", detail: res.status === 504 ? "Zeitüberschreitung auf dem Server (Antwort dauerte zu lange)" : `Server-Fehler ${res.status}` };
      throw { code: j.code || "unavailable", detail: j.hinweis || "" };
    }
    if (!j) throw { code: "invalid_json" };
    window.__lpUsage = { ...(j.usage || {}), t: Date.now() };
    return j.result;
  },
};

// ---------- Bilder: Supabase Storage (Bucket lp-bilder, öffentlich lesbar) ----------
export function makeAssets(sb) {
  return {
    async upload(file) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await sb.storage.from("lp-bilder").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      return { id: path, url: sb.storage.from("lp-bilder").getPublicUrl(path).data.publicUrl };
    },
  };
}
