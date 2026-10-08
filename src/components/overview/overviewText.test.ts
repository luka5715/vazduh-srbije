import { describe, expect, it } from 'vitest';

import {
  bandCountFor,
  bandPosition,
  deltaPhrase,
  distributionRepeatsHeadline,
  distributionSentence,
  driverSentence,
  heroHeadline,
  lensSentence,
  nextThreshold,
  rhythmSummary,
  rovingIndex,
  sharedWordPrefix,
  staleNote,
  stationsGenitive,
} from './overviewText';

describe('heroHeadline', () => {
  it('prilog prati udeo dominantne kategorije', () => {
    expect(heroHeadline([0, 6, 19, 0, 0, 0], 2)).toEqual({ lead: 'Vazduh je uglavnom', word: 'umeren', rank: 2 });
    expect(heroHeadline([0, 0, 25, 0, 0, 0], 2)).toEqual({ lead: 'Vazduh je svuda', word: 'umeren', rank: 2 });
    expect(heroHeadline([3, 4, 4, 2, 0, 0], 2)?.lead).toBe('Vazduh je najčešće');
    expect(heroHeadline([0, 0, 0, 0, 3, 0], 4)?.word).toBe('veoma zagađen');
  });

  it('dva stanja kad je bar 40 % stanica u LOŠIJIM kategorijama od najčešće (živa raspodela 3/1/41/27/15/0)', () => {
    // 41 od 87 stanica je „umeren“ (najčešće), ali 42 od 87 su „zagađen“ ili gore: „najčešće
    // umeren“ bi umanjio stanje. Reč naslova je najbrojnija lošija kategorija i nosi njen rang
    // (boja podvlačenja, rečenica „zbog …“ opisuje tu kategoriju).
    expect(heroHeadline([3, 1, 41, 27, 15, 0], 2)).toEqual({ lead: 'Vazduh je umeren do', word: 'zagađen', rank: 3 });
    // Dva stanja imaju prednost i nad „uglavnom“: 50 umeren + 40 zagađen (44 % lošijih).
    expect(heroHeadline([0, 0, 50, 40, 0, 0], 2)).toEqual({ lead: 'Vazduh je umeren do', word: 'zagađen', rank: 3 });
    // Među lošijim kategorijama najbrojnija; pri jednakom broju lošija (kao i izmaglica).
    expect(heroHeadline([0, 0, 20, 10, 10, 0], 2)).toEqual({ lead: 'Vazduh je umeren do', word: 'veoma zagađen', rank: 4 });
    // Tačno na pragu (40 %): mali okrug sa 5 stanica, 3 umeren + 2 zagađen.
    expect(heroHeadline([0, 0, 3, 2, 0, 0], 2)).toEqual({ lead: 'Vazduh je umeren do', word: 'zagađen', rank: 3 });
    expect(heroHeadline([2, 0, 3, 0, 0, 0], 2)).toEqual({ lead: 'Vazduh je uglavnom', word: 'umeren', rank: 2 });
  });

  it('jasan jednomodalan dan ostaje jedno stanje', () => {
    // 12 od 87 lošijih (14 %) → „uglavnom“; 3 od 10 (30 %) → takođe jedno stanje.
    expect(heroHeadline([5, 10, 60, 12, 0, 0], 2)).toEqual({ lead: 'Vazduh je uglavnom', word: 'umeren', rank: 2 });
    expect(heroHeadline([0, 0, 7, 3, 0, 0], 2)).toEqual({ lead: 'Vazduh je uglavnom', word: 'umeren', rank: 2 });
    expect(heroHeadline([0, 0, 25, 0, 0, 0], 2)).toEqual({ lead: 'Vazduh je svuda', word: 'umeren', rank: 2 });
    // Najgora kategorija nema lošijih: nikad „izuzetno zagađen do …“.
    expect(heroHeadline([0, 0, 0, 0, 3, 4], 5)).toEqual({ lead: 'Vazduh je uglavnom', word: 'izuzetno zagađen', rank: 5 });
    // Ogledalo (najčešća je loša, mnoge su bolje): „najčešće zagađen“ ne umanjuje stanje – ostaje.
    expect(heroHeadline([30, 5, 10, 40, 2, 0], 3)).toEqual({ lead: 'Vazduh je najčešće', word: 'zagađen', rank: 3 });
  });

  it('bez svežih stanica nema naslova', () => {
    expect(heroHeadline([0, 0, 0, 0, 0, 0], null)).toBeNull();
  });

  it('jedna ili dve stanice: brojanje umesto „svuda“/„uglavnom“', () => {
    expect(heroHeadline([0, 0, 0, 1, 0, 0], 3)).toEqual({ lead: 'Na jedinoj stanici vazduh je', word: 'zagađen', rank: 3 });
    expect(heroHeadline([0, 0, 2, 0, 0, 0], 2)).toEqual({ lead: 'Na obe stanice vazduh je', word: 'umeren', rank: 2 });
    // Različite kategorije: naslov nosi lošiju, rečenica raspodele drugu.
    expect(heroHeadline([0, 1, 0, 1, 0, 0], 1)).toEqual({ lead: 'Na jednoj od dve stanice vazduh je', word: 'zagađen', rank: 3 });
    expect(heroHeadline([0, 0, 1, 2, 0, 0], 3)?.lead).toBe('Vazduh je uglavnom');
  });
});

