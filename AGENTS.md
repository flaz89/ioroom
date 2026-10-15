# ioroom — Riassunto del Progetto

## Scopo
Un'applicazione web 3D interattiva dedicata all'arredo in realtà virtuale (VR) e realtà aumentata (AR). L'utente può selezionare mobili e oggetti di arredo da un catalogo, posizionarli in uno spazio virtuale (stanza o ambiente esterno) e spostarli liberamente per comporre ambienti personalizzati, simulando un vero e proprio progetto di interior design immersivo. L'applicazione supporta tre modalità di utilizzo: flatscreen (desktop), VR immersivo con visore, e AR per sovrapporre gli oggetti al mondo reale tramite fotocamera del dispositivo. L'obiettivo è rendere l'esperienza di arredamento intuitiva, realistica e accessibile direttamente dal browser, senza la necessità di software esterni.

## Stack Tecnologico
- **React 19.3** con **Vite 8** come bundler
- **Three.js** (r186): **WebGPURenderer** su flatscreen quando disponibile, **WebGLRenderer** in VR/AR (WebXR non supporta WebGPU) e come fallback
- **@react-three/fiber** e **@react-three/drei** per l'integrazione React-Three
- **@react-three/xr** per il supporto VR/AR immersivo, **@react-three/handle** per grab/pinch degli oggetti
- **Zustand** per la gestione dello stato globale (slices modulari)
- Pannello performance custom (PerfSampler + PerfPanel), funziona sia su WebGL sia su WebGPU
- Deploy su **Vercel**

## Struttura del Progetto

```
ioroom/
├── index.html                  # Entry point HTML (monta #root, carica font SUSE Mono)
├── vite.config.js              # Plugin React + Basic SSL, server con host aperto
├── package.json                # Dipendenze e script (dev, build, deploy, lint, preview)
├── src/
│   ├── main.jsx                # Render React (StrictMode, createRoot)
│   ├── App.jsx                 # Componente principale: UI (Left/Right toolbar) + Scene 3D
│   ├── index.css               # Reset globale (margin/padding 0, overflow hidden)
│   ├── app.css                 # Stili container UI e scena (gradienti di sfondo)
│   │
│   ├── components/
│   │   ├── scene/
│   │   │   ├── Scene.jsx       # Canvas 3D (Canvas di React-Three, WebGPU check, Grid, Light, Level)
│   │   │   ├── scene.css       # Stili canvas (glassmorphism, backdrop-filter)
│   │   │   ├── controls/pivot-controls/  # Copia di drei PivotControls con Line compatibile WebGL/WebGPU (vedi header index.js)
│   │   │   ├── xr-ui/          # UI 3D per VR/AR: WristMenu (polso sinistro, visibile solo se rivolto verso gli occhi: useFacingViewer), VRButton, VRStatsPanel, VRCatalogPanel (canvas texture)
│   │   │   ├── perf/PerfSampler.jsx  # Legge renderer.info dopo il render (addAfterEffect) + GPU time WebGPU
│   │   │   ├── helpers/
│   │   │   │   ├── SceneGrid.jsx         # drei Grid su WebGL, GridHelper su WebGPU
│   │   │   │   └── SelectionOutline.jsx  # drei Outlines su WebGL, inverted hull TSL su WebGPU
│   │   │   └── level/
│   │   │       ├── Level.jsx           # Livello principale (logica VR/AR/Flatscreen)
│   │   │       ├── Board.jsx           # Radice stanza+oggetti: identità a 1:1, plastico in modalità tabletop
│   │   │       ├── Room.jsx            # Stanza (pavimento + 3 muri)
│   │   │       ├── ObjectRenderer.jsx  # Renderizza tutti gli oggetti dalla store
│   │   │       └── SingleObject.jsx    # Singolo oggetto 3D (PivotControls per manipolazione)
│   │   │
│   │   ├── light/
│   │   │   └── Light.jsx       # Luci (ambientale + direzionale con ombre)
│   │   │
│   │   └── ui/
│   │       ├── LeftToolBar.jsx     # Toolbar sinistra (settings + performance toggle)
│   │       ├── RightToolBar.jsx    # Toolbar destra (grid, add, delete, VR, AR, fullscreen)
│   │       ├── ui.css              # Stili toolbars (glassmorphism)
│   │       ├── perf-panel/         # Pannello performance DOM (FPS, frame/GPU ms, draw calls, memoria)
│   │       ├── circle-button/
│   │       │   ├── CircleButton.jsx  # Bottone circolare riutilizzabile (SVG + testo)
│   │       │   └── circle-button.css # Stili bottone (gradienti, hover, active, disabled)
│   │       └── objects-menu/
│   │           ├── ObjectsMenu.jsx     # Menu per aggiungere oggetti primitivi
│   │           └── objects-menu.css    # Stili menu (tab, lista oggetti, scrollbar)
│   │
│   ├── store/
│   │   ├── appStore.js           # Store Zustand principale (merge delle slices)
│   │   └── slices/
│   │       ├── gridSlice.js      # Toggle visibilità griglia
│   │       ├── settingSlice.js   # Toggle visibilità pannello performance
│   │       ├── objectsSlice.js   # CRUD oggetti (add, select, deselect, update, remove)
│   │       ├── rendererSlice.js  # Backend del renderer (webgpu/webgl), supporto WebGPU
│   │       ├── perfSlice.js      # Statistiche performance (pubblicate ~2 volte al secondo)
│   │       └── viewSlice.js      # Vista XR: 'life' (1:1) | 'tabletop' (plastico)
│   │
│   ├── xr/
│   │   └── xrStore.js            # XR store condiviso + enterXR(): passa a WebGL, poi apre la sessione
│   │
│   └── utils/
│       └── svg-logos.jsx         # Loghi SVG per l'interfaccia (icons UI)
│
└── public/
    └── vite.svg                  # Favicon
```

