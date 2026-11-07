;(function () {
  const H264 = 'video/mp4; codecs="avc1.42E01E"'
  if (document.createElement('video').canPlayType(H264) !== '') return

  const NO_DECODER = 'DEMUXER_ERROR_NO_SUPPORTED_STREAMS'

  function say() {
    const asked = globalThis.nibAsked
    if (typeof asked === 'function') asked(JSON.stringify(['', 'orden-media-unplayable']))
  }

  window.addEventListener(
    'error',
    (event) => {
      const at = event.target
      if (at instanceof HTMLMediaElement) {
        if (at.error?.message.includes(NO_DECODER)) say()
        return
      }
      if (!(at instanceof HTMLSourceElement)) return
      const media = at.parentElement
      if (media instanceof HTMLMediaElement && media.networkState === media.NETWORK_NO_SOURCE) {
        say()
      }
    },
    true,
  )
})()
