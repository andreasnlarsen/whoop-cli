import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBundledSkill } from '../src/commands/skill.js';

const withTempDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'whoop-skill-install-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('installBundledSkill installs to ~/.agents and links Codex discovery path', async () => {
  await withTempDir(async (dir) => {
    const sourceFile = join(dir, 'source.SKILL.md');
    const agentsHome = join(dir, '.agents');
    const codexHome = join(dir, '.codex');
    await writeFile(sourceFile, '# whoop skill\n', 'utf8');

    const result = await installBundledSkill({
      target: 'agents',
      agentsHome,
      codexHome,
      sourceFile,
    });

    assert.equal(result.target, 'agents');
    assert.equal(result.targetFile, join(agentsHome, 'skills', 'whoop-cli', 'SKILL.md'));
    assert.equal(
      await readFile(join(agentsHome, 'skills', 'whoop-cli', 'SKILL.md'), 'utf8'),
      '# whoop skill\n',
    );
    assert.equal(
      await readlink(join(codexHome, 'skills', 'whoop-cli')),
      join(agentsHome, 'skills', 'whoop-cli'),
    );
  });
});

test('installBundledSkill installs to OpenClaw target when requested', async () => {
  await withTempDir(async (dir) => {
    const sourceFile = join(dir, 'source.SKILL.md');
    const openclawHome = join(dir, '.openclaw');
    await writeFile(sourceFile, '# whoop skill\n', 'utf8');

    const result = await installBundledSkill({
      target: 'openclaw',
      openclawHome,
      sourceFile,
    });

    assert.equal(result.target, 'openclaw');
    assert.equal(
      result.targetFile,
      join(openclawHome, 'workspace', 'skills', 'whoop-cli', 'SKILL.md'),
    );
    assert.equal(
      await readFile(join(openclawHome, 'workspace', 'skills', 'whoop-cli', 'SKILL.md'), 'utf8'),
      '# whoop skill\n',
    );
    assert.equal(result.codexSymlink, undefined);
  });
});

test('installBundledSkill rejects accidental overwrite without --force', async () => {
  await withTempDir(async (dir) => {
    const sourceFile = join(dir, 'source.SKILL.md');
    const agentsHome = join(dir, '.agents');
    const codexHome = join(dir, '.codex');
    await writeFile(sourceFile, '# whoop skill\n', 'utf8');
    await installBundledSkill({ target: 'agents', agentsHome, codexHome, sourceFile });

    await assert.rejects(
      () => installBundledSkill({ target: 'agents', agentsHome, codexHome, sourceFile }),
      /Target skill file already exists/,
    );
  });
});

test('installBundledSkill installs to explicit skill directory', async () => {
  await withTempDir(async (dir) => {
    const sourceFile = join(dir, 'source.SKILL.md');
    const skillDir = join(dir, 'custom-skills', 'whoop-cli');
    await writeFile(sourceFile, '# whoop skill\n', 'utf8');

    const result = await installBundledSkill({
      target: 'path',
      skillDir,
      sourceFile,
    });

    assert.equal(result.target, 'path');
    assert.equal(result.targetFile, join(skillDir, 'SKILL.md'));
    assert.equal(await readFile(join(skillDir, 'SKILL.md'), 'utf8'), '# whoop skill\n');
  });
});
