import './app.css'
import Scene from './components/scene/Scene'
import { xrStore } from './xr/xrStore';
import RightToolBar from './components/ui/RightToolBar';
import LeftToolBar from './components/ui/LeftToolBar';
import PerfPanel from './components/ui/perf-panel/PerfPanel';
import { useEffect } from 'react';
import { SYNC_HOST, connectRoom, getRoomId } from './sync/roomSync';


/* 
* App entry point, here logic manages UI and 3D Scene. 
* XR store (src/xr/xrStore.js) is passed as prop in Scene component to provide <XR> component 
*/

export default function App() {

  // Shared room (?room=<id> in the URL): same scene on every device that opens the link.
  // Skipped when VITE_SYNC_HOST is not configured (local only).
  useEffect(() => {
    if (!SYNC_HOST) return;
    return connectRoom(getRoomId());
  }, []);

  return (
    <>
      <div className="ui-container">
        <div className="ui">
          <LeftToolBar/>
          <RightToolBar/>
          <PerfPanel/>
        </div>
        
      </div>

      <div className="scene-container">
        <Scene xrStore={xrStore}/>
      </div>
    </>
  )
}
