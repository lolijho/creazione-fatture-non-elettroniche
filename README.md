# Generatore di Fatture non Elettroniche

Applicazione web self-hosted per creare **fatture non elettroniche in PDF**. Tre modalità di lavoro:

1. **Creazione manuale** tramite interfaccia web
2. **Import da CSV / Excel** (.csv, .xlsx, .ods) con anteprima prima del salvataggio
3. **Integrazione WooCommerce REST API** per importare ordini come fatture

> Le fatture generate sono documenti cartacei/PDF **non validi** ai fini del Sistema di Interscambio (SdI). Un disclaimer viene stampato nel footer.

## Stack

- **Backend:** Node.js + Express
- **Database:** PostgreSQL (via `pg`)
- **PDF:** [pdfkit](https://pdfkit.org/) — i file generati vengono salvati su volume in `${DATA_DIR}/invoices/`
- **Email:** [nodemailer](https://nodemailer.com/) (SMTP generico)
- **Import:** [csv-parse](https://csv.js.org/parse/) + [xlsx](https://github.com/SheetJS/sheetjs)
- **WooCommerce:** REST API v3 via axios
- **Frontend:** HTML + CSS + vanilla JS (nessun build step)

## Requisiti

- Node.js 18+
- PostgreSQL 13+ (qualsiasi istanza accessibile via `DATABASE_URL`)

## Installazione

```bash
npm install
export DATABASE_URL=postgresql://user:password@localhost:5432/fatture
npm start
```

L'app è disponibile su `http://localhost:3000`. Puoi cambiare porta con `PORT=4000 npm start`. Lo schema (`invoices`, `settings`) viene creato automaticamente al primo avvio.

> Se hai un'installazione precedente con `data/invoices.json` e `data/settings.json`, al primo avvio con Postgres i dati vengono migrati automaticamente nel database. Un file `.migrated-to-postgres` in `data/` segna la migrazione come completata.

## Primi passi

1. Vai in **Impostazioni** e compila i dati della tua azienda (ragione sociale, P.IVA, indirizzo, IBAN).
2. Configura prefisso e prossimo numero fattura (es. prefisso `FT-`, numero `1`).
3. Torna nella sezione **Fatture** e crea la prima fattura, oppure importa un file CSV/Excel.

## Formato CSV / Excel

Puoi scaricare il template da `/template-fatture.csv` oppure dal link nella pagina di import.

Colonne supportate (intestazioni case-insensitive, accenti ignorati):

| Colonna | Obbligatoria | Note |
|---|---|---|
| `numero` | no | Se vuoto viene assegnato automaticamente |
| `data` | sì | `YYYY-MM-DD` o `DD/MM/YYYY` |
| `scadenza` | no | |
| `metodo_pagamento` | no | default: Bonifico bancario |
| `note` | no | |
| `cliente_ragione_sociale` | sì | |
| `cliente_indirizzo` | no | |
| `cliente_cap`, `cliente_citta`, `cliente_provincia`, `cliente_paese` | no | |
| `cliente_piva`, `cliente_cf` | no | |
| `cliente_email`, `cliente_telefono` | no | |
| `descrizione` | sì | |
| `codice` | no | |
| `unita_misura` | no | default: `pz` |
| `quantita` | sì | |
| `prezzo_unitario` | sì | Accetta `12,50` o `12.50` |
| `aliquota_iva` | no | default: 22 |
| `sconto_pct` | no | default: 0 |

**Più righe con lo stesso `numero`** (oppure stesso cliente + data se il numero è vuoto) vengono raggruppate in un'unica fattura con più righe.

## WooCommerce

1. Nel tuo backend WordPress vai in **WooCommerce → Impostazioni → Avanzate → REST API**.
2. Crea una nuova chiave con permesso **Lettura** (o Read/Write se vuoi aggiornamenti futuri).
3. In **Impostazioni → WooCommerce** dell'app incolla:
   - URL del negozio (es. `https://miosito.it`)
   - Consumer Key
   - Consumer Secret
4. Vai nella sezione **WooCommerce**, filtra gli ordini e clicca **Importa** per trasformare un ordine in fattura. Il PDF viene generato e la fattura salvata in archivio.

Gli importi delle righe (prezzi, IVA, sconti) e le spedizioni/commissioni vengono mappati automaticamente partendo dai campi dell'ordine WooCommerce.

## Struttura del progetto

```
├── server.js               # Bootstrap Express
├── src/
│   ├── db.js               # Pool Postgres + schema migration
│   ├── storage.js          # Persistenza fatture/settings su Postgres
│   ├── invoice.js          # Calcolo totali e normalizzazione righe
│   ├── pdf.js              # Rendering PDF con pdfkit
│   ├── pdfStore.js         # Persistenza PDF su volume + cache
│   ├── mailer.js           # Invio email SMTP (nodemailer)
│   ├── importer.js         # Parser CSV/Excel → fatture
│   ├── woocommerce.js      # Client REST API + mapping ordine→fattura
│   └── routes/
│       ├── invoices.js
│       ├── settings.js
│       ├── import.js
│       └── woocommerce.js
├── public/                 # Frontend SPA
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── template-fatture.csv
└── data/                   # Volume persistente (PDF, upload, secret.key)
    ├── invoices/           # PDF salvati per ogni fattura (<id>.pdf)
    ├── uploads/            # File temporanei degli import
    └── secret.key          # Chiave di firma sessioni (se SESSION_SECRET non è impostata)
```

## Autenticazione

L'applicazione richiede login con **username e password**. Configura le credenziali tramite variabili d'ambiente:

| Variabile | Descrizione |
|---|---|
| `AUTH_USERNAME` | Nome utente (default: `admin`) |
| `AUTH_PASSWORD` | Password in chiaro (bcryptata in memoria all'avvio) |
| `AUTH_PASSWORD_HASH` | In alternativa, hash bcrypt precalcolato |
| `SESSION_SECRET` | Chiave di firma dei token di sessione (min. 16 caratteri). Se omessa viene generata e salvata in `data/secret.key` |
| `COOKIE_SECURE` | `true` per richiedere HTTPS sul cookie di sessione (consigliato in produzione) |

Se non imposti alcuna password l'app parte con `admin/changeme` stampando un warning a console: **non lasciare questa configurazione su un server esposto**.

Per generare un hash bcrypt da usare con `AUTH_PASSWORD_HASH`:

```bash
node -e "console.log(require('bcryptjs').hashSync('la-mia-password',10))"
```

Per generare un session secret casuale:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Il cookie di sessione è `httpOnly`, `SameSite=Lax` e dura 30 giorni. Puoi uscire con il pulsante **Esci** in alto a destra.

## Email (invio fatture al cliente)

Dalla dashboard, ogni fattura ha un bottone **Invia email**: il PDF viene allegato e spedito via SMTP all'indirizzo del cliente (puoi confermarlo o modificarlo nel prompt).

Configura le credenziali SMTP via variabili d'ambiente:

| Variabile | Descrizione |
|---|---|
| `SMTP_HOST` | Host SMTP del provider (es. `smtp.resend.com`, `smtp.brevo.com`, `smtp.gmail.com`) |
| `SMTP_PORT` | Porta (587 STARTTLS, 465 TLS implicito) |
| `SMTP_SECURE` | `true` per TLS implicito (porta 465); `false` per STARTTLS |
| `SMTP_USER` | Utente SMTP (se richiesto dal provider) |
| `SMTP_PASS` | Password / API key SMTP |
| `SMTP_FROM` | Mittente, es. `"Mio Studio <fatture@example.com>"` |
| `SMTP_REPLY_TO` | Opzionale: indirizzo Reply-To |

Oggetto e corpo dell'email sono personalizzabili in **Impostazioni → Email** con i placeholder `{numero}`, `{data}`, `{cliente}`, `{azienda}`, `{totale}`, `{scadenza}`.

## Deploy su Coolify

Il progetto include un `Dockerfile` pronto all'uso.

1. In Coolify crea prima un **PostgreSQL** add-on (o un database esterno) e copia la sua URL di connessione interna.
2. Crea una nuova **Resource → Application** e collega il repository.
3. **Build pack:** Dockerfile.
4. **Port esposta:** `3000`.
5. **Persistent volume:** monta un volume sul path `/data` (qui vengono salvati i PDF generati in `/data/invoices/`, gli upload temporanei e la chiave di sessione).
6. **Variabili d'ambiente** (copia da `.env.example`):
   - `DATABASE_URL` — URL Postgres del passo 1
   - `AUTH_USERNAME` — il tuo username
   - `AUTH_PASSWORD` *oppure* `AUTH_PASSWORD_HASH`
   - `SESSION_SECRET` — stringa random di almeno 32 caratteri
   - `COOKIE_SECURE=true` (Coolify espone sempre HTTPS con Traefik)
   - `DATA_DIR=/data` (già default nel Dockerfile)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — per l'invio email (opzionale finché non vuoi mandare fatture)
7. Abilita il dominio HTTPS e salva. Coolify userà la `HEALTHCHECK` del Dockerfile (`/api/health`).

Lo schema Postgres viene creato automaticamente al primo avvio. Se l'app parte prima del database, l'inizializzazione fa retry esponenziale per ~1 minuto.

### Build locale del container (per test)

```bash
docker build -t fatture .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host.docker.internal:5432/fatture \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=supersegreta \
  -e SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  -v $(pwd)/data:/data \
  fatture
```

## Backup

Fai backup di:

- **Database Postgres** — fatture e impostazioni (usa `pg_dump`)
- **Volume `/data`** — PDF generati in `/data/invoices/` e `secret.key`

> Se ricostruisci da zero: ripristina il dump Postgres e i PDF da `/data/invoices/`. Eventuali PDF mancanti vengono rigenerati automaticamente al primo accesso (i dati delle fatture sono in DB).

## Licenza

MIT
