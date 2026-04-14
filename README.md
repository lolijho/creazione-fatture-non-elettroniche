# Generatore di Fatture non Elettroniche

Applicazione web self-hosted per creare **fatture non elettroniche in PDF**. Tre modalità di lavoro:

1. **Creazione manuale** tramite interfaccia web
2. **Import da CSV / Excel** (.csv, .xlsx, .ods) con anteprima prima del salvataggio
3. **Integrazione WooCommerce REST API** per importare ordini come fatture

> Le fatture generate sono documenti cartacei/PDF **non validi** ai fini del Sistema di Interscambio (SdI). Un disclaimer viene stampato nel footer.

## Stack

- **Backend:** Node.js + Express
- **PDF:** [pdfkit](https://pdfkit.org/)
- **Import:** [csv-parse](https://csv.js.org/parse/) + [xlsx](https://github.com/SheetJS/sheetjs)
- **WooCommerce:** REST API v3 via axios
- **Frontend:** HTML + CSS + vanilla JS (nessun build step)
- **Storage:** file JSON in `data/` (niente database)

## Requisiti

- Node.js 18+

## Installazione

```bash
npm install
npm start
```

L'app è disponibile su `http://localhost:3000`. Puoi cambiare porta con `PORT=4000 npm start`.

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
│   ├── storage.js          # Persistenza su file JSON
│   ├── invoice.js          # Calcolo totali e normalizzazione righe
│   ├── pdf.js              # Rendering PDF con pdfkit
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
└── data/                   # Creato al primo avvio (invoices.json, settings.json)
```

## Backup

Fai backup della cartella `data/`: contiene tutte le fatture (`invoices.json`) e le impostazioni (`settings.json`).

## Licenza

MIT
