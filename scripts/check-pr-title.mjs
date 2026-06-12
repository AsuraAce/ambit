import process from 'node:process';

const title = process.argv.slice(2).join(' ').trim();
const conventionalTitle =
  /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9][a-z0-9._/-]*\))?!?: \S.*$/;

if (!title) {
  console.error('Usage: pnpm check:pr-title -- "<pull request title>"');
  process.exit(2);
}

if (!conventionalTitle.test(title)) {
  console.error(`Invalid pull request title: ${title}`);
  console.error('Expected a Conventional Commit title such as "feat: add viewer zoom" or "fix(ui)!: remove legacy mode".');
  process.exit(1);
}

console.log(`Pull request title is valid: ${title}`);
