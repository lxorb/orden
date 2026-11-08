import { describe, expect, test } from 'vitest'
import { onTheList, plainOf, programOf, startsOnlyOne, Tail } from './shell-text'

function onBoth(command: string, programs: readonly string[]): boolean | string {
  const windows = onTheList(command, programs, 'windows')
  const unix = onTheList(command, programs, 'unix')
  return windows === unix ? windows : `windows ${windows}, unix ${unix}`
}

const ESC = String.fromCharCode(27)
const BELL = String.fromCharCode(7)

describe('the program a command starts', () => {
  test('is the first word: on Windows in lower case, elsewhere as it is', () => {
    for (const os of ['windows', 'unix'] as const) {
      expect(programOf('git status --short', os)).toBe('git')
      expect(programOf('node build.mjs', os)).toBe('node')
    }
    expect(programOf('  Git status', 'windows')).toBe('git')
    expect(programOf('  Git status', 'unix')).toBe('Git')
  })

  test('is on the list only named bare, never by a path that happens to end in it', () => {
    const programs = ['git', 'Node']
    expect(onBoth('git status', programs)).toBe(true)
    expect(onBoth('npm test', programs)).toBe(false)
    expect(onTheList('GIT.exe log', programs, 'windows')).toBe(true)
    expect(onTheList('node build.mjs', programs, 'windows')).toBe(true)
    expect(onTheList('GIT.exe log', programs, 'unix')).toBe(false)
    expect(onTheList('node build.mjs', programs, 'unix')).toBe(false)
    expect(onTheList('Node build.mjs', programs, 'unix')).toBe(true)
    for (const line of [
      '/tmp/x/git status',
      './git status',
      'bin/git status',
      '~/bin/git status',
      '"C:\\Users\\me\\Downloads\\git.exe" status',
      '..\\git status',
      'PATH=/tmp/x git status',
      'GIT_SSH_COMMAND=evil git fetch',
    ]) {
      expect(onBoth(line, programs), line).toBe(false)
    }
  })

  test('an ending is the bare name only where Windows runs a bare name with it', () => {
    for (const name of ['git.exe', 'GIT.EXE', 'git.com', 'Git.Bat', 'git.cmd']) {
      expect(programOf(`${name} status`, 'windows'), name).toBe('git')
      expect(programOf(`${name} status`, 'unix'), name).toBe(name)
    }
    for (const name of ['git.sh', 'git.ps1', 'GIT.PS1']) {
      expect(programOf(`${name} status`, 'windows'), name).toBe(name.toLowerCase())
      expect(onBoth(`${name} status`, ['git']), name).toBe(false)
    }
    expect(onTheList('git.exe status', ['git'], 'windows')).toBe(true)
    expect(onTheList('git.exe status', ['git'], 'unix')).toBe(false)
    expect(onTheList('git status', ['Git.exe'], 'windows')).toBe(true)
    expect(onTheList('git status', ['Git.exe'], 'unix')).toBe(false)
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
      'git$IFS-x',
      'FOO=1 git status',
    ]) {
      for (const os of ['windows', 'unix'] as const) {
        expect(['git'], `${os}: ${line}`).not.toContain(programOf(line, os))
      }
    }
    expect(programOf('git.exe status', 'unix')).toBe('git.exe')
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
      expect(onBoth(line, ['git']), line).toBe(false)
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
      expect(onBoth(line, [program]), line).toBe(false)
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
      expect(onBoth(line, [program]), line).toBe(true)
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
    expect(onBoth(line, listed)).toBe(false)
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
    expect(onBoth(line, listed)).toBe(true)
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
    expect(onBoth(line, listed)).toBe(false)
  })

  test.each(['git push -u origin main', 'git add -u', 'git status'])(
    "another command's own letter is that command's: %s",
    (line) => {
      expect(onBoth(line, listed)).toBe(true)
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
    expect(onBoth(line, ['git'])).toBe(false)
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
    expect(onBoth(line, ['git'])).toBe(true)
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
    expect(onBoth(line, listed)).toBe(true)
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
    expect(onBoth(line, listed)).toBe(false)
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
    expect(onBoth(line, listed)).toBe(false)
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
    expect(onBoth(line, listed)).toBe(true)
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
    'npm --prefix a\\ exec test',
    'npm --prefix "a b" test',
    'npm test "',
    "git log '",
    'git "log',
    'git -c"core.pager=touch" log',
    'git --"exec-path"=x status',
    'git log --"output"=x',
    'npm t --"shell"=x',
  ])('asks: %s', (line) => {
    expect(onBoth(line, listed)).toBe(false)
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
    expect(onBoth(line, listed)).toBe(true)
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
    expect(onBoth(line, listed)).toBe(false)
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
    expect(onBoth(line, listed)).toBe(true)
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
    expect(onBoth(line, listed) && startsOnlyOne(line)).toBe(false)
  })

  test('a tab and a space still part words', () => {
    expect(onBoth('git  status', listed)).toBe(true)
  })
})

describe('a colon name that is a file', () => {
  const listed = ['pnpm', 'yarn', 'bun']

  test.each(['bun a:b.js', 'bun run a:b.js', 'pnpm a:b.js', 'yarn a:b.js'])('asks: %s', (line) => {
    expect(onBoth(line, listed)).toBe(false)
  })

  test.each(['bun run test:unit', 'bun db:migrate', 'pnpm build:web'])('goes: %s', (line) => {
    expect(onBoth(line, listed)).toBe(true)
  })
})

describe('what a command prints, kept while it runs', () => {
  test('is its last lines only, however long it prints', () => {
    const kept = new Tail(1000)
    for (let at = 1; at <= 20_000; at++) {
      kept.push(`line ${at}\n`)
      expect(kept.text.length).toBeLessThanOrEqual(2000)
    }
    expect(kept.dropped).toBe(true)
    expect(kept.text.startsWith('line ')).toBe(true)
    expect(kept.text.endsWith('line 20000\n')).toBe(true)
  })

  test('is all of it when it is short', () => {
    const kept = new Tail(1000)
    kept.push('one\n')
    kept.push('two')
    expect(kept.text).toBe('one\ntwo')
    expect(kept.dropped).toBe(false)
  })
})
