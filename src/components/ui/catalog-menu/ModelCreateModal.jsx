import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store/appStore';
import { MODEL_CATEGORIES, brandsOf, subtypeOf } from '../../../models/grouping';
import { createModel, modelFileUrl, updateModel, uploadModelTextures } from '../../../models/modelsApi';
import { inspectGlb } from '../../../models/inspectGlb';
import { loadModel } from '../../../models/loadModel';
import { fixedProposal } from '../../../models/fixedProposal';
import { renderThumbnail } from '../../../models/thumbnail';
import { DEFAULT_VAT, formatDecimal, parseDecimal } from '../../../materials/pricing';
import { imageToWebp } from '../../../materials/imageToWebp';
import '../materials-panel/material-create.css';
import './model-create.css';

/*
* New furniture form (owner only, the admin "+" of the "+" menu; plan U4, R9, R14, R18):
* - GLB file: checked in the browser (models/inspectGlb.js: one mesh node, at least one texture; size and
*   material names read from it) and its thumbnail rendered here (models/thumbnail.js), shown as preview;
* - card: name, manufacturer (suggestions from the catalog), category, subtype, Fixed (proposed from category
*   and size, models/fixedProposal.js, until the owner changes it), manufacturer link;
* - variants: name, code, net price per piece, VAT %, and for each material of the GLB an optional tint
*   (multiplies the material color) and an optional color texture replacing the GLB's own (resized to 1K,
*   WebP: materials/imageToWebp.js).
* Saving: the GLB + thumbnail + card first (POST), then the variant textures (POST .../textures) and the
*   variants that use them (PATCH). A texture failing after the GLB leaves the model saved: the error says
*   so and ✎ retries it.
* EDIT mode (`model` given, the ✎ of the menu): same form without the GLB (it never changes; to replace it,
*   upload a new model); material names read from the loaded model. A PATCH of the variants deletes the
*   textures they no longer use (server).
* Escape or a click on the backdrop closes it (not while saving).
*/
const firstSubtype = (category) => MODEL_CATEGORIES.find((item) => item.id === category)?.subtypes[0]?.id ?? 'other';
const newVariant = (name = '') => ({ key: crypto.randomUUID(), name, code: '', price: '', vatRate: formatDecimal(DEFAULT_VAT), overrides: {} });
const fromRecord = (variant) => ({
    key: variant.id,
    id: variant.id,
    name: variant.name,
    code: variant.code ?? '',
    price: formatDecimal(variant.price),
    vatRate: formatDecimal(variant.vatRate ?? DEFAULT_VAT),
    overrides: Object.fromEntries(Object.entries(variant.overrides ?? {}).map(([name, change]) => [name, { ...change }]))
});

