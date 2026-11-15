export interface SharingSpacesPort {
  readonly listed: (still: () => boolean) => Promise<void>
}

interface PublishingPort {
  readonly show: (space: {
    readonly id: string
    readonly name: string
    readonly root: string
  }) => Promise<void>
}

interface SpacesArchivedPort {
  readonly listed: () => Promise<void>
}

export interface SharingPorts {
  readonly 'sharing.spaces': SharingSpacesPort
  readonly 'spaces.archived': SpacesArchivedPort
  readonly publishing: PublishingPort
}
