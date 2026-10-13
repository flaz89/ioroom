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
```

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
- **Oggetti** (`SingleObject.jsx`): il gruppo esterno possiede la trasformazione salvata nello store; grab/drag con `useHandle` (mouse, grip del controller, pinch della mano; in XR l'oggetto segue la rotazione della mano). Il gizmo (scala 2/3, priorità sugli eventi: `pointerEventsOrder: 1`) si nasconde durante il grab. Limite pavimento: bounding box sempre a y >= 0. I drag a raggio (mouse, raggio controller/mano) usano `controls/surfaceDrag.js`: l'oggetto scorre sul piano della superficie su cui poggia (rilevata all'aggancio) fino a una portata massima (2,5× la distanza di presa, minimo 3 m: `MIN_REACH`; puntando sopra l'orizzonte del piano resta alla portata massima, non torna indietro) e cambia superficie (snap) solo entro 30 cm da essa e dopo 0,2 s di puntamento, oppure col gesto deliberato (raggio >20° fuori dal piano tenuto 0,5 s); da una parete si stacca puntando il pavimento o un piano davanti (0,2 s, a qualsiasi distanza); in XR si stacca anche "tirando la corda": un tiro rapido della mano all'indietro lungo il raggio (8 cm, solo movimenti rapidi: `PULL_DISTANCE`, `PULL_WINDOW_MS`) lo riporta sul pavimento a metà distanza (`REEL_FACTOR`); smorzamento anti-tremolio sui raggi XR; zona morta di 8° sulla rotazione col polso; Handle con `alwaysUpdate`; i fianchi degli altri oggetti non sono appoggi; cade dai piani rialzati; sempre dritto; sulle pareti della stanza (`userData.surface = 'wall'`) si gira verso la stanza; rotazione col polso attorno al raggio (`TWIST_TO_YAW`). Snap alla griglia opzionale (`settings.gridSnap`, bottone nella barra sinistra e "Snap" sul palmo): letto al grab, celle da 10 cm nello spazio board (`GRID_SNAP_STEP` in SingleObject.jsx) sui due assi del piano d'appoggio e yaw a passi di 15° (`YAW_SNAP`), solo dopo che il drag è partito; vale per i drag a raggio, non per presa ravvicinata e gizmo. Impronta a punti: in XR griglia 3 volte più fitta (`DOT_GRID_XR`). Limiti della stanza indipendenti dalla forma (`keepOverSurface()`): il centro dell'oggetto deve restare sopra una superficie (pavimento, piano), altrimenti scorre lungo il bordo o torna alla posizione precedente; vale per drag a raggio, presa ravvicinata e rilascio del gizmo, e funzionerà anche con stanze di forma qualsiasi generate da disegni/piante. Verifica con `node src/components/scene/controls/surfaceDrag.check.mjs`. Durante lo spostamento (grab/drag dell'oggetto, non il gizmo) `helpers/DragFootprint.jsx` mostra un'impronta a punti arancioni (stile scansione del terreno di Death Stranding: punti che rimpiccioliscono e sfumano verso l'esterno) sulla superficie sotto l'oggetto (`surfaceBelow()` di surfaceDrag.js, condivisa con la regola di caduta); è renderizzata come sorella del target (spazio board) e ha `raycast` disattivato, quindi non diventa mai un appoggio né intercetta i puntatori.
- **Tabletop (plastico)**: in XR il pulsante "Tabletop" sul polso scala `Board` (default 1:12, limiti 1:40–1:3) davanti all'utente all'altezza di un tavolo. Si afferra la stanza con una mano per spostare/ruotare (solo Y) il plastico; zoom = pinch/grilletto con entrambe le mani in qualsiasi punto e allargare/stringere (`useTwoHandZoom.js`, formula in `controls/boardZoom.js`, verifica con `node src/components/scene/controls/boardZoom.check.mjs`). Lo zoom non parte se un oggetto è tenuto in mano (`objects.grabbedId`). Gli oggetti restano figli del Board: le trasformazioni salvate sono sempre in metri reali. Limite pavimento e drag lavorano nello spazio del parent. Alla fine della sessione XR si torna a 'life'.
- **Pulsanti VR**: filtro `acceptsPointer` in `VRButton.jsx`: con le mani solo il puntatore touch del dito (raggio e grab esclusi), con i controller il raggio.
- **Cancellazione in VR**: si seleziona con la destra; mano sinistra aperta con il palmo perpendicolare al pavimento (entro ~30°) per ~0,4 s con un oggetto selezionato → contorno rosso (armato) → pugno entro 0,6 s = elimina (`xr-ui/FistDeleteGesture.jsx`, logica pura in `xr-ui/fistGesture.js`, verifica con `node src/components/scene/xr-ui/fistGesture.check.mjs`). Solo mano sinistra; il gesto non si arma mentre il menu del polso è visibile (`view.handMenuVisible`).
