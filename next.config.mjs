/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright liest zur Laufzeit browsers.json – Vercel packt die Datei sonst nicht mit ein.
  serverExternalPackages: ["playwright-core", "ssh2", "ssh2-sftp-client", "basic-ftp"],
  outputFileTracingIncludes: {
    "/api/buchung/**/*": ["./node_modules/playwright-core/**/*"],
  },
  // Bilder aus dem Prototyp (Claude-Artifact) hatten Adressen wie /_blob/<id>. Sie liegen jetzt unter /bilder/<id>.jpg.
  async rewrites() {
    return [{ source: "/_blob/:id", destination: "/bilder/:id.jpg" }];
  },
};
export default nextConfig;
