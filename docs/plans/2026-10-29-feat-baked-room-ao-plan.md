---
title: AO precalcolata della stanza (VR) - Plan
type: feat
date: 2026-10-29
topic: baked-room-ao
execution: code
---

# AO precalcolata della stanza - Plan

## Obiettivo

In VR (Quest 2 come riferimento: se regge lì, regge su Quest 3, Vision Pro e occhiali futuri) la stanza è piatta: senza
GI gli angoli tra muri, pavimento, soffitto, travi e telai non si leggono, e il pavimento lucido riflette l'ambiente anche
nelle zone in ombra. Si aggiunge un'occlusione ambientale (AO) della sola stanza, calcolata una volta quando cambia la
pianta e poi gratuita a ogni frame.

- **Fuori scope:** AO in spazio schermo in VR (costo per occhio, perde la foveation, sfarfalla in stereo); AO degli oggetti
  (verrà dalla ORM dei GLB del catalogo); ombre di contatto sotto gli oggetti (piano a parte, dopo questo).
- **Profilo di esecuzione:** piccoli passi verificati uno per uno; Flavio prova sul Quest e fa lui commit e push.

## Decisioni

- **D1. Solo la stanza, oggetti esclusi.** Muri, pavimenti, soffitti, tetto, travi, abbaini, parapetti. Gli oggetti si
  spostano: nel calcolo lascerebbero una macchia scura dove stavano fino al ricalcolo.
- **D2. Ricalcolo solo quando cambia la pianta** (Builder, o modifica arrivata da un altro dispositivo), in background,
  mai durante l'uso. Finché non è pronta la stanza si vede come oggi.
- **D3. Texture AO unica per la stanza (lightmap), non per vertice.** Ogni faccia è piana: la sua seconda UV (`uv1`) è una
  proiezione planare impacchettata in un atlante. Niente suddivisione dei muri (oggi sono pochi triangoli grandi) e resa
  liscia. L'alternativa per vertice obbligherebbe a ritriangolare pavimenti poligonali e falde a griglia.
- **D4. Applicata con l'`aoMap` di three sul canale `uv1`, senza shader custom.** Un solo atlante per tutta la stanza,
  quindi i materiali restano condivisi per id (`SurfaceMesh.jsx`). Three la applica solo alla luce indiretta (ambiente e
  luce emisferica, non il sole) e attenua anche i riflessi dell'ambiente (`computeSpecularOcclusion`): risolve il riflesso
  del pavimento nelle zone in ombra. Compatibile con WebGL e WebGPU. Costo: l'AO di dettaglio della ORM dei materiali
  (canale R, piastrelle 1K) non si usa dove c'è l'atlante; differenza trascurabile.
