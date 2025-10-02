import './app.css'
import Scene from './components/scene/Scene'
import { createXRStore } from '@react-three/xr'

const xrStore = createXRStore();

/* 
* App entry point, here logic manages UI and 3D Scene. 
* XR store is created here and passed as prop in Scene component to provide <XR> component 
*/

export default function App() {

    // function to allow player to enlarge to full screen visualization on computer
    const toggleFullScreen = () => {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement
    
    if (!fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen()
        } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.requestFullscreen()
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullScreen) {
            document.webkitExitFullscreen();
        }
    }
  };

  return (
    <>
      <div className="ui-container">
        <button onClick={() => {xrStore.enterVR()}}>Enter VR</button>
        <button onClick={() => {xrStore.enterAR()}}>Enter AR</button>
        <button onClick={toggleFullScreen}>Fullscreen</button>
      </div>

      <div className="scene-container">
        <Scene xrStore={xrStore}/>
      </div>
    </>
  )
}
