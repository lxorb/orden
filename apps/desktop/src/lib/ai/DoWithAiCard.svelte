<script lang="ts">
  /** Settings › AI › Do with AI (#325): the mode a task done with AI works in, the tools it
   *  may reach beside its own note, and the words it is asked in. Its own file so the
   *  glasses' bundle, which has no AI panel, carries none of it; AiPane loads it. */
  import Hint from '../Hint.svelte'
  import { key, t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { viewport } from '../viewport.svelte'
  import { type Mode, MODES, modeWord } from './modes'
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
  } from './sidebar/prefs'

  let tasked = $state(taskMode())
  /** The switches of what a task done with AI may reach, and the words it is asked in. */
  const taskTools = $state(Object.fromEntries(TASK_TOOLS.map((one) => [one, taskUses(one)])))
  let taskWords = $state(taskAsk())

  /** Each switch's name and its sentence, in the order the switches are drawn. */
  const TOOL_WORDS: Record<TaskTool, { label: string; hint: string }> = {
    browser: {
      label: key('Use the browser'),
      hint: key('Lets a task done with AI open web pages and act on them.'),
    },
    notes: {
      label: key('Look through notes'),
      hint: key('Lets a task done with AI search and read your other notes, beside its own.'),
    },
    edits: {
      label: key('Change other notes'),
      hint: key('Lets a task done with AI write, move and delete notes other than the task.'),
    },
  }

  function turnTaskTool(tool: TaskTool): void {
    const on = !taskTools[tool]
    taskTools[tool] = on
    rememberTaskUses(tool, on)
  }
</script>

<div class="card">
  <div class="nib-setting setting">
    <span class="name"
      ><span class="nib-named"
        >{t('Do with AI')}<Hint
          text={t('Whether a task done with AI asks before each change or makes them on its own.')}
        /></span
      ></span
    >
    <div class="pick">
      <Select
        value={tasked}
        options={MODES.filter((one) => one !== 'plan').map((one) => ({
          value: one,
          label: t(modeWord(one)),
        }))}
        onchange={(value: string) => rememberTaskMode((tasked = value as Mode))}
        label={t('Do with AI')}
        plain={viewport.touch}
      />
    </div>
  </div>
  {#each TASK_TOOLS as tool (tool)}
    {@const words = TOOL_WORDS[tool]}
    <!-- The whole row turns it, as a switch in the other panes does. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="nib-setting setting pressable" onclick={() => turnTaskTool(tool)}>
      <span class="name"
        ><span class="nib-named">{t(words.label)}<Hint text={t(words.hint)} /></span></span
      >
      <span
        class="nib-switch"
        class:on={taskTools[tool]}
        role="switch"
        tabindex="0"
        aria-checked={taskTools[tool]}
        aria-label={t(words.label)}
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          turnTaskTool(tool)
        }}
      ></span>
    </div>
  {/each}
  <!-- The words the task is asked in. Orden's own are the placeholder, in the language
       the model is asked in, so an empty field is Orden's words back. -->
  <label class="nib-setting setting asking">
    <span class="name"
      ><span class="nib-named"
        >{t('Instructions')}<Hint
          text={t(
            'What a task done with AI is asked to do. It still ticks the task when done, or asks in a comment.',
          )}
        /></span
      ></span
    >
    <textarea
      class="nib-field ask"
      rows="3"
      value={taskWords}
      placeholder={DEFAULT_ASK}
      oninput={(event) => {
        taskWords = event.currentTarget.value
        rememberTaskAsk(taskWords)
      }}></textarea>
  </label>
</div>

<style>
  /* AiPane's shapes, which a component of its own does not inherit: see AiPane.svelte. */
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

  .pick {
    flex: none;
    width: 14rem;
  }

  .pressable {
    cursor: pointer;
  }

  /* The instructions take the row's width under their name. */
  .asking {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
  }

  /* The design system's box, tall enough for a few lines of words. */
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
