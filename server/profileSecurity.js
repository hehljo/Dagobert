import { randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'dagobert_profile_session';
const SESSION_DURATION = 12 * 60 * 60 * 1000;
const ATTEMPT_WINDOW = 60 * 1000;

export function createProfileSecurity(getProfile, hashPin) {
  const sessions = new Map();
  const attempts = new Map();

  function sessionToken(req) {
    return req.headers.cookie?.split(';').map(c => c.trim())
      .find(c => c.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  }

  function requireAccess(resolveProfileId) {
    return (req, res, next) => {
      const profileId = resolveProfileId(req);
      if (typeof profileId !== 'string' || !profileId) {
        return res.status(400).json({ error: 'Profil fehlt oder wurde nicht gefunden' });
      }
      const profile = getProfile(profileId);
      if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });

      res.set('Cache-Control', 'no-store');
      if (profile.pin_hash) {
        const token = sessionToken(req);
        const session = sessions.get(token);
        if (!session || session.expiresAt <= Date.now() ||
            session.profileId !== profileId || session.pinHash !== profile.pin_hash) {
          if (session?.expiresAt <= Date.now()) sessions.delete(token);
          return res.status(401).json({ error: 'Bitte das Profil mit der PIN entsperren' });
        }
      }
      next();
    };
  }

  function unlock(req, res) {
    const profile = getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.set('Cache-Control', 'no-store');
    if (!profile.pin_hash) return res.json({ success: true });

    const now = Date.now();
    const previous = attempts.get(profile.id);
    if (previous && previous.expiresAt > now && previous.count >= 5) {
      res.set('Retry-After', String(Math.ceil((previous.expiresAt - now) / 1000)));
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte in einer Minute erneut versuchen.' });
    }

    const hashed = hashPin(req.body?.pin);
    const expected = Buffer.from(profile.pin_hash);
    const actual = Buffer.from(hashed || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      const entry = previous?.expiresAt > now ? previous : { count: 0, expiresAt: now + ATTEMPT_WINDOW };
      entry.count++;
      attempts.set(profile.id, entry);
      return res.status(401).json({ error: 'Falsche PIN' });
    }

    attempts.delete(profile.id);
    sessions.delete(sessionToken(req));
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { profileId: profile.id, pinHash: profile.pin_hash, expiresAt: now + SESSION_DURATION });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || process.env.SECURE_COOKIES === 'true',
      path: '/api'
    });
    res.json({ success: true });
  }

  return { requireAccess, unlock };
}
