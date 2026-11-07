<script lang="ts">
  import { blank } from '@orden/pass/envelope'
  import type {
    Alias,
    Card,
    Content,
    Custom,
    FieldKind,
    Identity,
    Item,
    Login,
    SshKey,
    Wifi,
  } from '@orden/pass/types'
  import { normalizeUrl } from '@orden/pass/urls'
  import { untrack } from 'svelte'
  import Cross from '../Cross.svelte'
  import { message, t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import AddField from './AddField.svelte'
  import AliasEdit from './AliasEdit.svelte'
  import type { AliasAsk } from './aliases'
  import type { Picked } from './attachments'
  import AttachmentsEdit from './AttachmentsEdit.svelte'
  import CardEdit from './CardEdit.svelte'
  import EditCard from './EditCard.svelte'
  import EditField from './EditField.svelte'
  import FieldsEdit from './FieldsEdit.svelte'
  import { folderOptions } from './folder-options'
  import IdentityEdit from './IdentityEdit.svelte'
  import LoginEdit from './LoginEdit.svelte'
  import { providedAlias } from './new-alias'
  import { newField } from './new-field'
  import OtherEdit from './OtherEdit.svelte'
  import { pass } from './store.svelte'
  import type { Editing, PassUi } from './ui.svelte'

  const { ui }: { ui: PassUi } = $props()

  let source: Editing | null = null
  let draft = $state<Content>(blank('note'))
  let vault = $state('')
  let folder = $state<string | null>(null)
  let baseline = $state('')
  let saving = $state(false)
  let error = $state<string | null>(null)
  let adding = $state.raw<Picked[]>([])
  let removing = $state.raw<string[]>([])
  let aliasAsk = $state.raw<AliasAsk | null>(null)

  const keyOf = () =>
    JSON.stringify([draft, vault, folder, adding.map((one) => one.name), removing])

  $effect.pre(() => {
    const now = ui.editing
    if (!now || now === source) return
    source = now
    untrack(() => {
      draft = structuredClone($state.snapshot(now.content))
      vault = now.vault
      folder = now.folder
      adding = []
      removing = []
      aliasAsk = null
      baseline = keyOf()
      error = null
    })
  })

  const changed = $derived(keyOf() !== baseline)

  $effect(() => {
    ui.dirty = changed
  })

  const vaults = $derived(pass.vaults.map((one) => ({ value: one.id, label: one.name })))
  const folders = $derived([
    { value: '', label: t('No folder') },
    ...folderOptions(pass.vaults.find((one) => one.id === vault)?.folders ?? []).map((one) => ({
      value: one.id,
      label: `${' '.repeat(one.depth)}${one.name}`,
    })),
  ])

  const isNew = $derived(ui.editing?.id === null)
  const kept = $derived(pass.items.find((one) => one.id === ui.editing?.id)?.attachments ?? [])
  const canSave = $derived(draft.title.trim() !== '' && vault !== '' && !saving)

  function touched() {
    error = null
  }

  function cleaned(content: Content): Content {
    const title = content.title.trim()
    if (content.kind !== 'login') return { ...content, title }
    const websites = content.websites
      .map((one) => ({ ...one, url: normalizeUrl(one.url) ?? one.url.trim() }))
      .filter((one) => one.url !== '')
    return { ...content, title, websites }
  }

  async function save() {
    const editing = ui.editing
    if (!editing || !canSave) return
    saving = true
    error = null
    try {
      let content = cleaned($state.snapshot(draft))
      if (editing.id === null && content.kind === 'alias' && aliasAsk) {
        content = await providedAlias(aliasAsk, content)
      }
      let item: Item
      if (editing.id === null) item = await pass.create(vault, content, folder)
      else {
        const id = editing.id
        item = await pass.update(id, content)
        if (vault !== editing.vault || folder !== editing.folder) {
          await pass.move([id], vault, folder)
          item = pass.items.find((one) => one.id === id) ?? item
        }
      }
      for (const file of removing) item = await pass.detach(item.id, file)
      for (const file of adding) item = await pass.attach(item.id, file)
      ui.edited(item)
    } catch (failure) {
      error = message(failure, 'The item could not be saved.')
    } finally {
      saving = false
    }
  }

  function cancel() {
    void ui.leave().then((left) => {
      if (left) ui.edited(null)
    })
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      cancel()
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
  class="edit"
  onsubmit={(event) => {
    event.preventDefault()
    void save()
  }}
  {onkeydown}
>
  <div class="head">
    <button
      type="button"
      class="nib-glyph"
      aria-label={t('Cancel')}
      title={t('Cancel')}
      onclick={cancel}
    >
      <Cross />
    </button>
    <h2 class="heading">{isNew ? t('New item') : t('Edit item')}</h2>
    <div class="place">
      <Select
        value={vault}
        options={vaults}
        label={t('Vault')}
        onchange={(next: string) => {
          vault = next
          folder = null
        }}
      />
    </div>
    {#if folders.length > 1}
      <div class="place">
        <Select
          value={folder ?? ''}
          options={folders}
          label={t('Folder')}
          onchange={(next: string) => (folder = next === '' ? null : next)}
        />
      </div>
    {/if}
    <button type="submit" class="nib-button save" disabled={!canSave} aria-busy={saving}>
      {isNew ? t('Create') : t('Save')}
    </button>
  </div>

  <div class="body" data-scrolls>
    {#if error}<p class="wrong" role="alert">{error}</p>{/if}

    <EditCard>
      <EditField
        label={t('Title')}
        bind:value={draft.title}
        big
        placeholder={t('Untitled')}
        oninput={touched}
      />
    </EditCard>

    {#if draft.kind === 'login'}
      <LoginEdit
        {ui}
        bind:content={() => draft as Login, (next: Login) => (draft = next)}
        oninput={touched}
      />
    {:else if draft.kind === 'alias'}
      <AliasEdit
        bind:content={() => draft as Alias, (next: Alias) => (draft = next)}
        onask={(next: AliasAsk | null) => (aliasAsk = next)}
        fresh={isNew}
        oninput={touched}
      />
    {:else if draft.kind === 'card'}
      <CardEdit
        bind:content={() => draft as Card, (next: Card) => (draft = next)}
        oninput={touched}
      />
    {:else if draft.kind === 'identity'}
      <IdentityEdit
        bind:content={() => draft as Identity, (next: Identity) => (draft = next)}
        oninput={touched}
      />
    {:else if draft.kind === 'custom' || draft.kind === 'ssh' || draft.kind === 'wifi'}
      <OtherEdit
        {ui}
        bind:content={
          () => draft as Custom | SshKey | Wifi, (next: Custom | SshKey | Wifi) => (draft = next)
        }
        oninput={touched}
      />
    {/if}

    <EditCard>
      <EditField label={t('Note')} bind:value={draft.note} kind="multiline" oninput={touched} />
    </EditCard>

    {#if draft.fields.length}
      <EditCard>
        <FieldsEdit bind:fields={draft.fields} oninput={touched} />
      </EditCard>
    {/if}
    <AddField
      onadd={(kind: FieldKind) => {
        draft.fields = [...draft.fields, newField(kind)]
        touched()
      }}
    />

    <AttachmentsEdit {kept} bind:adding bind:removing oninput={touched} />
  </div>
</form>

<style>
  .edit {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    margin: 0;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .heading {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .place {
    flex: none;
    width: 10rem;
    max-width: 28%;
  }

  .save {
    flex: none;
  }

  .nib-glyph :global(.nib-cross) {
    width: var(--icon-lg);
    height: var(--icon-lg);
    stroke-width: 1.5;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    overflow-y: auto;
    padding: 0 var(--space-4) var(--space-6);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }
</style>
