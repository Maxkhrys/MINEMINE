export type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQuality = 'off' | 'low' | 'high' | 'ultra';

export interface Settings {
  preset: Preset;
  renderDistance: number;
  resolutionScale: number;
  shadows: ShadowQuality;
  postprocessing: boolean;
  ssao: boolean;
  bloom: boolean;
  antialias: boolean;
  animation: boolean;
  clouds: boolean;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  viewBobbing: boolean;
  volume: number;
  showFps: boolean;
}

type GraphicsKeys = 'renderDistance' | 'resolutionScale' | 'shadows' | 'postprocessing' | 'ssao' | 'bloom' | 'antialias' | 'animation' | 'clouds';

export const PRESETS: Record<Exclude<Preset, 'custom'>, Pick<Settings, GraphicsKeys>> = {
  low: {
    renderDistance: 4,
    resolutionScale: 0.75,
    shadows: 'off',
    postprocessing: false,
    ssao: false,
    bloom: false,
    antialias: false,
    animation: true,
    clouds: false,
  },
  medium: {
    renderDistance: 6,
    resolutionScale: 1,
    shadows: 'low',
    postprocessing: true,
    ssao: false,
    bloom: true,
    antialias: false,
    animation: true,
    clouds: true,
  },
  high: {
    renderDistance: 8,
    resolutionScale: 1,
    shadows: 'high',
    postprocessing: true,
    ssao: true,
    bloom: true,
    antialias: true,
    animation: true,
    clouds: true,
  },
  ultra: {
    renderDistance: 11,
    resolutionScale: 1,
    shadows: 'ultra',
    postprocessing: true,
    ssao: true,
    bloom: true,
    antialias: true,
    animation: true,
    clouds: true,
  },
};

const KEY = 'minemine.settings.v1';

export function defaultSettings(preset: Exclude<Preset, 'custom'>): Settings {
  return {
    preset,
    ...PRESETS[preset],
    fov: 75,
    sensitivity: 1,
    invertY: false,
    viewBobbing: true,
    volume: 0.6,
    showFps: false,
  };
}

export function loadSettings(fallbackPreset: Exclude<Preset, 'custom'>): Settings {
  const base = defaultSettings(fallbackPreset);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...base, ...parsed };
    merged.renderDistance = clamp(Math.round(merged.renderDistance), 2, 16);
    merged.resolutionScale = clamp(merged.resolutionScale, 0.4, 1);
    merged.fov = clamp(merged.fov, 50, 110);
    merged.sensitivity = clamp(merged.sensitivity, 0.1, 4);
    merged.volume = clamp(merged.volume, 0, 1);
    if (!['off', 'low', 'high', 'ultra'].includes(merged.shadows)) merged.shadows = base.shadows;
    return merged;
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
