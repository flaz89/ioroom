/*
* Wakes the on-demand renderer (FrameDriver.jsx) from code that changes what is on screen WITHOUT a store
* change, a pointer / keyboard event or a React render: e.g. remote presence updates (sync/presence.js).
* A no-op until FrameDriver is mounted (and in XR / under the 2D plan, where it is not needed).
*/
let handler = () => {};
export const wakeRender = () => handler();
export const setWakeHandler = (next) => { handler = next ?? (() => {}); };
