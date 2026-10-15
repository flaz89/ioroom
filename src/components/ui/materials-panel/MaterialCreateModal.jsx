import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store/appStore';
import { createMaterial } from '../../../materials/materialsApi';
import { COLOR_MAX_SIZE, ORM_MAX_SIZE, imageToWebp, packOrm } from '../../../materials/imageToWebp';
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
* New material form (owner only, opened by the "+" of the materials panel): name, category, real size
* of one texture tile (meters) and the maps. In the browser (materials/imageToWebp.js) images are
* downscaled (color / normal up to 2K, ORM 1K) and converted to WebP; the ORM map is either uploaded
* ready-made (ARM) or packed from separate AO / roughness / metallic images (one GPU texture instead of
* three); then uploaded (materials/materialsApi.js ->
* server/src/materials.js, R2). The new material joins the library right away (store
* `libraryMaterials`) and can be dragged onto surfaces.
* A preview ball shows the chosen color map. Escape or a click on the backdrop closes it.
*/
export default function MaterialCreateModal({ onClose }) {
    const [name, setName] = useState('');
    const [category, setCategory] = useState('wall');
    const [tileSize, setTileSize] = useState('1');
    const [files, setFiles] = useState({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    // Preview of the color map (object URL, released when it changes or the modal closes)
    const preview = useMemo(() => (files.color ? URL.createObjectURL(files.color) : null), [files.color]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const pickFile = (key, file) => setFiles((current) => ({ ...current, [key]: file }));
    // Decimal comma or point: "1,5" and "1.5" both mean 1.5 m (a text field, so no browser-locale surprises)
    const size = Number(tileSize.trim().replace(',', '.'));
    const canCreate = !busy && name.trim() !== '' && files.color != null && size >= 0.05 && size <= 20;

    const create = async (event) => {
        event.preventDefault();
        if (!canCreate) return;
        setBusy(true);
        setError(null);
        try {
            const converted = {
                color: await imageToWebp(files.color, { maxSize: COLOR_MAX_SIZE[category], quality: 0.85 }),
                // normal maps carry data, not color: a higher quality keeps them smooth
                normal: files.normal ? await imageToWebp(files.normal, { maxSize: COLOR_MAX_SIZE[category], quality: 0.9 }) : null,
                orm: files.arm
                    ? await imageToWebp(files.arm, { maxSize: ORM_MAX_SIZE, quality: 0.9 })
                    : await packOrm(files)
            };
            const material = await createMaterial({ name: name.trim(), category, tileSize: size }, converted);
            const { libraryMaterials, setLibraryMaterials } = useStore.getState();
            setLibraryMaterials([...libraryMaterials, material]);
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
                    <span className="material-create-title">New material</span>
                    <span className="material-ball" style={preview ? { backgroundImage: `url(${preview})` } : undefined} aria-hidden="true" />
                </div>

                <label>
                    <span>Name</span>
                    <input value={name} maxLength={60} autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. Oak herringbone" />
                </label>
                <div className="material-create-row">
                    <label>
                        <span>Category</span>
                        <select value={category} onChange={(event) => setCategory(event.target.value)}>
                            <option value="floor">Floor</option>
                            <option value="wall">Wall</option>
                        </select>
                    </label>
                    <label>
                        <span>Real size (m)</span>
                        <input type="text" inputMode="decimal" value={tileSize} onChange={(event) => setTileSize(event.target.value)} placeholder="e.g. 1,5" />
                    </label>
                </div>
                <span className="material-create-help">Real size = width of one texture tile in the room (e.g. 2 m of parquet).</span>
                <span className="material-create-help">Maps: upload the best you have (2K recommended). Color and normal are kept up to 2K for walls (seen up close) and 1K for floors; the ARM map at 1K.</span>

                {[...MAIN_MAPS, ARM_MAP].map((map) => <FileField key={map.key} map={map} onPick={pickFile} />)}
                <fieldset className="material-create-group" disabled={files.arm != null}>
                    <legend>{files.arm ? 'Separate maps (not needed: ARM given)' : 'Or separate maps (packed automatically)'}</legend>
                    {SEPARATE_MAPS.map((map) => <FileField key={map.key} map={map} onPick={pickFile} />)}
                </fieldset>

                {error && <span className="material-create-error" role="alert">{error}</span>}
                <div className="material-create-actions">
                    <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className="primary" disabled={!canCreate}>{busy ? 'Uploading…' : 'Create'}</button>
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
