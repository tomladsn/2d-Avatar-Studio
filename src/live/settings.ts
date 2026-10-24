import type { LightingSettings } from 'mesh-avatar';
import { lightingFromQuery, writeLightingQuery } from '../lighting/storage';
export const SAMPLE_PROJECT = 'sample-miko-qipao';
export const ACTIVE_PROJECT_KEY = 'mesh-avatar-active-project';
export const LIVE_PROJECT_KEY = 'mesh-avatar-live-project';

export interface ViewSettings {
  project: string;
  avatar?: string;
  background: string;
  fit: 'contain' | 'cover';
  idle: boolean;
  lighting?: LightingSettings;
}
export function backgroundColor(value: string | null): string {
  if (value === 'green') return '#00ff00';
  if (value === 'blue') return '#0000ff';
  if (value && /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return `#${value.replace('#', '')}`;
  return 'transparent';
}
export function readLiveProject(): string | null {
  try {
    const val = localStorage.getItem(ACTIVE_PROJECT_KEY) ?? localStorage.getItem(LIVE_PROJECT_KEY);
    if (val && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(val)) return val;
    const recent = JSON.parse(localStorage.getItem('mesh-avatar-recent-projects') ?? '[]');
    if (Array.isArray(recent) && recent[0]?.serverName && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(recent[0].serverName)) {
      return recent[0].serverName;
    }
  } catch { return null; }
  return null;
}
export function saveLiveProject(project: string): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, project);
    localStorage.setItem(LIVE_PROJECT_KEY, project);
  } catch { /* ignore */ }
}
export function viewSettings(search: string, origin = globalThis.location?.origin ?? 'http://localhost'): ViewSettings {
  const query = new URLSearchParams(search), project = query.get('project');
  let avatar: string | undefined;
  try {
    const value = query.get('avatar');
    if (!query.has('project') && value) {
      const url = new URL(value, origin);
      if (url.origin === origin && /^https?:$/.test(url.protocol) && !url.username && !url.password) avatar = value;
    }
  } catch { /* Invalid or external URLs fall back to the sample. */ }
  // If no explicit project param, restore the last live project from localStorage.
  const saved = readLiveProject();
  const resolved = project && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project)
    ? project
    : (saved && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(saved) ? saved : SAMPLE_PROJECT);
  return { project: resolved,
    ...(avatar ? { avatar } : {}),
    background: backgroundColor(query.get('bg')), fit: query.get('fit') === 'cover' ? 'cover' : 'contain', idle: query.get('idle') !== '0', ...(query.has('light') ? { lighting: lightingFromQuery(query) } : {}) };
}
export function streamUrl(settings: ViewSettings, origin: string): string {
  const url = new URL('/stream.html', origin);
  url.search = new URLSearchParams({ project: settings.project, bg: settings.background, fit: settings.fit, idle: settings.idle ? '1' : '0' }).toString();
  if (settings.avatar) { url.searchParams.delete('project'); url.searchParams.set('avatar', settings.avatar); }
  if (settings.lighting) writeLightingQuery(url.searchParams, settings.lighting);
  return url.href;
}
