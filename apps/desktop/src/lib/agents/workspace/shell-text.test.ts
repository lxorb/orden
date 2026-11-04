import { describe, expect, test } from 'vitest'
import { onTheList, plainOf, programOf, startsOnlyOne } from './shell-text'

const ESC = String.fromCharCode(27)
const BELL = String.fromCharCode(7)

describe('the program a command starts', () => {
  test('is the first word, in lower case', () => {
    expect(programOf('git status --short')).toBe('git')
    expect(programOf('  Git status')).toBe('git')
    expect(programOf('node build.mjs')).toBe('node')
  })

  test('is the only one a line starts, or the line is not let through for it', () => {
    expect(startsOnlyOne('git status --short')).toBe(true)
    for (const line of [
      'git status; rm -rf ~',
      'git log && curl x',
      'git log || curl x',
      'git log | sh',
      'git log & calc',
      'git log > ~/.bashrc',
      'git log $(whoami)',
      'git log `whoami`',
    ]) {
      expect(startsOnlyOne(line), line).toBe(false)
    }
  })
})

describe('what a terminal printed', () => {
  test('comes back as its words, the colours, titles and carriage returns taken out', () => {
    const printed = `${ESC}]0;title${BELL}${ESC}[32mok${ESC}[0m\r\nnext ${ESC}[2K${ESC}]8;;x${ESC}\\line\tend\r\n`
    expect(plainOf(printed)).toBe('ok\nnext line\tend\n')
  })
})

describe('what actually runs', () => {
  test('a word with a folder, an ending or a quote is no program on a list', () => {
    for (const line of [
      '/tmp/x/git.sh',
      './git status',
      '../git',
      '~/git',
      'C:\\tools\\git.exe log',
      '"C:\\Program Files\\Git\\bin\\git.exe" log',
      "'git' status",
      '"git"/../../bin/sh',
      '\\git status',
      'git.sh',
      'git.exe status',
      'git$IFS-x',
      'FOO=1 git status',
    ]) {
      expect(['git'], line).not.toContain(programOf(line))
    }
  })

  test('a line with a control character starts more than it says', () => {
    for (const line of [
      'git \u0015touch pwned',
      'git status \u000ftouch x',
      'git status\u0008\u0008touch x',
      'git status\u007f\u007ftouch x',
      'git status\ttouch',
      'git \u001b[Atouch',
      'git status\u0085touch',
      'git status\u2028touch',
    ]) {
      expect(startsOnlyOne(line), JSON.stringify(line)).toBe(false)
    }
  })

  test('nor does history or a subexpression run under the first word', () => {
    for (const line of ['git !!', 'git !-1', 'git (rm x)']) {
      expect(startsOnlyOne(line), line).toBe(false)
    }
  })
})

describe('what a listed program is told to run', () => {
  test('git’s config, exec and output options ask', () => {
    for (const line of [
      'git -c core.fsmonitor="touch x" status',
      'git -p -c core.pager=touch status',
      'git --paginate log',
      'git -C /tmp/x status',
      'git --config-env=core.pager=X log',
      'git --exec-path=/tmp/x status',
      'git --git-dir=/tmp/x/.git status',
      'git --work-tree=/tmp/x status',
      'git log --output=/home/me/.bashrc',
      'git log --outp=/home/me/.bashrc',
      'git diff --ext-diff',
      'git fetch --upload-pack=touch origin',
      'git rebase -x touch',
      'git rebase --exec=touch',
      'git grep -Ovim x',
      'git grep --open-files-in-pager=touch x',
      'git difftool -x touch',
      'git config core.pager touch',
      'git submodule foreach touch',
      'git bisect run touch',
      'git "-c" core.pager=touch log',
      "git -'c' core.pager=touch log",
      'git --out""put=x log',
      'git -\\c core.pager=touch log',
    ]) {
      expect(onTheList(line, ['git']), line).toBe(false)
    }
  })

  test('npm and its kind ask before they fetch and run', () => {
    for (const [line, program] of [
      ['npm exec touch', 'npm'],
      ['npm x touch', 'npm'],
      ['npm explore x', 'npm'],
      ['npm test --script-shell=/tmp/x', 'npm'],
      ['npx touch', 'npx'],
      ['pnpm dlx touch', 'pnpm'],
      ['pnpm exec touch', 'pnpm'],
      ['pnpx touch', 'pnpx'],
      ['yarn dlx touch', 'yarn'],
      ['bunx touch', 'bunx'],
    ] as const) {
      expect(onTheList(line, [program]), line).toBe(false)
    }
  })

  test('what they do every day goes', () => {
    for (const [line, program] of [
      ['git status --short', 'git'],
      ['git log --oneline -5', 'git'],
      ['git diff HEAD~1 -- src/a.ts', 'git'],
      ['git commit -m fix', 'git'],
      ['npm test', 'npm'],
      ['pnpm run build', 'pnpm'],
    ] as const) {
      expect(onTheList(line, [program]), line).toBe(true)
    }
  })

  test('expansion that builds an option under the first word asks', () => {
    for (const line of [
      'git @{a=calc}',
      'git {-c,core.pager=touch} log',
      'git x$IFS-c',
      'git $X',
      'git log *',
      'git log ?c',
      'git log [-]c',
    ]) {
      expect(startsOnlyOne(line), line).toBe(false)
    }
  })
})

