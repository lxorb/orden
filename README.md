# Nib

<p align="center">
  <a href="https://github.com/lxorb/nib/releases/latest">
    <img alt="Download for Windows" src="https://img.shields.io/badge/Windows-x64%20%C2%B7%20arm64-0078D6?style=for-the-badge&logo=windows11&logoColor=white">
  </a>
  <a href="https://github.com/lxorb/nib/releases/latest">
    <img alt="Download for macOS" src="https://img.shields.io/badge/macOS-universal-1A1A1A?style=for-the-badge&logo=apple&logoColor=white">
  </a>
  <a href="https://github.com/lxorb/nib/releases/latest">
    <img alt="Download for Linux" src="https://img.shields.io/badge/Linux-x64%20%C2%B7%20arm64-FCC624?style=for-the-badge&logo=linux&logoColor=black">
  </a>
  <a href="https://nibeditor.com">
    <img alt="Open in the browser" src="https://img.shields.io/badge/Browser-no%20install-7C6BF5?style=for-the-badge&logo=firefoxbrowser&logoColor=white">
  </a>
</p>

<p align="center">
  <a href="https://github.com/lxorb/nib/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/lxorb/nib?style=flat-square&label=latest&color=7C6BF5">
  </a>
  <a href="https://github.com/lxorb/nib/releases">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/lxorb/nib/total?style=flat-square&color=3FCF8E">
  </a>
  <a href="https://nibeditor.com">
    <img alt="Web app" src="https://img.shields.io/badge/web-nibeditor.com-767E8C?style=flat-square">
  </a>
</p>

<p align="center">
  <img alt="Nib: typing markdown that renders as you type, then a look around the tabs, the file tree and four spaces" src="docs/media/live-preview.gif">
</p>

If you're also annoyed by all the other Markdown Editors out there, you sould probably just use Nib. 

It's extremely fast, lightweight, let's your favorite LLM edit your notes and syncs everything to the cloud - on any platform. 

How much does it cost? Well, it's free. 

See for yourself: [nibeditor.com](https://nibeditor.com)

## Why Nib?

|  | Open source | MCP | Platform independent | Inline preview | Sync | Publish |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| **Nib** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Typora | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| MarkText | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Obsidian | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Zettlr | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Joplin | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Logseq | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| iA Writer | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Bear | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| VS Code | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Sublime Text | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

## Features

- A **clean** and **modern** UI
- **Realtime preview** (WYSIWYG)
- **Syncing** across different devices
- An **MCP** to allow LLM read and write access
- **Paste Images** from Clipboard
- **Publish** your markdown files as an online blog with a single click

## Install

Download an installer from the [latest release](https://github.com/lxorb/nib/releases/latest), open [nibeditor.com](https://nibeditor.com) in a browser, or use a package manager:

| | |
| --- | --- |
| Windows, Scoop | `scoop bucket add lxorb https://github.com/lxorb/scoop-bucket` then `scoop install nib` |
| macOS, Homebrew | `brew install --cask --no-quarantine lxorb/tap/nib` |
| Nix | `nix profile install github:lxorb/nib?dir=packaging/nix` |
| Debian, Ubuntu | `sudo apt install ./Nib-<version>-linux-x64.deb` |
| Fedora, openSUSE | `sudo dnf install ./Nib-<version>-linux-x64.rpm` |
| Any Linux | `chmod +x Nib-<version>-linux-x64.AppImage && ./Nib-<version>-linux-x64.AppImage` |

## Motivation

I’ve spent the last few years switching between different editors with markdown support, but kept being disappointed: Notion is way too bloated, Obsidian is proprietary and MarkText feels unfinished. Nothing against marktext, I really liked it and have been using it for a few months, but there’s just stuff missing: you can’t sync and also even though the UI looks nice, it feels a bit clunky and unfinished at places. People will tell you to use a shared mount to have sync but then still, I won’t be able to sync it to my mobile device. And I find it really important to be able to sync your notes between your phone and computer, e.g. when taking some notes you can’t always just pull up your laptop :)
So… long story short: I’ve decided to build my own Markdown Editor. I know there’s a lot of them out there, but there’s just not a single one that makes me happy. And I believe my reasoning should become clear when looking at the comparison table above.

I aim to keep this free forever (because I really don’t wanna become the Typora 2.0). For now, I’ve limited cloud space usage to 1 GB per account - I believe this should be more than enough, but if you run into any issues, let me know.

If you’re still unsure whether you should use marktext or Nib, here are a few reasons to use Nib. This is not to say I don’t like MarkText whatsoever, it’s just why I am not satisfied with it:
- Nib is by construction considerably faster and lighter (around 20x compared to MarkText)
- Nib has an MCP so your favorite LLM can mess with your notes, MarkText doesn’t
- Nib has sync on all of your devices, MarkText is just local
- Have you thought about starting an online blog? Well, it’s one click away now.
