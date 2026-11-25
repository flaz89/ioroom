import { useSyncExternalStore } from 'react';

/*
* VOICE CHAT in a shared room: WebRTC audio, peer to peer (a MESH: one connection per pair of devices in the
* voice, fine up to ~5-6 people; beyond that an SFU such as Cloudflare Realtime).
*
* OPT-IN, per device, never saved: nothing is heard until this device JOINS the voice (joinVoice, from a click:
* browsers play audio only after a user gesture); the microphone is a separate toggle (setMic), off by default,
* and turning it on joins the voice too. Leaving (leaveVoice) stops everything.
*
* STATE in the room's awareness (presence.js lists it in the users): `voice` = { on, mic } or null.
* Two devices are connected when both are `on`; the lower awareness client id makes the offer (no glare).
* Each connection has ONE audio transceiver from the start: the microphone is put on / taken off it with
* replaceTrack, so turning the mic on or off never renegotiates.
*
* SIGNALING through the room's WebSocket (y-partyserver custom messages, relayed by the server: Room.onCustomMessage
* in server/src/index.js): { voice: { from, to, sdp? , candidate? } }, each device keeps only those `to` it.
*
* SPEAKING: an analyser per stream (the remote ones and this device's microphone) measured ~10 times a second;
* useVoice().speaking = client ids talking right now (computed here, never sent).
*
* NAT: STUN only for now (direct connections: most home / office networks). Corporate networks and some
* mobile networks block them: TURN (Cloudflare, credentials from the Worker) is the next step.
*/
const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
const LEVEL_MS = 100;           // speaking check cadence
const SPEAKING_LEVEL = 0.02;    // RMS of the waveform (0..1) above which someone is talking
const SPEAKING_HOLD_MS = 400;   // still "speaking" this long after the last loud sample (no flicker between words)

let provider = null;
let awareness = null;
let joined = false;
let micStream = null;           // MediaStream of this device's microphone while it is on
let micAnalyser = null;
let micError = null;            // last getUserMedia failure (denied, no microphone)
let audioContext = null;
const peers = new Map();        // client id -> { pc, queue, audio, analyser }
const loudAt = new Map();       // client id -> last time it was loud (ms)
let speaking = new Set();
let levelTimer = null;

// React snapshot, rebuilt on every change
let snapshot = { joined: false, mic: false, micError: null, speaking };
const listeners = new Set();
function notify() {
    snapshot = { joined, mic: micStream != null, micError, speaking };
    listeners.forEach((listener) => listener());
}

// { joined, mic, micError, speaking: Set<client id> } (this device's own id included while it talks)
export function useVoice() {
    return useSyncExternalStore((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }, () => snapshot);
}

/*
* The other clients to be connected with: in the voice, while this device is too (pure, see voice.check.mjs).
* states: Map client id -> awareness state.
*/
export function voicePeerIds(states, selfId, selfJoined) {
    if (!selfJoined) return [];
    return [...states].filter(([id, state]) => id !== selfId && state?.voice?.on === true).map(([id]) => id);
}

function publish() {
    awareness?.setLocalStateField('voice', joined ? { on: true, mic: micStream != null } : null);
}

function send(to, payload) {
    provider?.sendMessage(JSON.stringify({ voice: { from: awareness.clientID, to, ...payload } }));
}

// Analyser on a stream, for the speaking indicator
function analyserFor(stream) {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    return analyser;
}

function createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { pc, queue: Promise.resolve(), audio: null, source: null, analyser: null, position: null, panner: null, spatial: null };
    peers.set(id, peer);
    pc.onicecandidate = ({ candidate }) => { if (candidate) send(id, { candidate: candidate.toJSON() }); };
    pc.ontrack = ({ track, streams }) => {
        if (peer.audio != null) return;
        // the other side puts its microphone with replaceTrack (no stream of its own): `streams` is empty
        const stream = streams[0] ?? new MediaStream([track]);
        // MUTED <audio> element: Chrome gives WebAudio no data from a remote WebRTC stream without one;
        // muted, it autoplays everywhere (iOS Safari blocks an unmuted one started outside a click)
        peer.audio = new Audio();
        peer.audio.muted = true;
        peer.audio.srcObject = stream;
        peer.audio.play().catch(() => {});
        // the sound goes out through WebAudio (the AudioContext was started by the "join" click): straight
        // out, or through a panner in VR (setVoicePosition)
        peer.source = audioContext.createMediaStreamSource(stream);
        peer.analyser = audioContext.createAnalyser();
        peer.analyser.fftSize = 512;
        routePeer(peer);
    };
    // ponytail: a failed connection is dropped and made again at the next presence change; ICE restart if
    // connections drop often on real networks
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') { closePeer(id); syncPeers(); }
    };
    return peer;
}

/*
* SPATIAL AUDIO (VR): the voice of a headset user comes from their avatar's head. RemoteAvatars.jsx calls
* this every frame with that head's position RELATIVE TO THIS DEVICE'S HEAD (meters: x right, y up, -z ahead,
* the Web Audio listener's default pose, so the listener is never moved), or null = plain audio (this device
* is not in a headset, or the speaker has no avatar: desktop / phone).
*/
export function setVoicePosition(id, position) {
    const peer = peers.get(id);
    if (peer == null) return;
    peer.position = position;
    routePeer(peer);
}

// Distance falloff: full volume within REF_DISTANCE, then ~1/distance (calibration knobs)
const REF_DISTANCE = 1;
const ROLLOFF = 1;

// Connects a peer's sound straight out or through its panner, as its position says
function routePeer(peer) {
    if (peer.source == null) return;
    const spatial = peer.position != null;
    if (spatial !== peer.spatial) {
        peer.source.disconnect();
        peer.source.connect(peer.analyser);
        if (spatial) {
            peer.panner ??= new PannerNode(audioContext, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: REF_DISTANCE, rolloffFactor: ROLLOFF });
            peer.panner.connect(audioContext.destination);
            peer.source.connect(peer.panner);
        } else {
            peer.source.connect(audioContext.destination);
        }
        peer.spatial = spatial;
    }
    if (spatial) {
        peer.panner.positionX.value = peer.position.x;
        peer.panner.positionY.value = peer.position.y;
        peer.panner.positionZ.value = peer.position.z;
    }
}

function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.source?.disconnect();
    peer.panner?.disconnect();
    if (peer.audio) { peer.audio.pause(); peer.audio.srcObject = null; }
    peers.delete(id);
    loudAt.delete(id);
}

// Opens / closes the connections to match who is in the voice
function syncPeers() {
    if (awareness == null) return;
    const wanted = new Set(voicePeerIds(awareness.getStates(), awareness.clientID, joined));
    for (const id of peers.keys()) if (!wanted.has(id)) closePeer(id);
    for (const id of wanted) {
        if (peers.has(id) || id < awareness.clientID) continue; // the lower id makes the offer
        const peer = createPeer(id);
        const transceiver = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
        if (micStream) transceiver.sender.replaceTrack(micStream.getAudioTracks()[0]);
        peer.queue = peer.queue.then(async () => {
            await peer.pc.setLocalDescription(await peer.pc.createOffer());
            send(id, { sdp: peer.pc.localDescription.toJSON() });
        });
    }
}

