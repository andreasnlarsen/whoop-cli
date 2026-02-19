import { Command } from 'commander';
import { copyFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getGlobalOptions, printData, printError } from './context.js';
import { usageError } from '../http/errors.js';

const defaultOpenclawHome = (): string => join(homedir(), '.openclaw');

const canRead = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

export const registerOpenClawCommands = (program: Command): void => {
  const openclaw = program.command('openclaw').description('OpenClaw helper commands');

  openclaw
    .command('install-skill')
    .description('Install bundled whoop-cli OpenClaw skill into ~/.openclaw/workspace/skills/whoop-cli')
    .option('--openclaw-home <path>', 'override OpenClaw home directory', defaultOpenclawHome())
    .option('--force', 'overwrite existing SKILL.md if present', false)
    .action(async function installSkillAction(opts) {
      try {
        getGlobalOptions(this);

        const openclawHome = String(opts.openclawHome ?? defaultOpenclawHome());
        const targetDir = join(openclawHome, 'workspace', 'skills', 'whoop-cli');
        const targetFile = join(targetDir, 'SKILL.md');

        const sourceFile = new URL('../../openclaw-skill/SKILL.md', import.meta.url);

        const exists = await canRead(targetFile);
        if (exists && !opts.force) {
          throw usageError('Target skill file already exists. Re-run with --force to overwrite.', {
            targetFile,
          });
        }

        await mkdir(targetDir, { recursive: true });
        await copyFile(sourceFile, targetFile);

        printData(this, {
          installed: true,
          targetFile,
          force: Boolean(opts.force),
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
