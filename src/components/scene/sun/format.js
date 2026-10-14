// Labels for the sun settings, shared by the desktop sun panel and the VR one

// "14 Oct" for a day of the year (UTC: no time zone shift of the label)
export const formatDay = (day) =>
    new Date(Date.UTC(new Date().getFullYear(), 0, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// "15:05" for minutes after midnight
export const formatTime = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
