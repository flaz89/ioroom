import './app.css'
import Scene from './components/scene/Scene'
import { xrStore } from './xr/xrStore';
import RightToolBar from './components/ui/RightToolBar';
import LeftToolBar from './components/ui/LeftToolBar';
import PerfPanel from './components/ui/perf-panel/PerfPanel';
import { useEffect } from 'react';
import { SYNC_HOST, connectRoom, getRoomId } from './sync/roomSync';
import { undo, redo } from './sync/history';
import { listMaterials } from './materials/materialsApi';
import { useStore } from './store/appStore';
import RoomNotice from './components/ui/room-notice/RoomNotice';
import CompassBar from './components/ui/compass/CompassBar';
import NoteModal from './components/ui/note-modal/NoteModal';
import PartsMenu from './components/ui/parts-menu/PartsMenu';
import WorkspaceSwitch from './components/ui/workspace-switch/WorkspaceSwitch';
import UndoRedo from './components/ui/undo-redo/UndoRedo';
import PlanGridLegend from './components/builder/PlanGridLegend';


/* 
* App entry point, here logic manages UI and 3D Scene. 
* XR store (src/xr/xrStore.js) is passed as prop in Scene component to provide <XR> component 
*/

export default function App() {

  // Material library (textures stored in R2, server/src/materials.js): loaded once for everyone, rooms
  // may use any of them. Without the sync server only the plain material exists.
  useEffect(() => {
    if (!SYNC_HOST) return;
    listMaterials()
      .then((list) => useStore.getState().setLibraryMaterials(list))
      .catch((error) => console.warn('Material library not loaded:', error.message));
  }, []);

  // Environment document: always created (undo / redo, sync/history.js). Shared room (?room=<id> in the
  // URL, same scene on every device that opens the link) only when VITE_SYNC_HOST is configured;
  // otherwise local mode (only the owner creates rooms).
  useEffect(() => connectRoom(SYNC_HOST ? getRoomId() : null), []);

  // Undo / redo shortcuts: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y. Text fields keep their own undo.
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) undo();
      else if ((key === 'z' && event.shiftKey) || key === 'y') redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="ui-container">
        <div className="ui">
          <LeftToolBar/>
          <RightToolBar/>
          <CompassBar/>
          <RoomNotice/>
          <NoteModal/>
          <PartsMenu/>
          {/* bottom center (provisional), stacked upwards: performance stats (when open), grid scale of the
              2D plan (builder), then undo / redo for everyone and the workspace switch for the admin */}
          <div className="bottom-bar">
            <PerfPanel/>
            <PlanGridLegend/>
            <div className="bottom-bar-row">
              <UndoRedo/>
              <WorkspaceSwitch/>
            </div>
          </div>
        </div>
        
      </div>

      <div className="scene-container">
        <Scene xrStore={xrStore}/>
      </div>
    </>
  )
}