describe('an option in front of the command', () => {
  const listed = ['git', 'npm', 'pnpm', 'yarn', 'bun']

  test.each([
    'git --namespace x config core.sshCommand "touch pwned"',
    'git --namespace=x status',
    'npm --prefix . exec -c "touch pwned"',
    'pnpm --dir . exec touch pwned',
    'pnpm -C . dlx cowsay',
    'yarn --cwd . exec touch pwned',
    'bun --cwd . x cowsay',
    'git -- config core.sshCommand x',
  ])('hides nothing: %s goes to the question', (line) => {
    expect(onTheList(line, listed)).toBe(false)
  })

  test.each([
    'git --no-pager log',
    'git -P status',
    'git --version',
    'git status',
    'git log --oneline',
    'npm --version',
    'npm ci',
    'npm --silent ci',
    'pnpm test',
  ])('one that takes no value stays out of the way: %s', (line) => {
    expect(onTheList(line, listed)).toBe(true)
  })

  test.each([
    'git clone -u ./x repo',
    'git clone -q -u ./x repo',
    'git clone -qu ./x repo',
    'git clone -u./x repo',
    'git archive -o out.tar HEAD',
    'git archive HEAD -o../out.tar',
    'bun -e "1"',
    'bun --eval 1',
    'bun --print 1',
    'bun run -e 1',
  ])('a short name for what is on the list goes too: %s', (line) => {
    expect(onTheList(line, listed)).toBe(false)
  })

  test.each(['git push -u origin main', 'git add -u', 'git status'])(
    "another command's own letter is that command's: %s",
    (line) => {
      expect(onTheList(line, listed)).toBe(true)
    },
  )
})

describe('git, by what is known to be free', () => {
  test.each([
    'git clone -ccore.sshCommand=./pwn.sh https://x/y',
    'git rebase -x./pwn.sh',
    'git rebase -ix ./pwn.sh',
    'git rebase -i',
    'git clone --template=./t https://x/y',
    'git init --template=./t',
    'git clone --templ=./t https://x/y',
    'git log -Ox',
    'git log --unknown-option',
    'git fetch --upload-pac=x',
    'git status -zq',
    'git somethingnew',
    'git commit -vF ./x',
  ])('asks: %s', (line) => {
    expect(onTheList(line, ['git'])).toBe(false)
  })

  test.each([
    'git status -sb',
    'git status --short --branch',
    'git log --oneline --graph -20 main',
    'git log -n5 --format=%h',
    'git log -n 5',
    'git log -p',
    'git diff --stat HEAD~1',
    'git diff --cached',
    'git show HEAD:a.md',
    'git commit -am fix',
    'git commit -m"fix"',
    'git commit --amend --no-edit',
    'git add -A',
    'git add .',
    'git push -u origin main',
    'git push --force-with-lease',
    'git pull --rebase',
    'git fetch --all --prune',
    'git checkout -b fix',
    'git switch -c fix',
    'git branch -vv',
    'git merge --no-ff x',
    'git rebase main',
    'git rebase --continue',
    'git clone --depth 1 https://x/y',
    'git clone --depth=1 -b main https://x/y',
    'git init -b main',
    'git stash pop',
    'git rev-parse --abbrev-ref HEAD',
    'git log -- -x',
  ])('goes: %s', (line) => {
    expect(onTheList(line, ['git'])).toBe(true)
  })
})