export default function ModelCreateModal({ model = null, initialCategory = 'seating', onClose }) {
    const isEdit = model != null;
    const models = useStore((state) => state.libraryModels);
    const [glb, setGlb] = useState(null);                 // new: { file, size, materialNames, thumb (Blob) }
    const [checking, setChecking] = useState(false);
    const [glbError, setGlbError] = useState(null);
    const [materialNames, setMaterialNames] = useState(null); // edit: read from the loaded GLB
    const [name, setName] = useState(model?.name ?? '');
    const [brand, setBrand] = useState(model?.brand ?? '');
    const [category, setCategory] = useState(model?.category ?? initialCategory);
    const [subtype, setSubtype] = useState(model ? subtypeOf(model) : firstSubtype(initialCategory));
    const [fixed, setFixed] = useState(model?.fixed ?? null); // null = follow the proposal
    const [url, setUrl] = useState(model?.url ?? '');
    const [variants, setVariants] = useState(() => (model ? model.variants.map(fromRecord) : [newVariant('Standard')]));
    const [busy, setBusy] = useState(null); // progress text while saving
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!isEdit) return;
        loadModel(modelFileUrl(model.files.glb))
            .then((mesh) => setMaterialNames(mesh.materials.map((material) => material.name)))
            .catch(() => setMaterialNames([]));
    }, [isEdit, model]);

    const names = isEdit ? materialNames ?? [] : glb?.materialNames ?? [];
    const size = isEdit ? model.size : glb?.size;
    const isFixed = fixed ?? (size ? fixedProposal(category, size) : false);
    const subtypes = MODEL_CATEGORIES.find((item) => item.id === category)?.subtypes ?? [];
    const preview = useMemo(() => (glb?.thumb ? URL.createObjectURL(glb.thumb) : null), [glb]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const pickGlb = async (file) => {
        setGlb(null);
        setGlbError(null);
        if (!file) return;
        setChecking(true);
        try {
            const inspected = await inspectGlb(file);
            setGlb({ file, size: inspected.size, materialNames: inspected.materialNames, thumb: await renderThumbnail(inspected.mesh) });
            if (!name.trim()) setName(file.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim());
        } catch (err) {
            setGlbError(err.message);
        }
        setChecking(false);
    };

    const changeCategory = (id) => {
        setCategory(id);
        setSubtype(firstSubtype(id));
    };
    const editVariant = (key, patch) => setVariants((list) => list.map((variant) => (variant.key === key ? { ...variant, ...patch } : variant)));
    const editOverride = (variant, material, patch) => {
        const next = { ...variant.overrides[material], ...patch };
        editVariant(variant.key, { overrides: { ...variant.overrides, [material]: next } });
    };

    const prices = variants.map((variant) => ({ price: parseDecimal(variant.price), vatRate: parseDecimal(variant.vatRate) }));
    const variantsValid = variants.length > 0 && variants.every((variant, i) => variant.name.trim() !== ''
        && (prices[i].price == null || prices[i].price >= 0) && (prices[i].vatRate == null || (prices[i].vatRate >= 0 && prices[i].vatRate <= 100)));
    const canSave = !busy && (isEdit || glb != null) && name.trim() !== '' && brand.trim() !== '' && variantsValid
        && (url.trim() === '' || /^https?:\/\/\S+$/i.test(url.trim()));

    // Variants as the server wants them; `keys`: R2 keys of the textures just uploaded, by File
    const variantsPayload = (keys = new Map()) => variants.map((variant, i) => ({
        ...(variant.id && { id: variant.id }),
        name: variant.name.trim(),
        code: variant.code.trim() || null,
        price: prices[i].price,
        vatRate: prices[i].vatRate,
        overrides: Object.fromEntries(Object.entries(variant.overrides).flatMap(([material, change]) => {
            const tintOn = change.tintOn ?? (change.tint != null); // a saved tint counts as on
            const tint = tintOn ? change.tint ?? '#ffffff' : null;
            const map = change.file ? keys.get(change.file) : change.map ?? null;
            return tint == null && map == null ? [] : [[material, { ...(tint != null && { tint }), ...(map != null && { map }) }]];
        }))
    }));
    // Texture files picked in the form: resized + WebP, uploaded to the model, -> Map(File -> R2 key)
    const uploadTextures = async (id) => {
        const files = variants.flatMap((variant) => Object.values(variant.overrides).map((change) => change.file).filter(Boolean));
        if (files.length === 0) return new Map();
        setBusy('Uploading textures…');
        const blobs = await Promise.all(files.map((file) => imageToWebp(file, { quality: 0.85 })));
        const keys = await uploadModelTextures(id, blobs);
        return new Map(files.map((file, i) => [file, keys[i]]));
    };

    const save = async (event) => {
        event.preventDefault();
        if (!canSave) return;
        setError(null);
        const fields = { name: name.trim(), brand: brand.trim(), category, subtype, fixed: isFixed, url: url.trim() || null };
        const replace = (record) => {
            const { libraryModels, setLibraryModels } = useStore.getState();
            setLibraryModels(libraryModels.some((item) => item.id === record.id)
                ? libraryModels.map((item) => (item.id === record.id ? record : item))
                : [...libraryModels, record]);
        };
        let saved = null;
        try {
            if (isEdit) {
                const keys = await uploadTextures(model.id);
                setBusy('Saving…');
                replace(await updateModel(model.id, { ...fields, variants: variantsPayload(keys) }));
                return onClose();
            }
            setBusy('Uploading the model…');
            saved = await createModel({ ...fields, size, variants: variantsPayload() }, glb.file, glb.thumb);
            replace(saved);
            const keys = await uploadTextures(saved.id);
            if (keys.size > 0) {
                setBusy('Saving the variants…');
                const withIds = variantsPayload(keys).map((variant, i) => ({ ...variant, id: saved.variants[i].id }));
                replace(await updateModel(saved.id, { variants: withIds }));
            }
            onClose();
        } catch (err) {
            // the model itself may be saved already (textures fail after the GLB): say so, ✎ retries them
            setError(saved ? `The model is saved, but the variant textures failed (${err.message}): open ✎ to add them again.` : err.message);
            setBusy(null);
        }
    };

    const close = () => !busy && onClose();
    return (
        <div className="material-create-backdrop" onClick={close} onKeyDown={(event) => event.key === 'Escape' && close()}>
            <form className="material-create model-create" onClick={(event) => event.stopPropagation()} onSubmit={save}>
                <div className="material-create-header">
                    <span className="material-create-title">{isEdit ? 'Edit furniture' : 'New furniture'}</span>
                    {(preview || model?.files.thumb) && (
                        <img className="model-create-thumb" src={preview ?? modelFileUrl(model.files.thumb)} alt="" />
                    )}
                </div>

                {!isEdit && (
                    <label className="material-create-file">
                        <span>Model (GLB: one mesh, Draco, textures, meters)</span>
                        <input type="file" accept=".glb,model/gltf-binary" autoFocus onChange={(event) => pickGlb(event.target.files[0] ?? null)} />
                    </label>
                )}
                {checking && <span className="material-create-help">Checking the model…</span>}
                {glbError && <span className="material-create-error" role="alert">{glbError}</span>}
                {size && (
                    <span className="material-create-help">
                        {size.map((side) => side.toFixed(2).replace('.', ',')).join(' × ')} m · {names.length} material{names.length === 1 ? '' : 's'}
                    </span>
                )}

                <label>
                    <span>Name</span>
                    <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="e.g. Oslo armchair" />
                </label>
                <label>
                    <span>Manufacturer</span>
                    <input value={brand} maxLength={60} list="model-brands" onChange={(event) => setBrand(event.target.value)} />
                    <datalist id="model-brands">{brandsOf(models).map((item) => <option key={item} value={item} />)}</datalist>
                </label>
                <div className="material-create-row">
                    <label>
                        <span>Category</span>
                        <select value={category} onChange={(event) => changeCategory(event.target.value)}>
                            {MODEL_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                    </label>
                    <label>
                        <span>Type</span>
                        <select value={subtype} onChange={(event) => setSubtype(event.target.value)}>
                            {subtypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                    </label>
                </div>
                <label className="model-create-check">
                    <input type="checkbox" checked={isFixed} onChange={(event) => setFixed(event.target.checked)} />
                    <span>Fixed: cannot be moved in first-person VR{fixed == null && size ? ' (proposed)' : ''}</span>
                </label>
                <label>
                    <span>Manufacturer link · optional</span>
                    <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
                </label>

                <div className="model-create-variants">
                    {variants.map((variant, i) => (
                        <fieldset key={variant.key} className="material-create-group">
                            <legend>Variant {i + 1}</legend>
                            <div className="material-create-row">
                                <label>
                                    <span>Name</span>
                                    <input value={variant.name} maxLength={60} onChange={(event) => editVariant(variant.key, { name: event.target.value })} placeholder="e.g. Oak" />
                                </label>
                                <label>
                                    <span>Product code</span>
                                    <input value={variant.code} maxLength={60} onChange={(event) => editVariant(variant.key, { code: event.target.value })} />
                                </label>
                            </div>
                            <div className="material-create-row">
                                <label>
                                    <span>Price € / piece (net)</span>
                                    <input type="text" inputMode="decimal" value={variant.price} onChange={(event) => editVariant(variant.key, { price: event.target.value })} placeholder="e.g. 450" />
                                </label>
                                <label>
                                    <span>VAT %</span>
                                    <input type="text" inputMode="decimal" value={variant.vatRate} onChange={(event) => editVariant(variant.key, { vatRate: event.target.value })} />
                                </label>
                            </div>
                            {names.map((material, m) => (
                                <MaterialOverride key={`${m}:${material}`} material={material} change={variant.overrides[material] ?? {}}
                                    onChange={(patch) => editOverride(variant, material, patch)} />
                            ))}
                            {variants.length > 1 && (
                                <button type="button" className="model-create-link" onClick={() => setVariants((list) => list.filter((item) => item.key !== variant.key))}>Remove this variant</button>
                            )}
                        </fieldset>
                    ))}
                    <button type="button" className="model-create-link" onClick={() => setVariants((list) => [...list, newVariant()])}>+ Add a variant</button>
                </div>

                {error && <span className="material-create-error" role="alert">{error}</span>}
                <div className="material-create-actions">
                    <button type="button" onClick={onClose} disabled={busy != null}>Cancel</button>
                    <button type="submit" className="primary" disabled={!canSave}>{busy ?? (isEdit ? 'Save' : 'Create')}</button>
                </div>
            </form>
        </div>
    );
}

/*
* One material of the GLB in a variant: optional tint (color picker, multiplies the material color) and
* optional color texture (a new file, or the one already saved, which can be removed). Materials without a
* name in the GLB cannot be targeted (variants find them by name).
*/
function MaterialOverride({ material, change, onChange }) {
    if (!material) return <span className="material-create-help">(unnamed material: name it in the 3D app to vary it)</span>;
    const tintOn = change.tintOn ?? change.tint != null;
    return (
        <div className="model-create-material">
            <span className="model-create-material-name">{material}</span>
            <label className="model-create-check">
                <input type="checkbox" checked={tintOn} onChange={(event) => onChange({ tintOn: event.target.checked, tint: change.tint ?? '#ffffff' })} />
                <span>Tint</span>
                <input type="color" value={change.tint ?? '#ffffff'} disabled={!tintOn} onChange={(event) => onChange({ tintOn: true, tint: event.target.value })} />
            </label>
            {change.map && !change.file ? (
                <span className="model-create-texture">
                    Texture saved
                    <button type="button" className="model-create-link" onClick={() => onChange({ map: null })}>Remove</button>
                </span>
            ) : (
                <label className="material-create-file">
                    <span>Texture · optional</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange({ file: event.target.files[0] ?? null })} />
                </label>
            )}
        </div>
    );
}
