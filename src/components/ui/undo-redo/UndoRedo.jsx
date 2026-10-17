import CircleButton from '../circle-button/CircleButton';
import { svg } from '../../../utils/svg-logos';
import { undo, redo, useHistoryAvailability } from '../../../sync/history';
import './undo-redo.css';

/*
* Undo / redo buttons (sync/history.js): this device's own edits only. Shown to everyone (guests edit too),
* mainly for touch devices; desktop also has Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (App.jsx).
* Disabled when there is nothing to undo / redo.
*/
export default function UndoRedo() {
    const { canUndo, canRedo } = useHistoryAvailability();

    return (
        <div className="undo-redo">
            <CircleButton svg={svg.undo} onClick={undo} isDisabled={!canUndo} title="Undo (Cmd/Ctrl+Z)" />
            <CircleButton svg={svg.redo} onClick={redo} isDisabled={!canRedo} title="Redo (Cmd/Ctrl+Shift+Z)" />
        </div>
    );
}
