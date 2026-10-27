import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CrestOrbit } from '../src';

describe('CrestOrbit', () => {
  it('is one labelled image with front, back and edge layers and the orbiting class', () => {
    const { container } = render(<CrestOrbit src="/crest.png" label="The ICT University" students={6} />);
    expect(screen.getByRole('img', { name: 'The ICT University' })).toBeTruthy();
    expect(container.querySelectorAll('.lp-crest__face--front, .lp-crest__face--back')).toHaveLength(2);
    expect(container.querySelectorAll('.lp-crest__edge').length).toBeGreaterThan(4);
    expect(container.querySelectorAll('.lp-crest__seat')).toHaveLength(6);
  });

  it('can hide the class and stop all motion', () => {
    const { container } = render(<CrestOrbit src="/crest.png" label="ICTU" students={0} still />);
    expect(container.querySelector('.lp-crest')?.classList.contains('is-still')).toBe(true);
    expect(container.querySelector('.lp-crest__class')).toBeNull();
  });
});
