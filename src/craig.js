// Helpers for importing a Craig (craig.chat) multi-track recording. Craig records every speaker to
// their own file, all starting at the same moment, so each track can go in with offset 0.
export const CRAIG_AUDIO = ['.flac', '.ogg', '.opus', '.m4a', '.aac', '.wav', '.mp3'];

/** "3-callidus.flac" -> "callidus". Strips Craig's track number, folders and old #1234 tags. */
export function craigSpeaker(path) {
  const file = String(path).split(/[\\/]/).pop();
  return file.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]+/, '').replace(/#\d{1,4}$/, '').trim() || file;
}

/** Parse repeated --map "name=Label" options into a lookup (case-insensitive). */
export function parseSpeakerMap(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const at = entry.indexOf('=');
    if (at < 1 || at === entry.length - 1) throw new Error(`Use --map "craig name=Speaker label" (got "${entry}").`);
    map.set(entry.slice(0, at).trim().toLowerCase(), entry.slice(at + 1).trim().slice(0, 100));
  }
  return map;
}

/** Choose the audio tracks in a Craig ZIP and label them. Returns [{ path, label, speaker, bytes }]. */
export function craigTracks(entries, speakerMap = new Map()) {
  const tracks = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(path)) continue;
    const ext = (path.match(/\.[^.\\/]+$/)?.[0] || '').toLowerCase();
    if (!CRAIG_AUDIO.includes(ext) || !bytes?.length) continue;
    const speaker = craigSpeaker(path);
    const label = speakerMap.get(speaker.toLowerCase()) || speakerMap.get(path.split(/[\\/]/).pop().toLowerCase()) || speaker;
    tracks.push({ path, ext, speaker, label:label.slice(0, 100), bytes });
  }
  return tracks.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric:true }));
}
