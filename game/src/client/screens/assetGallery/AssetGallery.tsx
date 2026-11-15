/**
 * The asset gallery (dev screen): every placeholder generator variant, the portrait layer catalog,
 * and the whole asset manifest with each id's status (final file present or placeholder). The owner
 * uses it to check final art after running `npm run tool -- assets-index` (see ASSET_DROP_IN.md).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useT } from '@client/i18n/index';
import type { CultureId } from '@content/schemas/ids';
import {
  AssetImage,
  BIOMES,
  GLYPH_IDS,
  GlyphIcon,
  RELIC_KEYS,
  assetManifestView,
  checkRecipe,
  ensureFinalIndex,
  finalIndexStatus,
  findFinalFile,
  getFinalIndex,
  getImageGenerator,
  manifestIssues,
  placeholderUrl,
  portraitLayerCatalog,
  setAssetSettings,
  useAssetSettings,
  type GeneratorParams,
  type IconStyle,
  type WatermarkMode,
} from '@client/assets/index';
import './gallery.css';

type Tab = 'portraits' | 'panoramas' | 'interiors' | 'vignettes' | 'icons' | 'relics' | 'sprites' | 'tiles' | 'manifest';
const TABS: readonly Tab[] = ['portraits', 'panoramas', 'interiors', 'vignettes', 'icons', 'relics', 'sprites', 'tiles', 'manifest'];

/** Renders `make()` only once the element scrolls into view (generation is the expensive part). */
function Lazy(props: { width: number; height: number; make: () => string; title?: string; className?: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  const url = useMemo(() => (visible ? props.make() : ''), [visible, props.make]);
  return (
    <div ref={ref} className={`ag-thumb ${props.className ?? ''}`} style={{ width: props.width, height: props.height }} title={props.title}>
      {url ? <img src={url} alt="" width={props.width} height={props.height} draggable={false} /> : null}
    </div>
  );
}

function Cell(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <figure className="ag-cell">
      {props.children}
      <figcaption title={props.label}>{props.label}</figcaption>
    </figure>
  );
}

function describe(p: GeneratorParams): string {
  return Object.entries(p)
    .filter(([k]) => k !== 'seed')
    .map(([, v]) => String(v))
    .join(' · ');
}

