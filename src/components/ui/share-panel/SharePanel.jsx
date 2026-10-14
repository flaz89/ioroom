import { useState } from 'react';
import QRCode from 'qrcode';
import CircleButton from '../circle-button/CircleButton';
import { useStore } from '../../../store/appStore';
import { svg } from '../../../utils/svg-logos';
import './share-panel.css';

// Public address of the deployed app (e.g. https://ioroom.vercel.app). Used only when the page runs on
// localhost / a LAN address, so a shared link never points at a dev machine. Unset = current address.
const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL;

// Link to the current shared room: this page's room, on the public address when developing locally
function shareLink() {
    const here = new URL(window.location.href);
    const isLocal = /^(localhost|127\.|192\.168\.|10\.)/.test(here.hostname);
    if (!isLocal || !PUBLIC_URL) return here.href;
    const link = new URL(PUBLIC_URL);
    link.search = here.search; // keeps ?room=…
    return link.href;
}

/*
* "Share" toolbar button: opens a small panel with a QR code and the link of the current room, so another
* device (headset, tablet, phone) can join the same scene: scan the QR or open/copy the link.
*/
export default function SharePanel() {
    // Open state shared with the other toolbar panels: only one open at a time (store/slices/panelSlice.js)
    const isOpen = useStore((state) => state.openPanel === 'share');
    const togglePanel = useStore((state) => state.togglePanel);
    const closePanel = useStore((state) => state.closePanel);
    const [link, setLink] = useState('');
    const [qr, setQr] = useState(null);     // QR image (data URL)
    const [copied, setCopied] = useState(false);

    // Link and QR are built when the panel opens (the room id is in the URL by then)
    const toggle = () => {
        togglePanel('share');
        if (isOpen) return;
        const url = shareLink();
        setLink(url);
        setCopied(false);
        QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0b1030', light: '#ffffff' } })
            .then(setQr)
            .catch(console.error);
    };

    const copy = () => {
        navigator.clipboard?.writeText(link)
            .then(() => setCopied(true))
            .catch(console.error);
    };

    return (
        <div className="share-control">
            <CircleButton svg={svg.share} onClick={toggle} isActive={isOpen} title="Share this room" />
            {isOpen && (
                // Centered modal; a click on the dimmed backdrop (outside the panel) closes it
                <div className="share-backdrop" onClick={closePanel}>
                <div className="share-panel" onClick={(event) => event.stopPropagation()}>
                    <span className="share-title">Open on another device</span>
                    {qr && <img className="share-qr" src={qr} alt="QR code of the room link" />}
                    <input className="share-link" value={link} readOnly onFocus={(event) => event.target.select()} />
                    <button className="share-copy" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
                </div>
                </div>
            )}
        </div>
    );
}
