import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store/appStore';
import { createMaterial, updateMaterial } from '../../../materials/materialsApi';
import { MATERIAL_CATEGORIES, MATERIAL_KINDS, kindOf } from '../../../materials/grouping';
import { DEFAULT_VAT, formatDecimal, parseDecimal } from '../../../materials/pricing';
import { ORM_MAX_SIZE, imageToWebp, packOrm } from '../../../materials/imageToWebp';
import './material-create.css';

// Maps the form asks for. The ORM data comes either from one ready-made ARM/ORM image (e.g. Poly Haven
// "arm": R ambient occlusion, G roughness, B metalness) or from separate AO / roughness / metallic
// images packed in the browser; the ready-made one wins when both are given.
const MAIN_MAPS = [
    { key: 'color', label: 'Color', required: true },
    { key: 'normal', label: 'Normal (OpenGL)', required: false }
];
const ARM_MAP = { key: 'arm', label: 'ARM / ORM (packed AO · roughness · metallic)', required: false };
const SEPARATE_MAPS = [
    { key: 'ao', label: 'Ambient occlusion', required: false },
    { key: 'roughness', label: 'Roughness', required: false },
    { key: 'metalness', label: 'Metallic', required: false }
];

/*
* New material form (owner only, opened by the "+" of the materials panel): name, category, kind, real size
* of one texture tile (meters) and the maps. In the browser (materials/imageToWebp.js) images are
* downscaled to 1K and converted to WebP; the ORM map is either uploaded
* ready-made (ARM) or packed from separate AO / roughness / metallic images (one GPU texture instead of
* three); then uploaded (materials/materialsApi.js ->
* server/src/materials.js, R2). The new material joins the library right away (store
* `libraryMaterials`) and can be dragged onto surfaces.
* A preview ball shows the chosen color map. Escape or a click on the backdrop closes it.
* EDIT mode (`material` given, the "✎" of the panel): same form for name, category, kind and real size,
* without the maps (they never change; to replace them, upload a new material). Saved with
* updateMaterial (PATCH): surfaces using it update right away (new tile size, panel group).
* initialCategory: preselected category of a new material (the panel's current tab).
* PRODUCT CARD (optional, both modes): net price €/m² (VAT excluded), VAT %, waste %, manufacturer code
* and link (materials/pricing.js). They feed the material card and the bill of quantities.
*/
export default function MaterialCreateModal({ material = null, initialCategory = 'wall', onClose }) {
    const isEdit = material != null;
    const [name, setName] = useState(material?.name ?? '');
    const [category, setCategory] = useState(material?.category ?? initialCategory);
    const [kind, setKind] = useState(material ? kindOf(material) : 'other');
    // shown with a decimal comma, like the user would type it
    const [tileSize, setTileSize] = useState(material ? String(material.tileSize).replace('.', ',') : '1');
    // product card: text fields (decimal comma or point), parsed on save
    const [price, setPrice] = useState(formatDecimal(material?.price));
    const [vatRate, setVatRate] = useState(formatDecimal(material?.vatRate ?? DEFAULT_VAT));
    const [waste, setWaste] = useState(formatDecimal(material?.waste ?? 0));
    const [code, setCode] = useState(material?.code ?? '');
    const [url, setUrl] = useState(material?.url ?? '');
    const [files, setFiles] = useState({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    // Preview of the color map (object URL, released when it changes or the modal closes)
    const preview = useMemo(() => (files.color ? URL.createObjectURL(files.color) : null), [files.color]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const pickFile = (key, file) => setFiles((current) => ({ ...current, [key]: file }));
    // Decimal comma or point: "1,5" and "1.5" both mean 1.5 m (a text field, so no browser-locale surprises)
    const size = Number(tileSize.trim().replace(',', '.'));
    const card = { price: parseDecimal(price), vatRate: parseDecimal(vatRate), waste: parseDecimal(waste) };
    const cardValid = Object.values(card).every((value) => value == null || value >= 0)
        && (card.vatRate ?? 0) <= 100 && (card.waste ?? 0) <= 100
        && (url.trim() === '' || /^https?:\/\/\S+$/i.test(url.trim()));
    const canCreate = !busy && name.trim() !== '' && (isEdit || files.color != null) && size >= 0.05 && size <= 20 && cardValid;

    const create = async (event) => {
        event.preventDefault();
        if (!canCreate) return;
        setBusy(true);
        setError(null);
        try {
            const fields = { name: name.trim(), category, kind, tileSize: size, ...card, code: code.trim() || null, url: url.trim() || null };
            const { libraryMaterials, setLibraryMaterials } = useStore.getState();
            if (isEdit) {
                const updated = await updateMaterial(material.id, fields);
                setLibraryMaterials(libraryMaterials.map((item) => (item.id === updated.id ? updated : item)));
                onClose();
                return;
            }
            const converted = {
                color: await imageToWebp(files.color, { quality: 0.85 }),
                // normal maps carry data, not color: a higher quality keeps them smooth
                normal: files.normal ? await imageToWebp(files.normal, { quality: 0.9 }) : null,
                orm: files.arm
                    ? await imageToWebp(files.arm, { maxSize: ORM_MAX_SIZE, quality: 0.9 })
                    : await packOrm(files)
            };
            const created = await createMaterial(fields, converted);
            setLibraryMaterials([...libraryMaterials, created]);
            onClose();
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    return (
        <div className="material-create-backdrop" onClick={() => !busy && onClose()} onKeyDown={(event) => event.key === 'Escape' && !busy && onClose()}>
            <form className="material-create" onClick={(event) => event.stopPropagation()} onSubmit={create}>
                <div className="material-create-header">
                    <span className="material-create-title">{isEdit ? 'Edit material' : 'New material'}</span>
                    {/* preview: the chosen color map (new) or the material's own (edit) */}
                    <span className="material-ball" style={(preview ?? material?.maps?.color) ? { backgroundImage: `url(${preview ?? material.maps.color})` } : undefined} aria-hidden="true" />
                </div>

                <label>
                    <span>Name</span>
                    <input value={name} maxLength={60} autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. Oak herringbone" />
                </label>
                <div className="material-create-row">
                    <label>
                        <span>Category</span>
                        <select value={category} onChange={(event) => setCategory(event.target.value)}>
                            {MATERIAL_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                    </label>
                    <label>
                        <span>Kind</span>
                        <select value={kind} onChange={(event) => setKind(event.target.value)}>
                            {MATERIAL_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                    </label>
                </div>
                <div className="material-create-row">
                    <label>
                        <span>Real size (m)</span>
                        <input type="text" inputMode="decimal" value={tileSize} onChange={(event) => setTileSize(event.target.value)} placeholder="e.g. 1,5" />
                    </label>
                </div>
                <span className="material-create-help">Real size = width of one texture tile in the room (e.g. 2 m of parquet).</span>
                <fieldset className="material-create-group">
                    <legend>Product card · optional</legend>
                    <div className="material-create-row three">
                        <label>
                            <span>Price €/m² (net)</span>
                            <input type="text" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 45,50" />
                        </label>
                        <label>
                            <span>VAT %</span>
                            <input type="text" inputMode="decimal" value={vatRate} onChange={(event) => setVatRate(event.target.value)} />
                        </label>
                        <label>
                            <span>Waste %</span>
                            <input type="text" inputMode="decimal" value={waste} onChange={(event) => setWaste(event.target.value)} />
                        </label>
                    </div>
                    <label>
                        <span>Product code</span>
                        <input value={code} maxLength={60} onChange={(event) => setCode(event.target.value)} />
                    </label>
                    <label>
                        <span>Manufacturer link</span>
                        <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
                    </label>
                    <span className="material-create-help">Waste = extra material to buy for cuts and breakage (e.g. 10% for tiles).</span>
                </fieldset>
                {!isEdit && (<>
                    <span className="material-create-help">Maps: upload the best you have (2K recommended). Everything is resized to 1K.</span>
                    {[...MAIN_MAPS, ARM_MAP].map((map) => <FileField key={map.key} map={map} onPick={pickFile} />)}
                    <fieldset className="material-create-group" disabled={files.arm != null}>
                        <legend>{files.arm ? 'Separate maps (not needed: ARM given)' : 'Or separate maps (packed automatically)'}</legend>
                        {SEPARATE_MAPS.map((map) => <FileField key={map.key} map={map} onPick={pickFile} />)}
                    </fieldset>
                </>)}

                {error && <span className="material-create-error" role="alert">{error}</span>}
                <div className="material-create-actions">
                    <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className="primary" disabled={!canCreate}>{busy ? (isEdit ? 'Saving…' : 'Uploading…') : (isEdit ? 'Save' : 'Create')}</button>
                </div>
            </form>
        </div>
    );
}

// One map file input
function FileField({ map, onPick }) {
    return (
        <label className="material-create-file">
            <span>{map.label}{map.required ? '' : ' · optional'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onPick(map.key, event.target.files[0] ?? null)} />
        </label>
    );
}
