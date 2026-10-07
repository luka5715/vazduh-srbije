import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CATEGORIES, PARAMETERS, THRESHOLDS_1H } from '@shared/aqi';

import { HowToReadButton } from '@/components/HowToRead';

describe('HowToReadButton („Kako čitati“)', () => {
  it('otvara dijalog sa pragovima i savetima iz @shared/aqi', async () => {
    render(<HowToReadButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Kako čitati' }));
    const heading = await screen.findByRole('heading', { name: 'Kako čitati podatke' });
    const dialog = heading.closest('dialog') as HTMLElement;
    expect(dialog).not.toBeNull();

    // Saveti: svih šest kategorija, tekst iz CATEGORIES (jedini izvor).
    for (const category of CATEGORIES) expect(within(dialog).getByText(category.advice)).toBeInTheDocument();
    // Tabela pragova: red „Umeren“ nosi gornje granice svih polutanata.
    const table = within(dialog).getByRole('table');
    const cells = (label: string) =>
      [...(within(table).getByRole('rowheader', { name: label }).closest('tr') as HTMLElement).querySelectorAll('td')].map((cell) => cell.textContent);
    expect(cells('Umeren')).toEqual(PARAMETERS.map((parameter) => `≤ ${THRESHOLDS_1H[parameter][2]}`));
    expect(cells('Izuzetno zagađen')).toEqual(PARAMETERS.map((parameter) => `> ${THRESHOLDS_1H[parameter][4]}`));
    // Pravila: najlošiji polutant, svežina, preliminarni podaci.
    expect(within(dialog).getByRole('heading', { name: 'Kategorija stanice: najlošiji polutant' })).toBeInTheDocument();
    expect(within(dialog).getByText(/poslednjih 6 h/)).toBeInTheDocument();
    expect(within(dialog).getByText(/preliminarni \(neverifikovani\)/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Zatvori' }));
    expect(screen.queryByRole('heading', { name: 'Kako čitati podatke' })).toBeNull();
  });

  it('varijanta za podnožje je tekstualni link', () => {
    render(<HowToReadButton variant="link" />);
    expect(screen.getByRole('button', { name: 'Kako čitati podatke' })).toHaveAttribute('aria-haspopup', 'dialog');
  });
});