function GenGrid(props: { generator: string; variants: GeneratorParams[]; w: number; h: number; watermark: WatermarkMode; frames?: number }): ReactElement {
  return (
    <div className="ag-grid">
      {props.variants.map((v, i) => (
        <Cell key={`${props.generator}-${i}`} label={describe(v)}>
          <Lazy width={props.w * (props.frames ?? 1)} height={props.h} make={() => placeholderUrl(props.generator, v, { width: props.w, height: props.h, watermark: props.watermark, frames: props.frames ?? 1, label: `${props.generator} ${describe(v)}` })} />
        </Cell>
      ))}
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="ag-section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

const CULTURES: readonly CultureId[] = ['skarn', 'hvarn', 'eyjar', 'albric', 'cael', 'corvani', 'saraleonese', 'velkar', 'kurgai', 'rime', 'isafolder'];

function PortraitsTab(props: { seed: number; wm: WatermarkMode }): ReactElement {
  const t = useT();
  const { seed, wm } = props;
  const mixed = useMemo(() => {
    const out: GeneratorParams[] = [];
    const ranks = ['common', 'warrior', 'noble', 'ruler', 'clergy', 'seer'];
    let i = 0;
    for (const culture of CULTURES) for (const sex of ['male', 'female']) {
      out.push({ seed: seed * 101 + i, culture, sex, age: [9, 16, 24, 34, 47, 66][(i + seed) % 6] as number, rank: ranks[(i * 5 + seed) % ranks.length] as string });
      i++;
    }
    return out;
  }, [seed]);
  const aging = useMemo(() => {
    const out: GeneratorParams[] = [];
    for (const sex of ['male', 'female']) for (const age of [7, 15, 25, 40, 58, 76]) out.push({ seed: seed * 7 + (sex === 'male' ? 1 : 2), culture: sex === 'male' ? 'skarn' : 'hvarn', sex, age, rank: age < 12 ? 'common' : 'noble' });
    return out;
  }, [seed]);
  const traits: GeneratorParams[] = useMemo(
    () => [
      { seed: seed + 11, culture: 'skarn', age: 38, rank: 'warrior', traits: 'scarred' },
      { seed: seed + 12, culture: 'eyjar', age: 44, traits: 'oneEyed' },
      { seed: seed + 13, culture: 'hvarn', age: 30, wounded: true },
      { seed: seed + 14, culture: 'albric', age: 52, rank: 'ruler', dead: true },
      { seed: seed + 15, culture: 'velkar', age: 28, traits: 'towering,strong' },
      { seed: seed + 16, culture: 'cael', sex: 'female', age: 33, traits: 'sickly,slight' },
      { seed: seed + 17, culture: 'skarn', age: 30, background: false },
    ],
    [seed],
  );
  const layers = useMemo(() => portraitLayerCatalog(), []);
  return (
    <>
      <Section title={t('portraits.gallery.section.mixed')}>
        <GenGrid generator="portrait" variants={mixed} w={160} h={200} watermark={wm} />
      </Section>
      <Section title={t('portraits.gallery.section.aging')}>
        <GenGrid generator="portrait" variants={aging} w={160} h={200} watermark={wm} />
      </Section>
      <Section title={t('portraits.gallery.section.traits')}>
        <GenGrid generator="portrait" variants={[...traits, {}]} w={160} h={200} watermark={wm} />
        <div className="ag-grid">
          <Cell label="silhouette">
            <Lazy width={160} height={200} make={() => placeholderUrl('silhouette', {}, { width: 160, height: 200, watermark: wm })} />
          </Cell>
        </div>
      </Section>
      <Section title={t('portraits.gallery.section.layers', { count: layers.length })}>
        <div className="ag-grid">
          {layers.map((l) => (
            <Cell key={l.assetId} label={l.assetId.replace('portraits.layer.', '')}>
              <Lazy width={112} height={140} className="ag-checker" make={() => placeholderUrl('portraitLayer', { slot: l.slot, variant: l.variant }, { width: 112, height: 140, watermark: wm })} />
            </Cell>
          ))}
        </div>
      </Section>
    </>
  );
}

function IconsTab(props: { wm: WatermarkMode }): ReactElement {
  const t = useT();
  const [style, setStyle] = useState<IconStyle>('carved');
  return (
    <>
      <div className="ag-controls">
        <label>
          {t('portraits.gallery.iconStyle')}{' '}
          <select value={style} onChange={(e) => setStyle(e.target.value as IconStyle)}>
            {(['carved', 'flat', 'ink', 'outlined'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`portraits.gallery.iconStyle.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="ag-muted">{t('portraits.gallery.count', { count: GLYPH_IDS.length })}</span>
      </div>
      <div className={`ag-grid ag-icons ${style === 'ink' ? 'ag-parchment' : ''}`}>
        {GLYPH_IDS.map((glyph) => (
          <Cell key={glyph} label={glyph}>
            <Lazy width={64} height={64} make={() => placeholderUrl('icon', { glyph, style }, { width: 64, height: 64, watermark: props.wm })} />
          </Cell>
        ))}
      </div>
      <div className="ag-inline-icons" data-testid="inline-icons">
        {GLYPH_IDS.slice(0, 40).map((glyph) => (
          <GlyphIcon key={glyph} glyph={glyph} size={22} />
        ))}
      </div>
    </>
  );
}

function SpritesTab(props: { wm: WatermarkMode }): ReactElement {
  const t = useT();
  const unit = getImageGenerator('unitSprite');
  const ship = getImageGenerator('shipSprite');
  const anims: GeneratorParams[] = ['walk', 'attack', 'shoot', 'die', 'rout'].map((anim) => ({ kind: anim === 'shoot' ? 'bow' : 'axe', anim, culture: 'skarn' }));
  return (
    <>
      <Section title={t('portraits.gallery.section.units')}>
        <GenGrid generator="unitSprite" variants={unit?.variants?.() ?? []} w={96} h={96} watermark={props.wm} />
      </Section>
      <Section title={t('portraits.gallery.section.animations')}>
        <GenGrid generator="unitSprite" variants={anims} w={64} h={64} frames={6} watermark={props.wm} />
      </Section>
      <Section title={t('portraits.gallery.section.ships')}>
        <div className="ag-sea">
          <GenGrid generator="shipSprite" variants={ship?.variants?.() ?? []} w={96} h={200} watermark={props.wm} />
        </div>
      </Section>
    </>
  );
}

function TilesTab(props: { wm: WatermarkMode }): ReactElement {
  const t = useT();
  return (
    <>
      <Section title={t('portraits.gallery.section.tiles')}>
        <div className="ag-grid">
          {BIOMES.map((biome) => (
            <Cell key={biome} label={biome}>
              <Lazy width={128} height={128} make={() => placeholderUrl('terrainTile', { biome }, { width: 128, height: 128 })} />
            </Cell>
          ))}
        </div>
      </Section>
      <Section title={t('portraits.gallery.section.cards')}>
        <GenGrid generator="card" variants={getImageGenerator('card')?.variants?.() ?? []} w={240} h={150} watermark={props.wm} />
      </Section>
    </>
  );
}

function ManifestTab(): ReactElement {
  const t = useT();
  const [filter, setFilter] = useState('');
  const entries = useMemo(() => Object.entries(assetManifestView()).sort(([a], [b]) => a.localeCompare(b)), []);
  const index = getFinalIndex();
  const rows = entries.filter(([id, e]) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return id.toLowerCase().includes(f) || e.path.includes(f) || e.placeholder.generator.toLowerCase().includes(f);
  });
  const finals = entries.filter(([, e]) => findFinalFile(e.path, e.kind === 'image' ? 'image' : 'audio')).length;
  const issues = useMemo(() => {
    const out: string[] = [...manifestIssues()];
    for (const [id, e] of entries) for (const msg of checkRecipe(e.placeholder.generator, e.placeholder.params, e.kind === 'image' ? 'image' : 'audio')) out.push(`${id}: ${msg}`);
    return out;
  }, [entries]);
  const shown = rows.slice(0, 300);
  return (
    <>
      <div className="ag-controls">
        <input className="ag-filter" type="search" value={filter} placeholder={t('portraits.gallery.manifest.filter')} aria-label={t('portraits.gallery.manifest.filter')} onChange={(e) => setFilter(e.target.value)} />
        <span className="ag-muted" data-testid="manifest-summary">
          {t('portraits.gallery.manifest.summary', { total: entries.length, final: finals, placeholder: entries.length - finals })}
        </span>
        <span className="ag-muted">{t('portraits.gallery.index.ready', { count: Object.keys(index.files).length })}</span>
      </div>
      {issues.length > 0 ? (
        <details className="ag-issues">
          <summary>{t('portraits.gallery.manifest.issues', { count: issues.length })}</summary>
          <ul>
            {issues.slice(0, 200).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <table className="ag-table">
        <thead>
          <tr>
            <th>{t('portraits.gallery.manifest.preview')}</th>
            <th>{t('portraits.gallery.manifest.id')}</th>
            <th>{t('portraits.gallery.manifest.kind')}</th>
            <th>{t('portraits.gallery.manifest.path')}</th>
            <th>{t('portraits.gallery.manifest.size')}</th>
            <th>{t('portraits.gallery.manifest.status')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(([id, e]) => {
            const final = Boolean(findFinalFile(e.path, e.kind === 'image' ? 'image' : 'audio'));
            const size = e.kind === 'image' ? `${e.size[0]}×${e.size[1]}${e.frames && e.frames > 1 ? ` ×${e.frames}` : ''}` : e.kind === 'voice' ? e.voice : e.durationS !== undefined ? `${e.durationS}s` : '';
            return (
              <tr key={id} data-asset-row={id}>
                <td>{e.kind === 'image' ? <LazyAsset id={id} /> : <GlyphIcon glyph={e.kind === 'voice' ? 'uiVoice' : e.kind === 'music' ? 'uiMusic' : 'uiSound'} size={24} />}</td>
                <td className="ag-mono">{id}</td>
                <td>{e.kind}</td>
                <td className="ag-mono">{e.path}</td>
                <td>{size}</td>
                <td>
                  <span className={`ag-status ag-${final ? 'final' : 'placeholder'}`}>{t(`portraits.gallery.status.${final ? 'final' : 'placeholder'}`)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > shown.length ? <p className="ag-muted">{t('portraits.gallery.manifest.more', { count: rows.length - shown.length })}</p> : null}
    </>
  );
}

/** A manifest preview that only resolves once visible. */
function LazyAsset(props: { id: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '300px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  return (
    <div ref={ref} className="ag-preview">
      {visible ? <AssetImage id={props.id} alt="" fit="contain" style={{ width: 72, height: 54 }} resolve={{ width: 144, height: 108 }} /> : null}
    </div>
  );
}

/** The gallery screen body. */
export function AssetGallery(props: { close?: () => void }): ReactElement {
  const t = useT();
  const settings = useAssetSettings();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('galleryTab');
      if (q && (TABS as readonly string[]).includes(q)) return q as Tab;
    } catch {
      /* no window */
    }
    return 'portraits';
  });
  const [seed, setSeed] = useState(1);
  useEffect(ensureFinalIndex, []);
  const wm = settings.watermark;
  const status = finalIndexStatus();
  const pan = getImageGenerator('panorama');
  const int = getImageGenerator('interior');
  const vig = getImageGenerator('vignette');
  return (
    <div className="ag-root" data-testid="asset-gallery">
      <header className="ag-header">
        <div>
          <h1>{t('portraits.gallery.title')}</h1>
          <p className="ag-muted">{t('portraits.gallery.subtitle')}</p>
        </div>
        <div className="ag-controls">
          <label>
            {t('portraits.gallery.watermark')}{' '}
            <select value={wm} onChange={(e) => setAssetSettings({ watermark: e.target.value as WatermarkMode })}>
              {(['off', 'corner', 'full'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`portraits.gallery.watermark.${m}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={settings.forcePlaceholders} onChange={(e) => setAssetSettings({ forcePlaceholders: e.target.checked })} /> {t('portraits.gallery.forcePlaceholders')}
          </label>
          <button type="button" onClick={() => setSeed((s) => s + 1)}>
            <GlyphIcon glyph="uiDice" /> {t('portraits.gallery.reroll')}
          </button>
          <span className="ag-muted">{status === 'loading' ? t('portraits.gallery.index.loading') : status === 'failed' ? t('portraits.gallery.index.failed') : t('portraits.gallery.index.ready', { count: Object.keys(getFinalIndex().files).length })}</span>
          {props.close ? (
            <button type="button" onClick={props.close} aria-label={t('portraits.gallery.close')}>
              <GlyphIcon glyph="uiClose" />
            </button>
          ) : null}
        </div>
      </header>
      <nav className="ag-tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'ag-tab ag-on' : 'ag-tab'} onClick={() => setTab(id)}>
            {t(`portraits.gallery.tab.${id}`)}
          </button>
        ))}
      </nav>
      <main className="ag-body" key={`${tab}-${wm}`}>
        {tab === 'portraits' ? <PortraitsTab seed={seed} wm={wm} /> : null}
        {tab === 'panoramas' && pan?.variants ? (
          <>
            <Section title={t('portraits.gallery.section.cultures')}>
              <GenGrid generator="panorama" variants={pan.variants().slice(0, 16).map((v) => ({ ...v, seed: Number(v.seed ?? 1) + seed }))} w={384} h={216} watermark={wm} />
            </Section>
            <Section title={t('portraits.gallery.section.seasons')}>
              <GenGrid generator="panorama" variants={pan.variants().slice(16)} w={384} h={216} watermark={wm} />
            </Section>
          </>
        ) : null}
        {tab === 'interiors' && int?.variants ? <GenGrid generator="interior" variants={int.variants().map((v) => ({ ...v, seed: Number(v.seed ?? 1) + seed }))} w={384} h={216} watermark={wm} /> : null}
        {tab === 'vignettes' && vig?.variants ? <GenGrid generator="vignette" variants={vig.variants().map((v) => ({ ...v, seed: Number(v.seed ?? 1) + seed }))} w={384} h={216} watermark={wm} /> : null}
        {tab === 'icons' ? <IconsTab wm={wm} /> : null}
        {tab === 'relics' ? <GenGrid generator="relic" variants={RELIC_KEYS.map((relic) => ({ relic, seed }))} w={180} h={180} watermark={wm} /> : null}
        {tab === 'sprites' ? <SpritesTab wm={wm} /> : null}
        {tab === 'tiles' ? <TilesTab wm={wm} /> : null}
        {tab === 'manifest' ? <ManifestTab /> : null}
      </main>
    </div>
  );
}
