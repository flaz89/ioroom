import { useStore } from '../../../store/appStore';
import { isAdmin } from '../../../sync/roomSync';
import './workspace-switch.css';

const MODES = [
    { id: 'builder', label: 'Builder', title: 'Build the environment: floor plan, walls' },
    { id: 'designer', label: 'Designer', title: 'Furnish the environment: materials, furniture, notes' }
];

/*
* Builder | Designer segmented switch (store/slices/workspaceSlice.js). Admin only: guests always stay in
* the designer. Provisional position (bottom center, the top center is taken by the compass).
*/
export default function WorkspaceSwitch() {
    const workspace = useStore((state) => state.workspace);
    const setWorkspace = useStore((state) => state.setWorkspace);
    if (!isAdmin) return null;

    return (
        <div className="workspace-switch" role="radiogroup" aria-label="Workspace mode">
            {MODES.map((mode) => (
                <button
                    key={mode.id}
                    role="radio"
                    aria-checked={workspace === mode.id}
                    className={workspace === mode.id ? 'is-active' : undefined}
                    onClick={() => setWorkspace(mode.id)}
                    title={mode.title}
                >{mode.label}</button>
            ))}
        </div>
    );
}