- **D5. Calcolo in un Web Worker con `three-mesh-bvh`** (già installato tramite drei: va dichiarato in `package.json`,
  servirà comunque per i GLB). Raggi distribuiti a coseno sull'emisfero di ogni texel, raggio d'azione limitato (circa
  1 m: è il "contatto", non l'ombra lontana).
- **D6. Dove si vede: in XR (prima persona e tabletop) e su schermo quando la SSGI è spenta** (preset Low, fallback
  WebGL); con la SSGI attiva no, la fa già lei. (Flavio, 29/10)
- **D7. Tabletop.** L'atlante è attaccato alla geometria, quindi rimpicciolisce e ruota col plastico senza ricalcolo.
  Unico caso: nel tabletop (e con "Hide ceiling" su schermo) i soffitti non si vedono, ma l'AO calcolata con i soffitti
  lascia una fascia più scura in cima ai muri. Primo passo: un solo calcolo, si guarda sul Quest; se la fascia si nota,
  secondo atlante senza soffitti, calcolato solo quando serve (prima volta in tabletop / con i soffitti nascosti).

## Unità

### U1. Seconda UV della stanza (`uv1`) — FATTA (29/10)

`level/room/aoAtlas.js` (`aoAtlas`, check `aoAtlas.check.mjs`): facce divise in chart complanari (normale + distanza),
impacchettamento a ripiani in un quadrato potenza di due (max 2048 px, poi il texel cresce), margine `PAD` di 2 texel,
nuove geometrie con `uv1` e la lista dei chart per il calcolo. La 6×6 con porta, finestra e tetto a due falde: 23 chart
in 512 px a 5 cm. Non ancora collegata alla scena (U3).

- Funzione pura (`level/room/aoAtlas.js`): per ogni faccia del risultato di `roomFaces`, proiezione planare sul suo piano
  in metri, rettangoli impacchettati in un atlante quadrato con un margine di qualche texel tra le facce (niente
  sbavature ai bordi); dimensione del texel come costante (proposta 5 cm, da tarare).
- `uv1` scritta su ogni geometria prima di `mergeFaces` (tutte le facce devono averla, o il merge fallisce).
- Check: nessuna sovrapposizione tra rettangoli, tutte le `uv1` dentro [0, 1], area dei texel coerente con l'area delle
  facce (`surfaceAreas`).

### U2. Calcolo dell'AO — FATTA (29/10)

`level/room/bakeAo.js` (`bakeAo`, `bakeInput`; check `bakeAo.check.mjs`), `aoWorker.js`, `aoBaker.js` (`bakeRoomAo`:
un calcolo alla volta, uno nuovo termina il vecchio). 32 raggi Hammersley ruotati per texel, raggio 1 m, attenuazione
lineare, sfocatura 3×3 sui soli texel coperti, riempimento del margine. 6×6 sul Mac: 0,66 s; pavimento centro 1,00,
piede del muro 0,61, angolo 0,38. `three-mesh-bvh` dichiarato in `package.json`. Tempo sul Quest da misurare in U4.

- Funzione pura (`level/room/bakeAo.js`) eseguibile anche in Node: geometrie della stanza + atlante → `Uint8Array` (un
  canale). Per ogni texel coperto: punto e normale della faccia, N raggi (proposta 32) con BVH, AO = 1 − frazione
  occlusa entro il raggio d'azione; poi i texel di bordo vengono estesi oltre la faccia (dilatazione) per evitare
  cuciture con il filtraggio.
- Worker (`aoWorker.js`) che la chiama; si annulla un calcolo vecchio se la pianta cambia di nuovo.
- Check (Node, stanza 6×6): texel al centro del pavimento quasi 1, texel nell'angolo muro-pavimento sensibilmente più
  scuro, angolo a tre facce più scuro di uno a due; tempo di calcolo stampato.

### U3. Applicazione in scena — FATTA (29/10), da provare

`roomAo.js`: UNA `DataTexture` (RedFormat, `channel = 1`) per tutta la sessione, riempita da ogni calcolo (`setRoomAo`;
dimensione nuova = `dispose` prima), così i materiali "ao" si creano una volta sola. `SurfaceMesh` prop `ao`: variante
del materiale condiviso con `aoMap` = quella texture (`ROOM_AO_INTENSITY`), al posto dell'AO della ORM. `Room.jsx`:
`wantsAo` = XR o niente SSGI su WebGPU; atlante dalle facce (`aoAtlas`), calcolo 400 ms dopo l'ultima modifica della
pianta (`BAKE_DELAY`), AO usata solo se il calcolo corrisponde all'atlante attuale (`bakedAtlas`). Build ok (worker
160 kB). Non verificata a schermo: il browser integrato rifiuta il certificato HTTPS del dev server.

**Prima prova di Flavio (29/10, Mac, sua pianta, SSGI spenta):** l'AO compare ma dopo 20–30 s. Benchmark in Node su una
mansarda 19×11 m (tetto a padiglione, gronda a 1 m, 6 tramezzi), un solo core M2 Max: 5 cm / 32 raggi 20 s; 10 cm / 32
raggi 5,1 s; 10 cm / 16 raggi 2,7 s; 15 cm / 16 raggi 1,2 s. Correzioni: texel 10 cm e 16 raggi (default), calcolo
diviso per righe alterne su più worker in parallelo (`hardwareConcurrency − 1`, max 6; unione e finitura in un worker,
niente cicli lunghi sul thread della pagina; check: diviso e riunito = calcolo unico), e un calcolo riusato quando il
Canvas si ricostruisce con la stessa pianta (entrare / uscire dalla VR: `isRoomAoFor` in `roomAo.js`).

