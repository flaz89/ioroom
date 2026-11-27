# Dispositivi IoT nel progetto

Obiettivo (Flavio, 27/11): un utente medio compra dispositivi su Amazon, li attiva a casa, apre ioroom, segue le
istruzioni, incolla un URL, e da lì li vede e li comanda nella scena (luce che si accende, temperatura che varia,
termostato, telecamera). Chi configura è l'account "pro" (progettista per i suoi clienti, o il privato che si
progetta casa); i dispositivi stanno A CASA DELL'UTENTE; gli OSPITI (il cliente, col link del progetto che resta
per sempre) devono poterli comandare.

Hardware di prova: Shelly 1 Mini Gen4 (relè + gateway Bluetooth), Shelly BLU H&T (temperatura/umidità, BLE, da
comprare), ESP32-CAM. Arduino UNO R4 escluso (decisione di Flavio 27/11: non è plug & play; come gateway troppo
limitato).

## Decisioni di architettura
- IL DISPOSITIVO CHIAMA NOI: è lui ad aprire una WebSocket verso il Worker (Shelly: "Outbound WebSocket", di
  serie su Gen2/3/4). Niente porte aperte, tunnel, IP di casa né Home Assistant. Il browser non parla MAI con i
  dispositivi (HTTPS → LAN è bloccato: mixed content, CORS, Private Network Access).
