import { bakeAo } from './bakeAo.js';

/*
* AO bake off the main thread (bakeAo.js): { id, size, faces } in, { id, ao } out (the AO buffer transferred).
* Started and canceled by aoBaker.js.
*/
self.onmessage = ({ data: { id, size, faces } }) => {
    const ao = bakeAo(size, faces);
    self.postMessage({ id, ao }, [ao.buffer]);
};
