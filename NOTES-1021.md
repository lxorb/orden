# notes for #1021 (linux h.264/aac playback), paused

Root cause, confirmed so far:
- scripts/linux-cef.sh:131-150 (`cef` case) fetches the stock "minimal" distribution from cef-builds.spotifycdn.com; the cef crate's own build script fetches the same server when CEF_PATH is unset. packaging/nix/flake.nix:246 pins the same minimal tarball.
- Repo already knows: packaging/linux.md:111-114 says the standard CEF build has no H.264, HEVC or AAC and that a proprietary-codec CEF would be "a build of its own, on a larger runner". scripts/wayland-418.py:21-23 says the same, and scripts/wayland-launch.sh:234-242 has an h264-aac probe that is expected to fail.
- Linux is on Tauri 3 + tauri-runtime-cef with cef =154.5.0 (CEF 154.0.34), apps/desktop/src-tauri/linux/Cargo.toml:40-42. macOS/Windows stay on Tauri 2 (system WebView: WKWebView / WebView2), which ship H.264/AAC themselves, so only Linux is affected.
- Downloaded cef_binary_154.0.34+g14c5a08+chromium-154.0.8037.98_linux64_minimal.tar.bz2 (to /home/super1/code/.worktrees/.tmp-1021/cef/min.tar.bz2): Release/ holds only chrome-sandbox, libcef.so, libvk_swiftshader.so, libvulkan.so.1, v8_context_snapshot.bin, vk_swiftshader_icd.json. No libffmpeg.so: ffmpeg is linked statically into libcef.so, so the Electron-style libffmpeg.so swap does not apply.

Not done yet: check include/cef_config.h / libcef.so strings in that tarball for proprietary_codecs to make the evidence airtight.

Options (none is a small fix):
1. Build CEF 154.0.34 from source with proprietary_codecs=true ffmpeg_branding="Chrome" (CEF automate-git.py, GN_DEFINES). Hours per arch on a large runner, ~100+ GB disk; would need hosting the binary (e.g. R2) and pointing CEF_PATH / linux-cef.sh at it. Licensing: distributing H.264/AAC decoders carries MPEG LA / Via patent exposure; Chrome pays for that, Orden would not be covered.
2. Use a third-party proprietary-codec CEF build if one exists for 154 (untrusted supply chain, version lag).
3. Hand the video off to the system: e.g. offer "open in external player/browser" for media that fails canPlayType, or a GStreamer path. Big feature, not a codec fix.
4. Document only (already documented in packaging/linux.md) and close as known limitation.

Next step: user decides between 1 (with hosting + legal ok) and 3/4. Nothing committed beyond this file.