- `Room.jsx` tiene la `DataTexture` dell'ultimo calcolo (eliminata quando ne arriva una nuova) e la passa a
  `SurfaceMesh`, che la usa come `aoMap` (`channel = 1`) con chiave di cache del materiale che include l'atlante.
- Nessun cambiamento su schermo con la SSGI attiva (D6).
- Prova sul Quest: angoli, travi, riflesso del pavimento.

### U4. Taratura e prestazioni sul Quest 2 — IN CORSO

- 29/10, tempi di Flavio con la sua pianta: Quest 2 circa 6,4 s, Mac circa 2 s (in background). Accettati.
- 29/10, resa sul Quest: AO troppo pesante e nera, fascia scura larga lungo ogni spigolo (effetto "riquadro morbido"
  su muri e falde), falde marroncine e cupe. Ora: raggio 0,5 m con attenuazione quadratica, `ROOM_AO_INTENSITY` 0,8,
  luce dal basso in XR più chiara e quasi neutra (`XR_GROUND` #86827c). Check: a 60 cm da un muro il pavimento è aperto.
- 29/10, seconda prova: soffitti ancora molto più scuri dei muri con lo stesso stucco → `XR_GROUND` #b8b4ae (le
  falde guardano in basso e prendono quasi solo quella luce). Tabletop: l'AO di falde, travi e controsoffitto restava
  sui muri col tetto nascosto → D7 risolta senza un secondo calcolo: lo stesso passaggio produce anche la versione
  senza soffitti (un raggio fermato da un soffitto viene rifatto sulla BVH senza soffitti), scambiata al volo
  (`showRoomAoCeilings`). Check: cima del muro sotto la gronda 0,81 col tetto, 1,00 senza.
- 29/10, terza prova: tabletop e soffitti a posto; AO ora troppo netta, una linea lungo gli spigoli (muri contro il
  lato lungo della falda) → raggio 0,75 m (sempre quadratica) e sfocatura 5×5 (`BLUR`, sotto il margine tra i chart).
  Check: a 30 cm dal muro una via di mezzo. Calcolo circa 1,5 volte più lungo (6×6: 111 → 180 ms).
- 29/10: resa accettata da Flavio. Idea per dopo (UX): oggi entrando in VR l'AO compare dopo alcuni secondi. Due
  strade: calcolarla già durante l'uso a schermo (anche con la SSGI attiva, usarla solo in VR: il calcolo è in
  background nei worker e si riusa entrando con la stessa pianta) oppure una schermata di caricamento immersiva.
- 30/10: riflesso al centro del pavimento → in XR la environment map è un gradiente cielo / orizzonte / terra
  (`SceneEnvironment.jsx`) invece dello studio coi pannelli luminosi. Da provare sul Quest.
- Da fare dopo (emersi dalle catture): cielo blu saturo fuori dalle finestre, seghettature dei bordi
  in VR (verificare l'MSAA del framebuffer XR), ombre di contatto sotto gli oggetti (piano a parte).

- Costanti: dimensione del texel, numero di raggi, raggio d'azione, intensità (`aoMapIntensity`).
- Misure: tempo di calcolo sul Quest con la pianta reale di Flavio (obiettivo: pochi secondi, in background), memoria
  dell'atlante, fps prima e dopo (atteso invariato: una texture in più per materiale).
- Se il calcolo sul Quest è troppo lento: prima un calcolo grossolano (texel più grandi, meno raggi) poi quello fine.

## Rischi

- **Atlante troppo grande** con piante reali grandi: oltre 2048 px si aumenta il texel automaticamente.
- **Facce che si toccano o si sovrappongono** (pavimento sotto i muri, falde sopra i muri): i raggi che partono
  esattamente sul punto di contatto vanno spostati di poco lungo la normale per non colpire la faccia stessa.
- **Aperture** (telai, ante): i telai fissi possono entrare nel calcolo come occlusori in un secondo momento; le ante
  si muovono e restano fuori (D1).
