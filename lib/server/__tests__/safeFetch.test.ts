import { describe, it, expect } from 'vitest';
import { assertPublicUrl, BlockedUrl } from '../safeFetch';

/** The address that made this worth fixing: Alibaba's instance metadata service. */
const ALIBABA_METADATA = 'http://100.100.100.200/latest/meta-data/ram/security-credentials/';

describe('assertPublicUrl', () => {
  it('refuses the Alibaba metadata service', async () => {
    await expect(assertPublicUrl(ALIBABA_METADATA)).rejects.toBeInstanceOf(BlockedUrl);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:3000/api/projects',
    'http://10.0.0.5/',
    'http://172.20.173.11/',
    'http://192.168.1.1/',
    'http://[::1]:3000/',
    'http://localhost:3000/',
  ])('refuses %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(BlockedUrl);
  });

  it.each(['file:///etc/passwd', 'gopher://example.com/', 'data:text/plain,hi'])('refuses scheme in %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(BlockedUrl);
  });

  it('refuses a url it cannot parse', async () => {
    await expect(assertPublicUrl('not-a-url')).rejects.toBeInstanceOf(BlockedUrl);
  });

  it('allows a public address', async () => {
    await expect(assertPublicUrl('https://8.8.8.8/img.png')).resolves.toBeInstanceOf(URL);
  });

  it('names the offending address so the 400 is debuggable', async () => {
    await expect(assertPublicUrl(ALIBABA_METADATA)).rejects.toThrow(/100\.100\.100\.200/);
  });
});