describe('the options a package manager takes in front of its command', () => {
  const listed = ['npm', 'pnpm', 'yarn', 'bun']

  test.each([
    'pnpm --filter web build',
    'pnpm --filter=web build',
    'pnpm -F web test',
    'pnpm -r test',
    'pnpm --recursive test',
    'pnpm -C apps/web build',
    'npm --prefix x run b',
    'npm -w web test',
    'npm --workspace=web test',
    'yarn --cwd x build',
    'yarn workspace web build',
    'bun --cwd x test',
  ])('walks past them: %s', (line) => {
    expect(onTheList(line, listed)).toBe(true)
  })

  test.each([
    'pnpm --filter web exec touch x',
    'pnpm -r exec touch x',
    'pnpm --filter=web dlx x',
    'npm --prefix x exec y',
    'pnpm --unknown web build',
    'npm --prefix',
    'bun -e1',
    'bun -pe1',
  ])('sees the command behind them: %s', (line) => {
    expect(onTheList(line, listed)).toBe(false)
  })
})

describe('a package manager, by what is known to be free', () => {
  const listed = ['npm', 'pnpm', 'yarn', 'bun']

  test.each([
    "npm exe -c 'touch pwned'",
    'npm ex touch',
    'npm explor x',
    'npm cre x',
    'npm ini x',
    'npm config set script-shell ./sh.sh --location=project',
    'npm set script-shell ./sh.sh',
    'npm set-script t x',
    'npm pkg set scripts.t=x',
    'npm somethingnew',
    'npm test --userconfig=./npmrc',
    'npm run t --shell=./sh',
    'npm help x --viewer=./pwn',
    'npm install --git=./pwn x',
    'bun exec touch',
    'bun touch pwned',
    'bun ./pwn.ts',
    'bun run touch pwned',
    'bun run ./pwn.ts',
    'bun pm pkg set scripts.t=x',
    'bun build ./a.ts --outfile=./b',
    'bun test --preload=./pwn.ts',
    'pnpm recursive exec touch pwned',
    'pnpm multi exec touch pwned',
    'pnpm m exec touch pwned',
    'pnpm r exec touch pwned',
    'pnpm touch pwned',
    'pnpm --filter web touch pwned',
    'pnpm config set script-shell ./sh.sh',
    'pnpm test --config.script-shell=./sh.sh',
    'pnpm run t --shell-mode',
    'yarn touch pwned',
    'yarn config set scriptShell ./sh.sh',
    'yarn workspace web touch pwned',
    'yarn workspace web exec touch',
    'yarn workspace',
  ])('asks: %s', (line) => {
    expect(onTheList(line, listed)).toBe(false)
  })

  test.each([
    'npm',
    'npm i',
    'npm install',
    'npm i -D vitest',
    'npm install --save-dev vitest',
    'npm ci --omit=dev',
    'npm run build',
    'npm run build --if-present',
    'npm run test -- --watch',
    'npm t',
    'npm start',
    'npm ls --depth=0',
    'npm audit --json',
    'npm outdated',
    'npm view svelte version',
    'npm uninstall x',
    'npm update',
    'pnpm',
    'pnpm i --frozen-lockfile',
    'pnpm add -D vitest',
    'pnpm remove x',
    'pnpm build',
    'pnpm dev',
    'pnpm lint',
    'pnpm check',
    'pnpm run anything',
    'pnpm -r test',
    'pnpm --filter web test -- -t name',
    'pnpm list --depth 0',
    'yarn',
    'yarn install --immutable',
    'yarn add -D x',
    'yarn run anything',
    'yarn build',
    'yarn workspace web build',
    'bun i',
    'bun install --frozen-lockfile',
    'bun add -d x',
    'bun test',
    'bun run build',
    'bun run dev',
    'bun build ./a.ts',
  ])('goes: %s', (line) => {
    expect(onTheList(line, listed)).toBe(true)
  })
})

