/**
 * A small piano roll of the next bars of the generative score (the audio lab's proof that the
 * composer is deterministic: the same seed always draws the same notes).
 */
import { useMemo } from 'react';
import { composeSpan } from '@client/audio/composer';
import { barPulses, MUSIC_STYLES } from '@client/audio/styles';
import type { MusicState } from '@client/audio/catalog';

const LAYER_COLOURS = ['#d9a441', '#7fb3a6', '#c46a4a', '#9f8fd0', '#8fbf5a', '#d07fa8', '#6aa0d8', '#cfc6b0'];

export interface PianoRollProps {
  state: MusicState;
  seed: string;
  fromBar: number;
  bars: number;
  intensity: number;
  label: string;
}

export function PianoRoll({ state, seed, fromBar, bars, intensity, label }: PianoRollProps) {
  const style = MUSIC_STYLES[state];
  const data = useMemo(() => {
    const notes = composeSpan(style, seed, fromBar, bars, intensity);
    const pitched = notes.filter((n) => n.instrument !== 'drums');
    const lo = Math.min(...pitched.map((n) => n.midi), 48);
    const hi = Math.max(...pitched.map((n) => n.midi), 72);
    return { notes, lo, hi };
  }, [style, seed, fromBar, bars, intensity]);
  const pulses = barPulses(style) * bars;
  const rows = data.hi - data.lo + 1;
  const drumRows = 2;
  const w = 600;
  const rowH = 4;
  const h = (rows + drumRows + 1) * rowH;
  const x = (p: number) => ((p - fromBar * barPulses(style)) / pulses) * w;
  const layerIndex = (id: string) => Math.max(0, style.layers.findIndex((l) => l.id === id));
  return (
    <svg className="al-roll" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {Array.from({ length: bars + 1 }, (_, b) => (
        <line key={`b${b}`} x1={(b / bars) * w} x2={(b / bars) * w} y1={0} y2={h} className="al-roll-bar" />
      ))}
      {data.notes.map((n, i) => {
        const colour = LAYER_COLOURS[layerIndex(n.layer) % LAYER_COLOURS.length];
        if (n.instrument === 'drums') {
          const y = (rows + 1 + (n.hit === 'boom' || n.hit === 'war' ? 1 : 0)) * rowH;
          return <rect key={i} x={x(n.abs)} y={y} width={Math.max(1.5, (w / pulses) * 0.5)} height={rowH - 0.5} fill={colour} opacity={0.4 + n.vel * 0.6} />;
        }
        const y = (data.hi - n.midi) * rowH;
        const width = Math.max(1.5, Math.min(w - x(n.abs), (n.len / pulses) * w) - 0.5);
        return <rect key={i} x={x(n.abs)} y={y} width={width} height={rowH - 0.5} rx={1} fill={colour} opacity={0.35 + n.vel * 0.65} />;
      })}
    </svg>
  );
}
