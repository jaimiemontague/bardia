/**
 * Developer room gallery (route 'interiorGallery', a menu page): paints any room without a save, so rooms can be
 * looked at and screenshotted quickly. Panels show a placeholder line (their real menus need a game).
 *
 *   /?interiors=greatHall                       opens the Great hall (dev builds)
 *   /?interiors=smithy&hour=21&season=winter    the Smithy on a winter night
 *   /?interiors=greatHall&person=steward        with the Steward's panel open
 *
 * The bar's words are developer text, not player text.
 */
import { useState, type ReactElement } from 'react';
import { SEASON_IDS, type SeasonId } from '@content/schemas/ids';
import { navigation } from '../../app/navigation';
import type { ScreenDescriptor, ScreenProps } from '../../app/screenTypes';
import { useT } from '../../i18n/index';
import { InteriorRoom } from './InteriorRoom';
import { roomById, roomIds } from './registry';
import type { RoomAmbience } from './types';

const SEASONS: readonly SeasonId[] = SEASON_IDS;

interface GalleryParams {
  room: string;
  hour: number;
  season: SeasonId;
  person: string | null;
}

function readParams(): GalleryParams {
  try {
    const q = new URLSearchParams(window.location.search);
    const hour = Number(q.get('hour') ?? '12');
    const season = (q.get('season') ?? 'summer') as SeasonId;
    return { room: q.get('interiors') || 'greatHall', hour: Number.isFinite(hour) ? hour : 12, season: SEASONS.includes(season) ? season : 'summer', person: q.get('person') };
  } catch {
    return { room: 'greatHall', hour: 12, season: 'summer', person: null };
  }
}

function InteriorGallery({ close }: ScreenProps): ReactElement {
  const t = useT();
  const [sel, setSel] = useState(readParams);
  const room = roomById(sel.room) ?? roomById(roomIds()[0] ?? '');
  const ambience: RoomAmbience = { hourOfDay: sel.hour, season: sel.season, weather: { fog: false, wind: 'fresh', storm: false } };
  return (
    <div className="int-gallery" data-testid="interior-gallery" data-room={room?.id ?? ''}>
      {room && (
        <InteriorRoom
          key={`${room.id}-${sel.hour}-${sel.season}`}
          room={room}
          ambience={ambience}
          subtitle="Gallery"
          initialPerson={sel.person}
          panel={(id) => <p className="int-greeting">{`${t(room.people.find((p) => p.id === id)?.nameKey ?? '')}: their menu opens here in the game.`}</p>}
          onLeave={close}
        />
      )}
      <div className="int-gallery-bar">
        <select value={room?.id ?? ''} onChange={(e) => setSel((s) => ({ ...s, room: e.target.value, person: null }))} data-testid="interior-gallery-room">
          {roomIds().map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <select value={sel.hour} onChange={(e) => setSel((s) => ({ ...s, hour: Number(e.target.value) }))}>
          {[6, 12, 19, 23].map((h) => (
            <option key={h} value={h}>{`${h}:00`}</option>
          ))}
        </select>
        <select value={sel.season} onChange={(e) => setSel((s) => ({ ...s, season: e.target.value as SeasonId }))}>
          {SEASONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** The gallery's screen descriptor (re-exported by screens/hub so the registry finds it). */
export const interiorGalleryScreen: ScreenDescriptor = { id: 'interiorGallery', route: 'interiorGallery', layout: 'fullscreen', titleKey: 'hub.interior.gallery', component: InteriorGallery };

// Deep link in dev builds: /?interiors=<room>[&hour=21][&season=winter][&person=<id>].
if (typeof window !== 'undefined') {
  try {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('interiors')) setTimeout(() => navigation.showMenu('interiorGallery'), 0);
  } catch {
    /* non-browser environment */
  }
}
