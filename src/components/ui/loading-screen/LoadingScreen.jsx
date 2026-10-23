import { useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useStore } from '../../../store/appStore';
import { useRoomStatus } from '../../../sync/roomSync';
import HouseBuild from './HouseBuild';
import './loading-screen.css';

// Room states after which the room step is over: content received, no room, or a state the room notice
// explains (the loading screen must not hide it forever)
const ROOM_DONE = ['synced', 'local', 'not-found', 'elsewhere'];
// Calibration knobs
const TEXTURES_IDLE_MS = 400; // textures start loading only once the room and materials are in: no texture
                              // request for this long (after those) = nothing left to load
const FADE_MS = 500;          // fade-out (keep in sync with the css transition)
const MAX_WAIT_MS = 20000;    // safety: never block the app longer than this (offline, a stuck request)

/*
* Full-screen loading screen shown while an environment opens: at app start and when another environment is
* opened ("My environments" reloads the page, so both cases are the same). Real progress, in steps:
*   1. renderer created (store renderer.readyBackend, set in the Canvas onCreated);
*   2. room content received (sync/roomSync.js status 'synced'; local mode skips it);
*   3. material library listed (store libraryLoaded, App.jsx);
*   4. textures (drei useProgress: three's DefaultLoadingManager, used by the texture loader): done when
*      nothing has been loading for TEXTURES_IDLE_MS.
* Then it fades out and unmounts; it never comes back during the visit.
* Look: glass card with a house being built in DXF-orange lines (HouseBuild.jsx), progress bar with its
* percentage, step label.
*/
export default function LoadingScreen() {
    const isRendererReady = useStore((state) => state.renderer.readyBackend != null);
    const roomStatus = useRoomStatus();
    const isLibraryLoaded = useStore((state) => state.libraryLoaded);
    const { active: isLoadingTextures, loaded, total } = useProgress();

    const isRoomReady = ROOM_DONE.includes(roomStatus);
    const isDataReady = isRendererReady && isRoomReady && isLibraryLoaded;

    // textures: idle for TEXTURES_IDLE_MS once the data is in (requests start right after it)
    const [areTexturesReady, setTexturesReady] = useState(false);
    useEffect(() => {
        if (!isDataReady || isLoadingTextures) return undefined;
        const timer = setTimeout(() => setTexturesReady(true), TEXTURES_IDLE_MS);
        return () => clearTimeout(timer);
    }, [isDataReady, isLoadingTextures]);

    // safety timeout: the app becomes usable anyway
    const [isTimedOut, setTimedOut] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
        return () => clearTimeout(timer);
    }, []);

    const isReady = (isDataReady && areTexturesReady) || isTimedOut;

    // fade out, then unmount for good
    const [isGone, setGone] = useState(false);
    const wasReady = useRef(false);
    useEffect(() => {
        if (!isReady || wasReady.current) return undefined;
        wasReady.current = true;
        const timer = setTimeout(() => setGone(true), FADE_MS);
        return () => clearTimeout(timer);
    }, [isReady]);
    if (isGone) return null;

    // progress: steps weighted by how long they usually take; textures by their own count
    const textureShare = total > 0 ? loaded / total : 0;
    const progress = isReady ? 1
        : 0.1 * isRendererReady + 0.3 * isRoomReady + 0.2 * isLibraryLoaded + 0.4 * (areTexturesReady ? 1 : textureShare);
    const percent = Math.round(progress * 100);
    const label = !isRendererReady ? 'Starting the renderer'
        : !isRoomReady ? 'Opening the environment'
        : !isLibraryLoaded ? 'Loading materials'
        : total > 0 && isLoadingTextures ? `Loading textures ${loaded}/${total}`
        : 'Almost ready';

    return (
        <div className={`loading-screen${isReady ? ' is-done' : ''}`} role="status" aria-live="polite">
            <div className="loading-card">
                <HouseBuild />
                <div className="loading-bar"><div className="loading-bar-fill" style={{ width: `${percent}%` }} /></div>
                <span className="loading-percent">{percent}%</span>
                <span className="loading-label">{label}</span>
            </div>
        </div>
    );
}
