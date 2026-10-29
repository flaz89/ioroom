import { bakeTexels, finishBoth, mergeRows } from './bakeAo.js';

/*
* AO bake off the main thread (bakeAo.js), driven by aoBaker.js:
* - { type: 'texels', size, faces, rowOffset, rowStride } -> { values, valuesOpen, covered } (this worker's rows)
* - { type: 'finish', size, parts } -> { ao, aoOpen } (the workers' rows merged, then blur + border fill of both)
* Results are transferred, not copied.
*/
self.onmessage = ({ data }) => {
    if (data.type === 'texels') {
        const part = bakeTexels(data.size, data.faces, { rowOffset: data.rowOffset, rowStride: data.rowStride });
        self.postMessage(part, [part.values.buffer, part.valuesOpen.buffer, part.covered.buffer]);
    } else {
        const result = finishBoth(data.size, mergeRows(data.size, data.parts));
        self.postMessage(result, [result.ao.buffer, result.aoOpen.buffer]);
    }
};
