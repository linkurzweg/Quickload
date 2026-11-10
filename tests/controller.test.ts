import { describe, expect, it } from 'vite-plus/test';
import {
  detectFamily,
  controllerButtons,
  directionTarget,
  scrollVelocity,
} from '../src/lib/controller';
describe('controller identity', () => {
  it('recognizes Sony names and USB vendor identifiers', () => {
    expect(detectFamily('DualSense Wireless Controller')).toBe('playstation');
    expect(detectFamily('054c-0ce6')).toBe('playstation');
    expect(detectFamily('Xbox Wireless Controller')).toBe('xbox');
  });
  it('recognizes Nintendo generations and keeps labelled confirm/cancel consistent', () => {
    for (const name of [
      'Nintendo Switch Pro Controller',
      'Nintendo Switch 2 Pro Controller',
      'Joy-Con 2 (L/R)',
      '057e-2009',
      'Pro Controller',
    ])
      expect(detectFamily(name)).toBe('nintendo');
    expect(controllerButtons('nintendo')).toEqual({ accept: 1, back: 0, favorite: 3, search: 2 });
    expect(controllerButtons('xbox')).toEqual({ accept: 0, back: 1, favorite: 2, search: 3 });
  });
});

describe('analog scrolling', () => {
  it('ignores stick drift and invalid readings', () => {
    for (const value of [0, 0.1, -0.21, 0.22, NaN, Infinity]) expect(scrollVelocity(value)).toBe(0);
  });
  it('provides progressive, symmetric speed and clamps excessive deflection', () => {
    expect(scrollVelocity(0.4)).toBeGreaterThan(0);
    expect(scrollVelocity(0.4)).toBeLessThan(scrollVelocity(0.8));
    expect(scrollVelocity(-0.8)).toBe(-scrollVelocity(0.8));
    expect(scrollVelocity(1)).toBe(1150);
    expect(scrollVelocity(2)).toBe(1150);
    expect(scrollVelocity(-2)).toBe(-1150);
  });
});
describe('spatial navigation', () => {
  const rect = (x: number, y: number) => ({ left: x, top: y, width: 100, height: 100 }) as DOMRect;
  it('stays in the row instead of jumping diagonally to a closer item', () => {
    const right = {} as HTMLElement,
      diagonal = {} as HTMLElement,
      left = {} as HTMLElement;
    expect(
      directionTarget(
        rect(0, 0),
        [
          { element: right, rect: rect(150, 0) },
          { element: diagonal, rect: rect(60, 110) },
          { element: left, rect: rect(-100, 0) },
        ],
        'right',
      ),
    ).toBe(right);
  });
  it('does not wrap past the edge', () => {
    expect(
      directionTarget(rect(0, 0), [{ element: {} as HTMLElement, rect: rect(120, 0) }], 'left'),
    ).toBeNull();
  });
});
