import { useWindowDimensions } from 'react-native';
import { breakpoints, layout } from '@/src/theme/tokens';

export type Device = 'phone' | 'tablet' | 'laptop' | 'desktop';

export interface Responsive {
  /** The whole window. */
  width: number;
  height: number;
  /** What a page has to work with: the window, minus the sidebar on a laptop. */
  pageWidth: number;
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

  // A phone turned sideways is still a phone: its short side stays phone-sized,
  // so it keeps the phone layout instead of switching to the laptop one. Real
  // tablets and computers have a short side well past this on any rotation.
  const phoneSized = Math.min(width, height) < 600;

  const device: Device = phoneSized
    ? 'phone'
    : width >= breakpoints.desktop
      ? 'desktop'
      : width >= breakpoints.laptop
        ? 'laptop'
        : width >= breakpoints.tablet
          ? 'tablet'
          : 'phone';

  // On a laptop the sidebar takes the left of the window and pages sit in a
  // panel beside it, so page layout works from the panel's width.
  const pageWidth =
    device === 'laptop' || device === 'desktop' ? width - layout.sidebarWidth - 16 : width;

  // On wide screens the gutter absorbs the extra width instead of letting a
  // phone layout stretch across a monitor, so content stays centred and
  // readable while horizontal shelves still run to the edge of the column.
  const gutter =
    device === 'phone'
      ? 18
      : device === 'tablet'
        ? 28
        : Math.max(32, (pageWidth - layout.maxContentWidth) / 2);
  const contentWidth = Math.min(pageWidth - gutter * 2, layout.maxContentWidth);
  const gridColumns = device === 'phone' ? (width >= breakpoints.phoneLarge ? (width > height ? 5 : 3) : 2) : device === 'tablet' ? 4 : device === 'laptop' ? 5 : 6;
  const shelfCardWidth =
    device === 'phone' ? Math.min(158, (Math.min(width, 520) - gutter * 2 - 24) / 2.2) : device === 'tablet' ? 180 : 196;

  return {
    width,
    height,
    pageWidth,
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
