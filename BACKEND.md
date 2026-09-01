# Backend gry (konta + ranking)

Funkcje serverless w katalogu `api/` (Vercel, Node 24). Baza: **Turso / libSQL**.
Model kont: **login + hasło** (bez e-maila, bez odzyskiwania hasła — świadoma
decyzja, patrz `regulamin.html` § 4). Front (`src/`) rozmawia z backendem przez
`src/net.ts`; gdy backendu nie ma (test, `file://`, brak sieci, brak konfiguracji)
działa lokalna atrapa na `localStorage`, więc gra nie przestaje działać offline.

## Endpointy

| Metoda | Ścieżka                | Opis                                              |
| ------ | ---------------------- | ------------------------------------------------- |
| POST   | `/api/auth/register`   | `{login,password,password2,terms}` → `{token}`    |
| POST   | `/api/auth/login`      | `{login,password}` → `{token,login,nick}`         |
| GET    | `/api/auth/check?login=` | `{available: bool}` — podpowiedź „login zajęty"  |
| GET    | `/api/auth/me`         | Bearer → dane konta                               |
| POST   | `/api/account`         | Bearer `{action:"nick"\|"delete"}`                |
| GET    | `/api/scores?songId=`  | top 50 + moje miejsce                             |
| POST   | `/api/scores`          | Bearer `{songId,score,stars}` → `{best,rank}`     |

- Schemat bazy tworzy się sam przy pierwszym żądaniu (`CREATE TABLE IF NOT EXISTS`,
  `api/_lib/schema.ts`), łącznie z lekką migracją ze starego modelu (email → login).
- Hasła: `scrypt` + sól (`api/_lib/util.ts`). Sesje: token w tabeli `sessions`
  (180 dni). Login jest unikalny bez rozróżniania wielkości liter
  (`CREATE UNIQUE INDEX ON users(lower(login))`).
- `login` jest zarazem nazwą w rankingu; `users.nick` to opcjonalna nazwa
  wyświetlana (na przyszłość) — ranking pokazuje `COALESCE(NULLIF(nick,''), login)`.

## Konfiguracja — kroki jednorazowe

### 1. Baza Turso

Na koncie Turso, na którym stoją bazy `koncerty` itd. (`konradkasznia`):

```bash
turso db create denis-game
turso db show denis-game --url        # -> TURSO_DATABASE_URL
turso db tokens create denis-game     # -> TURSO_AUTH_TOKEN
```

(Bez CLI: panel https://turso.tech → Create Database → Create Token.)

### 2. Zmienne środowiskowe na Vercel

```bash
cd "D:/Projekty/denis-game"
npx vercel env add TURSO_DATABASE_URL production
npx vercel env add TURSO_AUTH_TOKEN production
```

Powtórz dla `preview`, jeśli chcesz testować przez `vercel dev`. Do lokalnego dev
(`npm run dev`) backend nie działa — front sam przełącza się na atrapę offline.
Żeby lokalnie uderzać w produkcyjne API: ustaw
`VITE_API_BASE=https://denis-game.vercel.app` w `.env.local`.

### 3. Deploy

```bash
npx vercel deploy --prod --yes
```

Status obecny: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` ustawione, backend
przetestowany end-to-end na produkcji.

## Do zrobienia / świadomie pominięte

- **Brak odzyskiwania hasła** — rozważyć jednorazowy kod odzyskiwania pokazany raz
  przy rejestracji.
- **Tryb gościa** — gra powinna dać się odpalić bez konta (App Store 5.1.1).
- Rate-limit na `login` / `register` / `check` (np. Upstash).
- Usuwanie konta przez WWW (wymóg Google Play, obok usuwania w apce).
- Sign in with Apple / Google — świadomie NIE wprowadzane (brak social = brak
  wymogu Sign in with Apple wg wytycznej 4.8).
- Dokumenty `regulamin.html` / `polityka-prywatnosci.html` — projekty z
  `[[PLACEHOLDER]]`, wymagają uzupełnienia i przeglądu prawnika.
