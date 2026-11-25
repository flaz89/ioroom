import { useRoomUsers } from '../../../sync/presence';
import { useStore } from '../../../store/appStore';
import { joinVoice, leaveVoice, setMic, useVoice } from '../../../sync/voice';
import './room-users.css';

const MAX_DOTS = 4; // overlapping color dots shown in the collapsed group; the count covers the rest

/*
* People in the shared room (top left), collapsed into one pill: overlapping presence-color dots and the
* number of people. Tap/click it to open the list: one row per device with its presence color (the same
* color outlines the objects it is holding); this device comes first, marked "you". The list is one of
* the toolbar panels (store openPanel 'users'): opening another panel closes it. Hidden without a room.
* Away devices (page hidden, headset off: presence.js) are dimmed, marked "away".
* Names are device types for now (sync/presence.js deviceName); accounts will replace them.
* VOICE (sync/voice.js): at the end of every row a speaker (in the voice: hears the room) and a microphone,
* orange when on. On this device's row they are the toggles (join / leave the voice, microphone on / off),
* on the others they show that device's state. The dot of whoever is talking glows (also in the collapsed
* pill, which shows a microphone while this device's one is on).
*/
const SpeakerIcon = () => (
    <svg className="room-voice-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path className="is-filled" d="M4 9h4l5-4v14l-5-4H4z" />
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
);
const MicIcon = () => (
    <svg className="room-voice-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect className="is-filled" x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
);
const onClass = (on) => on ? 'room-voice-toggle is-on' : 'room-voice-toggle';

export default function RoomUsers() {
    const users = useRoomUsers();
    const isOpen = useStore((state) => state.openPanel === 'users');
    const togglePanel = useStore((state) => state.togglePanel);
    const voice = useVoice();
    if (users.length === 0) return null;
    const dotClass = (user) => voice.speaking.has(user.clientId) ? 'room-user-dot is-speaking' : 'room-user-dot';

    return (
        <div className="room-users">
            <button
                className={isOpen ? 'room-users-group is-active' : 'room-users-group'}
                onClick={() => togglePanel('users')}
                aria-expanded={isOpen}
                title={`${users.length} ${users.length === 1 ? 'person' : 'people'} in this room`}
            >
                <span className="room-users-dots">
                    {users.slice(0, MAX_DOTS).map((user) => (
                        <span key={user.clientId} className={dotClass(user)} style={{ background: user.color, color: user.color }} />
                    ))}
                </span>
                <span>{users.length}</span>
                {voice.mic && <span className="room-voice-toggle is-on"><MicIcon /></span>}
            </button>

            {isOpen && (
                <div className="room-users-list" aria-label="People in this room">
                    {users.map((user) => (
                        <div key={user.clientId} className={user.away ? 'room-user is-away' : 'room-user'}
                            title={user.isSelf ? 'This device' : user.away ? `${user.name} is away` : user.name}>
                            <span className={dotClass(user)} style={{ background: user.color, color: user.color }} />
                            <span>{user.name}{user.isSelf && <span className="room-user-self"> (you)</span>}{user.away && <span className="room-user-self"> · away</span>}</span>
                            {user.isSelf ? (
                                <span className="room-voice">
                                    <button className={onClass(voice.joined)} onClick={voice.joined ? leaveVoice : joinVoice}
                                        title={voice.joined ? 'Stop hearing the room' : 'Hear the others in this room'} aria-pressed={voice.joined}>
                                        <SpeakerIcon />
                                    </button>
                                    <button className={onClass(voice.mic)} onClick={() => setMic(!voice.mic)}
                                        title={voice.micError ?? (voice.mic ? 'Turn your microphone off' : 'Turn your microphone on')} aria-pressed={voice.mic}>
                                        <MicIcon />
                                    </button>
                                    {voice.micError && <span className="room-voice-error">{voice.micError}</span>}
                                </span>
                            ) : (
                                <span className="room-voice" title={user.voice?.on ? (user.voice.mic ? 'In the voice, microphone on' : 'Listening') : 'Not in the voice'}>
                                    <span className={onClass(user.voice?.on)}><SpeakerIcon /></span>
                                    <span className={onClass(user.voice?.mic)}><MicIcon /></span>
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
