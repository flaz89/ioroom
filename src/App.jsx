import './app.css'
import Scene from './components/scene/Scene'
import { createXRStore } from '@react-three/xr'
import RightMenu from './components/ui/RightMenu';
import LeftMenu from './components/ui/LeftMenu';

const xrStore = createXRStore();

/* 
* App entry point, here logic manages UI and 3D Scene. 
* XR store is created here and passed as prop in Scene component to provide <XR> component 
*/

export default function App() {

    

  return (
    <>
      <div className="ui-container">
        <div className="ui">
          <LeftMenu/>
          <RightMenu xrStore={xrStore}/>
        </div>
        
      </div>

      <div className="scene-container">
        <Scene xrStore={xrStore}/>
      </div>
    </>
  )
}
