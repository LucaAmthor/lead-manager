import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Erneuert die Supabase-Sitzung und schickt nicht angemeldete Besucher zum Login.
// Kurz-Domains (z. B. go.modernisieren24.de): jeder Pfad ist ein Anzeigen-Code → /r/<code>
const KURZ_HOSTS = (process.env.KURZLINK_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

export async function proxy(request) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  if (KURZ_HOSTS.includes(host)) {
    const url = request.nextUrl.clone();
    const code = url.pathname.replace(/^\/+|\/+$/g, "");
    url.pathname = code ? `/r/${code}` : "/r/start";
    return NextResponse.rewrite(url);
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const offen = path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/api") || path.startsWith("/r/");
  if (!user && !offen) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|bilder/|_blob/|lokalpilot.js|lp-tracking.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico|wav)$).*)"],
};
