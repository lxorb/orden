#![allow(
    unsafe_code,
    reason = "the files a page is handed are put in a shell data object through COM and Win32"
)]

use std::mem::ManuallyDrop;

use windows_com::core::HSTRING;
use windows_com::Win32::System::Com::{
    IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
};
use windows_com::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows_com::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows_com::Win32::System::Ole::CF_UNICODETEXT;
use windows_com::Win32::UI::Shell::Common::ITEMIDLIST;
use windows_com::Win32::UI::Shell::{
    BHID_DataObject, ILCreateFromPathW, ILFree, IShellItemArray, SHCreateDataObject,
    SHCreateShellItemArrayFromIDLists,
};

use super::Carried;

const OWN: &str = "Chromium Web Custom MIME Data Format";

fn format(kind: u16) -> FORMATETC {
    FORMATETC {
        cfFormat: kind,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: u32::try_from(TYMED_HGLOBAL.0).unwrap_or(1),
    }
}

fn from_this_app(data: &IDataObject) -> bool {
    let own = unsafe { RegisterClipboardFormatW(&HSTRING::from(OWN)) };
    let Ok(own) = u16::try_from(own) else {
        return false;
    };
    let asked = format(own);
    own != 0 && unsafe { data.QueryGetData(&raw const asked) }.is_ok()
}

fn files_of(carried: &Carried) -> windows_com::core::Result<IDataObject> {
    if carried.files.is_empty() {
        return unsafe { SHCreateDataObject(None, None, None) };
    }
    let lists: Vec<*mut ITEMIDLIST> = carried
        .files
        .iter()
        .map(|file| unsafe { ILCreateFromPathW(&HSTRING::from(file.as_os_str())) })
        .collect();
    let made = (|| {
        if lists.iter().any(|one| one.is_null()) {
            return Err(windows_com::core::Error::empty());
        }
        let shown: Vec<*const ITEMIDLIST> = lists.iter().map(|one| one.cast_const()).collect();
        let items: IShellItemArray = unsafe { SHCreateShellItemArrayFromIDLists(&shown)? };
        let handler = BHID_DataObject;
        unsafe { items.BindToHandler(None, &raw const handler) }
    })();
    for one in lists {
        if !one.is_null() {
            unsafe { ILFree(Some(one.cast_const())) };
        }
    }
    made
}

fn with_words(data: &IDataObject, words: &str) -> windows_com::core::Result<()> {
    let wide: Vec<u16> = words.encode_utf16().chain(std::iter::once(0)).collect();
    let size = wide.len() * std::mem::size_of::<u16>();
    unsafe {
        let global = GlobalAlloc(GMEM_MOVEABLE, size)?;
        let at = GlobalLock(global).cast::<u16>();
        if at.is_null() {
            return Err(windows_com::core::Error::from_win32());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), at, wide.len());
        let _ = GlobalUnlock(global);
        let medium = STGMEDIUM {
            tymed: u32::try_from(TYMED_HGLOBAL.0).unwrap_or(1),
            u: STGMEDIUM_0 { hGlobal: global },
            pUnkForRelease: ManuallyDrop::new(None),
        };
        let kind = format(CF_UNICODETEXT.0);
        data.SetData(&raw const kind, &raw const medium, true)
    }
}

fn data_of(carried: &Carried) -> windows_com::core::Result<IDataObject> {
    let data = files_of(carried)?;
    if let Some(words) = &carried.text {
        with_words(&data, words)?;
    }
    Ok(data)
}

pub(crate) fn swapped(data: Option<&IDataObject>) -> Option<IDataObject> {
    let carried = super::carrying()?;
    if !data.is_some_and(from_this_app) {
        return None;
    }
    match data_of(&carried) {
        Ok(made) => Some(made),
        Err(error) => {
            eprintln!("page_carry: the files could not be handed to the page: {error}");
            None
        }
    }
}