// Signaling message from another device
function onCustomMessage(text) {
    let message;
    try { message = JSON.parse(text).voice; } catch { return; }
    if (message == null || awareness == null || message.to !== awareness.clientID || !joined) return;
    const { from, sdp, candidate } = message;
    // an offer always starts a new connection (the other side made a new one, e.g. after a failure)
    if (sdp?.type === 'offer') closePeer(from);
    const peer = peers.get(from) ?? (sdp?.type === 'offer' ? createPeer(from) : null);
    if (peer == null) return; // stray answer / candidate of a closed connection
    // in order: a candidate must not be added before the description it belongs to
    peer.queue = peer.queue.then(async () => {
        if (sdp) {
            await peer.pc.setRemoteDescription(sdp);
            if (sdp.type === 'offer') {
                const transceiver = peer.pc.getTransceivers()[0];
                transceiver.direction = 'sendrecv';
                if (micStream) await transceiver.sender.replaceTrack(micStream.getAudioTracks()[0]);
                await peer.pc.setLocalDescription(await peer.pc.createAnswer());
                send(from, { sdp: peer.pc.localDescription.toJSON() });
            }
        } else if (candidate) {
            await peer.pc.addIceCandidate(candidate);
        }
    }).catch((error) => console.warn('voice: signaling failed', error));
}

// RMS of an analyser's current waveform (0..1)
function levelOf(analyser) {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const value of data) sum += value * value;
    return Math.sqrt(sum / data.length);
}

function measureLevels() {
    const now = performance.now();
    const sources = [...peers].map(([id, peer]) => [id, peer.analyser]);
    if (micAnalyser && awareness) sources.push([awareness.clientID, micAnalyser]);
    for (const [id, analyser] of sources) if (analyser && levelOf(analyser) > SPEAKING_LEVEL) loudAt.set(id, now);
    const next = new Set([...loudAt].filter(([, at]) => now - at < SPEAKING_HOLD_MS).map(([id]) => id));
    if (next.size === speaking.size && [...next].every((id) => speaking.has(id))) return;
    speaking = next;
    notify();
}

// Joins the voice: hears the others (call it from a click)
export function joinVoice() {
    if (joined || awareness == null) return;
    joined = true;
    audioContext ??= new AudioContext();
    audioContext.resume();
    levelTimer = setInterval(measureLevels, LEVEL_MS);
    publish();
    syncPeers();
    notify();
}

// Leaves the voice: microphone off, every connection closed
export function leaveVoice() {
    if (!joined) return;
    joined = false;
    stopMic();
    for (const id of [...peers.keys()]) closePeer(id);
    clearInterval(levelTimer);
    speaking = new Set();
    loudAt.clear();
    publish();
    notify();
}

function stopMic() {
    micStream?.getTracks().forEach((track) => track.stop()); // the browser's "mic in use" sign goes off too
    micStream = null;
    micAnalyser = null;
}

// Microphone on / off (on also joins the voice); asks the browser's permission the first time
export async function setMic(on) {
    if (awareness == null) return;
    if (!on) {
        stopMic();
        peers.forEach((peer) => peer.pc.getTransceivers()[0]?.sender.replaceTrack(null));
        publish();
        notify();
        return;
    }
    if (micStream) return;
    joinVoice();
    try {
        micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        micError = null;
    } catch (error) {
        micError = error?.name === 'NotAllowedError' ? 'Microphone blocked' : 'No microphone';
        notify();
        return;
    }
    if (!joined) { stopMic(); return; } // left while the permission prompt was open
    micAnalyser = analyserFor(micStream);
    const track = micStream.getAudioTracks()[0];
    peers.forEach((peer) => peer.pc.getTransceivers()[0]?.sender.replaceTrack(track));
    publish();
    notify();
}

// Called by connectRoom with the room's provider; returns the unbind function
export function bindVoice(roomProvider) {
    provider = roomProvider;
    awareness = roomProvider.awareness;
    provider.on('custom-message', onCustomMessage);
    awareness.on('change', syncPeers);
    // reconnected (e.g. back after being away): presence and connections again
    const onStatus = ({ status }) => { if (status === 'connected') { publish(); syncPeers(); } };
    provider.on('status', onStatus);
    return () => {
        leaveVoice();
        provider.off('custom-message', onCustomMessage);
        provider.off('status', onStatus);
        awareness.off('change', syncPeers);
        provider = null;
        awareness = null;
    };
}
