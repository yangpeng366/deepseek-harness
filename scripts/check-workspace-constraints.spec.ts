/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkRepositoryVersion,
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
