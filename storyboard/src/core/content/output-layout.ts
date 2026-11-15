// The content loader's output layout (spec §3.2 "Pages read only .content/"; design
// p1-step8-design.md §2, §8; P1-2b). Names only, no I/O and no path joining: scripts/load-content.ts
// writes these files (outputPaths) and src/content reads them, and src/content may not import
// scripts/ (eslint.config.mjs), so both take the names from here.

/** The folder, under the storyboard folder, that holds every loaded content file. */
export const CONTENT_DIR = '.content'
/** In CONTENT_DIR: the pointer and snapshot bytes as loaded, and the build-info record. */
export const POINTER_FILE = 'pointer.json'
export const SNAPSHOT_FILE = 'snapshot.json'
export const BUILD_INFO_FILE = 'build-info.json'
/** In CONTENT_DIR: one file per built package, named by packageFileName. */
export const PACKAGES_DIR = 'packages'
/** In CONTENT_DIR: where each file is written before it is renamed into place. */
export const TMP_DIR = '.tmp'
/** The public copy of build-info, `public/build-info.json`; written last, its presence means loaded. */
export const PUBLIC_DIR = 'public'
export const PUBLIC_BUILD_INFO_FILE = 'build-info.json'

/** The file name of a package in PACKAGES_DIR; storyId is a gate-checked StoryId. */
export function packageFileName(storyId: string): string {
  return `${storyId}.json`
}
