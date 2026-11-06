// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

mod class;
mod event_loop;
mod monitor;
mod taskbar;
mod unhosted;
mod utils;
mod webview;
mod window;

pub(crate) use class::{name_popup, name_windows};
pub(crate) use unhosted::put_out_of_sight;
pub(crate) use window::CefX11Host;
