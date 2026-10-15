import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store/appStore';
import { createMaterial } from '../../../materials/materialsApi';
import { imageToWebp, packOrm } from '../../../materials/imageToWebp';
import './material-create.css';

// Maps the form asks for. ao / roughness / metalness are packed into one ORM image before the upload.
const MAPS = [
    { key: 'color', label: 'Color', required: true },
    { key: 'normal', label: 'Normal (OpenGL)', required: false },
    { key: 'ao', label: 'Ambient occlusion', required: false },
    { key: 'roughness', label: 'Roughness', required: false },
    { key: 'metalness', label: 'Metallic', required: false }
];

/*
* New material form (owner only, opened by the "+" of the materials panel): name, category, real size
* of one texture tile (meters) and the maps. In the browser (materials/imageToWebp.js) images are
* downscaled to 1K and converted to WebP, and AO / roughness / metallic are packed into a single ORM
* image (one texture on the GPU instead of three); then uploaded (materials/materialsApi.js ->
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

    const size = Number(tileSize);
    const canCreate = !busy && name.trim() !== '' && files.color != null && size >= 0.05 && size <= 20;

    const create = async (event) => {
        event.preventDefault();
        if (!canCreate) return;
        setBusy(true);
        setError(null);
        try {
            const converted = {
                color: await imageToWebp(files.color, { quality: 0.85 }),
                // normal maps carry data, not color: a higher quality keeps them smooth
                normal: files.normal ? await imageToWebp(files.normal, { quality: 0.9 }) : null,
                orm: await packOrm(files)
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
                        <input type="number" min={0.05} max={20} step={0.05} value={tileSize} onChange={(event) => setTileSize(event.target.value)} />
                    </label>
                </div>
                <span className="material-create-help">Real size = width of one texture tile in the room (e.g. 2 m of parquet).</span>
                <span className="material-create-help">Maps: upload the best you have (2K recommended). Color and normal are kept up to 2K, AO / roughness / metallic are packed at 1K.</span>

                {MAPS.map((map) => (
                    <label key={map.key} className="material-create-file">
                        <span>{map.label}{map.required ? '' : ' · optional'}</span>
                        <input type="file" accept="image/png,image/jpeg,image/webp"
                            onChange={(event) => setFiles((current) => ({ ...current, [map.key]: event.target.files[0] ?? null }))} />
                    </label>
                ))}

                {error && <span className="material-create-error" role="alert">{error}</span>}
                <div className="material-create-actions">
                    <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className="primary" disabled={!canCreate}>{busy ? 'Uploading…' : 'Create'}</button>
                </div>
            </form>
        </div>
    );
}
