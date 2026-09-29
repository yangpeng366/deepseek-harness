import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProjectReferenceFaceViolations } from './project-reference-faces.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function workspaceFixture(options: {
  readonly host: readonly string[]
  readonly client: readonly string[]
}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-project-reference-faces-'))
  roots.push(root)
  const shared = join(root, 'packages/core/shared')
  const split = join(root, 'packages/api/split')
  mkdirSync(shared, { recursive: true })
  mkdirSync(split, { recursive: true })
  writeJson(join(root, 'tsconfig.base.json'), {})
  writeJson(join(root, 'tsconfig.base.client.json'), { extends: './tsconfig.base.json' })
  writeJson(join(shared, 'package.json'), { name: '@deepseek-ai/dsh-shared' })
  writeJson(join(shared, 'tsconfig.json'), {
    extends: '../../../tsconfig.base.json',
    references: [],
  })
  writeJson(join(split, 'package.json'), { name: '@deepseek-ai/dsh-split' })
  writeJson(join(split, 'tsconfig.json'), {
    files: [],
    references: [{ path: './tsconfig.host.json' }, { path: './tsconfig.client.json' }],
  })
  writeJson(join(split, 'tsconfig.host.json'), { references: [{ path: '../../core/shared' }] })
  writeJson(join(split, 'tsconfig.client.json'), { references: [{ path: '../../core/shared' }] })
  writeJson(join(root, 'tsconfig.host.json'), {
    references: options.host.map(path => ({ path })),
  })
  writeJson(join(root, 'tsconfig.client.json'), {
    references: options.client.map(path => ({ path })),
  })
  return root
}

describe('Project Reference compiler faces', () => {
  it('allows neutral projects in either graph and matching split leaves', () => {
    const root = workspaceFixture({
      host: ['./packages/core/shared', './packages/api/split/tsconfig.host.json'],
      client: ['./packages/core/shared', './packages/api/split/tsconfig.client.json'],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([])
  })

  it('rejects the opposite leaf and the solution root of a split project', () => {
    const root = workspaceFixture({
      host: [
        './packages/api/split/tsconfig.host.json',
        './packages/api/split/tsconfig.client.json',
      ],
      client: ['./packages/api/split'],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'tsconfig.client.json: Project Reference "./packages/api/split" enters split project packages/api/split from a Client config; reference "packages/api/split/tsconfig.client.json" instead',
      'tsconfig.host.json: Project Reference "./packages/api/split/tsconfig.client.json" enters split project packages/api/split from a Host config; reference "packages/api/split/tsconfig.host.json" instead',
    ])
  })

  it('uses the referencing project face throughout the reachable graph', () => {
    const root = workspaceFixture({
      host: ['./packages/core/host-consumer'],
      client: ['./packages/core/client-consumer'],
    })
    const hostConsumer = join(root, 'packages/core/host-consumer')
    mkdirSync(hostConsumer, { recursive: true })
    writeJson(join(hostConsumer, 'package.json'), { name: '@deepseek-ai/dsh-host-consumer' })
    writeJson(join(hostConsumer, 'tsconfig.json'), {
      extends: '../../../tsconfig.base.json',
      references: [{ path: '../../api/split/tsconfig.client.json' }],
    })
    const clientConsumer = join(root, 'packages/core/client-consumer')
    mkdirSync(clientConsumer, { recursive: true })
    writeJson(join(clientConsumer, 'package.json'), { name: '@deepseek-ai/dsh-client-consumer' })
    writeJson(join(clientConsumer, 'tsconfig.json'), {
      extends: '../../../tsconfig.base.client.json',
      references: [{ path: '../../api/split/tsconfig.host.json' }],
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'packages/core/client-consumer/tsconfig.json: Project Reference "../../api/split/tsconfig.host.json" enters split project packages/api/split from a Client config; reference "packages/api/split/tsconfig.client.json" instead',
      'packages/core/host-consumer/tsconfig.json: Project Reference "../../api/split/tsconfig.client.json" enters split project packages/api/split from a Host config; reference "packages/api/split/tsconfig.host.json" instead',
    ])
  })

  it('pins silent-skip of packages that declare only one of the two face configs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-half-split-'))
    roots.push(root)
    const split = join(root, 'packages/api/half-split')
    mkdirSync(split, { recursive: true })
    writeJson(join(split, 'package.json'), { name: '@deepseek-ai/dsh-half-split' })
    writeJson(join(split, 'tsconfig.json'), { files: [] })
    writeJson(join(split, 'tsconfig.host.json'), { references: [] })
    writeJson(join(root, 'tsconfig.host.json'), {
      references: [{ path: './packages/api/half-split' }],
    })
    writeJson(join(root, 'tsconfig.client.json'), { references: [] })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([])
  })

  it('tolerates extends cycles when resolving the referencing face', () => {
    const root = workspaceFixture({
      host: ['./packages/core/cyclic-consumer'],
      client: [],
    })
    const cyclicDir = join(root, 'packages/core/cyclic-consumer')
    mkdirSync(cyclicDir, { recursive: true })
    writeJson(join(cyclicDir, 'package.json'), { name: '@deepseek-ai/dsh-cyclic-consumer' })
    writeJson(join(cyclicDir, 'tsconfig.json'), {
      extends: './tsconfig.cycle-a.json',
      references: [{ path: '../../api/split/tsconfig.host.json' }],
    })
    writeJson(join(cyclicDir, 'tsconfig.cycle-a.json'), {
      extends: './tsconfig.cycle-b.json',
    })
    writeJson(join(cyclicDir, 'tsconfig.cycle-b.json'), {
      extends: './tsconfig.cycle-a.json',
    })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'packages/core/cyclic-consumer/tsconfig.json: Project Reference "../../api/split/tsconfig.host.json" enters split project packages/api/split from a config with no Host/Client face',
    ])
  })

  it('tolerates extends self-cycles when resolving the referencing face', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-self-cycle-'))
    roots.push(root)
    const split = join(root, 'packages/api/split')
    mkdirSync(split, { recursive: true })
    writeJson(join(split, 'package.json'), { name: '@deepseek-ai/dsh-split' })
    writeJson(join(split, 'tsconfig.json'), { files: [] })
    writeJson(join(split, 'tsconfig.host.json'), { references: [] })
    writeJson(join(split, 'tsconfig.client.json'), { references: [] })
    const cyclicDir = join(root, 'packages/core/self-cycle-consumer')
    mkdirSync(cyclicDir, { recursive: true })
    writeJson(join(cyclicDir, 'package.json'), { name: '@deepseek-ai/dsh-self-cycle-consumer' })
    writeJson(join(cyclicDir, 'tsconfig.json'), {
      extends: './tsconfig.self.json',
      references: [{ path: '../../api/split/tsconfig.host.json' }],
    })
    writeJson(join(cyclicDir, 'tsconfig.self.json'), {
      extends: './tsconfig.self.json',
    })
    writeJson(join(root, 'tsconfig.host.json'), {
      references: [{ path: './packages/core/self-cycle-consumer' }],
    })
    writeJson(join(root, 'tsconfig.client.json'), { references: [] })

    expect(collectProjectReferenceFaceViolations(root)).toEqual([
      'packages/core/self-cycle-consumer/tsconfig.json: Project Reference "../../api/split/tsconfig.host.json" enters split project packages/api/split from a config with no Host/Client face',
    ])
  })
})
