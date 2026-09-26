import type { SnapshotEnvelope } from './crypto';

export interface CloudHead {
  revision: number;
  createdAt: string | null;
  label: string | null;
}

export interface CloudVersionMeta {
  revision: number;
  createdAt: string;
  label: string | null;
}

export interface CloudVersion extends CloudVersionMeta {
  envelope: SnapshotEnvelope;
}

export type CloudErrorCode =
  'unauthorized' | 'conflict' | 'not_found' | 'network' | 'invalid_response' | 'server';

export class CloudSyncError extends Error {
  constructor(
    message: string,
    readonly code: CloudErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CloudSyncError';
  }
}

export class SyncConflictError extends CloudSyncError {
  constructor() {
    super(
      'The cloud snapshot changed on another device. Review the newer version before uploading.',
      'conflict',
      409,
    );
    this.name = 'SyncConflictError';
  }
}

export interface CloudClientOptions {
  /** Omit in a private web build to use the page's origin. Required HTTPS URL for Tauri. */
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
}

const validRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseHead(value: unknown): CloudHead {
  if (!value || typeof value !== 'object')
    throw new CloudSyncError('Invalid cloud response.', 'invalid_response');
  const item = value as Record<string, unknown>;
  if (
    !validRevision(item.revision) ||
    (item.createdAt !== null && typeof item.createdAt !== 'string') ||
    (item.label !== null && typeof item.label !== 'string')
  )
    throw new CloudSyncError('Invalid cloud version metadata.', 'invalid_response');
  return item as unknown as CloudHead;
}

function parseVersion(value: unknown): CloudVersion {
  const head = parseHead(value);
  const envelope = (value as Record<string, unknown>).envelope;
  if (
    head.revision < 1 ||
    !head.createdAt ||
    !envelope ||
    typeof envelope !== 'object' ||
    (envelope as Record<string, unknown>).format !== 'personal-treasury-snapshot' ||
    (envelope as Record<string, unknown>).version !== 1 ||
    !['salt', 'iv', 'ciphertext'].every(
      (field) => typeof (envelope as Record<string, unknown>)[field] === 'string',
    )
  )
    throw new CloudSyncError('Invalid cloud snapshot.', 'invalid_response');
  return { ...head, createdAt: head.createdAt, envelope: envelope as SnapshotEnvelope };
}

/** API transport for guarded, whole-database snapshots. Credentials stay in memory. */
export class CloudClient {
  private readonly root: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ baseUrl, token, fetchImpl }: CloudClientOptions) {
    if (!token.trim()) throw new CloudSyncError('Enter a cloud access token.', 'unauthorized');
    if (baseUrl) {
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch {
        throw new CloudSyncError('The cloud URL is invalid.', 'invalid_response');
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new CloudSyncError(
          'The cloud URL must use HTTPS without credentials or query parameters.',
          'invalid_response',
        );
      this.root = `${url.href.replace(/\/+$/, '')}/api/sync`;
    } else {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)
        throw new CloudSyncError('Set the HTTPS cloud URL for the desktop app.', 'invalid_response');
      this.root = '/api/sync';
    }
    this.token = token;
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.root}${path}`, {
        ...init,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...init.headers,
        },
      });
    } catch {
      throw new CloudSyncError(
        'Could not reach cloud storage. Check the connection and try again.',
        'network',
      );
    }
    if (response.status === 409) throw new SyncConflictError();
    if (response.status === 401 || response.status === 403)
      throw new CloudSyncError(
        'Cloud access was denied. Check the access token.',
        'unauthorized',
        response.status,
      );
    if (response.status === 404)
      throw new CloudSyncError('The requested cloud version was not found.', 'not_found', 404);
    if (!response.ok)
      throw new CloudSyncError('Cloud storage could not complete the request.', 'server', response.status);
    try {
      return await response.json();
    } catch {
      throw new CloudSyncError(
        'Cloud storage returned an invalid response.',
        'invalid_response',
        response.status,
      );
    }
  }

  async getHead(): Promise<CloudHead> {
    return parseHead(await this.request('/head'));
  }

  async getVersions(): Promise<CloudVersionMeta[]> {
    const result = await this.request('/versions');
    if (!Array.isArray(result)) throw new CloudSyncError('Invalid cloud version list.', 'invalid_response');
    const versions = result.map(parseHead);
    if (versions.some((v) => v.revision < 1 || !v.createdAt))
      throw new CloudSyncError('Invalid cloud version list.', 'invalid_response');
    return versions as CloudVersionMeta[];
  }

  async getVersion(revision: number): Promise<CloudVersion> {
    if (!validRevision(revision) || revision < 1)
      throw new CloudSyncError('Choose a valid cloud revision.', 'invalid_response');
    const version = parseVersion(await this.request(`/versions/${revision}`));
    if (version.revision !== revision)
      throw new CloudSyncError('Cloud storage returned a different revision.', 'invalid_response');
    return version;
  }

  async put(envelope: SnapshotEnvelope, expectedRevision: number, label?: string): Promise<CloudHead> {
    if (!validRevision(expectedRevision))
      throw new CloudSyncError('The expected cloud revision is invalid.', 'invalid_response');
    const result = await this.request('/head', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedRevision}"`,
      },
      body: JSON.stringify({ envelope, ...(label === undefined ? {} : { label }) }),
    });
    const head = parseHead(result);
    if (head.revision !== expectedRevision + 1)
      throw new CloudSyncError('Cloud storage returned an unexpected revision.', 'invalid_response');
    return head;
  }
}