describe('driverSentence', () => {
  it('računa se iz dominantnih polutanata stanica u kategoriji naslova', () => {
    expect(driverSentence({ stations: 18, drivers: [{ parameter: 'NO2', count: 12 }, { parameter: 'PM2.5', count: 6 }] }, 2)).toBe(
      'Uglavnom zbog NO₂ – na 12 od 18 stanica u kategoriji „Umeren“.',
    );
    expect(
      driverSentence(
        { stations: 18, drivers: [{ parameter: 'PM2.5', count: 7 }, { parameter: 'NO2', count: 6 }, { parameter: 'PM10', count: 5 }] },
        2,
      ),
    ).toBe('Najčešće zbog PM2.5 – na 7 od 18 stanica u kategoriji „Umeren“; zatim NO₂ (6).');
  });

  it('jedan poznat polutant na manje od pola stanica (ostale bez dominantnog) ne pada', () => {
    expect(driverSentence({ stations: 3, drivers: [{ parameter: 'PM10', count: 1 }] }, 2)).toBe(
      'Najčešće zbog PM10 – na 1 od 3 stanice u kategoriji „Umeren“.',
    );
  });

  it('sve stanice, izjednačenje i jedna stanica', () => {
    expect(driverSentence({ stations: 3, drivers: [{ parameter: 'PM10', count: 3 }] }, 3)).toBe('Zbog PM10 – na sve 3 stanice u kategoriji „Zagađen“.');
    expect(driverSentence({ stations: 7, drivers: [{ parameter: 'PM10', count: 7 }] }, 2)).toBe('Zbog PM10 – na svih 7 stanica u kategoriji „Umeren“.');
    expect(driverSentence({ stations: 1, drivers: [{ parameter: 'SO2', count: 1 }] }, 4)).toBe('Kategoriju „Veoma zagađen“ određuje SO₂.');
    expect(driverSentence({ stations: 2, drivers: [{ parameter: 'NO2', count: 2 }] }, 1)).toBe('Zbog NO₂ – na obe stanice u kategoriji „Prihvatljiv“.');
    expect(driverSentence({ stations: 4, drivers: [{ parameter: 'PM2.5', count: 2 }, { parameter: 'NO2', count: 2 }] }, 2)).toBe(
      'Podjednako zbog PM2.5 i NO₂ – po 2 od 4 stanice u kategoriji „Umeren“.',
    );
  });

  it('bez stanica ili bez poznatog polutanta nema rečenice', () => {
    expect(driverSentence({ stations: 0, drivers: [] }, 2)).toBeNull();
    expect(driverSentence({ stations: 2, drivers: [] }, 2)).toBeNull();
  });
});

describe('distributionRepeatsHeadline', () => {
  it('jedna ili dve stanice iste kategorije – rečenica bi ponovila naslov', () => {
    expect(distributionRepeatsHeadline([0, 0, 0, 1, 0, 0])).toBe(true);
    expect(distributionRepeatsHeadline([0, 0, 2, 0, 0, 0])).toBe(true);
    expect(distributionRepeatsHeadline([0, 1, 0, 1, 0, 0])).toBe(false);
    expect(distributionRepeatsHeadline([0, 0, 3, 0, 0, 0])).toBe(false);
    expect(distributionRepeatsHeadline([0, 0, 0, 0, 0, 0])).toBe(false);
  });
});

