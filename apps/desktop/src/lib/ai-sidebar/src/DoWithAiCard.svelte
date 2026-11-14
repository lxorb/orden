<script lang="ts">
  import { Hint } from '../../ui-controls/src/api'
  import { Select } from '../../ui-controls/src/api'
  import { viewport } from '../../ui-kit/src/api'
  import { type Mode, MODES, modeWord } from '../../ai-providers/src/api'
  import {
    DEFAULT_ASK,
    rememberTaskAsk,
    rememberTaskMode,
    rememberTaskUses,
    TASK_TOOLS,
    type TaskTool,
    taskAsk,
    taskMode,
    taskUses,
  } from './chat-parts'

  let tasked = $state(taskMode())
  const taskTools = $state(Object.fromEntries(TASK_TOOLS.map((one) => [one, taskUses(one)])))
  let taskWords = $state(taskAsk())

  const TOOL_WORDS: Record<TaskTool, { label: string; hint: string }> = {
    browser: {
      label: 'Use the browser',
      hint: 'Lets a task done with AI open web pages and act on them.',
    },
    notes: {
      label: 'Look through notes',
      hint: 'Lets a task done with AI search and read your other notes, beside its own.',
    },
    edits: {
      label: 'Change other notes',
      hint: 'Lets a task done with AI write, move and delete notes other than the task.',
    },
  }

  function turnTaskTool(tool: TaskTool): void {
    const on = !taskTools[tool]
    taskTools[tool] = on
    rememberTaskUses(tool, on)
  }
</script>

<div class="card">
  <div class="orden-setting setting">
    <span class="name"
      ><span class="orden-named"
        >Do with AI<Hint
          text="Whether a task done with AI asks before each change or makes them on its own."
        /></span
      ></span
    >
    <div class="orden-setting-value">
      <Select
        value={tasked}
        options={MODES.filter((one) => one !== 'plan').map((one) => ({
          value: one,
          label: modeWord(one),
        }))}
        onchange={(value: string) => rememberTaskMode((tasked = value as Mode))}
        label="Do with AI"
        plain={viewport.touch}
      />
    </div>
  </div>
  <label class="orden-setting setting asking">
    <span class="name"
      ><span class="orden-named"
        >Instructions<Hint
          text="What a task done with AI is asked to do. It still ticks the task when done, or asks in a comment."
        /></span
      ></span
    >
    <textarea
      class="orden-field ask"
      rows="3"
      value={taskWords}
      placeholder={DEFAULT_ASK}
      oninput={(event) => {
        taskWords = event.currentTarget.value
        rememberTaskAsk(taskWords)
      }}></textarea>
  </label>
</div>

<h3>Permissions</h3>
<div class="card" data-permissions>
  {#each TASK_TOOLS as tool (tool)}
    {@const words = TOOL_WORDS[tool]}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="orden-setting setting pressable" onclick={() => turnTaskTool(tool)}>
      <span class="name"
        ><span class="orden-named">{words.label}<Hint text={words.hint} /></span></span
      >
      <span
        class="orden-switch"
        class:on={taskTools[tool]}
        role="switch"
        tabindex="0"
        aria-checked={taskTools[tool]}
        aria-label={words.label}
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          turnTaskTool(tool)
        }}
      ></span>
    </div>
  {/each}
</div>

<style>
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted-strong);
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pressable {
    cursor: pointer;
  }

  .asking {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
  }

  .ask {
    min-height: 4.5rem;
    padding: var(--space-1) var(--row-pad);
    line-height: 1.45;
    resize: vertical;
  }

  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }
</style>
