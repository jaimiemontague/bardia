/**
 * Audio lab screen descriptor (ARCHITECTURE §14 screen convention): opened with the route
 * 'audioLab' (e.g. `navigation.open('audioLab')` from the options page or a dev menu).
 */
import type { ScreenDescriptor } from '@client/app/screenTypes';
import { AudioLabScreen } from './AudioLab';

export const screen: ScreenDescriptor = {
  id: 'audioLab',
  route: 'audioLab',
  layout: 'fullscreen',
  titleKey: 'music.lab.title',
  component: AudioLabScreen,
};
