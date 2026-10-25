/* Lokalpilot-Tracking für Landingpages (z. B. modernisieren24.de).
   Einbinden: <script src="https://lokalpilot.vercel.app/lp-tracking.js" defer></script>
   Merkt sich den Anzeigen-Code aus dem Kurz-Link (?lp=SZ-WP-001&utm_medium=qr) 90 Tage und schickt Leads an Lokalpilot:
     window.lokalpilot.lead({ name, telefon, email, plz, ort, kategorie, antworten: { "Dachform": "Satteldach" }, einwilligung: true, einwilligungText })
   Gibt ein Promise zurück. window.lokalpilot.code() liefert den gemerkten Code (oder ""). */
(function () {
  var SKRIPT = document.currentScript && document.currentScript.src;
  var API = SKRIPT ? new URL("/api/lead", SKRIPT).toString() : "/api/lead";
  var KEY = "lp_tracking";
  var TAGE = 90;
  function lesen() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && v.t > Date.now() - TAGE * 864e5) return v; } catch (e) {}
    var m = document.cookie.match(/(?:^|; )lp_tracking=([^;]*)/);
    if (m) { try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) {} }
    return null;
  }
  function merken(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
    document.cookie = "lp_tracking=" + encodeURIComponent(JSON.stringify(v)) + "; max-age=" + TAGE * 86400 + "; path=/; SameSite=Lax";
  }
  var q = new URLSearchParams(location.search);
  if (q.get("lp")) merken({ code: q.get("lp"), medium: q.get("utm_medium") || "", quelle: q.get("utm_source") || "", t: Date.now() });
  var stand = lesen() || {};
  window.lokalpilot = {
    code: function () { return stand.code || ""; },
    lead: function (daten) {
      var body = Object.assign({}, daten || {}, { code: stand.code || "", medium: stand.medium || "", quelle: stand.quelle || "", seite: location.href.split("?")[0] });
      return fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true })
        .then(function (r) { return r.json(); })
        .catch(function () { return { ok: false }; });
    },
  };
})();
