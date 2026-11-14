export interface SharingSpacesPort {
  readonly listed: (still: () => boolean) => Promise<void>
}

export interface SharingPorts {
  readonly 'sharing.spaces': SharingSpacesPort
}