describe('a line as the shell hands it over', () => {
  const listed = ['git', 'npm', 'pnpm', 'yarn', 'bun']

  test.each([
    'npm --prefix "./ run /.." exec -- touch pwn',
    'npm --prefix "./ run /.." publish',
    'npm --prefix "./ run /.." config set script-shell ./sh.sh',
    'npm --prefix "./ run /.." pkg set scripts.t=x',
    "npm --prefix './ run /..' exec touch pwn",
    'pnpm --filter "./ run /.." exec touch pwn',
    'pnpm --dir "x run y" exec touch z',
    'pnpm --dir ./\\ run\\ /.. exec touch z',
    'bun --cwd "./ test /.." ./e.js',
    'yarn --cwd "./ test /.." exec touch z',
    // A shell with no such quoting reads these the other way round.
    'npm --prefix a\\ exec test',
    'npm --prefix "a b" test',
    // A quote never closed runs nothing it says.
    'npm test "',
    "git log '",
    'git "log',
    'git -c"core.pager=touch" log',
    'git --"exec-path"=x status',
    'git log --"output"=x',
    'npm t --"shell"=x',
  ])('asks: %s', (line) => {
    expect(onTheList(line, listed)).toBe(false)
  })

  test.each([
    'git commit -m "fix two words"',
    "git commit -m 'fix two words'",
    'git log --format="%h %s"',
    'git log --grep "a -c word"',
    'git diff -- "a file.md"',
    'npm run build -- --title "two words"',
    'pnpm --filter web test -- -t "a name with words"',
    'npm install "lodash"',
  ])('goes: %s', (line) => {
    expect(onTheList(line, listed)).toBe(true)
  })
})

describe('a bare name that may be on the path', () => {
  const listed = ['npm', 'pnpm', 'yarn', 'bun']

  test.each([
    "pnpm watch 'touch pwn'",
    "bun run watch 'touch pwn'",
    "yarn watch 'touch pwn'",
    'pnpm watch',
    'bun run watch',
    'pnpm format D:',
    'bun run format D:',
    'pnpm check x',
    'bun dev ./x',
    'pnpm tsc --project=./x',
    'pnpm vitest --config=./x',
    'npm --prefix "a b" run t',
    'pnpm eslint --rulesdir=./x .',
  ])('asks: %s', (line) => {
    expect(onTheList(line, listed)).toBe(false)
  })

  test.each([
    'bun run test:unit',
    'bun run db:migrate',
    'bun run build',
    'bun dev',
    'bun start',
    'bun db:migrate',
    'pnpm test:unit',
    'pnpm build:web',
    'yarn test:unit',
    'pnpm tsc',
    'pnpm tsc --noEmit',
    'pnpm vitest run',
    'pnpm vitest run src/a.test.ts',
    'pnpm eslint .',
    'pnpm eslint . --fix',
    'pnpm prettier --check .',
    'yarn jest',
    'pnpm test src/a.test.ts',
    'npm test --loglevel=error',
    'npm install --save-prod lodash',
    'npm install --ignore-scripts',
    'npm ci --ignore-scripts',
    'pnpm install --ignore-scripts',
    'bun install --ignore-scripts',
  ])('goes: %s', (line) => {
    expect(onTheList(line, listed)).toBe(true)
  })
})

describe('a space the shell does not split on', () => {
  const listed = ['git', 'npm', 'pnpm', 'yarn', 'bun']

  test.each([
    'npm --prefix ./\u00a0run\u00a0/.. exec touch pwn',
    'npm --prefix ./\u2003run\u2003/.. exec touch pwn',
    'pnpm --dir ./\u00a0run\u00a0/.. exec touch pwn',
    'pnpm --filter ./\u00a0run\u00a0/.. exec touch pwn',
    'bun --cwd ./\u00a0test\u00a0/.. ./e.js',
    'npm\u00a0exec touch',
    'git log\u00a0-c',
  ])('is no space, and asks: %j', (line) => {
    expect(onTheList(line, listed) && startsOnlyOne(line)).toBe(false)
  })

  test('a tab and a space still part words', () => {
    expect(onTheList('git  status', listed)).toBe(true)
  })
})

describe('a colon name that is a file', () => {
  const listed = ['pnpm', 'yarn', 'bun']

  test.each(['bun a:b.js', 'bun run a:b.js', 'pnpm a:b.js', 'yarn a:b.js'])('asks: %s', (line) => {
    expect(onTheList(line, listed)).toBe(false)
  })

  test.each(['bun run test:unit', 'bun db:migrate', 'pnpm build:web'])('goes: %s', (line) => {
    expect(onTheList(line, listed)).toBe(true)
  })
})
