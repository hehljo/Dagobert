import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function createBankAccessStore(directory) {
  const root = path.resolve(directory), folder = path.join(root, 'comdirect-access'), keyFile = path.join(root, '.comdirect-access-key');
  const file = profile => path.join(folder, createHash('sha256').update(profile).digest('hex') + '.json');
  function key(create = false) {
    if (!fs.existsSync(keyFile)) {
      if (!create) throw new Error('Der Schlüssel für den gespeicherten Bankzugang fehlt.');
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      try { fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const stat = fs.lstatSync(keyFile);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size !== 32 ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error('Der Bankzugangsschlüssel ist nicht ausreichend geschützt.');
    return fs.readFileSync(keyFile);
  }
  function load(profile) {
    if (!fs.existsSync(file(profile))) return null;
    const envelope = JSON.parse(fs.readFileSync(file(profile), 'utf8'));
    if (envelope.version !== 1) throw new Error('Unbekanntes Bankzugangsformat.');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(profile)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
  }
  return {
    load,
    status(profile) { const value = load(profile); return { saved: !!value, pinStored: !!value?.password }; },
    save(profile, credentials, includePin) {
      const value = Object.fromEntries(['clientId', 'clientSecret', 'username', ...(includePin ? ['password'] : [])].map(name => {
        if (typeof credentials[name] !== 'string' || !credentials[name] || credentials[name].length > 256) throw new Error('Ungültige Bankzugangsdaten.');
        return [name, credentials[name]];
      }));
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(true), iv);
      cipher.setAAD(Buffer.from(profile));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      const destination = file(profile), temporary = destination + '.' + randomBytes(8).toString('hex') + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, destination);
    },
    remove(profile) { try { fs.unlinkSync(file(profile)); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
  };
}
