import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ScopeConfig, ScopeId } from './types.ts';

export interface AppPaths {
  projectRoot: string;
  scopes: Record<ScopeId, ScopeConfig>;
}

export function getGlobalLockPath(home = homedir()): string {
  const stateHome = process.env.XDG_STATE_HOME;
  return stateHome
    ? join(resolve(stateHome), 'skills', '.skill-lock.json')
    : join(home, '.agents', '.skill-lock.json');
}

export function createAppPaths(projectRoot = process.cwd(), home = homedir()): AppPaths {
  const resolvedProject = resolve(projectRoot);
  const resolvedHome = resolve(home);

  return {
    projectRoot: resolvedProject,
    scopes: {
      project: {
        id: 'project',
        label: 'Project',
        rootDir: resolvedProject,
        skillsDir: join(resolvedProject, '.agents', 'skills'),
        lockPath: join(resolvedProject, 'skills-lock.json'),
        lockVersion: 1,
      },
      global: {
        id: 'global',
        label: 'Global',
        rootDir: resolvedHome,
        skillsDir: join(resolvedHome, '.agents', 'skills'),
        lockPath: getGlobalLockPath(resolvedHome),
        lockVersion: 3,
      },
    },
  };
}

export function otherScope(scope: ScopeId): ScopeId {
  return scope === 'project' ? 'global' : 'project';
}
