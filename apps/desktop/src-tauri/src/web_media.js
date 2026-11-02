;(function () {
  // What a page in a web tab says when a video or a sound in it will not play for want of
  // a decoder, from nib's own world in it; see web_media.rs. Every listener only reads.

  // An engine that has the decoder has nothing to say, and this script nothing to do.
  const H264 = 'video/mp4; codecs="avc1.42E01E"'
  if (document.createElement('video').canPlayType(H264) !== '') return

  // Chromium's words for a file it opened and holds no decoder for. A file that never
  // came is `MEDIA_ELEMENT_ERROR: Format error`, which a browser would not play either.
  const NO_DECODER = 'DEMUXER_ERROR_NO_SUPPORTED_STREAMS'

  // Looked for at each say, since it arrives in a document just after this script has
  // started there; see `BINDING` in web_opens.rs.
  function say() {
    const asked = globalThis.nibAsked
    if (typeof asked === 'function') asked(JSON.stringify(['', 'nib-media-unplayable']))
  }

  // An error on a media element or its source does not bubble, so it is heard on the way
  // down. A `<source>` says nothing of why, and one that failed may have another after it
  // that plays, so only the last of them counts.
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
