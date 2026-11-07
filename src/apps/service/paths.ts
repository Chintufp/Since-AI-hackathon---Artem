import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DEFAULT_DB_PATH = join(REPO_ROOT, 'data', 'local', 'knowledge-twin.sqlite');
