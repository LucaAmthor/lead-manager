/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bilder aus dem Prototyp (Claude-Artifact) hatten Adressen wie /_blob/<id>. Sie liegen jetzt unter /bilder/<id>.jpg.
  async rewrites() {
    return [{ source: "/_blob/:id", destination: "/bilder/:id.jpg" }];
  },
};
export default nextConfig;
