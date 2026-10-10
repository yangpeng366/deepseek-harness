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

describe('checkWorkspace vendored skip', () => {
  it('returns before the apps, forbidden-file, and dsh-* segments for a vendored package', () => {
    const errors = dropExperimentalNoise(checkWorkspace({
      dir: 'apps/cordis-bundle',
      manifest: { name: '@deepseek-ai/cordis' },
    }))
    expect(errors.some(e => e.includes('app package has no publication files policy'))).toBe(false)
    expect(errors.some(e => e.includes('must not publish'))).toBe(false)
  })
})

describe('checkWorkspace forbidden publication files', () => {
  it('rejects a source file under src/ for a non-vendored dsh-family member', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'tools/some-dsh-tool',
      manifest: { name: '@deepseek-ai/dsh-tool', files: ['src/main.ts'] },
    })))
    expect(errors).toContain('tools/some-dsh-tool/package.json: @deepseek-ai/dsh-tool: package.json files must not publish "src/main.ts"')
  })
})

describe('checkWorkspace app files table', () => {
  it('accepts a known app package with the canonical files', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: 'apps/dsh',
      manifest: {
        name: '@deepseek-ai/dsh',
        publishConfig: { access: 'public' },
        repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'apps/dsh' },
        files: ['lib/*.js', 'config'],
      },
    }))).toEqual([])
  })

  it('rejects a known app package with mismatched files', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'apps/dsh',
      manifest: {
        name: '@deepseek-ai/dsh',
        publishConfig: { access: 'public' },
        repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'apps/dsh' },
        files: ['lib/index.js'],
      },
    })))
    expect(errors).toContain('apps/dsh/package.json: @deepseek-ai/dsh: package.json files must be ["lib/*.js","config"]')
  })

  it('rejects an app package whose name is not in the apps table', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'apps/some-app',
      manifest: {
        name: '@deepseek-ai/dsh-some-app',
        publishConfig: { access: 'public' },
        repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'apps/some-app' },
      },
    })))
    expect(errors).toContain('apps/some-app/package.json: @deepseek-ai/dsh-some-app: app package has no publication files policy')
  })
})

describe('checkWorkspace landlock version sync', () => {
  it('rejects a non-public package under native/landlock-run/packages/', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'native/landlock-run/packages/not-public',
      manifest: { name: '@deepseek-ai/dsh-not-landlock' },
    })))
    expect(errors).toContain('native/landlock-run/packages/not-public/package.json: @deepseek-ai/dsh-not-landlock: unexpected package in the public Landlock package family')
  })

  it('rejects a public Landlock package whose version drifts from the workspace version', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: 'native/landlock-run/packages/linux-x64',
      manifest: {
        name: '@deepseek-ai/node-addon-landlock-run-linux-x64',
        version: '9.9.9-not-matching',
        publishConfig: { access: 'public' },
        repository: { type: 'git', url: 'git+https://github.com/deepseek-harness/deepseek-harness.git', directory: 'native/landlock-run/packages/linux-x64' },
      },
    })))
    expect(errors.some(e => e.includes('package.json version must match Landlock workspace version'))).toBe(true)
  })
})

