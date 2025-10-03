import './app.css'
import Scene from './components/scene/Scene'
import { createXRStore } from '@react-three/xr'
import ExperienceMode from './components/ui/experience-mode/ExperienceMode';

const xrStore = createXRStore();

/* 
* App entry point, here logic manages UI and 3D Scene. 
* XR store is created here and passed as prop in Scene component to provide <XR> component 
*/

export default function App() {

    

  return (
    <>
      <div className="ui-container">
        <ExperienceMode xrStore={xrStore}/>
      </div>

      <div className="scene-container">
        <Scene xrStore={xrStore}/>
      </div>
    </>
  )
}
