import { Command } from 'commander';

export const program = new Command()
  .name('whoop')
  .description('WHOOP CLI (scaffold)')
  .option('--json', 'Output JSON envelope', false)
  .option('--profile <name>', 'Profile name', 'default')
  .option('--base-url <url>', 'WHOOP API base URL', 'https://api.prod.whoop.com')
  .option('--timeout-ms <n>', 'HTTP timeout in ms', '10000');

program
  .command('auth')
  .description('Authentication commands')
  .command('status')
  .description('Show auth status (scaffold)')
  .action(() => {
    console.log('auth status: scaffold');
  });

program
  .command('recovery')
  .description('Recovery commands')
  .command('latest')
  .description('Fetch latest recovery (scaffold)')
  .action(() => {
    console.log('recovery latest: scaffold');
  });