describe('checkWorkspace dsh-* family invariants', () => {
  // Baseline: a dsh-* package with all 12 fields + files correctly set.
  const baseline: WorkspaceManifest['manifest'] = {
    name: '@deepseek-ai/dsh-test-pkg',
    version: '0.1.1-rc.2',
    publishConfig: { access: 'public' },
    repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'packages/core/dsh-test-pkg' },
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    exports: {
      '.': {
        types: './lib/types/index.d.ts',
        default: './lib/index.js',
      },
      './invariant': {
        types: './lib/types/invariant.d.ts',
        default: './lib/invariant.js',
      },
    },
    files: ['lib/index.js', 'lib/invariant.js', 'lib/types/**/*.d.ts'],
  }
  const pkgDir = 'packages/core/dsh-test-pkg'

  it('accepts a valid dsh-* member', () => {
    expect(dropExperimentalNoise(checkWorkspace({ dir: pkgDir, manifest: baseline }))).toEqual([])
  })

  it('rejects when @deepseek-ai/cordis is missing from peerDependencies', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baseline, peerDependencies: {} },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: @deepseek-ai/cordis must be a peerDependency')
  })

  it('rejects when @deepseek-ai/cordis is missing from devDependencies', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baseline, devDependencies: {} },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: @deepseek-ai/cordis must also be a devDependency')
  })

  it('rejects when @deepseek-ai/cordis peer and dev ranges diverge', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baseline,
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        devDependencies: { '@deepseek-ai/cordis': 'workspace:*' },
      },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: @deepseek-ai/cordis peer (workspace:^) and dev (workspace:*) ranges must match')
  })

  it('rejects a dsh-* member whose version drifts from the root version', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baseline, version: '0.0.0-mismatch' },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json version must match root version 0.1.1-rc.2')
  })

  it('rejects a dsh-* member without type: module', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baseline, type: 'commonjs' },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json must set "type": "module"')
  })

  it('rejects a dsh-* member with a non-canonical main', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baseline, main: 'lib/wrong.js' },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json must set "main": "lib/index.js"')
  })

  it('rejects a dsh-* member with a non-canonical types', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baseline, types: 'lib/types/wrong.d.ts' },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json must set "types": "lib/types/index.d.ts"')
  })

  it('rejects a dsh-* member whose exports["."].types drifts', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baseline,
        exports: {
          '.': { types: './lib/types/wrong.d.ts', default: './lib/index.js' },
          './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
        },
      },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json exports["."].types must be "./lib/types/index.d.ts"')
  })

  it('rejects a dsh-* member whose exports["."].default drifts', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baseline,
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/wrong.js' },
          './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
        },
      },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json exports["."].default must be "./lib/index.js"')
  })

  it('rejects a dsh-* member whose exports["./invariant"].types points elsewhere', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baseline,
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
          './invariant': { types: './lib/types/wrong.d.ts', default: './lib/invariant.js' },
        },
      },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json exports["./invariant"].types must be "./lib/types/invariant.d.ts"')
  })

  it('rejects a dsh-* member whose exports["./invariant"].default points elsewhere', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baseline,
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
          './invariant': { types: './lib/types/invariant.d.ts', default: './lib/wrong.js' },
        },
      },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json exports["./invariant"].default must be "./lib/invariant.js"')
  })

  it('rejects a dsh-* member whose exports["./invariant"] declares only types or only default', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baseline,
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
          './invariant': { types: './lib/types/invariant.d.ts' },
        },
      },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json exports["./invariant"] must declare both types and default targets')
  })

  it('rejects a dsh-* member whose files diverge from expectedDshPackageFiles', () => {
    const errors = normalizePath(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baseline, files: ['lib/index.js'] },
    })))
    expect(errors).toContain('packages/core/dsh-test-pkg/package.json: @deepseek-ai/dsh-test-pkg: package.json files must be ["lib/index.js","lib/invariant.js","lib/types/**/*.d.ts"]')
  })
})

describe('expectedDshPackageFiles conditional branches', () => {
  const pkgDir = 'packages/core/dsh-test-pkg'
  const baselineWith = (extra: readonly string[]) => ({
    name: '@deepseek-ai/dsh-test-pkg',
    version: '0.1.1-rc.2',
    publishConfig: { access: 'public' },
    repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'packages/core/dsh-test-pkg' },
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
    },
    files: ['lib/index.js', 'lib/invariant.js', ...extra, 'lib/types/**/*.d.ts'],
  })

  it('adds lib/bin.js when the manifest declares a bin field', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: { ...baselineWith(['lib/bin.js']), bin: { 'dsh-test-pkg': 'lib/bin.js' } },
    }))).toEqual([])
  })

  it('adds lib/worker.cjs when exports declare ./worker', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baselineWith(['lib/worker.cjs']),
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
          './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
          './worker': './lib/worker.cjs',
        },
      },
    }))).toEqual([])
  })

  it('adds lib/client.js when exports["./client"].default resolves to ./lib/client.js', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baselineWith(['lib/client.js']),
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
          './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
          './client': './lib/client.js',
        },
      },
    }))).toEqual([])
  })

  it('adds lib/escape.js when exports["./escape"].default is ./lib/escape.js', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baselineWith(['lib/escape.js']),
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
          './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
          './escape': './lib/escape.js',
        },
      },
    }))).toEqual([])
  })

  it('adds dsh.bundle.patch to files when the manifest declares one', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: pkgDir,
      manifest: {
        ...baselineWith(['patches/extra.cjs']),
        dsh: { bundle: { patch: './patches/extra.cjs' } },
      },
    }))).toEqual([])
  })

  it('adds packageFileExtras entries for a known package name', () => {
    expect(dropExperimentalNoise(checkWorkspace({
      dir: 'packages/skill/skill-badge',
      manifest: {
        ...baselineWith(['assets']),
        name: '@deepseek-ai/dsh-skill-badge',
        repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: 'packages/skill/skill-badge' },
      },
    }))).toEqual([])
  })
})
