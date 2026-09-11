import { useWindowDimensions } from 'react-native';
import { breakpoints, layout } from '@/src/theme/tokens';

export type Device = 'phone' | 'tablet' | 'laptop' | 'desktop';

export interface Responsive {
  width: number;
  height: number;
  device: Device;
  isPhone: boolean;
  isTabletUp: boolean;
  isLaptopUp: boolean;
  /** Horizontal page padding that grows with the viewport. */
  gutter: number;
  /** Content width, capped so text never runs the full width of a monitor. */
  contentWidth: number;
  /** Columns for a grid of artwork cards at this size. */
  gridColumns: number;
  /** Width of one card in a horizontal shelf. */
  shelfCardWidth: number;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const device: Device =
    width >= breakpoints.desktop
      ? 'desktop'
      : width >= breakpoints.laptop
        ? 'laptop'
        : width >= breakpoints.tablet
          ? 'tablet'
          : 'phone';

  // On wide screens the gutter absorbs the extra width instead of letting a
  // phone layout stretch across a monitor, so content stays centred and
  // readable while horizontal shelves still run to the edge of the column.
  const gutter =
    device === 'phone'
      ? 18
      : device === 'tablet'
        ? 28
        : Math.max(40, (width - layout.maxContentWidth) / 2);
  const contentWidth = Math.min(width - gutter * 2, layout.maxContentWidth);
  const gridColumns = device === 'phone' ? (width >= breakpoints.phoneLarge ? 3 : 2) : device === 'tablet' ? 4 : device === 'laptop' ? 5 : 6;
  const shelfCardWidth =
    device === 'phone' ? Math.min(158, (width - gutter * 2 - 24) / 2.2) : device === 'tablet' ? 180 : 196;

  return {
    width,
    height,
    device,
    isPhone: device === 'phone',
    isTabletUp: device !== 'phone',
    isLaptopUp: device === 'laptop' || device === 'desktop',
    gutter,
    contentWidth,
    gridColumns,
    shelfCardWidth,
  };
}
