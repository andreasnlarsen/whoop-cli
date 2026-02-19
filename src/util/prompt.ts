import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const ask = async (question: string): Promise<string> => {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer;
  } finally {
    rl.close();
  }
};
