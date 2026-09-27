import { masterKey } from './kdf';
self.onmessage = async (e) => {
  try {
    const key = await masterKey(e.data.password, e.data.salt, e.data.params);
    self.postMessage({ key });
    key.fill(0);
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
