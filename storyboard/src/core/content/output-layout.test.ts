// The content output layout (design p1-step8-design.md §2, §8; P1-2b): the names the loader writes
// and src/content reads, pinned, and equal to the folders the loader's outputPaths builds today.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { outputPaths } from '../../../scripts/load-content'
import {
  BUILD_INFO_FILE,
  CONTENT_DIR,
  PACKAGES_DIR,
  packageFileName,
  POINTER_FILE,
  PUBLIC_BUILD_INFO_FILE,
  PUBLIC_DIR,
  SNAPSHOT_FILE,
  TMP_DIR,
} from './output-layout'

describe('output layout', () => {
  it('pins every name', () => {
    expect({
      CONTENT_DIR,
      POINTER_FILE,
      SNAPSHOT_FILE,
      BUILD_INFO_FILE,
      PACKAGES_DIR,
      TMP_DIR,
      PUBLIC_DIR,
      PUBLIC_BUILD_INFO_FILE,
    }).toEqual({
      CONTENT_DIR: '.content',
      POINTER_FILE: 'pointer.json',
      SNAPSHOT_FILE: 'snapshot.json',
      BUILD_INFO_FILE: 'build-info.json',
      PACKAGES_DIR: 'packages',
      TMP_DIR: '.tmp',
      PUBLIC_DIR: 'public',
      PUBLIC_BUILD_INFO_FILE: 'build-info.json',
    })
    expect(packageFileName('two-paths')).toBe('two-paths.json')
  })

  it("equals the loader's output folders", () => {
    const root = join('x', 'storyboard')
    expect(outputPaths(root)).toEqual({
      contentDir: join(root, CONTENT_DIR),
      packagesDir: join(root, CONTENT_DIR, PACKAGES_DIR),
      tmpDir: join(root, CONTENT_DIR, TMP_DIR),
      publicBuildInfo: join(root, PUBLIC_DIR, PUBLIC_BUILD_INFO_FILE),
    })
  })
})
