/*
* Sun position for the scene's sun light (components/light/Light.jsx).
*
* sunPosition(date, lat, lon) -> { azimuth, altitude } in RADIANS:
*   azimuth  = compass bearing, from geographic north, clockwise (0 = N, PI/2 = E, PI = S);
*   altitude = angle above the horizon (negative = below).
* Algorithm: the low-precision solar position used by SunCalc (V. Agafonkin, BSD), based on
* https://aa.quae.nl/en/reken/zonpositie.html — accurate to a fraction of a degree, plenty for shadows.
*
* localTimeToDate(year, dayOfYear, minutes, timeZone) -> Date: the instant when the clocks of `timeZone`
* (IANA name, e.g. "Europe/Rome") show that day and time, daylight saving time included.
*
* sunDirection(azimuth, altitude, northDeg) -> [x, y, z] unit vector from the room towards the sun, in room
* space: +Y up, the back wall at -Z. northDeg = where geographic north points, in degrees clockwise (seen
* from above) from the room's -Z axis (0 = the back wall faces north, 90 = the right wall faces north).
*/

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = 23.4397 * RAD; // tilt of the Earth's axis

const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000; // days since J2000.0

// Azimuth (compass bearing) and altitude of a body at right ascension `ra` / declination `dec`
function horizontal(d, lat, lon, ra, dec) {
    const phi = lat * RAD;
    const H = RAD * (280.16 + 360.9856235 * d) + lon * RAD - ra; // local hour angle from the sidereal time
    const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    // atan2 gives the azimuth from SOUTH, westward positive: + PI turns it into a compass bearing
    const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { azimuth: (fromSouth + Math.PI) % (2 * Math.PI), altitude };
}

// Ecliptic (longitude l, latitude b) -> equatorial (right ascension, declination)
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));

export function sunPosition(date, lat, lon) {
    const d = toDays(date);
    // Sun's ecliptic longitude from the mean anomaly and the equation of center
    const M = RAD * (357.5291 + 0.98560028 * d);
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + RAD * 102.9372 + Math.PI;
    return horizontal(d, lat, lon, rightAscension(L, 0), declination(L, 0));
}

// Offset of `timeZone` from UTC at instant `ms`, in ms (e.g. +2 h for Rome in summer)
function timeZoneOffset(ms, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
    }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - Math.floor(ms / 1000) * 1000;
}

export function localTimeToDate(year, dayOfYear, minutes, timeZone) {
    const wallClock = Date.UTC(year, 0, dayOfYear, 0, minutes); // that day and time, read as if it were UTC
    // Two passes: the offset can differ between the guess and the result around DST changes
    let ms = wallClock - timeZoneOffset(wallClock, timeZone);
    ms = wallClock - timeZoneOffset(ms, timeZone);
    return new Date(ms);
}

export function sunDirection(azimuth, altitude, northDeg) {
    // Bearing in room space: clockwise from -Z seen from above (-Z -> +X -> +Z -> -X)
    const bearing = azimuth + northDeg * RAD;
    const horizontal = Math.cos(altitude);
    return [Math.sin(bearing) * horizontal, Math.sin(altitude), -Math.cos(bearing) * horizontal];
}

// Day of the year (1 = Jan 1st) of `date`, in local time
export function dayOfYear(date) {
    return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / DAY_MS);
}

/*
* Locations offered by the sun panel (no geocoding service, no device GPS: privacy).
* ponytail: fixed list; add a city search (geocoding API) when users need places that are not here.
*/
export const CITIES = [
    { id: 'turin', name: 'Torino', lat: 45.0703, lon: 7.6869, timeZone: 'Europe/Rome' },
    { id: 'milan', name: 'Milano', lat: 45.4642, lon: 9.19, timeZone: 'Europe/Rome' },
    { id: 'genoa', name: 'Genova', lat: 44.4056, lon: 8.9463, timeZone: 'Europe/Rome' },
    { id: 'venice', name: 'Venezia', lat: 45.4408, lon: 12.3155, timeZone: 'Europe/Rome' },
    { id: 'bologna', name: 'Bologna', lat: 44.4949, lon: 11.3426, timeZone: 'Europe/Rome' },
    { id: 'florence', name: 'Firenze', lat: 43.7696, lon: 11.2558, timeZone: 'Europe/Rome' },
    { id: 'rome', name: 'Roma', lat: 41.9028, lon: 12.4964, timeZone: 'Europe/Rome' },
    { id: 'naples', name: 'Napoli', lat: 40.8518, lon: 14.2681, timeZone: 'Europe/Rome' },
    { id: 'bari', name: 'Bari', lat: 41.1171, lon: 16.8719, timeZone: 'Europe/Rome' },
    { id: 'palermo', name: 'Palermo', lat: 38.1157, lon: 13.3615, timeZone: 'Europe/Rome' },
    { id: 'cagliari', name: 'Cagliari', lat: 39.2238, lon: 9.1217, timeZone: 'Europe/Rome' },
    { id: 'london', name: 'London', lat: 51.5072, lon: -0.1276, timeZone: 'Europe/London' },
    { id: 'paris', name: 'Paris', lat: 48.8566, lon: 2.3522, timeZone: 'Europe/Paris' },
    { id: 'madrid', name: 'Madrid', lat: 40.4168, lon: -3.7038, timeZone: 'Europe/Madrid' },
    { id: 'berlin', name: 'Berlin', lat: 52.52, lon: 13.405, timeZone: 'Europe/Berlin' },
    { id: 'zurich', name: 'Zürich', lat: 47.3769, lon: 8.5417, timeZone: 'Europe/Zurich' },
    { id: 'stockholm', name: 'Stockholm', lat: 59.3293, lon: 18.0686, timeZone: 'Europe/Stockholm' },
    { id: 'athens', name: 'Athens', lat: 37.9838, lon: 23.7275, timeZone: 'Europe/Athens' },
    { id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, timeZone: 'Asia/Dubai' },
    { id: 'new-york', name: 'New York', lat: 40.7128, lon: -74.006, timeZone: 'America/New_York' },
    { id: 'los-angeles', name: 'Los Angeles', lat: 34.0522, lon: -118.2437, timeZone: 'America/Los_Angeles' },
    { id: 'sao-paulo', name: 'São Paulo', lat: -23.5505, lon: -46.6333, timeZone: 'America/Sao_Paulo' },
    { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503, timeZone: 'Asia/Tokyo' },
    { id: 'singapore', name: 'Singapore', lat: 1.3521, lon: 103.8198, timeZone: 'Asia/Singapore' },
    { id: 'sydney', name: 'Sydney', lat: -33.8688, lon: 151.2093, timeZone: 'Australia/Sydney' }
];
export const DEFAULT_CITY_ID = 'turin';
export const findCity = (id) => CITIES.find((city) => city.id === id) ?? CITIES[0];
