// Ochrona edytora beatmap hasłem (HTTP Basic Auth, Vercel Edge Middleware).
// Hasło w zmiennej środowiskowej EDITOR_PASSWORD (login dowolny).
// Gra, API i dokumenty prawne NIE są objęte — matcher tylko na /editor.

export const config = {
  matcher: ["/editor", "/editor.html", "/editor/:path*"],
};

export default function middleware(request: Request): Response | undefined {
  const pass = process.env.EDITOR_PASSWORD;
  if (!pass) return undefined; // brak hasła w env -> nie blokuj (np. lokalnie)

  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const provided = decoded.slice(decoded.indexOf(":") + 1);
      if (provided === pass) return undefined;
    } catch {
      /* zła wartość -> 401 poniżej */
    }
  }

  return new Response("Edytor beatmap — wymagane logowanie.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Edytor beatmap DENIS", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
