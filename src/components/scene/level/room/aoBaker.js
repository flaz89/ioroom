import { bakeInput } from './bakeAo.js';

/*
* Room AO bake in a Web Worker (aoWorker.js), one at a time: a new request (the plan changed again) TERMINATES the
* running bake (a bake is seconds on a Quest: no point finishing an outdated one) and its promise resolves to null.
* bakeRoomAo(atlas) -> Promise<Uint8Array | null> (aoAtlas.js result in, the atlas' AO texels out).
*/
let running = null; // { worker, resolve }
let nextId = 0;

export function bakeRoomAo(atlas) {
    if (running) {
        running.worker.terminate();
        running.resolve(null);
    }
    const worker = new Worker(new URL('./aoWorker.js', import.meta.url), { type: 'module' });
    const id = ++nextId;
    return new Promise((resolve) => {
        running = { worker, resolve };
        const finish = (ao) => {
            worker.terminate();
            if (running?.worker === worker) running = null;
            resolve(ao);
        };
        worker.onmessage = ({ data }) => finish(data.id === id ? data.ao : null);
        worker.onerror = (error) => {
            console.error('AO bake failed', error);
            finish(null);
        };
        // copies (structured clone): the arrays stay with the geometries the scene draws
        worker.postMessage({ id, size: atlas.size, faces: bakeInput(atlas.geometries) });
    });
}