## Come Eseguirlo

```bash
npm install          # Installa le dipendenze
npm run dev          # Avvia il server di sviluppo (Vite + HTTPS)
npm run build        # Build di produzione
npm run deploy       # Deploy su Vercel
npm run lint         # ESLint
npm run preview      # Preview della build
npm run sync:dev     # Server stanze condivise in locale (wrangler dev, localhost:8787)
npm run sync:deploy  # Deploy del server stanze su Cloudflare (Workers + Durable Objects)
```

## Stanze condivise (multi-dispositivo)
- Server: `server/` (Cloudflare Worker, dipendenze proprie: `npm --prefix server install`). Ogni stanza = un Durable Object (classe `Room`, binding `Rooms` → URL `/parties/rooms/<id>`) con un documento Yjs salvato nel suo storage; una stanza = un ambiente salvato.
- Client: `src/sync/roomSync.js`, collegato in `App.jsx`. Stanza da `?room=<id>` nell'URL (senza: modalità locale). Sincronizza solo `objects.instances` (oggetto intero, l'ultima scrittura vince); selezione, grab e impostazioni restano per dispositivo.
- Presenza: `src/sync/presence.js` (awareness Yjs, non salvato). Movimento live durante i drag (~15 aggiornamenti/s, nessun invio se l'oggetto è fermo) e blocco: un oggetto tenuto da un altro dispositivo non si prende, sposta, ruota né cancella e ha il contorno del suo colore; in caso di presa simultanea vince il client id più basso. Puntatori: dove punta il mouse/touch di chi è su desktop/mobile appare agli altri come freccia 3D colorata con nome (`components/scene/presence/RemotePointers.jsx`, dentro la Board). Avatar VR: testa con visore + mani/controller low-poly del colore dell'utente con nome (`components/scene/presence/RemoteAvatars.jsx`, spazio Board, scala 1/scala board: in tabletop l'utente appare "gigante" sul plastico). Utenti attivi in alto a sinistra (`components/ui/room-users/`): colore + nome del dispositivo (per ora dallo user agent).
- Condivisione: bottone Share (`components/ui/share-panel/`) con QR e link della stanza; in locale usa `VITE_PUBLIC_URL` così il link punta all'app online.
- Accesso (fase di sviluppo): solo il proprietario gestisce le stanze, tramite l'API "I miei ambienti" del Worker (`/api/rooms`: lista, crea, rinomina, duplica, elimina; header `Authorization: Bearer <ADMIN_TOKEN>`, secret del Worker: `npx wrangler secret put ADMIN_TOKEN` in `server/`). L'elenco sta nel Durable Object `RoomRegistry` (le stanze non sono enumerabili altrimenti). La WebSocket non crea stanze: quelle inesistenti o eliminate chiudono con codice 4004. Sui propri dispositivi si apre una volta l'app con `?admin=<token>` (salvato in localStorage); solo allora compare il bottone Condividi. Gli ospiti entrano solo con link esistenti, altrimenti restano in modalità locale (`components/ui/room-notice/`). Check dell'API: `node server/api.check.mjs` (con `wrangler dev` e `ADMIN_TOKEN=test` in `server/.dev.vars`).
- Configurazione: `VITE_SYNC_HOST` (vedi `.env.example`), anche nelle variabili d'ambiente di Vercel. Se vuota l'app funziona solo in locale.

## Sole, bussola e pannelli (UI)
- Sole: `components/scene/sun/` — `sun.js` (posizione del sole SunCalc low-precision, ora locale → UTC con fuso/ora legale, elenco città; check: `node src/components/scene/sun/sun.check.mjs`), `sunLighting.js` (intensità/colore luce, `skyMarkers`: sole di giorno, luna simbolica opposta di notte), `SunArc.jsx` (arco + sfera mentre si muovono gli slider giorno/ora, sempre sopra i muri), `format.js`.
- Impostazioni nello store `sun` (`cityId`, `day`, `minutes`, `northDeg`), sincronizzate nell'ambiente da `sync/sunSync.js` (Y.Map "sun", un campo per chiave). Città e nord: solo admin (regola solo UI per ora).
- La luce (`components/light/Light.jsx`) sta DENTRO la Board (`level/Level.jsx`): luce, arco, ombre e lettere seguono il plastico in tabletop; la shadow camera si riscala con la Board (ombre nitide anche in miniatura). Tutti i muri proiettano e ricevono ombra.
- Bussola: `CameraHeadingTracker.jsx` (dentro la Board) pubblica la direzione di vista (`cameraHeading.js`); barra in alto su desktop (`components/ui/compass/`), barra nel pannello VR (`xr-ui/VRCompassBar.jsx`, texture fissa che scorre), lettere N/E/S/W a terra (`sun/CompassLetters.jsx`), bussola circolare admin nel pannello sole desktop (`ui/sun-panel/CompassDial.jsx`).
- Raggio lettere, arco e area ombre sono costanti tarate sulla stanza 6×6: con la pianta da dati/DXF andranno lette dall'ingombro dell'ambiente.
- Cursore del mouse sulla scena: `components/scene/sceneCursor.js` (classi su `<body>`, stili in `app.css`): manina su oggetti e note in hover, mano chiusa durante i trascinamenti (oggetti, gizmo, materiali dal pannello); il mirino del posizionamento note ha la precedenza.
- Pannelli UI: un solo pannello aperto per volta (`store/slices/panelSlice.js`, `openPanel`: sun, rooms, share, objects, users, perf). Su mobile ogni menu si apre come card centrata (`ui.css`). Bottoni attivi: `CircleButton isActive`.
- VR: pannello sole nel mondo davanti all'utente (`xr-ui/VRSunPanel.jsx`, slider `VRSlider.jsx`), aperto dal bottone sole del polso. Il puntatore del dito usa un ordinamento custom (`xr/xrStore.js`): @pmndrs con i puntatori a sfera ignora `pointerEventsOrder` e guarda solo la distanza, così le note (a pochi mm dal muro, < 1 mm in tabletop) perdevano il tocco a favore del muro; ora vince l'ordine più alto (oggetto o antenato più vicino che lo imposta), poi la distanza. Puntatori ammessi in `xr-ui/pointers.js` (PointerFilterContext): menu del polso = dito destro o raggio controller (mai le dita della mano sinistra), pannelli nella stanza = anche raggio della mano. Cursore del raggio ridotto in tabletop (`xr/xrStore.js`).

## Post-it (note)
- Dati: `store/slices/notesSlice.js` (`notes.items`: `{ id, objectId, p, n, text, author: { name, color } }`; `objectId` null = superficie della stanza, coordinate della Board; altrimenti spazio locale (geometria non scalata) dell'oggetto). Salvati nell'ambiente: Y.Map "notes" sincronizzata come gli oggetti (`bindInstances` in `sync/roomSync.js`). Autore = nome del dispositivo e colore di presenza (`getSelfUser()` in `presence.js`); per ora chiunque nella stanza modifica/elimina qualsiasi nota. Eliminando un oggetto si eliminano le sue note.
- Scena: `components/scene/notes/Notes.jsx` — `BoardNotes` (dentro la Board: note sulla stanza + modalità di posizionamento desktop) e `NotePin` (card quadrata stile HUD nel colore dell'autore, 3 layer su canvas: card in glassmorphism col colore dell'autore, titolo "NOTE" e righe tratteggiate decorative (mai il testo: una texture statica per colore), parentesi angolari luminose che "respirano", linea di scansione che scorre; all'hover si ingrandisce e accelera; tag HUD sempre visibile col nome, ancorato all'angolo; click o tocco del dito = editor. `pointerEventsOrder={1}` sulla card: il dito che la tocca tocca anche il muro dietro, così la card vince il pareggio). Le note su un oggetto sono figlie dell'oggetto in `SingleObject.jsx` (lo seguono, anche nei drag remoti) con scala annullata. Le note non sono mai appoggi per gli oggetti (`userData.isNote`, escluse in `surfaceDrag.js`). Superfici che accettano note: mesh degli oggetti (`userData.objectId`) e stanza (`userData.isRoom` in `Room.jsx`).
- UI desktop: bottone post-it nella barra destra (pill della griglia) → modalità posizionamento (cursore a croce, Esc annulla; la pressione non seleziona/orbita) → click su muro/pavimento/oggetto → editor `components/ui/note-modal/` (Ctrl/Cmd+Enter salva, Esc/sfondo annulla, Elimina con conferma).
- VR: click su un marker (raggio o dito) → `xr-ui/VRNotePanel.jsx`, pannello nel mondo davanti all'utente (posizionamento condiviso con il pannello sole: `placeInFrontOfUser` in `xr-ui/layout.js`): autore, testo (a capo con `wrapLines` di `useCanvasTexture.js`, check: `node src/components/scene/xr-ui/wrapLines.check.mjs`), Delete/Clear/Save, X. Un tocco sul riquadro del testo apre la tastiera di sistema del Quest (System Keyboard in WebXR, Quest Browser 26.1+: focus su un campo DOM nascosto, testo letto dal suo `value`). La tastiera a ogni apertura riparte da zero, quindi il campo contiene solo il testo di quella sessione, che viene aggiunto in coda a quello della nota (backspace cancella solo il nuovo testo; "Clear" svuota la nota). In tabletop le note sono 2× (`TABLETOP_BOOST`). Il tag col nome non ha depth test (come un waypoint HUD: niente clipping col muro, visibile anche dietro gli oggetti), renderOrder -2 così pannelli e menu VR gli stanno sopra. In XR il modale DOM non si monta (ruberebbe il focus). Creare note in VR: bottone post-it sul polso (accanto a "+") → modalità posizionamento → grilletto/pinch col raggio su muro, pavimento o oggetto (`XRNotePlacer` in `notes/Notes.jsx`, evento `select` della sessione; ignorato mentre il menu del polso è visibile, così il raggio del controller che preme il bottone per annullare non posiziona una nota). Durante il posizionamento (desktop e VR) gli oggetti non si afferrano né si selezionano (`filter` di `useHandle` e `handleClick` in `SingleObject.jsx`).

## Materiali di pavimento e pareti
- Libreria: `src/materials/library.js`. Record `{ id, name, category: 'floor'|'wall'|null, tileSize (lato reale di una piastrella della texture, m), maps: { color, normal?, orm? } (URL) }`; ORM = mappa impacchettata come glTF (R occlusione ambientale, G roughness, B metalness), i record più vecchi possono avere `roughness` al posto di `orm`. `PLAIN_ID` = materiale base senza texture (l'unico non nel DB). Tutti gli altri materiali stanno nel DB (R2), caricati all'avvio nello store `libraryMaterials` (`App.jsx`); accesso via hook `useMaterial(id)` / `useMaterialList()`. Scena e sync salvano solo gli id: un materiale sconosciuto (eliminato o non ancora caricato) si vede plain.
- Server: `server/src/materials.js`, Cloudflare R2 (binding `MATERIALS`, bucket `ioroom-materials`, creato una volta con `npx wrangler r2 bucket create ioroom-materials` in `server/`). `GET /api/materials` pubblico, `POST` multipart (name, category, tileSize, color + normal/orm opzionali, id opzionale per migrazioni: 409 se esiste già) e `DELETE /api/materials/:id` solo owner; file da `GET /files/materials/<id>/<map>.<ext>` (immutabili, cache 1 anno). Elenco in `materials/index.json` nel bucket. Check: `node server/api.check.mjs` (con `wrangler dev`).
- Upload dal browser (`src/materials/imageToWebp.js`): riduzione a 1K di tutte le mappe (l'utente può caricare qualsiasi risoluzione, consigliato 2K; test su Quest: il 2K si nota solo sui muri visti da vicino, rimandato ai preset di qualità) e WebP (encoder nativo, o `@jsquash/webp` in WebAssembly caricato al volo dove manca, es. Safari: escluso dal pre-bundle in `vite.config.js`); la ORM si carica pronta (ARM di Poly Haven: R AO, G roughness, B metallic) oppure da AO, roughness e metallic separati, impacchettati nel browser (valori neutri per le mappe mancanti); se ci sono entrambe vince quella pronta. UI owner: "+" nel pannello → `ui/materials-panel/MaterialCreateModal.jsx`; "×" su qualsiasi materiale tranne Plain per eliminarlo (seconda pressione conferma).
- Materiali iniziali (Poly Haven CC0): `bash scripts/fetch-textures.sh` scarica in `scripts/.textures/` (non versionata), conversione in WebP, poi `ADMIN_TOKEN=... node scripts/seed-materials.mjs` li carica nel DB mantenendo gli id.
- Geometria: `level/room/roomGeometry.js` — ogni faccia (pavimento e le 6 facce di ogni muro) ha UV in coordinate mondo in metri ("box mapping" calcolato una volta in JS, `planarUVs`): stessa resa del triplanare su superfici piane, a costo zero nello shader e su entrambi i renderer; motivi continui lungo gli assi, niente stiramenti. Check: `node src/components/scene/level/room/roomGeometry.check.mjs`. Da riusare per i muri estrusi dalle piante.
- Batching (draw call): ogni faccia ha il suo materiale (id `floor`, `<muro>:inner` lato stanza, `<muro>:outer`, `<muro>:edge` sommità e testate), ma `Room.jsx` disegna le facce in GRUPPI: quelle con stesso materiale, tinta di anteprima, orientamento (verticale/orizzontale) e colore plain vengono unite in un'unica geometria (`mergeFaces`) = una draw call (+ una per le ombre) per gruppo invece che per faccia. I gruppi si ricostruiscono quando cambia un materiale o l'anteprima del drag (poche centinaia di vertici). Le mesh unite hanno `userData.faceRanges` (triangoli → id faccia, `surfaceIdAt` usato dal drop dei materiali) e `userData.surface = 'wall'` se verticali (surfaceDrag.js). Le facce verticali proiettano e ricevono ombre, quelle orizzontali solo le ricevono. In XR i puntatori a sfera (dito, presa) di @pmndrs testano il BOUNDING BOX della mesh: un gruppo con più muri ha un box grande quanto la stanza e le mani lo "toccherebbero" sempre (quel contatto vince sul raggio e blocca tutto). Per questo le mesh unite hanno un metodo `spherecast` (`spherecastFaces` in `roomGeometry.js`) che testa il box di OGNI faccia: presa del pavimento per spostare/ruotare il plastico e tocco dei muri si comportano come quando ogni faccia era una mesh a sé.
- VR: bottone materiali sul polso (accanto al tabletop) → `xr-ui/VRMaterialsPanel.jsx`, pannello nel mondo davanti all'utente con le sfere (tutte in UN canvas = una draw call; miniature 128 px delle color map, nessuna texture 1K caricata solo per la lista). Trascinamento come su desktop ma con il RAGGIO: pinch/grilletto su una sfera → `materialDrag` con il `pointerId` del raggio; `Room.jsx` segue quel puntatore sulle facce (anteprima arancione) e applica il materiale sul suo pointerup; rilasciato altrove non cambia nulla (il drag si chiude su `selectend` della sessione). Il dito non avvia il drag (non arriva ai muri). Funziona anche sul plastico in tabletop.
- Organizzazione della libreria (`src/materials/grouping.js`, check `node src/materials/grouping.check.mjs`): tab per CATEGORIA (Floors / Walls) e chip per TIPO (`kind`: wood, marble, stone, tiles, concrete, brick, plaster, paint, fabric, metal, other; si mostrano solo i tipi presenti; senza tipo o tipo sconosciuto = Other). La lista dei tipi sta SOLO nel client (il server controlla solo la forma dell'id): aggiungere un tipo = una riga. Plain è la prima sfera di ogni tab. Tab/chip scelti sono condivisi tra pannello desktop e VR (store `libraryFilter`). In VR pagine da 12 sfere con < >. Admin: "✎" su un materiale → stesso modale in modalità modifica (nome, categoria, tipo, dimensione reale; le mappe non cambiano) → `PATCH /api/materials/:id` (`updateMaterial`); la cache dei materiali three ha il tileSize nella chiave, quindi il nuovo real size si vede subito.
- Scena: `level/room/SurfaceMesh.jsx` — mesh di un gruppo col materiale `materialId` (o il colore plain), tinta arancione in anteprima; la texture ORM alimenta insieme aoMap, roughnessMap e metalnessMap (una sola texture GPU). Un `MeshStandardMaterial` CONDIVISO per materiale (e per tinta), texture caricate una volta (cache drei) e mai clonate (`repeat` = 1/`tileSize` uguale ovunque grazie alle UV in metri); passato con la prop `material` (React non lo possiede né lo distrugge). Mentre carica resta il plain. Solo `MeshStandardMaterial`: WebGPU e WebGL/XR.
- Stato e sync: store `surfaces` (`store/slices/surfacesSlice.js`, superficie → id materiale; assente = plain), salvato nell'ambiente: Y.Map "surfaces", una chiave per superficie, con `bindFieldMap` (`sync/fieldMapSync.js`, stessa logica del sole in `sunSync.js`). Tutti nella stanza possono cambiarli. `materialDrag` (per dispositivo) = trascinamento in corso.
- UI desktop/mobile (stile Unreal/Twinmotion): bottone Materiali nella barra sinistra → `ui/materials-panel/` con le sfere dei materiali per categoria; si trascina una sfera su una faccia di un muro o sul pavimento (pointer events: mouse e touch), la faccia sotto il puntatore mostra l'anteprima con tinta arancione, al rilascio il materiale si applica. Il DOM chiede alla scena quale superficie c'è sotto un punto dello schermo tramite `level/room/surfacePicker.js` (risponde `MaterialDropTarget.jsx`, dentro la Board; null se sopra c'è un pannello o un oggetto). Su mobile il pannello è ancorato in basso tra le due barre laterali, sopra il "+", con sfere piccole: la metà alta dello schermo resta libera per il drop. Pannelli flottanti tenuti dentro lo schermo con `ui/usePanelInViewport.js`. VR: da fare.

## Convenzioni

- **Componenti funzionali React** con JSX (nessun TypeScript, solo JSDoc implicito).
- **Stile CSS separato** per ogni componente (modulare, senza CSS-in-JS).
- **Glassmorphism** come stile UI dominante (gradienti, backdrop-filter, bordi semi-trasparenti).
- **Zustand con slices** per lo stato globale: ogni slice gestisce un dominio (griglia, impostazioni, oggetti).
- **XR support**: il progetto supporta tre modalità — flatscreen, VR immersivo, AR immersivo — con logica condizionale nei componenti.
- **Font**: SUSE Mono da Google Fonts.
- **Nessun routing**: applicazione single-page.
- **Renderer**: il `<Canvas>` ha `key={backend}` e viene rimontato quando cambia backend. Si entra in XR solo tramite `enterXR(mode)` (src/xr/xrStore.js), mai chiamando direttamente `xrStore.enterVR/AR`.
- **Compatibilità WebGPU**: niente `ShaderMaterial`/GLSL custom (es. drei `Grid`, `Outlines`, `Line`/`PivotControls`, `r3f-perf`) nel percorso WebGPU: usare materiali built-in o TSL/NodeMaterial.
- **Eventi**: il Canvas usa `events={noEvents}` + `<PointerEvents batchEvents={false} />` (pmndrs): un solo sistema di eventi per mouse, touch, controller e mani. Attenzione: se un oggetto ha listener three.js (`addEventListener`, es. quelli di `useHandle`), pmndrs ignora i suoi handler R3F (`onPointerDown`...) per quello stesso evento. Per i puntatori mouse `e.ray` non segue il cursore: usare `getPointerRay(e)` (`controls/pointerRay.js`).
- **Oggetti** (`SingleObject.jsx`): il gruppo esterno possiede la trasformazione salvata nello store; grab/drag con `useHandle` (mouse, grip del controller, pinch della mano; in XR l'oggetto segue la rotazione della mano). Il gizmo (scala 2/3, priorità sugli eventi: `pointerEventsOrder: 1`) si nasconde durante il grab. Limite pavimento: bounding box sempre a y >= 0. I drag a raggio (mouse, raggio controller/mano) usano `controls/surfaceDrag.js`: l'oggetto scorre sul piano della superficie su cui poggia (rilevata all'aggancio) fino a una portata massima (2,5× la distanza di presa, minimo 3 m: `MIN_REACH`; puntando sopra l'orizzonte del piano resta alla portata massima, non torna indietro) e cambia superficie (snap) solo entro 30 cm da essa e dopo 0,2 s di puntamento, oppure col gesto deliberato (raggio >20° fuori dal piano tenuto 0,5 s); da una parete si stacca puntando il pavimento o un piano davanti (0,2 s, a qualsiasi distanza); in XR si stacca anche "tirando la corda": un tiro rapido della mano all'indietro lungo il raggio (8 cm, solo movimenti rapidi: `PULL_DISTANCE`, `PULL_WINDOW_MS`) lo riporta sul pavimento a metà distanza (`REEL_FACTOR`); smorzamento anti-tremolio sui raggi XR; zona morta di 8° sulla rotazione col polso; Handle con `alwaysUpdate`; i fianchi degli altri oggetti non sono appoggi; cade dai piani rialzati; sempre dritto; sulle pareti della stanza (`userData.surface = 'wall'`) si gira verso la stanza; rotazione col polso attorno al raggio (`TWIST_TO_YAW`). Snap opzionali e indipendenti, letti all'inizio del drag: posizione (`settings.gridSnap` + `gridSnapStep` in cm) e rotazione (`settings.rotationSnap` + `rotationSnapStep` in gradi). UI flatscreen: `components/ui/snap-control/SnapControl.jsx`, nella barra destra sotto il bottone Grid; click = on/off, hover = bottoni arancioni a sinistra (griglia 1/5/20/50/100 cm, rotazione 1/5/15/45/90°) che impostano il passo e attivano lo snap. In VR "Snap" sul palmo fa on/off della sola griglia. Drag a raggio: assi del piano d'appoggio + yaw (`gridStep`/`yawStep` di `startSurfaceDrag`), solo dopo che il drag è partito; gizmo: in `onDrag` la posa completa viene snappata solo sugli assi/angoli che il drag sta cambiando e riscritta come delta. Impronta a punti (`DragFootprint`, per drag a raggio, presa ravvicinata e gizmo): sulla parete se l'oggetto è agganciato a una parete, altrimenti sulla superficie sotto; diventa rossa quando l'oggetto è trattenuto dai limiti della stanza (`drag.blocked` / risultato di `keepOverSurface`) o non ha nulla sotto (gizmo fuori dalla stanza); in XR griglia 3 volte più fitta (`DOT_GRID_XR`). Limiti della stanza indipendenti dalla forma (`keepOverSurface()`): il centro dell'oggetto deve restare sopra una superficie (pavimento, piano), altrimenti scorre lungo il bordo o torna alla posizione precedente; vale per drag a raggio, presa ravvicinata e rilascio del gizmo, e funzionerà anche con stanze di forma qualsiasi generate da disegni/piante. Verifica con `node src/components/scene/controls/surfaceDrag.check.mjs`. Durante lo spostamento (grab/drag dell'oggetto, non il gizmo) `helpers/DragFootprint.jsx` mostra un'impronta a punti arancioni (stile scansione del terreno di Death Stranding: punti che rimpiccioliscono e sfumano verso l'esterno) sulla superficie sotto l'oggetto (`surfaceBelow()` di surfaceDrag.js, condivisa con la regola di caduta); è renderizzata come sorella del target (spazio board) e ha `raycast` disattivato, quindi non diventa mai un appoggio né intercetta i puntatori.
- **Tabletop (plastico)**: in XR il pulsante "Tabletop" sul polso scala `Board` (default 1:12, limiti 1:40–1:3) davanti all'utente all'altezza di un tavolo. Si afferra la stanza con una mano per spostare/ruotare (solo Y) il plastico; zoom = pinch/grilletto con entrambe le mani in qualsiasi punto e allargare/stringere (`useTwoHandZoom.js`, formula in `controls/boardZoom.js`, verifica con `node src/components/scene/controls/boardZoom.check.mjs`). Lo zoom non parte se un oggetto è tenuto in mano (`objects.grabbedId`). Gli oggetti restano figli del Board: le trasformazioni salvate sono sempre in metri reali. Limite pavimento e drag lavorano nello spazio del parent. Alla fine della sessione XR si torna a 'life'.
- **Pulsanti VR**: filtro `acceptsPointer` in `VRButton.jsx`: con le mani solo il puntatore touch del dito (raggio e grab esclusi), con i controller il raggio.
- **Cancellazione in VR**: si seleziona con la destra; mano sinistra aperta in "posa di cancellazione" (dita verso l'alto entro ~35°, dorso della mano verso l'utente entro ~45°, quindi palmo perpendicolare al pavimento e rivolto in avanti; `isDeletePose` in `fistGesture.js`) per ~0,4 s con un oggetto selezionato → contorno rosso (armato) → pugno entro 0,6 s = elimina (`xr-ui/FistDeleteGesture.jsx`, logica pura in `xr-ui/fistGesture.js`, verifica con `node src/components/scene/xr-ui/fistGesture.check.mjs`). Solo mano sinistra; il gesto non si arma mentre il menu del polso è visibile (`view.handMenuVisible`).
- **Rotazione in VR (mani)**: pinch pollice-medio della mano destra + rotazione del polso ruota l'oggetto selezionato attorno alla verticale, senza spostarlo; vale lo snap di rotazione (`xr-ui/PinchRotateGesture.jsx`). Il pinch con l'indice (select) sposta soltanto: la torsione del polso durante il drag resta solo per i raggi dei controller.
- **Tabletop, grab ravvicinato** (mano/grip che tocca il pezzo): la torsione del polso ruota il pezzo attorno alla verticale (stessa regola e zona morta dei raggi, snap di rotazione incluso; `nearGrabYaw` in `SingleObject.jsx`). A 1:1 il grab ravvicinato segue la rotazione completa della mano.
