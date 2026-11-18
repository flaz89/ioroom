# Modalità Tour

Terza modalità accanto a Builder e Designer (decisioni di Flavio, 17/11): si visita l'ambiente e si interagisce con
ciò che è interagibile, ma NON si sposta, aggiunge, elimina né modifica nulla dell'arredo e della stanza.

## Cosa si può fare in Tour
- Girare: orbita / terza persona oppure prima persona (schermo piatto), VR e AR come oggi.
- Aprire / chiudere porte e finestre (clic, già esistente).
- Parti mobili dei mobili (`move_`): in Tour un clic le muove SUBITO (nel Designer il primo clic seleziona).
- Ante dei mobili, bottoni IoT: stesso concetto (interagibile a due stati), quando arriveranno.
- Clic su un mobile = selezione per la SCHEDA PRODOTTO, con cambio variante (colore). Niente specchiatura.
- Note e righello: utilizzabili (creare, modificare, salvare).
- Sole: slider funzionanti e condivisi come nel Designer.
- Computo: visibile (sola lettura).

## Cosa NON si può fare
Presa / drag / gizmo dei mobili, cancellazione (cestino, gesto del pugno), menu "+" (desktop e polso), materiali,
snap di griglia e rotazione (servono solo a spostare), specchiatura.

## Passi
1. FATTO (17/11). Modalità `workspace: 'tour'` (`workspaceSlice.js`), switch a tre (admin). Blocchi delle modifiche su desktop e VR.
   Parti mobili al primo clic. Scheda prodotto senza Mirror.
2. FATTO (17/11, da provare). Prima persona su schermo piatto (solo Tour): toggle Orbita / Prima persona. Desktop: WASD + frecce per
   camminare, sinistro tenuto per orientare la camera. Mobile: joystick virtuale (camminare) + trascinamento
   (guardare). Occhi a 1,6 m sopra il pavimento (`floorAt` + quota), niente attraversamento dei muri (sagome
   `wallFootprint`, come il teletrasporto `canLand`).
3. FATTO (18/11, VR da provare sul visore). PUNTO DI PARTENZA (player start, stile Unreal): elemento posizionabile nella pianta dal Designer, cono
   rovesciato + freccia del forward. Dato condiviso nel livello `{ p, yaw }`. Usato entrando in VR / AR / prima
   persona / terza persona (camera puntata nella sua direzione).

## Aperte
- Gli ospiti: entrano in Tour? possono passare al Designer? (oggi sempre Designer, switch solo admin)
- Un solo punto di partenza per livello, o più punti con nome?
