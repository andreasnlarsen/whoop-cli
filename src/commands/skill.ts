import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Command } from 'commander';
import { usageError } from '../http/errors.js';
import { getGlobalOptions, printData, printError } from './context.js';

const SKILL_NAME = 'whoop-cli';

type SkillInstallTarget = 'agents' | 'openclaw' | 'path';

interface SkillInstallOptions {
  target?: string;
  skillDir?: string;
  agentsHome?: string;
  codexHome?: string;
  openclawHome?: string;
  force?: boolean;
  sourceFile?: string | URL;
}

interface SkillInstallResult {
  installed: true;
  target: SkillInstallTarget;
  targetDir: string;
  targetFile: string;
  codexSymlink?: string;
  force: boolean;
}

const defaultAgentsHome = (): string => join(homedir(), '.agents');
const defaultCodexHome = (): string => join(homedir(), '.codex');
const defaultOpenclawHome = (): string => join(homedir(), '.openclaw');

const expandHomePath = (path: string): string => {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
};

const absolutePath = (path: string): string => {
  const expanded = expandHomePath(path);
  return isAbsolute(expanded) ? expanded : resolve(expanded);
};

const canRead = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const parseInstallTarget = (target: string | undefined): SkillInstallTarget => {
  const normalized = (target ?? 'agents').toLowerCase();
  if (normalized === 'agents' || normalized === 'openclaw' || normalized === 'path') {
    return normalized;
  }

  throw usageError('Unsupported skill install target. Use agents, openclaw, or path.', {
    target,
  });
};

const targetDirectory = (
  target: SkillInstallTarget,
  opts: SkillInstallOptions,
): string => {
  if (target === 'agents') {
    return join(absolutePath(opts.agentsHome ?? defaultAgentsHome()), 'skills', SKILL_NAME);
  }

  if (target === 'openclaw') {
    return join(
      absolutePath(opts.openclawHome ?? defaultOpenclawHome()),
      'workspace',
      'skills',
      SKILL_NAME,
    );
  }

  if (!opts.skillDir) {
    throw usageError('--skill-dir is required when --target path is used.');
  }

  return absolutePath(opts.skillDir);
};

const installSkillFile = async (
  sourceFile: string | URL,
  targetDir: string,
  force: boolean,
): Promise<string> => {
  const targetFile = join(targetDir, 'SKILL.md');
  const exists = await canRead(targetFile);
  if (exists && !force) {
    throw usageError('Target skill file already exists. Re-run with --force to overwrite.', {
      targetFile,
    });
  }

  await mkdir(targetDir, { recursive: true });
  await copyFile(sourceFile, targetFile);
  return targetFile;
};

const ensureCodexSkillSymlink = async (
  targetDir: string,
  codexHome: string,
  force: boolean,
): Promise<string> => {
  const codexSkillsDir = join(absolutePath(codexHome), 'skills');
  const linkPath = join(codexSkillsDir, SKILL_NAME);
  await mkdir(codexSkillsDir, { recursive: true });

  try {
    const stat = await lstat(linkPath);
    if (stat.isSymbolicLink()) {
      const currentTarget = await readlink(linkPath);
      const resolvedTarget = isAbsolute(currentTarget)
        ? currentTarget
        : resolve(codexSkillsDir, currentTarget);
      if (resolvedTarget === targetDir) {
        return linkPath;
      }
    }

    if (!force) {
      throw usageError('Codex skill entry already exists. Re-run with --force to replace it.', {
        linkPath,
      });
    }

    await rm(linkPath, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  await symlink(targetDir, linkPath, 'dir');
  return linkPath;
};

export const installBundledSkill = async (
  opts: SkillInstallOptions,
): Promise<SkillInstallResult> => {
  const target = parseInstallTarget(opts.target);
  const force = Boolean(opts.force);
  const targetDir = targetDirectory(target, opts);
  const sourceFile = opts.sourceFile ?? new URL('../../agent-skill/SKILL.md', import.meta.url);
  const targetFile = await installSkillFile(sourceFile, targetDir, force);
  const codexSymlink = target === 'agents'
    ? await ensureCodexSkillSymlink(targetDir, opts.codexHome ?? defaultCodexHome(), force)
    : undefined;

  return {
    installed: true,
    target,
    targetDir,
    targetFile,
    codexSymlink,
    force,
  };
};

export const registerSkillCommands = (program: Command): void => {
  const skill = program.command('skill').description('Agent skill helper commands');

  skill
    .command('install')
    .description('Install the bundled whoop-cli agent skill')
    .option('--target <target>', 'install target: agents, openclaw, or path', 'agents')
    .option('--skill-dir <path>', 'target directory when --target path is used')
    .option('--agents-home <path>', 'override agents home directory', defaultAgentsHome())
    .option('--codex-home <path>', 'override Codex home directory for the agents symlink', defaultCodexHome())
    .option('--openclaw-home <path>', 'override OpenClaw home directory', defaultOpenclawHome())
    .option('--force', 'overwrite existing skill files or symlink if present', false)
    .action(async function installSkillAction(opts) {
      try {
        getGlobalOptions(this);
        const result = await installBundledSkill({
          target: opts.target,
          skillDir: opts.skillDir,
          agentsHome: opts.agentsHome,
          codexHome: opts.codexHome,
          openclawHome: opts.openclawHome,
          force: opts.force,
        });

        printData(this, result);
      } catch (err) {
        printError(this, err);
      }
    });
};
