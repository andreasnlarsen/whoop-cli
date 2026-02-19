import { Command } from 'commander';
import { WhoopApiClient } from '../http/client.js';
import { getGlobalOptions, printData, printError } from './context.js';

export const registerProfileCommands = (program: Command): void => {
  const profile = program.command('profile').description('Profile and body measurements');

  profile
    .command('show')
    .description('Show basic WHOOP profile + body measurements')
    .action(async function showAction() {
      try {
        const globals = getGlobalOptions(this);
        const client = new WhoopApiClient(globals.profile);

        const [basic, body] = await Promise.all([
          client.requestJson<Record<string, unknown>>({
            path: '/developer/v2/user/profile/basic',
            timeoutMs: globals.timeoutMs,
          }),
          client.requestJson<Record<string, unknown>>({
            path: '/developer/v2/user/measurement/body',
            timeoutMs: globals.timeoutMs,
          }),
        ]);

        printData(this, {
          profile: basic,
          body,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