- Il CENTRALINO è il Durable Object `Room` della stanza: stessa URL della stanza con la chiave del dispositivo,
  `wss://<host>/parties/rooms/<room>?device=<chiave>`; `onConnect` la riconosce e NON la passa a Yjs
  (`super.onConnect` solo per i client dell'app). Una chiave segreta per connessione, generata da "Add device",
  rigenerabile (la vecchia smette di funzionare).
- UNA CONNESSIONE, PIÙ DISPOSITIVI: il Mini è una connessione che espone il relè (`switch:0`) e i sensori BLU che
  gli fanno da gateway (`bthomesensor:2xx`). Domani un gateway (Home Assistant, hub Zigbee) è una connessione con
  50 entità. L'app vede solo ENTITÀ con una CAPACITÀ, mai il protocollo.
- TRADUTTORI per famiglia sul server (`server/src/iot/<famiglia>.js`): protocollo del dispositivo ↔ modello
  comune. Primo: Shelly RPC (JSON-RPC: `NotifyStatus` / `NotifyFullStatus` / `NotifyEvent` in arrivo,
  `Switch.Set`, `Number.Set` in uscita). Aggiungere una marca = un traduttore, la scena non cambia.
- CAPACITÀ comuni (modello unico, chiuso, una riga per aggiungerne una):
  `switch { on }`, `light { on, brightness?, color? }`, `sensor { temperature?, humidity?, contact?, motion?,
  power?, battery? }`, `thermostat { current, target, heating }`, `cover { position }` (tapparelle: si legano
  alle FINESTRE della pianta), `camera { }` (stream a richiesta).
- DATI:
  - configurazione (connessioni, entità, nomi, permessi) = storage del Durable Object, MAI nel documento Yjs: la
    chiave non deve arrivare agli ospiti;
  - legami entità ↔ elemento della scena = documento Yjs (Y.Map "iot": `{ <elemento>: { entity } }`, elemento =
    id di un oggetto, di un'apertura o di un pavimento/stanza), sincronizzati e annullabili come i materiali;
  - valori live = messaggi custom della stanza (come la voce) + ultimo valore e ora salvati nello storage
    (un sensore a batteria dorme: "aggiornato 12 min fa" anche dopo un riavvio del Durable Object), consegnati a
    chi entra. Fuori dall'undo, come le porte aperte.
- COMANDI via HTTP: `POST /api/rooms/:id/iot/:entity` `{ action, value }`. Il server controlla: entità che
  accetta comandi dagli ospiti OPPURE header admin. Così il permesso è verificato SUL SERVER senza autenticare la
  WebSocket. Limite: un comando ogni 300 ms per entità (niente accendi/spegni a raffica sulla 230 V). Lo stato
  mostrato è sempre quello che RISPONDE il dispositivo, mai ottimistico (al più "in attesa…").
- PERMESSI per entità, decisi dal pro: "Gli ospiti possono comandarlo" (default NO), "Gli ospiti vedono la camera"
  (default NO). Le letture dei sensori sono sempre visibili.

## Esperienza dell'utente (abbinamento)
1. Pannello "Devices" (Designer, solo pro) → "Add device" → scelta della marca/tipo (all'inizio: Shelly).
2. Istruzioni passo passo per QUEL tipo (con immagini): app Shelly o pagina del dispositivo → Settings →
   Connectivity → Outbound WebSocket → incolla l'URL (bottone Copia + QR) → Save.
3. ioroom mostra "In attesa…" → "Online" appena arriva la prima connessione, con le entità trovate (relè,
   sensori BLU già abbinati al Mini); l'utente dà un nome a ciascuna ("Luce soggiorno").
4. Legame: selezionato un oggetto (lampada) o una finestra → scheda → "Collega dispositivo" → elenco delle entità
   compatibili. Da lì clic = comando.
Stati da mostrare sempre: online / offline / dorme (batteria) / ultimo aggiornamento / errore del comando.

## Visualizzazione
- Luce / switch: emissivo sul pezzo + al massimo poche `pointLight` senza ombre in tutta la scena (Quest 2: ogni
  luce dinamica costa); clic sul pezzo = comando (stessa regola delle porte: non a fine orbit, non con
  righello/note).
- Temperatura: etichetta in stile HUD (come le note) con valore, umidità, "12 min fa"; alone caldo/freddo
  sull'elemento o tinta del pavimento della stanza legata.
- Termostato: etichetta + setpoint modificabile (− / + su schermo, VRButton in VR), indicatore "sta scaldando".
- Telecamera: icona sul pezzo → pannello con il video (schermo) / texture su pannello con barra di presa (VR).
- Tour: gli elementi IoT sono interagibili (previsto nel piano Tour).

## Passi
1. Centralino: connessioni dei dispositivi in `Room` (chiave, `onConnect` separato da Yjs), API admin
   `/api/rooms/:id/devices` (crea connessione → URL, rinomina entità, permessi, rigenera chiave, elimina),
   comando HTTP con controllo dei permessi e limite, valori live ai client + ultimo valore salvato.
   SIMULATORE: `server/iot.check.mjs` finge uno Shelly (si collega a `wrangler dev`, manda `NotifyFullStatus`,
   risponde a `Switch.Set`): si sviluppa senza hardware ed è il check del protocollo.
2. Traduttore Shelly + relè del Mini legato a una lampada in scena (desktop e VR), pannello Devices con le
   istruzioni.
3. BLU H&T attraverso il Mini (componenti BTHome nello stato del Mini): temperatura in scena, stato "dorme".
4. Termostato di prova: sul Mini un componente virtuale `number:200` (setpoint) + script di poche righe
   (temperatura BLU vs setpoint → relè, con isteresi); ioroom scrive il setpoint con `Number.Set`; una lampada
   sul relè fa da "caldaia". Stessa capacità `thermostat` che useranno i termostati veri.
5. Telecamera ESP32-CAM: protocollo JSON nostro (firmware di riferimento nel repo), fotogrammi JPEG sulla
   WebSocket SOLO mentre qualcuno guarda (start/stop dal server), canvas → pannello / texture VR.
6. Dopo: sensori BLU di contatto/movimento, tapparelle (Shelly 2PM Gen4 in modalità cover) legate alle finestre.

## Scalabilità: cosa compra l'utente medio e come ci arriveremo
| Cosa ha in casa | Come si collega | Esperienza |
|---|---|---|
| Shelly (relè, prese, tapparelle, sensori BLU) | Outbound WebSocket → noi | incolla un URL (MVP) |
| Dispositivi solo-cloud: Tuya / Smart Life (la maggior parte dei marchi economici su Amazon), Philips Hue, TP-Link Tapo/Kasa, Meross, SwitchBot, Netatmo, tado | API cloud del marchio con OAuth | bottone "Collega account <marca>" (login, nessun URL); alcuni richiedono un account sviluppatore / approvazione del marchio |
| Matter / Thread | nessuna API cloud: serve un controller locale | tramite Home Assistant o un hub con API |
| Home Assistant | una connessione = tutte le sue entità | URL + token di HA (o add-on che chiama noi) |
| Fai da te (ESP32, ESPHome) | il nostro protocollo JSON | URL nel firmware |
| Telecamere di marca (Tapo, Reolink…) | di solito solo RTSP in LAN, niente API cloud aperte | serve un ponte locale: il caso più difficile da rendere plug & play |
Regola: ogni riga è un traduttore verso le stesse capacità; il pannello Devices mostra per ogni marca il suo
modo di abbinamento (URL o login).

## Costi (Cloudflare, 27/11; l'MVP deve stare nel piano GRATUITO)
Piano gratuito, Durable Objects (azzerati ogni giorno alle 00:00 UTC; superato un limite le operazioni di quel
tipo FALLISCONO): 100.000 richieste, 13.000 GB-s di durata (= ~29 ore di stanza sveglia AL GIORNO in tutto, a
128 MB), 100.000 righe scritte, 5 GB salvati. Durata = tempo da sveglio; messaggi WebSocket in arrivo contati
1 ogni 20, quelli in uscita gratis.
- I dispositivi restano collegati 24 ore su 24: con socket normali UNA casa terrebbe la sua stanza sveglia 24 h =
  83% della durata gratuita del giorno, due case la superano. Quindi `Room` passa a HIBERNATION
  (`static options = { hibernate: true }` di partyserver; y-partyserver la supporta: lo stato delle connessioni
  sopravvive negli attachment): da ferma non paga, si sveglia per un messaggio e torna a dormire.
- Nessun timer mentre ci sono solo dispositivi: il controllo delle presenze (`startPresenceTimeout`, un
  `setInterval` che tiene sveglio l'oggetto) conta solo le connessioni dell'APP, non quelle dei dispositivi.
- Ultimo valore di un sensore nello storage: al massimo una scrittura al minuto per entità (righe scritte).
- Dispositivi che parlano troppo (es. misure di potenza ogni secondo): il traduttore ignora i cambiamenti sotto
  soglia, così non svegliano la stanza per niente.
- La camera costa poco (10 fps = ~1.800 richieste contate e ~450 GB-s per ora di visione), ma tiene sveglio
  l'oggetto: fotogrammi solo mentre qualcuno guarda.

## Decisioni successive (Flavio, 27/11)
- L'amministratore del progetto può togliere l'accesso agli ospiti (revoca del link): da fare insieme ai permessi.
- Con gli account: i dispositivi appartengono all'ACCOUNT ma sono raggruppati per PROGETTO (casa del cliente);
  per l'MVP stanno nella stanza, migrazione quando arrivano gli account.

## Aperte
- Privacy della camera: nessun fotogramma salvato, solo inoltro; registrazioni mai.
