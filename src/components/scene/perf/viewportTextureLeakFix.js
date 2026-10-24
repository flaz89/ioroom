import { ViewportTextureNode } from 'three/webgpu';

/*
* FIX (three r186): ViewportTextureNode (the screen copy behind transmission: our physical glass, Openings3D.jsx)
* keeps one full-screen FramebufferTexture PER RENDER TARGET it is drawn into, in a WeakMap cache, and never
* disposes it when that render target goes away. Its nodes are module singletons inside three, so every
* rebuild of our effects chain (PostEffects.jsx: new pass render targets on every render setting change) left
* one more full-screen texture on the GPU (~80 MB each on a Retina screen at 2x).
* Here the cached texture is disposed (and dropped from the cache) as soon as its render target is disposed.
* Patched once, on import, for every instance. ponytail: remove when three disposes them itself.
*/
const original = ViewportTextureNode.prototype.getTextureForReference;
if (!original.isPatchedForDispose) {
    const patched = function (reference = null) {
        const cache = this.referenceNode ? this.referenceNode._cacheTextures : this._cacheTextures;
        const isNew = reference !== null && !cache.has(reference);
        const texture = original.call(this, reference);
        // a render target (not the canvas): free its screen copy with it
        if (isNew && reference.isRenderTarget && typeof reference.addEventListener === 'function') {
            const onDispose = () => {
                reference.removeEventListener('dispose', onDispose);
                if (cache.get(reference) === texture) cache.delete(reference);
                texture.dispose();
            };
            reference.addEventListener('dispose', onDispose);
        }
        return texture;
    };
    patched.isPatchedForDispose = true;
    ViewportTextureNode.prototype.getTextureForReference = patched;
}
