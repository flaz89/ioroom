import { useStore } from '../../../store/appStore';
import { isAdmin } from '../../../sync/roomSync';
import './workspace-switch.css';

// Views of the builder (store builderView)
const BUILDER_VIEWS = [
    { id: '2d', label: '2D', title: 'Top view floor plan' },
    { id: '3d', label: '3D', title: 'Perspective view' }
];

const MODES = [
    { id: 'builder', label: 'Builder', title: 'Build the environment: floor plan, walls' },
    { id: 'designer', label: 'Designer', title: 'Furnish the environment: materials, furniture, notes' }
];

/*
* Builder | Designer segmented switch (store/slices/workspaceSlice.js). Admin only: guests always stay in
* the designer. Provisional position (bottom center, the top center is taken by the compass).
* In the builder, a second switch picks the view: 2D plan or 3D perspective.
*/
export default function WorkspaceSwitch() {
    const workspace = useStore((state) => state.workspace);
    const setWorkspace = useStore((state) => state.setWorkspace);
    const builderView = useStore((state) => state.builderView);
    const setBuilderView = useStore((state) => state.setBuilderView);
    if (!isAdmin) return null;

    return (
        <>
            <Segmented label="Workspace mode" options={MODES} value={workspace} onPick={setWorkspace} />
            {workspace === 'builder' && (
                <Segmented label="Builder view" options={BUILDER_VIEWS} value={builderView} onPick={setBuilderView} />
            )}
        </>
    );
}

// Glass pill of mutually exclusive buttons (radio group): the current one is orange
function Segmented({ label, options, value, onPick }) {
    return (
        <div className="workspace-switch" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <button
                    key={option.id}
                    role="radio"
                    aria-checked={value === option.id}
                    className={value === option.id ? 'is-active' : undefined}
                    onClick={() => onPick(option.id)}
                    title={option.title}
                >{option.label}</button>
            ))}
        </div>
    );
}
