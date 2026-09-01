# Backend gry (konta, ranking, reset hasła)

Funkcje serverless w katalogu `api/` (Vercel, Node 24). Baza: **Turso / libSQL**.
Maile: **Resend**. Front (`src/`) rozmawia z backendem przez `src/net.ts`; gdy
backendu nie ma (test, `file://`, brak sieci) działa lokalna atrapa na
`localStorage`, więc gra nie przestaje działać offline.

## Endpointy

| Metoda | Ścieżka                 | Opis                                             |
| ------ | ----------------------- | ------------------------------------------------ |
| POST   | `/api/auth/register`    | `{email,password,password2,terms,marketing}` → `{token}` |
| POST   | `/api/auth/login`       | `{email,password}` → `{token,nick}`              |
| GET    | `/api/auth/me`          | Bearer → dane konta                              |
| POST   | `/api/auth/forgot`      | `{email}` → zawsze `{ok:true}` (wysyła mail)     |
| POST   | `/api/auth/reset`       | `{token,password}` → `{ok:true}` (z linka w mailu) |
| POST   | `/api/account`          | Bearer `{action:"nick"\|"marketing"\|"delete"}`  |
| GET    | `/api/scores?songId=`   | top 50 + moje miejsce                            |
| POST   | `/api/scores`           | Bearer `{songId,score,stars}` → `{best,rank}`    |

Schemat bazy tworzy się sam przy pierwszym żądaniu (`CREATE TABLE IF NOT EXISTS`).

## Konfiguracja — kroki jednorazowe

### 1. Baza Turso

```bash
turso db create denis-game
turso db show denis-game --url          # -> TURSO_DATABASE_URL
turso db tokens create denis-game       # -> TURSO_AUTH_TOKEN
```

(Bez CLI: to samo z panelu https://turso.tech → Create Database → Create Token.)

### 2. Resend (maile)

1. Załóż konto na https://resend.com (darmowy plan: 3000 maili/mies.).
2. https://resend.com/api-keys → **Create API Key** (uprawnienie *Sending*) → `RESEND_API_KEY`.
3. **Tryb testowy (teraz):** bez własnej domeny Resend dostarcza maile **tylko na
   adres właściciela konta** (czyli e-mail, na który założono Resend). Do testów
   resetu hasła używaj tego adresu.
4. **Docelowo:** w Resend → Domains dodaj np. `impulsywni.pl` (3 rekordy DNS),
   a potem ustaw `MAIL_FROM="Denis Impulsywni Live <no-reply@impulsywni.pl>"`.
   Dopiero wtedy maile dojdą do dowolnego użytkownika.

### 3. Zmienne środowiskowe na Vercel

```bash
cd "D:/Projekty/denis-game"
npx vercel env add TURSO_DATABASE_URL production
npx vercel env add TURSO_AUTH_TOKEN production
npx vercel env add RESEND_API_KEY production
npx vercel env add APP_URL production          # https://denis-game.vercel.app
# opcjonalnie, po weryfikacji domeny:
npx vercel env add MAIL_FROM production
```

Powtórz dla `preview` i `development`, jeśli chcesz testować lokalnie przez
`vercel dev`. Do lokalnego dev-a (`npm run dev`) backend nie działa — front sam
przełącza się na atrapę offline. Żeby lokalnie uderzać w produkcyjne API:
ustaw `VITE_API_BASE=https://denis-game.vercel.app` w `.env.local`.

### 4. Deploy

```bash
npx vercel deploy --prod --yes
```

## Bezpieczeństwo / TODO

- Hasła: `scrypt` z solą (Node crypto). OK na start.
- Sesje: nieprzezroczysty token w tabeli `sessions`, ważny 180 dni, kasowany
  przy zmianie hasła. Brak rotacji / rate-limitu logowania — do dodania.
- `forgot` nie ujawnia, czy adres istnieje. Token resetu: 1h, jednorazowy,
  trzymany jako SHA-256.
- Brak weryfikacji adresu e-mail przy rejestracji (double opt-in) — do dodania
  razem z domeną Resend.
- Sign in with Apple / Google: `loginSocial()` to wciąż atrapa; docelowo osobny
  endpoint wymieniający token dostawcy.
- Rozważyć rate-limit (np. Upstash) na `login` / `forgot` / `register`.
