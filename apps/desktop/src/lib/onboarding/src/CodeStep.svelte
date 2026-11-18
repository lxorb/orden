<script lang="ts">
  import type { Coding } from './flow'
  import Card from './Card.svelte'
  import Screen from './Screen.svelte'
  import { settleMarkdown, setup } from './setup-state.svelte'

  const PROMPT = '~/orden'
  const TYPED = 'git pull'
  const ANSWERED = 'up to date'

  let picked = $state<Coding>(setup.answers.code)

  async function done() {
    if (picked === null) return
    const { modes } = await import('../../modes/src/api')
    modes.setDeveloper(picked === 'yes')
    await settleMarkdown(setup.answers.notes)
    setup.answer({ code: picked })
    setup.next('code')
  }

  function skip() {
    setup.answer({ code: null })
    setup.next('code')
  }
</script>

<Screen
  title="Do you write code?"
  primary={{ label: 'Continue', disabled: picked === null, onclick: () => void done() }}
  quiet={{ label: 'Skip', onclick: skip }}
>
  <div class="cards rise" role="radiogroup" aria-label="Do you write code?">
    <Card label="Yes" checked={picked === 'yes'} onpick={() => (picked = 'yes')}>
      <span class="term" dir="ltr" aria-hidden="true"
        ><span class="p">{PROMPT}</span>
        {TYPED}<br /><span class="ok">✓</span>
        {ANSWERED}<br /><span class="p">{PROMPT}</span> <span class="caret"></span></span
      >
    </Card>
    <Card label="No" checked={picked === 'no'} onpick={() => (picked = 'no')}>
      <span class="write" aria-hidden="true">
        <i style:width="45%" style:height="9px"></i>
        <span class="todo"><b></b><i style:width="70%"></i></span>
        <span class="todo"><b></b><i style:width="55%"></i></span>
        <i style:width="80%"></i>
      </span>
    </Card>
  </div>
</Screen>

<style>
  .cards {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .term {
    display: block;
    width: 100%;
    min-height: 96px;
    border-radius: 10px;
    background: #0e1013;
    color: #dde2ea;
    padding: 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    text-align: start;
    font-weight: 400;
  }

  .p {
    color: #7c6bf5;
  }

  .ok {
    color: #34c759;
  }

  .caret {
    display: inline-block;
    width: 7px;
    height: 13px;
    vertical-align: -2px;
    background: #dde2ea;
    animation: blink 1s steps(1) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .write {
    width: 100%;
    min-height: 96px;
    border-radius: 10px;
    background: var(--bg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    justify-content: center;
  }

  .write i {
    display: block;
    height: 7px;
    border-radius: 4px;
    background: var(--surface-3);
  }

  .todo {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .todo b {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    border: 1.5px solid var(--accent);
    flex: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
  }
</style>
