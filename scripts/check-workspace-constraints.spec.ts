/** Experimental-package publication and dependency constraints. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkHierarchyShape,
  checkRepositoryVersion,
  checkWorkspace,
  checkWorkspaceProtocol,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('repository version constraint', () => {
  it('accepts a release version', () => {
    expect(checkRepositoryVersion('0.1.0')).toEqual([])
  })

  it('accepts a prerelease version', () => {
    expect(checkRepositoryVersion('0.1.0-rc.2')).toEqual([])
  })

  it('rejects a non-semver version', () => {
    expect(checkRepositoryVersion('not-a-version')).toEqual([
      'package.json: version must be X.Y.Z with an optional prerelease segment',
    ])
  })
})

describe('workspace protocol constraint', () => {
  const memberA: WorkspaceManifest = {
    dir: 'packages/core/a',
    manifest: { name: '@deepseek-ai/dsh-a' },
  }
  const memberB: WorkspaceManifest = {
    dir: 'packages/core/b',
    manifest: { name: '@deepseek-ai/dsh-b' },
  }

  it('accepts workspace protocol ranges', () => {
    expect(checkWorkspaceProtocol([memberA, {
      ...memberB,
      manifest: {
        ...memberB.manifest,
        dependencies: { '@deepseek-ai/dsh-a': 'workspace:^' },
      },
    }])).toEqual([])
  })

  it('ignores external package ranges', () => {
    expect(checkWorkspaceProtocol([memberA, {
      ...memberB,
      manifest: {
        ...memberB.manifest,
        dependencies: { 'left-pad': '^1.0.0' },
      },
    }])).toEqual([])
  })

  it('rejects bare ranges that name a workspace member', () => {
    expect(checkWorkspaceProtocol([memberA, {
      ...memberB,
      manifest: {
        ...memberB.manifest,
        dependencies: { '@deepseek-ai/dsh-a': '^1.0.0' },
      },
    }])).toEqual([
      '@deepseek-ai/dsh-b: dependencies.@deepseek-ai/dsh-a must use the workspace: protocol, got ^1.0.0',
    ])
  })
})

const dropExperimentalNoise = (errors: string[]) => errors.filter(error => !error.includes('experimental package'))
const normalizePath = (errors: string[]) => errors.map(error => error.replaceAll('\\', '/'))

describe('checkWorkspace publication rules', () => {
  const releaseManifest: WorkspaceManifest['manifest'] = {
    name: '@deepseek-ai/dsh-dummy',
    publishConfig: { access: 'public' },
    repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'vendor/dummy' },
  }

  it('accepts a valid release member', () => {
    expect(dropExperimentalNoise(checkWorkspace({ dir: 'vendor/dummy', manifest: releaseManifest }))).toEqual([])
  })

  it('rejects a release member that sets "private": true', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'vendor/dummy',
      manifest: { ...releaseManifest, private: true },
    })))
    expect(errors).toContain('vendor/dummy/package.json: @deepseek-ai/dsh-dummy: release member must not set "private": true')
  })

  it('rejects a release member without public publishConfig', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'vendor/dummy',
      manifest: { ...releaseManifest, publishConfig: { access: 'restricted' } },
    })))
    expect(errors).toContain('vendor/dummy/package.json: @deepseek-ai/dsh-dummy: release member must set publishConfig.access to "public"')
  })

  it('rejects a release member with a non-published repository URL', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'vendor/dummy',
      manifest: { ...releaseManifest, repository: { type: 'git', url: 'git+https://github.com/other/repo.git', directory: 'vendor/dummy' } },
    })))
    expect(errors).toContain('vendor/dummy/package.json: @deepseek-ai/dsh-dummy: release member repository must use git+https://github.com/deepseek-ai/deepseek-harness.git with directory vendor/dummy')
  })
})

describe('checkWorkspace non-experimental non-release private rule', () => {
  it('requires private=true for a non-experimental non-release member', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'tools/standalone',
      manifest: { name: '@deepseek-ai/dsh-dummy' },
    })))
    expect(errors).toContain('tools/standalone/package.json: @deepseek-ai/dsh-dummy: package.json must set "private": true')
  })

  it('accepts private=true for a non-experimental non-release member', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: 'tools/standalone',
      manifest: { name: '@deepseek-ai/dsh-dummy', private: true },
    }))).toEqual([])
  })
})

describe('checkHierarchyShape', () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dsh-hier-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects a package.json at the group level', () => {
    mkdirSync(join(tmpDir, 'group-a'), { recursive: true })
    writeFileSync(join(tmpDir, 'group-a', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-x' }))
    expect(normalizePath(checkHierarchyShape(tmpDir))).toEqual([
      'packages/group-a: a group dir must not contain a package.json — packages live at packages/<group>/<pkg>, not directly under packages/',
    ])
  })

  it('rejects a missing package.json at the package level', () => {
    mkdirSync(join(tmpDir, 'group-a', 'pkg-x'), { recursive: true })
    expect(normalizePath(checkHierarchyShape(tmpDir))).toEqual([
      'packages/group-a/pkg-x: expected a package here (no package.json found) — the hierarchy is exactly packages/<group>/<pkg>, no deeper nesting',
    ])
  })

  it('accepts a well-formed packages tree', () => {
    mkdirSync(join(tmpDir, 'group-a', 'pkg-x'), { recursive: true })
    writeFileSync(join(tmpDir, 'group-a', 'pkg-x', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-x' }))
    expect(checkHierarchyShape(tmpDir)).toEqual([])
  })
})
