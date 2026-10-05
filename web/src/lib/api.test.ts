import { describe, expect, test } from 'vitest';
import { fetchListInfo } from './api';

describe('fetchListInfo', () => {
  test('reports a list the server knows, with its venue count', async () => {
    const fetch = async (url: string) => {
      expect(url).toBe('/api/lists/brave-otter-harbor');
      return Response.json({ id: 'brave-otter-harbor', venues: 12 });
    };

    expect(await fetchListInfo('brave-otter-harbor', fetch)).toEqual({ found: true, venues: 12 });
  });

  test('reports an unknown list as not found', async () => {
    const fetch = async () => Response.json({ error: 'list not found' }, { status: 404 });

    expect(await fetchListInfo('brave-otter-harbor', fetch)).toEqual({ found: false, venues: 0 });
  });

  test('throws when the server fails', async () => {
    const fetch = async () => new Response('Bad Gateway', { status: 502 });

    await expect(fetchListInfo('brave-otter-harbor', fetch)).rejects.toThrow('502');
  });
});
