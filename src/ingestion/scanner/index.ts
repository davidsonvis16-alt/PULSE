import { filePickerScanner } from '@/src/ingestion/scanner/file-picker';
import { mediaLibraryScanner } from '@/src/ingestion/scanner/media-library';
import type { MusicScanner } from '@/src/ingestion/scanner/types';

export * from '@/src/ingestion/scanner/types';
export { clearImportedFiles } from '@/src/ingestion/scanner/file-picker';

const scanners: MusicScanner[] = [mediaLibraryScanner, filePickerScanner];

export function registerMusicScanner(scanner: MusicScanner) {
  scanners.unshift(scanner);
}

/**
 * The scanner that can enumerate this device's music, if any.
 * Null on platforms where the only way in is the user picking files.
 */
export async function enumeratingScanner(): Promise<MusicScanner | null> {
  for (const scanner of scanners) {
    if (!scanner.canEnumerate) continue;
    if (await scanner.isAvailable()) return scanner;
  }
  return null;
}

/** Always available: the user chooses files themselves. */
export function pickerScanner(): MusicScanner {
  return filePickerScanner;
}

export function listScanners(): MusicScanner[] {
  return [...scanners];
}
