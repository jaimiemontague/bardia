/**
 * The screen registry as React context, so screens can look up other screens (e.g. an optional
 * map-based picker) without importing the glob-built registry (which imports every screen).
 */
import { createContext, useContext } from 'react';
import { ScreenRegistry } from './screenRegistry';

const EMPTY = new ScreenRegistry([]);

export const ScreenRegistryContext = createContext<ScreenRegistry>(EMPTY);

/** The app's screen registry (an empty one outside the App, e.g. in isolated component tests). */
export function useScreenRegistry(): ScreenRegistry {
  return useContext(ScreenRegistryContext);
}
