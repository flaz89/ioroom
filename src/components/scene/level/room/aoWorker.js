import { bakeTexels, finishAo, mergeRows } from './bakeAo.js';

/*
* AO bake off the main thread (bakeAo.js), driven by aoBaker.js:
* - { type: 'texels', size, faces, rowOffset, rowStride } -> { values, covered } (this worker's rows)
* - { type: 'finish', size, parts: [{ values, covered }] } -> { ao } (the workers' rows merged, then blur + border fill)
* Results are transferred, not copied.
*/
self.onmessage = ({ data }) => {
    if (data.type === 'texels') {
        const { values, covered } = bakeTexels(data.size, data.faces, { rowOffset: data.rowOffset, rowStride: data.rowStride });
        self.postMessage({ values, covered }, [values.buffer, covered.buffer]);
    } else {
        const ao = finishAo(data.size, ...mergeRows(data.size, data.parts));
        self.postMessage({ ao }, [ao.buffer]);
    }
};
