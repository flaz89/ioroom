import { API_ORIGIN, adminToken } from './roomSync';

/*
* Client of the "My environments" API of the sync server (server/src/index.js, /api/rooms).
* Owner only: every request carries the admin token kept by roomSync.js. Each function resolves with the
* server's JSON ({ id, name, createdAt, updatedAt } per environment) and rejects with an Error whose
* message is meant for the UI.
*/

const API = `${API_ORIGIN}/api/rooms`;

async function request(path = '', method = 'GET', body) {
    const response = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
    });
    if (!response.ok) {
        const { error } = await response.json().catch(() => ({}));
        throw new Error(error ?? `Request failed (${response.status})`);
    }
    return response.status === 204 ? null : response.json();
}

export const listRooms = () => request();
export const createRoom = (name) => request('', 'POST', { name });
export const renameRoom = (id, name) => request(`/${id}`, 'PATCH', { name });
export const duplicateRoom = (id) => request(`/${id}/duplicate`, 'POST');
export const deleteRoom = (id) => request(`/${id}`, 'DELETE');
