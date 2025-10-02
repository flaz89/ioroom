import './app.css'
import Scene from './components/scene/Scene'
import { createXRStore } from '@react-three/xr'

const xrStore = createXRStore();

/* 
* App entry point, here logic manages UI and 3D Scene. 
* XR store is created here and passed as prop in Scene component to provide <XR> component 
*/

export default function App() {

  return (
    <>
      <div className="ui-container">
        <button onClick={() => {xrStore.enterVR()}}>Enter VR</button>
        <button onClick={() => {xrStore.enterAR()}}>Enter AR</button>
      </div>

      <div className="scene-container">
        <Scene xrStore={xrStore}/>
      </div>
    </>
  )
}
