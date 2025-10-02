import './app.css'
import Scene from './components/scene/Scene'
import { createXRStore } from '@react-three/xr'

const xrStore = createXRStore();

export default function App() {

  return (
    <>
      <div className="ui-container">
        <button>Enter VR</button>
      </div>

      <div className="scene-container">
        <Scene xrStore={xrStore}/>
      </div>
    </>
  )
}
