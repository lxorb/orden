use windows_registry::Key;

const FORMER: [&str; 2] = [r"Software\Classes\NibURL", r"Software\Classes\NibPDF"];
const OPEN_WITH: &str = r"Software\Classes\.pdf\OpenWithProgids";
const FORMER_OPEN_WITH: &str = "NibPDF";
pub(crate) fn forget(root: &Key) {
    for key in FORMER {
        let _ = root.remove_tree(key);
    }
    if let Ok(key) = root.options().read().write().open(OPEN_WITH) {
        let _ = key.remove_value(FORMER_OPEN_WITH);
    }
}
#[cfg(test)]
mod tests {
    use super::{forget, FORMER, FORMER_OPEN_WITH, OPEN_WITH};
    use windows_registry::CURRENT_USER;

    #[test]
    fn the_former_prog_ids_go_and_what_stands_beside_them_stays() {
        struct Scratch(String);
        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = CURRENT_USER.remove_tree(&self.0);
            }
        }
        let scratch = Scratch(format!(r"Software\orden-tests-prog-ids-{}", std::process::id()));
        let root = CURRENT_USER
            .options()
            .read()
            .write()
            .access(0x0001_0000)
            .create()
            .open(&scratch.0)
            .expect("a test key");
        for key in FORMER {
            root.create(format!(r"{key}\shell\open\command"))
                .and_then(|command| command.set_string("", "former"))
                .expect("a former ProgID");
        }
        root.create(r"Software\Classes\OrdenURL").expect("the ProgID of now");
        let open_with = root.create(OPEN_WITH).expect("the open-with list");
        open_with.set_string(FORMER_OPEN_WITH, "").expect("the former entry");
        open_with.set_string("OrdenPDF", "").expect("the entry of now");
        forget(&root);
        forget(&root);
        for key in FORMER {
            assert!(root.open(key).is_err(), "{key}");
        }
        assert!(root.open(r"Software\Classes\OrdenURL").is_ok());
        assert!(open_with.get_string(FORMER_OPEN_WITH).is_err());
        assert!(open_with.get_string("OrdenPDF").is_ok());
    }
}
