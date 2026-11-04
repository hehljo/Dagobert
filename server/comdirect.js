import { randomBytes } from 'node:crypto';

// April 2020 comdirect contract supplied by the user. Banking reads only;
// authentication writes are fixed here, never a general-purpose bank proxy.
export function mountComdirect(app, requireAccess, bankFetch = fetch, access = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const fail = message => { throw new Error(message); };
  const required = (data, key, max = 256) => {
    const value = data[key];
    if (typeof value !== 'string' || !value || value.length > max) fail('Bankangaben fehlen oder sind ungültig.');
    return value;
  };
  const identifier = value => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) fail('Ungültige Bankkennung.');
    return value;
  };
  async function request(session, method, path, body, extra = {}) {
    if (Date.now() >= session.expiresAt) fail('Die Bankverbindung ist abgelaufen. Bitte neu anmelden.');
    const form = path === '/oauth/token';
    const response = await bankFetch('https://api.comdirect.de' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: {
        Accept: 'application/json', 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        ...(session.token ? { Authorization: 'Bearer ' + session.token } : {}),
        'x-http-request-info': JSON.stringify({ clientRequestId: {
          sessionId: session.requestSession, requestId: String(++session.counter).padStart(9, '0'),
        } }), ...extra,
      }, body: body === undefined ? undefined : form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
    if (response.status === 404 && method === 'GET' && path.endsWith('/transactions?transactionState=BOOKED&paging-first=0')) {
      return { data: { values: [], paging: { index: 0, matches: 0 } }, headers: response.headers };
    }
    if (!response.ok) fail(`comdirect hat den Schritt abgelehnt (HTTP ${response.status}). Bitte die Freigabe im Onlinebanking prüfen; TAN nicht mehrfach ausprobieren.`);
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) fail('Die Antwort der Bank ist zu groß.');
    return { data: text ? JSON.parse(text) : {}, headers: response.headers };
  }
  function token(session, data) {
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) fail('Ungültige Anmeldeantwort der Bank.');
    session.token = data.access_token;
    session.expiresAt = Math.min(session.expiresAt, Date.now() + Number(data.expires_in) * 1000);
  }
  app.post('/api/comdirect/:operation', requireAccess, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('Origin');
    let originValid = true;
    try { if (origin) originValid = new URL(origin).host === req.get('host'); } catch { originValid = false; }
    if (!originValid || (req.get('Sec-Fetch-Site') && !['same-origin', 'none'].includes(req.get('Sec-Fetch-Site')))) {
      return res.status(403).json({ error: 'Bankzugang nur aus dieser App möglich.' });
    }
    const { profileId } = req.body;
    let handle = req.body.sessionId;
    try {
      for (const [key, value] of sessions) if (value.expiresAt <= Date.now()) sessions.delete(key);
      for (const [key, value] of attempts) if (value.start + 15 * 60_000 <= Date.now()) attempts.delete(key);
      if (req.params.operation === 'saved-access') {
        const canSave = !!access.store && !!access.canSave?.(profileId);
        return res.json({ ...(canSave ? access.store.status(profileId) : { saved: false, pinStored: false }), canSave });
      }
      if (req.params.operation === 'forget-access') {
        access.store?.remove(profileId); return res.json({ success: true });
      }
      if (req.params.operation === 'login') {
        const previous = attempts.get(profileId) || { start: Date.now(), count: 0 };
        if (previous.count >= 3) fail('Zu viele neue TAN-Anforderungen. Bitte zuerst im comdirect-Onlinebanking anmelden und später erneut versuchen.');
        if (sessions.size >= 50) fail('Der Bankzugang ist gerade ausgelastet. Bitte später versuchen.');
        if ((req.body.useSaved || req.body.saveAccess) && (!access.store || !access.canSave?.(profileId))) fail('Für gespeicherten Bankzugang bitte zuerst eine Profil-PIN in den Einstellungen setzen.');
        const stored = req.body.useSaved ? access.store.load(profileId) : null;
        if (req.body.useSaved && !stored) fail('Es ist kein Bankzugang gespeichert.');
        const credentials = stored ? { ...stored, ...(req.body.password ? { password: req.body.password } : {}) } : req.body;
        const clientId = required(credentials, 'clientId');
        const clientSecret = required(credentials, 'clientSecret');
        const username = required(credentials, 'username');
        const password = required(credentials, 'password');
        previous.count++; attempts.set(profileId, previous);
        handle = randomBytes(32).toString('hex');
        const session = { profileId, clientId, clientSecret, requestSession: randomBytes(16).toString('hex'),
          counter: 0, expiresAt: Date.now() + 10 * 60_000, token: '', accountIds: [] };
        sessions.set(handle, session);
        const expires = setTimeout(() => sessions.delete(handle), 10 * 60_000);
        expires.unref();
        token(session, (await request(session, 'POST', '/oauth/token', {
          client_id: clientId, client_secret: clientSecret, grant_type: 'password', username, password,
        })).data);
        const status = (await request(session, 'GET', '/api/session/clients/user/v1/sessions')).data;
        if (!Array.isArray(status) || status.length !== 1) fail('Die Banksitzung ist nicht eindeutig.');
        session.bankSession = identifier(status[0].identifier);
        session.sessionBody = { identifier: session.bankSession, sessionTanActive: true, activated2FA: true };
        const validation = await request(session, 'POST', `/api/session/clients/user/v1/sessions/${session.bankSession}/validate`, session.sessionBody);
        const challenge = JSON.parse(validation.headers.get('x-once-authentication-info') || '{}');
        if (!challenge.id || !['P_TAN', 'M_TAN', 'P_TAN_PUSH'].includes(challenge.typ)) fail('Das TAN-Verfahren wird nicht unterstützt.');
        session.challenge = challenge;
        if (req.body.saveAccess) access.store.save(profileId, { clientId, clientSecret, username, password }, req.body.savePin === true);
        return res.json({ sessionId: handle, challenge: { typ: challenge.typ,
          ...(challenge.typ === 'P_TAN' && typeof challenge.challenge === 'string' ? { image: challenge.challenge } : {}) } });
      }
      const session = sessions.get(handle);
      if (!session || session.profileId !== profileId || session.expiresAt <= Date.now()) fail('Bitte zuerst mit comdirect verbinden.');
      if (session.busy) fail('Ein Bankabruf läuft bereits.');
      session.busy = true;
      try {
        if (req.params.operation === 'disconnect') {
          sessions.delete(handle);
          await request(session, 'DELETE', '/oauth/revoke').catch(() => {});
          return res.json({ success: true });
        }
        if (req.params.operation === 'confirm') {
          if (!session.challenge) fail('Es liegt keine offene TAN-Freigabe vor.');
          const headers = { 'x-once-authentication-info': JSON.stringify({ id: session.challenge.id }) };
          if (session.challenge.typ !== 'P_TAN_PUSH') {
            if (!/^\d{6}$/.test(req.body.tan || '')) fail('Bitte eine sechsstellige TAN eingeben.');
            headers['x-once-authentication'] = req.body.tan;
          }
          await request(session, 'PATCH', `/api/session/clients/user/v1/sessions/${session.bankSession}`, session.sessionBody, headers);
          token(session, (await request(session, 'POST', '/oauth/token', {
            client_id: session.clientId, client_secret: session.clientSecret, grant_type: 'cd_secondary', token: session.token,
          })).data);
          // Do not retain client credentials once the one-shot session is established.
          delete session.clientSecret; delete session.clientId; delete session.challenge;
          const balances = (await request(session, 'GET', '/api/banking/clients/user/v2/accounts/balances')).data;
          if (!Array.isArray(balances.values)) fail('Ungültige Kontenliste der Bank.');
          const accounts = balances.values.map(({ account }) => ({ accountId: identifier(account?.accountId),
            iban: account.iban || '', label: account.accountType?.text || 'comdirect Konto', currency: account.currency }));
          session.accountIds = accounts.map(a => a.accountId);
          return res.json({ accounts });
        }
        if (req.params.operation === 'transactions') {
          const accountId = identifier(req.body.accountId);
          if (!session.accountIds.includes(accountId)) fail('Dieses Bankkonto gehört nicht zur freigegebenen Sitzung.');
          const first = req.body.first;
          if (!Number.isSafeInteger(first) || first < 0 || first > 100000) fail('Ungültige Abrufseite.');
          const reply = await request(session, 'GET', `/api/banking/v1/accounts/${accountId}/transactions?transactionState=BOOKED&paging-first=${first}`);
          return res.json(reply.data);
        }
        fail('Unbekannter Bankvorgang.');
      } finally { session.busy = false; }
    } catch (error) {
      // No retries of login/TAN: repeated attempts can lock the customer's bank access.
      if (handle && sessions.get(handle)?.profileId === profileId) sessions.delete(handle);
      res.status(400).json({ error: error instanceof Error && !['SyntaxError', 'TypeError', 'TimeoutError'].includes(error.name)
        ? error.message : 'Die Verbindung zur Bank ist fehlgeschlagen. Es wurde nichts importiert.' });
    }
  });
}
