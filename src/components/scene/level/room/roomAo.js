import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';

/*
* The room's baked AO (docs/plans/2026-10-29-feat-baked-room-ao-plan.md, U3): ONE texture object for the whole
* session, refilled by every bake (Room.jsx), read through uv1 (aoAtlas.js) by the "ao" variant of the shared
* room materials (SurfaceMesh.jsx). One object, so those materials are built once and never multiply per bake.
* aoMap only darkens the INDIRECT light (environment, XR hemisphere light; never the sun) and, with an
* environment map, its reflections too (three's specular occlusion).
*/
export const ROOM_AO_INTENSITY = 1; // material aoMapIntensity (calibration knob: tune on the headset)

export const roomAoTexture = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat, UnsignedByteType);
roomAoTexture.channel = 1; // uv1
roomAoTexture.minFilter = roomAoTexture.magFilter = LinearFilter;
roomAoTexture.generateMipmaps = false;
roomAoTexture.needsUpdate = true;

// A new bake: its texels (size x size, one channel). A new size needs a new GPU texture (dispose first)
export function setRoomAo(data, size) {
    if (roomAoTexture.image.width !== size) roomAoTexture.dispose();
    roomAoTexture.image = { data, width: size, height: size };
    roomAoTexture.needsUpdate = true;
}
