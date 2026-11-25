---
name: prepare-glb
description: Prepara un modello 3D (GLB InstaLOD, .blend, FBX/OBJ di un produttore o GLB già pulito) per il catalogo mobili di ioroom, fino al GLB ottimizzato in test/models/out e a un report per il modale di caricamento. Usala quando Flavio chiede di preparare, convertire, ottimizzare o controllare un modello/GLB da caricare nel catalogo, o lancia /prepare-glb <file>.
---

# Preparare un GLB per il catalogo

Rispondi sempre in italiano. Un modello alla volta, a piccoli passi: dopo ogni passo dì cosa è successo.
Il lavoro finisce con il GLB pronto e il report: il CARICAMENTO lo fa Flavio dal menu "+" (modale admin:
miniatura renderizzata nel browser). Non caricare nulla, non fare commit, non cancellare file senza chiedere.

## Regole del GLB (le controlla `src/models/inspectGlb.js` al caricamento)
- UN solo nodo mesh di CORPO + qualsiasi numero di parti mobili `move_<nome>` con custom property `slide`
  (3 numeri, metri negli assi di Blender; nel file la parte sta a riposo, `slide` = dove arriva mossa).
- Almeno una texture, max 30 MB, metri, +Y in alto (l'origine non conta: l'app centra sulla base).
- Draco + texture WebP 1K. I NOMI DEI MATERIALI sono le chiavi delle varianti: niente materiali senza nome.
- Scala NEGATIVA (parti specchiate InstaLOD): non applicarla mai in Blender (storce le normali custom);
  l'app gira i triangoli da sola.

## Strumenti
- Blender 5.2: `B=/Applications/Blender.app/Contents/MacOS/Blender`, sempre `-b --factory-startup`.
- Cartelle: sorgenti in `test/models/src/` e `blender/`, risultati in `test/models/out/` (entrambe fuori
  da git). File intermedi nella scratchpad, in una cartella `joined/` con il NOME FINALE del modello
  (il nome del file diventa il nome del nodo).
- `scripts/blender/join_export.py` — unisce in un corpo + parti `move_`, esporta GLB con le extras;
  stampa `MATERIAL`, `PART`, `SIZE`, `NEGATIVE_SCALE`. Terzo argomento facoltativo = scala (0.001 mm→m, 0.01 cm→m).
- `scripts/blender/atlas.py` — GLB InstaLOD con parti a UV e normal map separate → UN atlante, una
  normal map, un materiale, più la ID map per Painter (`.blend` + PNG in `blender/`).
- `scripts/blender/gltf_ready.py` — su un `.blend` texturizzato: `slide` dalla mesh all'oggetto, ORM in
  Non-Color, toglie il Mix AO × base color, collega l'occlusione al gruppo glTF. Salva sul posto (.blend1).
- `node scripts/check-glb.mjs <file.glb>` — regole sopra + Draco/WebP; stampa materiali e parti.
- `npx -y @gltf-transform/cli inspect <file.glb>` — misure vere (bboxMin / bboxMax della scena).

## Procedura
1. **Capisci il file.** Chiedi a Flavio, se non lo ha detto: nome del modello, se ha parti mobili (quali,
   dove arrivano). Per un GLB lancia subito `check-glb.mjs` per vedere cosa manca.
2. **Scegli il percorso:**
   - *GLB già pulito* (un corpo, solo manca Draco/WebP) → passo 4.
   - *GLB InstaLOD* con più parti e normal map separate → `atlas.py` (in `blender/<Nome>.blend`).
     Poi la texturizzazione in Substance Painter la fa Flavio: FERMATI e diglielo, con i file prodotti.
     Quando torna col `.blend` texturizzato → come un `.blend`.
   - *`.blend`* → `gltf_ready.py` se usa una ORM / un Mix AO (le parti mobili: `move_nome=x,y,z`), poi passo 3.
   - *FBX / OBJ* → passo 3; controlla `SIZE`: se è 100 o 1000 volte troppo grande rilancia con la scala.
3. **Unisci ed esporta:** `$B -b --factory-startup --python scripts/blender/join_export.py -- <in> <scratch>/joined/<Nome>.glb [scala]`.
   Con `NEGATIVE_SCALE` o una `PART ... MISSING` fermati e chiedi. Materiali con nomi generici
   (`Material.001`) o troppi materiali: proponi a Flavio di rinominarli/unirli in Blender prima di andare avanti.
4. **Ottimizza:** `npx -y @gltf-transform/cli optimize <in.glb> test/models/out/<Nome>.glb --compress draco --texture-compress webp --texture-size 1024 --simplify false --palette false --instance false --join false --flatten false`
   (`palette`/`join`/`flatten` spenti tengono i nomi dei materiali e le parti `move_`). Se il file in
   `test/models/out/` esiste già chiedi prima di sovrascriverlo.
5. **Controlla:** `check-glb.mjs` deve dire `ok`; leggi le misure con `inspect`. Misure assurde per quel
   mobile (es. un divano di 0,02 m o di 200 m) = scala sbagliata: torna al passo 3.
6. **Report a Flavio** (breve): file pronto e peso; misure L × H × P in metri; nomi dei materiali (da usare
   nelle varianti del modale, sezione Materials); parti mobili con `slide`; avvisi (texture pesanti, scala,
   materiali da rinominare). Proponi categoria e sottotipo (`src/models/grouping.js`, `MODEL_CATEGORIES`)
   e se è "Fixed" (`src/models/fixedProposal.js`). Ricordagli che il caricamento è dal "+" → "+" admin.
