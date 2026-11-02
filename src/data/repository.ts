import type { IDagobertRepository } from './interfaces.ts';
import { WebDagobertRepository } from './webAdapter.ts';
import { NativeDagobertRepository } from './nativeAdapter.ts';
import { detectPlatform } from '../platform/capabilities.ts';

let repositoryInstance: IDagobertRepository | null = null;

export function getRepository(): IDagobertRepository {
  if (repositoryInstance) return repositoryInstance;

  const caps = detectPlatform();
  if (caps.isNative) {
    repositoryInstance = new NativeDagobertRepository();
  } else {
    repositoryInstance = new WebDagobertRepository();
  }

  return repositoryInstance;
}

export function setRepository(repo: IDagobertRepository | null): void {
  repositoryInstance = repo;
}
