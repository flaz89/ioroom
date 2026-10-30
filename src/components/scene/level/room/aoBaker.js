import { bakeInput } from './bakeAo.js';

/*
* Room AO bake in Web Workers (aoWorker.js), IN PARALLEL: WORKERS workers take interleaved rows of the atlas
* (bakeTexels), then one of them blurs and fills the merged result (finishAo). The rays are the whole cost, so the
* time drops about with the number of cores.
* One bake at a time: a request for ANOTHER plan level (the plan changed again) TERMINATES the running one (a bake
* is seconds on a Quest: no point finishing an outdated one) and its promise resolves to null; a request for the
* SAME level gets the running bake's promise (entering VR mid-bake remounts the room: the bake goes on).
* bakeRoomAo(atlas, ceilings, level) -> Promise<{ ao, aoOpen } | null> (aoAtlas.js result, which of its faces are
* ceilings and the level they come from in; the atlas' AO texels with and without the ceilings out: bakeAo.js).
*/
// a core is left to the page (rendering, React); the Quest 2's browser reports 8
const WORKERS = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));

let running = null; // { level, promise, cancel }

export function bakeRoomAo(atlas, ceilings, level) {
    if (running?.level === level) return running.promise;
    running?.cancel();
    const workers = Array.from({ length: WORKERS }, () => new Worker(new URL('./aoWorker.js', import.meta.url), { type: 'module' }));
    const ask = (worker, message, transfer) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.onerror = reject;
        worker.postMessage(message, transfer);
    });
    const stop = () => workers.forEach((worker) => worker.terminate());

    let canceled = false;
    const bake = { level };
    bake.promise = new Promise((resolve) => {
        bake.cancel = () => { canceled = true; stop(); resolve(null); };
        // copies (structured clone): the arrays stay with the geometries the scene draws
        const faces = bakeInput(atlas.geometries, ceilings);
        const { size } = atlas;
        Promise.all(workers.map((worker, rowOffset) => ask(worker, { type: 'texels', size, faces, rowOffset, rowStride: WORKERS })))
            // merged and finished in a worker too: a loop over millions of texels would hitch the page
            .then((parts) => ask(workers[0], { type: 'finish', size, parts }, parts.flatMap((part) => [part.values.buffer, part.valuesOpen.buffer, part.covered.buffer])))
            .then((result) => { if (!canceled) resolve(result); })
            .catch((error) => {
                if (canceled) return;
                console.error('AO bake failed', error);
                resolve(null);
            })
            .finally(() => {
                if (canceled) return;
                stop();
                if (running === bake) running = null;
            });
    });
    running = bake;
    return bake.promise;
}
