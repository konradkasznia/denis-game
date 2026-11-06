// Prototyp rundy „Fotograf weselny" — tylko dla wybranych kont.
// Kod gry nie leży w public/: z tokenem sesji z gry (ten sam localStorage,
// ta sama domena) prosimy API o bilet ważny minutę, a potem ładujemy kod
// zwykłym <script src> z tej samej domeny (bez luzowania CSP).
(async () => {
  const msg = document.getElementById("gateMsg");
  const btn = document.getElementById("gateBtn");
  const deny = (text, login) => { msg.textContent = text; if (login) btn.hidden = false; };
  let token = "";
  try { token = localStorage.getItem("denis.token") || ""; } catch (_) { /* brak dostępu do pamięci */ }
  if (!token) return deny("Zaloguj się najpierw w grze w tej przeglądarce, a potem wróć na tę stronę.", true);
  let r;
  try {
    r = await fetch("/api/auth/me?proto=fotograf-ticket", { headers: { authorization: "Bearer " + token }, cache: "no-store" });
  } catch (_) {
    return deny("Brak połączenia. Spróbuj ponownie za chwilę.");
  }
  if (r.status === 401) return deny("Sesja wygasła. Zaloguj się ponownie w grze.", true);
  if (r.status === 403) return deny("Ta runda jest jeszcze w testach i nie jest dostępna dla Twojego konta.");
  if (!r.ok) return deny("Coś poszło nie tak. Spróbuj ponownie za chwilę.");
  const { ticket } = await r.json();
  const s = document.createElement("script");
  s.src = "/api/auth/me?proto=fotograf&ticket=" + encodeURIComponent(ticket);
  s.onload = () => { document.getElementById("gate").hidden = true; document.getElementById("intro").hidden = false; };
  s.onerror = () => deny("Nie udało się wczytać gry. Odśwież stronę.");
  document.body.appendChild(s);
})();
