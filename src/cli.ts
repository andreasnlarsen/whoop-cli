import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerProfileCommands } from './commands/profile.js';
import { registerRecoveryCommands } from './commands/recovery.js';
import { registerSleepCommands } from './commands/sleep.js';
import { registerCycleCommands } from './commands/cycle.js';
import { registerSummaryCommands } from './commands/summary.js';
import { registerHealthCommands } from './commands/health.js';
import { registerSyncCommands } from './commands/sync.js';
import { registerWebhookCommands } from './commands/webhook.js';
import { registerBehaviorCommands } from './commands/behavior.js';
import { registerExperimentCommands } from './commands/experiment.js';
import { registerActivityCommands } from './commands/activity.js';
import { registerOpenClawCommands } from './commands/openclaw.js';

export const program = new Command()
  .name('whoop')
  .description('WHOOP CLI for human + agent workflows')
  .option('--json', 'Output JSON envelope', false)
  .option('--pretty', 'Pretty print JSON', false)
  .option('--profile <name>', 'Profile name', 'default')
  .option('--base-url <url>', 'WHOOP API base URL', 'https://api.prod.whoop.com')
  .option('--timeout-ms <n>', 'HTTP timeout in ms', '10000');

registerAuthCommands(program);
registerProfileCommands(program);
registerRecoveryCommands(program);
registerSleepCommands(program);
registerCycleCommands(program);
registerSummaryCommands(program);
registerHealthCommands(program);
registerSyncCommands(program);
registerWebhookCommands(program);
registerBehaviorCommands(program);
registerExperimentCommands(program);
registerActivityCommands(program);
registerOpenClawCommands(program);
