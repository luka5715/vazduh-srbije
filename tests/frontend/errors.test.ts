import { describe, expect, it } from 'vitest';

import { SYNC_ALREADY_RUNNING } from '@shared/syncNotes';

import { dataErrorMessage, describeDataError, describeSyncError, httpStatusOf } from '@/lib/errors';

/** Greška kakvu baca instalirani SDK: `NetworkError` sa HTTP statusom i porukom iz tela odgovora. */
function sdkError(message: string, status: number): Error {
  return Object.assign(new Error(message), { name: 'NetworkError', status });
}

describe('httpStatusOf', () => {
  it('čita numerički status sa greške, `statusCode`, `response.status` i ugnežđenog `cause`', () => {
    expect(httpStatusOf(sdkError('x', 401))).toBe(401);
    expect(httpStatusOf(Object.assign(new Error('x'), { statusCode: 503 }))).toBe(503);
    expect(httpStatusOf(Object.assign(new Error('x'), { response: { status: 403 } }))).toBe(403);
    expect(httpStatusOf(Object.assign(new Error('outer'), { cause: sdkError('inner', 401) }))).toBe(401);
    expect(httpStatusOf(new Error('bez statusa'))).toBeNull();
    expect(httpStatusOf('tekst')).toBeNull();
    expect(httpStatusOf(Object.assign(new Error('x'), { status: '401' }))).toBeNull();
  });
});

describe('describeDataError', () => {
  it('401/403 po STATUSU, i kad poruka ne sadrži broj („Access token has expired“, prazna 403)', () => {
    const expired = describeDataError(sdkError('Access token has expired', 401));
    expect(expired).toMatchObject({ title: 'Sesija nije važeća', known: true, detail: 'Access token has expired' });
    expect(expired.hint).toBe('Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login).');
    expect(describeDataError(sdkError('HTTP Error 403: Forbidden', 403))).toMatchObject({ title: 'Sesija nije važeća', known: true });
    expect(describeDataError(Object.assign(new Error('Request failed'), { status: 403 }))).toMatchObject({ title: 'Sesija nije važeća' });
    // Ugnežđen uzrok nosi status.
    expect(describeDataError(Object.assign(new Error('Učitavanje nije uspelo'), { cause: sdkError('x', 401) })).title).toBe('Sesija nije važeća');
  });

  it('401/403 po tekstu kad greška nema status (stringovi, starije poruke)', () => {
    expect(describeDataError(new Error('GraphQL request failed: 401 Unauthorized'))).toMatchObject({ title: 'Sesija nije važeća', known: true });
    expect(dataErrorMessage('HTTP 403 Forbidden')).toBe('Sesija nije važeća. Odjavite se i prijavite ponovo (u lokalnom razvoju: npx rayfin login).');
    expect(describeDataError(new Error('token is expired')).title).toBe('Sesija nije važeća');
  });

  it('poznat status koji nije 401/403 nije sesija, čak ni sa rečju „token“ u telu', () => {
    const described = describeDataError(sdkError('token service unavailable', 500));
    expect(described.title).not.toBe('Sesija nije važeća');
    expect(described.known).toBe(false);
  });

  it('mreža i rok dobijaju konkretan savet', () => {
    expect(dataErrorMessage(new TypeError('Failed to fetch'))).toMatch(/^Nema veze sa Rayfin API-jem\./);
    expect(describeDataError(Object.assign(new Error('Network error: fetch failed'), { name: 'NetworkError' }))).toMatchObject({ title: 'Nema veze sa Rayfin API-jem', known: true });
    expect(describeDataError(new Error('Request timed out after 30000ms'))).toMatchObject({ title: 'Baza nije odgovorila u roku', known: true });
  });

  it('nepoznata greška: ljudski naslov i savet, sirova poruka samo u `detail`', () => {
    const raw = 'GraphQL errors: The specified input object field `gte` does not exist.';
    const described = describeDataError(new Error(raw));
    expect(described).toEqual({
      title: 'Greška pri čitanju baze',
      hint: 'Pokušajte ponovo; ako se ponavlja, javite vlasniku.',
      known: false,
      detail: raw,
    });
    expect(dataErrorMessage(new Error(raw))).toBe('Greška pri čitanju baze. Pokušajte ponovo; ako se ponavlja, javite vlasniku.');
    expect(dataErrorMessage(new Error(raw))).not.toContain('gte');
    // Ranije je sirova poruka prolazila kao glavni tekst – više ne.
    expect(dataErrorMessage('Cannot query field "foo"')).toBe('Greška pri čitanju baze. Pokušajte ponovo; ako se ponavlja, javite vlasniku.');
    expect(describeDataError('Cannot query field "foo"').detail).toBe('Cannot query field "foo"');
  });

  it('`detail` je prisutan i za prepoznate greške (za „Detalji“)', () => {
    expect(describeDataError(sdkError('Access token has expired', 401)).detail).toBe('Access token has expired');
    expect(describeDataError(new TypeError('Failed to fetch')).detail).toBe('Failed to fetch');
  });
});

describe('describeSyncError', () => {
  it('odbijen drugi posao i vremenski limit sinhronizacije', () => {
    expect(describeSyncError(`${SYNC_ALREADY_RUNNING} (pokrenuta pre 2 min u drugoj sesiji).`).title).toBe('Sinhronizacija je već u toku');
    expect(describeSyncError('Vremenski limit sinhronizacije: https://x/stations').title).toBe('Funkcija nije završila u roku');
  });

  it('sesija po statusu (poziv funkcije sa isteklim tokenom) i po tekstu', () => {
    expect(describeSyncError(sdkError('Access token has expired', 401)).title).toBe('Sesija nije važeća');
    expect(describeSyncError(sdkError('', 403)).title).toBe('Sesija nije važeća');
    expect(describeSyncError('HTTP 401 Unauthorized').title).toBe('Sesija nije važeća');
    expect(describeSyncError('HTTP Error 403').title).toBe('Sesija nije važeća');
    expect(describeSyncError('status 401').title).toBe('Sesija nije važeća');
    // Stanica sa SEPA id-om 401 koja ne odgovara nije istekla sesija.
    expect(describeSyncError('Stanica 401: HTTP 500 za https://kosava.example/api/v1/observations?station_id=401').title).toBe('SEPA/Kosava API nije vratio podatke');
    expect(describeDataError(new Error('Stanica 403: HTTP 500 za https://kosava.example/x?station_id=403')).title).toBe('Greška pri čitanju baze');
  });

  it('nepoznata greška sinhronizacije zadržava poruku kao savet', () => {
    expect(describeSyncError('Nešto neočekivano')).toEqual({ title: 'Sinhronizacija nije uspela', hint: 'Nešto neočekivano' });
  });
});