describe('lensSentence', () => {
  it('heroj opisuje sve polutante; sočivo dobija svoj red', () => {
    expect(lensSentence('SO2', { counts: [22, 1, 1, 0, 0, 0], reporting: 24, missing: 1 })).toBe('Po SO₂: 22 dobar, 1 prihvatljiv, 1 umeren · 1 bez vrednosti');
    expect(lensSentence('O3', { counts: [24, 0, 0, 0, 0, 0], reporting: 24, missing: 0 })).toBe('Po O₃: 24 dobar');
    expect(lensSentence('NO2', { counts: [0, 0, 0, 0, 0, 0], reporting: 0, missing: 5 })).toBe('Po NO₂: nijedna sveža stanica nema vrednost.');
    expect(lensSentence('worst', { counts: [0, 1, 0, 0, 0, 0], reporting: 1, missing: 0 })).toBeNull();
  });
});

describe('distributionSentence', () => {
  it('nabraja najbrojnije kategorije sa pravilnim padežima', () => {
    expect(distributionSentence([0, 6, 19, 0, 0, 0])).toBe('Na 19 od 25 stanica vazduh je umeren, na 6 prihvatljiv.');
    expect(distributionSentence([1, 1, 0, 0, 0, 0])).toBe('Na 1 od 2 stanice vazduh je prihvatljiv, na 1 dobar.');
  });

  it('jedna kategorija i jedna stanica', () => {
    expect(distributionSentence([0, 0, 7, 0, 0, 0])).toBe('Na svih 7 stanica sa svežim podacima vazduh je umeren.');
    expect(distributionSentence([0, 1, 0, 0, 0, 0])).toBe('Na jedinoj stanici sa svežim podacima vazduh je prihvatljiv.');
  });

  it('više od tri kategorije sažima ostatak', () => {
    expect(distributionSentence([1, 2, 3, 4, 0, 1])).toBe(
      'Na 4 od 11 stanica vazduh je zagađen, na 3 umeren, na 2 prihvatljiv, na još 2 u ostalim kategorijama.',
    );
  });

  it('prazna mreža', () => {
    expect(distributionSentence([0, 0, 0, 0, 0, 0])).toMatch(/Nijedna stanica/);
  });
});

describe('množina i opseg', () => {
  it('genitiv posle „od N“', () => {
    expect(stationsGenitive(1)).toBe('stanice');
    expect(stationsGenitive(3)).toBe('stanice');
    expect(stationsGenitive(25)).toBe('stanica');
    expect(stationsGenitive(21)).toBe('stanice');
  });

  it('napomena o zastarelim stanicama', () => {
    expect(staleNote(0)).toBeNull();
    expect(staleNote(1)).toBe('1 stanica bez svežih podataka nije uračunata.');
    expect(staleNote(3)).toBe('3 stanice bez svežih podataka nisu uračunate.');
    expect(staleNote(5)).toBe('5 stanica bez svežih podataka nije uračunato.');
  });
});

describe('bandPosition', () => {
  it('jednaki pojasevi, linearno unutar pojasa (PM10: 15/45/120/195/270)', () => {
    expect(bandPosition('PM10', 0, 6).position).toBe(0);
    expect(bandPosition('PM10', 15, 6).position).toBeCloseTo(1 / 6);
    expect(bandPosition('PM10', 30, 6).position).toBeCloseTo(1.5 / 6);
    expect(bandPosition('PM10', 45, 4).position).toBeCloseTo(2 / 4);
  });

  it('iznad poslednjeg prikazanog pojasa je puna traka sa prekoračenjem', () => {
    expect(bandPosition('PM10', 250, 4)).toEqual({ position: 1, overflow: true });
    expect(bandPosition('PM10', 190, 4).overflow).toBe(false);
    expect(bandPosition('PM10', 999, 6)).toEqual({ position: 1, overflow: true });
  });

  it('različiti polutanti iste kategorije su uporedivi', () => {
    // NO₂ 42 (25–60) i PM10 82,5 (45–120) su oba na polovini pojasa „Umeren“.
    expect(bandPosition('NO2', 42.5, 6).position).toBeCloseTo(bandPosition('PM10', 82.5, 6).position);
  });

  it('broj pojaseva za rang-listu', () => {
    expect(bandCountFor(0)).toBe(4);
    expect(bandCountFor(2)).toBe(4);
    expect(bandCountFor(3)).toBe(5);
    expect(bandCountFor(5)).toBe(6);
  });
});

