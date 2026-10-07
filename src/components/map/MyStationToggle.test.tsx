import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MyStationToggle } from './MyStationToggle';

function Harness({ initial = false, disabled = false }: { initial?: boolean; disabled?: boolean }) {
  const [mine, setMine] = useState(initial);
  return <MyStationToggle mine={mine} onToggle={() => setMine((value) => !value)} disabled={disabled} />;
}

describe('MyStationToggle', () => {
  it('„Postavi kao moju stanicu“ → oznaka i „Ukloni“; fokus ostaje na istom dugmetu', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Postavi kao moju stanicu' });
    button.focus();
    fireEvent.click(button);
    const remove = screen.getByRole('button', { name: 'Ukloni iz „Moja stanica“' });
    expect(remove).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(screen.getByText('Moja stanica')).toBeInTheDocument();
    expect(screen.getByText('Postavljeno kao moja stanica – prikazuje se prva na Pregledu.')).toBeInTheDocument();

    fireEvent.click(remove);
    expect(screen.getByRole('button', { name: 'Postavi kao moju stanicu' })).toBe(button);
    expect(screen.getByText('Stanica je uklonjena iz „Moja stanica“.')).toBeInTheDocument();
  });

  it('neaktivna stanica se ne nudi kao nova, ali se može ukloniti ako je već moja', () => {
    const { unmount } = render(<Harness disabled />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<Harness initial disabled />);
    expect(screen.getByRole('button', { name: 'Ukloni iz „Moja stanica“' })).toBeInTheDocument();
  });

  it('poziva onToggle jednom po kliku', () => {
    const onToggle = vi.fn();
    render(<MyStationToggle mine={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Postavi kao moju stanicu' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
