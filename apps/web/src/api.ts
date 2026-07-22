import type { Category, Entry, Info } from './types';

const baseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Der Server ist gerade nicht erreichbar.', 0);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (!response.ok) throw new ApiError(payload.error ?? 'UNKNOWN', payload.message ?? 'Etwas ist schiefgegangen.', response.status);
  return payload as T;
}

export const absoluteAudioUrl = (url: string) => `${baseUrl}${url}`;
export const api = {
  categories: () => request<{ categories: Category[] }>('/api/categories'),
  createCategory: (name: string) => request<{ category: Category }>('/api/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCategory: (id: string, name: string) => request<{ category: Category }>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
  entries: (search = '', categoryId = '') => {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (categoryId) query.set('categoryId', categoryId);
    return request<{ entries: Entry[] }>(`/api/entries${query.size ? `?${query}` : ''}`);
  },
  generate: (sourceText: string, categoryId: string | null) => request<{ entry: Entry }>('/api/entries', { method: 'POST', body: JSON.stringify({ sourceText, targetLanguage: 'it', categoryId }) }),
  assignCategory: (id: string, categoryId: string | null) => request<{ entry: Entry }>(`/api/entries/${id}/category`, { method: 'PATCH', body: JSON.stringify({ categoryId }) }),
  retryAudio: (id: string) => request<{ entry: Entry }>(`/api/entries/${id}/audio`, { method: 'POST' }),
  deleteEntry: (id: string) => request<void>(`/api/entries/${id}`, { method: 'DELETE' }),
  info: () => request<Info>('/api/info'),
};
