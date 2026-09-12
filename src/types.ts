import type { LocalSkillLockEntry } from '../vendor/skills/src/local-lock.ts';
import type { SkillLockEntry } from '../vendor/skills/src/skill-lock.ts';

export type ScopeId = 'project' | 'global';

export interface ScopeConfig {
  id: ScopeId;
  label: string;
  rootDir: string;
  skillsDir: string;
  lockPath: string;
  lockVersion: number;
}

export interface ProjectLockEntry extends LocalSkillLockEntry {
  installedAt?: string;
  updatedAt?: string;
  pluginName?: string;
  skillFolderHash?: string;
  sourceBaseUrl?: string;
}

export interface GlobalLockEntry extends SkillLockEntry {
  computedHash?: string;
}

export type TrackedEntry = ProjectLockEntry | GlobalLockEntry;

export interface LockFile<TEntry extends TrackedEntry = TrackedEntry> {
  version: number;
  skills: Record<string, TEntry>;
  [key: string]: unknown;
}

export type UpdateState = 'waiting' | 'checking' | 'current' | 'available' | 'unavailable';

export interface SkillRecord {
  id: string;
  scope: ScopeId;
  folderName: string;
  name: string;
  description: string;
  path: string;
  skillMdPath: string;
  previewPath: string;
  preview: string;
  tracked: boolean;
  lockKey?: string;
  lockEntry?: TrackedEntry;
}

export interface ScopeSnapshot {
  config: ScopeConfig;
  skills: SkillRecord[];
  hiddenLockEntries: number;
}

export interface AppSnapshot {
  project: ScopeSnapshot;
  global: ScopeSnapshot;
}

export interface OperationResult {
  changed: number;
  message: string;
  errors: string[];
}

export interface Collision {
  source?: string;
  destination: string;
  skillName: string;
}