describe('nextThreshold', () => {
  it('koliko još do sledeće kategorije', () => {
    expect(nextThreshold('NO2', 42, 2)).toEqual({ limit: 60, remaining: 18, nextLabel: 'Zagađen', share: 0.7 });
    expect(nextThreshold('PM10', 300, 5)).toBeNull();
  });

  it('„još“ se računa od prikazane vrednosti, pa se zbir slaže sa pragom', () => {
    // Prikazano „57,5“ → još 2,5 do 60 (ranije „58 … još 3“).
    expect(nextThreshold('NO2', 57.46, 2)?.remaining).toBe(2.5);
    // Od 100 naviše vrednost je ceo broj: „161“ → još 34 do 195.
    expect(nextThreshold('PM10', 161.4, 3)?.remaining).toBe(34);
    // Vrednost koja bi se zaokružila na SEPA prag zadržava decimalu: „160,4“ → još 34,6.
    expect(nextThreshold('PM10', 160.4, 3)?.remaining).toBe(34.6);
    expect(nextThreshold('NO2', 59.98, 2)?.remaining).toBe(0);
  });
});

describe('rhythmSummary', () => {
  it('broji stanice preko praga i nalazi najteži sat (najnoviji pri jednakom broju)', () => {
    const rows = [
      { cells: [{ rank: 1 }, { rank: 3 }, { rank: 4 }] },
      { cells: [{ rank: 3 }, { rank: null }, { rank: 3 }] },
      { cells: [{ rank: 2 }, { rank: 2 }, { rank: 2 }] },
    ];
    expect(rhythmSummary(rows)).toEqual({ stations: 2, peakIndex: 2, peakCount: 2 });
    expect(rhythmSummary(rows, 5)).toEqual({ stations: 0, peakIndex: null, peakCount: 0 });
  });
});

describe('deltaPhrase', () => {
  it('reči nose smer bez boje', () => {
    expect(deltaPhrase(12.4, 'up')).toEqual({ arrow: '↑', amount: '12', words: 'iznad proseka 24 h' });
    expect(deltaPhrase(-5, 'down')).toEqual({ arrow: '↓', amount: '5', words: 'ispod proseka 24 h' });
    // Iznos kao na Stanicama: jedna decimala ispod 10.
    expect(deltaPhrase(-4.36, 'down').amount).toBe('4,4');
    expect(deltaPhrase(0.2, 'flat').amount).toBeNull();
  });
});

describe('rovingIndex', () => {
  it('strelice bez prelaska preko ivice, Home/End do krajeva, ostali tasteri ne pomeraju fokus', () => {
    expect(rovingIndex('ArrowRight', 0, 12)).toBe(1);
    expect(rovingIndex('ArrowRight', 11, 12)).toBe(11);
    expect(rovingIndex('ArrowLeft', 5, 12)).toBe(4);
    expect(rovingIndex('ArrowLeft', 0, 12)).toBe(0);
    expect(rovingIndex('Home', 7, 12)).toBe(0);
    expect(rovingIndex('End', 2, 12)).toBe(11);
    expect(rovingIndex('Tab', 2, 12)).toBeNull();
    expect(rovingIndex('Enter', 2, 12)).toBeNull();
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('sharedWordPrefix', () => {
  it('cele reči zajedničke svim nazivima', () => {
    expect(sharedWordPrefix(['Demo stanica Bor 1', 'Demo stanica Niš 1'])).toBe('Demo stanica ');
    expect(sharedWordPrefix(['Beograd Novi Beograd', 'Beograd Vračar'])).toBe('Beograd ');
    expect(sharedWordPrefix(['Niš IJZ', 'Bor Brezonik'])).toBe('');
  });

  it('naziv nikad ne ostaje prazan', () => {
    expect(sharedWordPrefix(['Demo stanica', 'Demo stanica Bor'])).toBe('Demo ');
    expect(sharedWordPrefix(['Kragujevac'])).toBe('');
  });
});
