use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct Note {
    pub path: String,
    pub title: String,
    pub text: String,
    pub created: i64,
    pub modified: i64,
}

#[derive(Serialize, Debug)]
pub struct Media {
    pub path: String,
    pub bytes: String,
}

#[derive(Serialize, Default, Debug)]
pub struct Read {
    pub notes: Vec<Note>,
    pub media: Vec<Media>,
    pub locked: u32,
    pub binned: u32,
    pub drawn: u32,
    pub tables: u32,
    pub missing: u32,
}

#[tauri::command(async)]
pub fn read_apple_notes() -> Result<Read, String> {
    #[cfg(target_os = "macos")]
    {
        mac::read()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Apple Notes keeps its notes on a Mac, and this is not one".to_string())
    }
}

#[tauri::command(async)]
pub fn open_full_disk_access() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        mac::open_setting()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Full Disk Access is a setting a Mac has".to_string())
    }
}

#[cfg(target_os = "macos")]
mod mac {

    use std::collections::{HashMap, HashSet};
    use std::path::{Path, PathBuf};

    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use rusqlite::{Connection, OpenFlags};

    use super::{Media, Note, Read};
    use crate::apple_text::{self, Body, Parts};

    const NO_ACCESS: &str = "no access";

    const NO_DATABASE: &str = "no database";

    const CONTAINER: &str = "Library/Group Containers/group.com.apple.notes";

    const DATABASE: &str = "NoteStore.sqlite";
    const ALONGSIDE: [&str; 2] = ["NoteStore.sqlite-wal", "NoteStore.sqlite-shm"];

    const FROM_2001: f64 = 978_307_200.0;

    const TRASH: i64 = 1;
    const SMART: i64 = 3;

    const INLINE: &str = "com.apple.notes.inlinetextattachment.";
    const INTERNAL: &str = "com.apple.notes.inlinetextattachment.link";
    const CARD: &str = "public.url";
    const TABLE: &str = "com.apple.notes.table";

    const DRAWINGS: [&str; 3] = [
        "com.apple.paper",
        "com.apple.drawing",
        "com.apple.drawing.2",
    ];

    const SCAN: &str = "com.apple.notes.gallery";

    const MARKED_SCAN: &str = "com.apple.paper.doc.scan";

    const PICTURES: [&str; 9] = [
        "png", "jpg", "jpeg", "gif", "heic", "heif", "webp", "tiff", "bmp",
    ];

    pub fn read() -> Result<Read, String> {
        let home = std::env::var_os("HOME").ok_or_else(|| "there is no home folder".to_string())?;
        let base = PathBuf::from(home).join(CONTAINER);

        read_from(&base)
    }

    pub fn open_setting() -> Result<(), String> {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles")
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("that setting would not open: {error}"))
    }

    pub fn read_from(base: &Path) -> Result<Read, String> {
        let copied = copy_out(base)?;
        let db = Connection::open_with_flags(
            copied.path().join(DATABASE),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|error| format!("that database would not open: {error}"))?;

        let keys = keys(&db)?;
        let known = columns(&db, "ziccloudsyncingobject")?;
        let folders = folders(&db, &keys)?;
        let rows = notes(&db, &keys, &known)?;

        let mut read = Read::default();
        let mut where_notes_went = HashMap::new();
        let mut taken = HashSet::new();
        let mut kept = Vec::new();

        for row in rows {
            if row.locked {
                read.locked += 1;
                continue;
            }

            if folders
                .get(&row.folder)
                .is_some_and(|one| one.kind == TRASH)
            {
                read.binned += 1;
                continue;
            }

            let Some(place) = place_of(&row, &folders, &mut taken) else {
                continue;
            };

            where_notes_went.insert(row.identifier.to_uppercase(), place.clone());
            kept.push((row, place));
        }

        let roots = roots(&db, &keys, base)?;
        let mut found = Found::new(&db, roots, where_notes_went, known);

        for (row, place) in kept {
            let text = apple_text::markdown(&row.body, &mut found);
            let title = apple_text::title(&row.body).unwrap_or_else(|| row.title.clone());
            read.notes.push(Note {
                path: format!("{place}.md"),
                title,
                text,
                created: unix(row.created),
                modified: unix(row.modified),
            });
        }

        found.report(&mut read);

        Ok(read)
    }

    fn copy_out(base: &Path) -> Result<tempfile::TempDir, String> {
        let copied =
            tempfile::tempdir().map_err(|error| format!("no temporary folder: {error}"))?;

        if let Err(error) = std::fs::copy(base.join(DATABASE), copied.path().join(DATABASE)) {
            return Err(refusal(base, error));
        }

        for name in ALONGSIDE {
            let _ = std::fs::copy(base.join(name), copied.path().join(name));
        }

        Ok(copied)
    }

    fn refusal(base: &Path, error: std::io::Error) -> String {
        match error.kind() {
            std::io::ErrorKind::NotFound if base.is_dir() => NO_DATABASE.to_string(),
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => {
                NO_ACCESS.to_string()
            }
            _ => format!("that database would not be read: {error}"),
        }
    }

    fn unix(seconds: f64) -> i64 {
        let shifted = seconds + FROM_2001;
        if seconds <= 0.0 || !shifted.is_finite() {
            return 0;
        }

        whole(shifted)
    }

    #[allow(clippy::cast_possible_truncation)]
    fn whole(seconds: f64) -> i64 {
        seconds.trunc() as i64
    }

    fn keys(db: &Connection) -> Result<HashMap<String, i64>, String> {
        let mut statement = db
            .prepare("SELECT z_name, z_ent FROM z_primarykey")
            .map_err(|error| format!("that database is not Notes': {error}"))?;

        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| format!("that database is not Notes': {error}"))?;

        let mut found = HashMap::new();
        for row in rows {
            let (name, ent) =
                row.map_err(|error| format!("that database is not Notes': {error}"))?;
            found.insert(name, ent);
        }

        Ok(found)
    }

    fn columns(db: &Connection, table: &str) -> Result<HashSet<String>, String> {
        let mut statement = db
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|error| format!("that database would not be read: {error}"))?;

        let rows = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("that database would not be read: {error}"))?;

        let mut found = HashSet::new();
        for row in rows {
            let name = row.map_err(|error| format!("that database would not be read: {error}"))?;
            found.insert(name.to_lowercase());
        }

        Ok(found)
    }

    struct Folder {
        title: String,
        parent: Option<i64>,
        kind: i64,
        first: bool,
    }

    fn folders(
        db: &Connection,
        keys: &HashMap<String, i64>,
    ) -> Result<HashMap<i64, Folder>, String> {
        let ent = keys.get("ICFolder").copied().unwrap_or(0);
        let mut statement = db
            .prepare(
                "SELECT z_pk, ztitle2, zparent, zfoldertype, zidentifier
                 FROM ziccloudsyncingobject WHERE z_ent = ?1",
            )
            .map_err(|error| format!("those folders would not be read: {error}"))?;

        let rows = statement
            .query_map([ent], |row| {
                let identifier = row.get::<_, Option<String>>(4)?.unwrap_or_default();
                Ok((
                    row.get::<_, i64>(0)?,
                    Folder {
                        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        parent: row.get::<_, Option<i64>>(2)?,
                        kind: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                        first: identifier.starts_with("DefaultFolder"),
                    },
                ))
            })
            .map_err(|error| format!("those folders would not be read: {error}"))?;

        let mut found = HashMap::new();
        for row in rows {
            let (id, folder) =
                row.map_err(|error| format!("those folders would not be read: {error}"))?;
            found.insert(id, folder);
        }

        Ok(found)
    }

    struct Row {
        title: String,
        folder: i64,
        identifier: String,
        created: f64,
        modified: f64,
        locked: bool,
        body: Body,
    }

    fn notes(
        db: &Connection,
        keys: &HashMap<String, i64>,
        known: &HashSet<String>,
    ) -> Result<Vec<Row>, String> {
        let ent = keys.get("ICNote").copied().unwrap_or(0);
        let created = first_of(
            known,
            &["zcreationdate3", "zcreationdate2", "zcreationdate1"],
        );
        let modified = first_of(known, &["zmodificationdate1", "zmodificationdate"]);
        let locked = if known.contains("zispasswordprotected") {
            "note.zispasswordprotected"
        } else {
            "0"
        };

        let query = format!(
            "SELECT note.ztitle1, note.zfolder, note.zidentifier, {created}, {modified},
                    {locked}, data.zdata
             FROM zicnotedata AS data
             JOIN ziccloudsyncingobject AS note ON note.z_pk = data.znote
             WHERE note.z_ent = ?1 AND note.ztitle1 IS NOT NULL"
        );

        let mut statement = db
            .prepare(&query)
            .map_err(|error| format!("those notes would not be read: {error}"))?;

        let rows = statement
            .query_map([ent], |row| {
                Ok(Row {
                    title: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    folder: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    identifier: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    created: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                    modified: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    locked: row.get::<_, Option<i64>>(5)?.unwrap_or(0) != 0,
                    body: row
                        .get::<_, Option<Vec<u8>>>(6)?
                        .as_deref()
                        .and_then(apple_text::decode)
                        .unwrap_or_default(),
                })
            })
            .map_err(|error| format!("those notes would not be read: {error}"))?;

        let mut found = Vec::new();
        for row in rows {
            found.push(row.map_err(|error| format!("those notes would not be read: {error}"))?);
        }

        Ok(found)
    }

    fn first_of(known: &HashSet<String>, names: &[&str]) -> String {
        let mut said: Vec<String> = names
            .iter()
            .filter(|name| known.contains(**name))
            .map(|name| format!("note.{name}"))
            .collect();

        match said.len() {
            0 => "0".to_string(),
            1 => said.remove(0),
            _ => format!("COALESCE({})", said.join(", ")),
        }
    }

    fn place_of(
        row: &Row,
        folders: &HashMap<i64, Folder>,
        taken: &mut HashSet<String>,
    ) -> Option<String> {
        let mut parts = Vec::new();
        let mut walked = HashSet::new();
        let mut at = Some(row.folder);

        while let Some(id) = at {
            if !walked.insert(id) {
                break;
            }

            let Some(one) = folders.get(&id) else { break };
            if one.kind == SMART {
                return None;
            }

            if !one.first && !one.title.is_empty() {
                parts.push(one.title.replace('/', " "));
            }

            at = one.parent;
        }

        parts.reverse();
        let name = apple_text::title(&row.body).unwrap_or_else(|| row.title.clone());
        let name = name.replace('/', " ");
        parts.push(if name.trim().is_empty() {
            "Untitled".to_string()
        } else {
            name
        });

        Some(stepped(parts.join("/"), taken))
    }

    fn stepped(path: String, taken: &mut HashSet<String>) -> String {
        let mut said = path.clone();
        let mut at = 1;

        while !taken.insert(said.to_lowercase()) {
            at += 1;
            said = format!("{path} {at}");
        }

        said
    }

    fn roots(
        db: &Connection,
        keys: &HashMap<String, i64>,
        base: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let ent = keys.get("ICAccount").copied().unwrap_or(0);
        let mut statement = db
            .prepare("SELECT zidentifier FROM ziccloudsyncingobject WHERE z_ent = ?1")
            .map_err(|error| format!("those accounts would not be read: {error}"))?;

        let rows = statement
            .query_map([ent], |row| row.get::<_, Option<String>>(0))
            .map_err(|error| format!("those accounts would not be read: {error}"))?;

        let mut roots = Vec::new();
        for row in rows {
            let said = row.map_err(|error| format!("those accounts would not be read: {error}"))?;
            if let Some(uuid) = said {
                roots.push(base.join("Accounts").join(uuid));
            }
        }

        roots.push(base.to_path_buf());

        Ok(roots)
    }

    struct Found<'a> {
        db: &'a Connection,
        roots: Vec<PathBuf>,
        notes: HashMap<String, String>,
        known: HashSet<String>,
        media: Vec<Media>,
        written: HashMap<String, String>,
        taken: HashSet<String>,
        drawn: u32,
        tables: u32,
        missing: u32,
    }

    impl<'a> Found<'a> {
        fn new(
            db: &'a Connection,
            roots: Vec<PathBuf>,
            notes: HashMap<String, String>,
            known: HashSet<String>,
        ) -> Self {
            Self {
                db,
                roots,
                notes,
                known,
                media: Vec::new(),
                written: HashMap::new(),
                taken: HashSet::new(),
                drawn: 0,
                tables: 0,
                missing: 0,
            }
        }

        fn report(self, read: &mut Read) {
            read.media = self.media;
            read.drawn = self.drawn;
            read.tables = self.tables;
            read.missing = self.missing;
        }

        fn column(&self, id: &str, name: &str) -> Option<String> {
            if !self.known.contains(&name.to_lowercase()) {
                return None;
            }

            let query =
                format!("SELECT {name} FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1");

            self.db
                .query_row(&query, [id], |row| row.get::<_, Option<String>>(0))
                .ok()
                .flatten()
        }

        fn words(&self, id: &str) -> Option<String> {
            self.column(id, "zalttext")
                .map(|words| apple_text::as_words(&words))
        }

        fn link(&self, id: &str) -> Option<String> {
            let said = self.column(id, "ztokencontentidentifier")?;
            let uuid = said.rsplit('/').next().unwrap_or(said.as_str());
            let uuid = uuid.split('?').next().unwrap_or(uuid).to_uppercase();
            let path = self.notes.get(&uuid)?;
            let name = path.rsplit('/').next().unwrap_or(path.as_str()).to_string();

            Some(format!("[{}]({}.md)", label(&name), target(path)))
        }

        fn card(&self, id: &str) -> Option<String> {
            let url = self.column(id, "zurlstring")?;
            let title = self.column(id, "ztitle").unwrap_or_else(|| url.clone());

            Some(format!(
                "[{}]({})",
                label(&title),
                apple_text::destination(&url)
            ))
        }

        fn file(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let (name, at) = self.media_row(id)?;
            let Some(bytes) = self.on_disk(&[Path::new("Media").join(&at)]) else {
                self.missing += 1;
                return None;
            };

            Some(shown(&self.keep(id, &name, bytes)))
        }

        fn on_disk(&self, candidates: &[PathBuf]) -> Option<Vec<u8>> {
            self.roots.iter().find_map(|root| {
                candidates
                    .iter()
                    .find_map(|one| std::fs::read(root.join(one)).ok())
            })
        }

        fn keep(&mut self, id: &str, name: &str, bytes: Vec<u8>) -> String {
            let path = format!("assets/{}", free(name, &mut self.taken));
            self.media.push(Media {
                path: path.clone(),
                bytes: STANDARD.encode(bytes),
            });
            self.written.insert(id.to_string(), path.clone());
            path
        }

        fn merged(&self, id: &str) -> Option<Vec<u8>> {
            if !self.known.contains("zmergeabledata1") {
                return None;
            }

            self.db
                .query_row(
                    "SELECT zmergeabledata1 FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1",
                    [id],
                    |row| row.get::<_, Option<Vec<u8>>>(0),
                )
                .ok()
                .flatten()
        }

        fn table(&mut self, id: &str) -> Option<String> {
            let data = self.merged(id)?;
            let table = apple_text::table(&data, self)?;
            Some(format!("\n\n{table}\n\n"))
        }

        fn drawing(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let own = segment(id);
            if own.is_empty() {
                return None;
            }
            let generation = self
                .column(id, "zfallbackimagegeneration")
                .map(|one| segment(&one))
                .unwrap_or_default();

            let mut candidates = Vec::new();
            if !generation.is_empty() {
                candidates.push(
                    Path::new("FallbackImages")
                        .join(&own)
                        .join(&generation)
                        .join("FallbackImage.png"),
                );
            }
            candidates.push(Path::new("FallbackImages").join(format!("{own}.jpg")));
            candidates.push(Path::new("FallbackImages").join(format!("{own}.png")));

            let (at, bytes) = candidates
                .iter()
                .find_map(|one| Some((one, self.on_disk(std::slice::from_ref(one))?)))?;
            let extension = at.extension().and_then(|one| one.to_str()).unwrap_or("png");
            let name = format!("Drawing.{extension}");

            Some(shown(&self.keep(id, &name, bytes)))
        }

        fn scan(&mut self, id: &str) -> Option<String> {
            let pages = apple_text::gallery(&self.merged(id)?);
            let shown: Vec<String> = pages
                .iter()
                .filter_map(|page| self.scanned_page(page))
                .collect();

            if shown.is_empty() {
                return None;
            }

            Some(format!("\n\n{}\n\n", shown.join("\n\n")))
        }

        fn scanned_page(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let own = segment(id);
            let size = self
                .db
                .query_row(
                    "SELECT zsizewidth, zsizeheight FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1",
                    [id],
                    |row| Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?)),
                )
                .ok();

            if let (false, Some((Some(width), Some(height)))) = (own.is_empty(), size) {
                let preview = Path::new("Previews").join(format!(
                    "{own}-1-{}x{}-0.jpeg",
                    measure(width),
                    measure(height)
                ));
                if let Some(bytes) = self.on_disk(&[preview]) {
                    return Some(shown(&self.keep(id, "Scan Page.jpg", bytes)));
                }
            }

            self.file(id)
        }

        fn marked_scan(&mut self, id: &str) -> Option<String> {
            if let Some(path) = self.written.get(id) {
                return Some(shown(path));
            }

            let own = segment(id);
            let generation = self
                .column(id, "zfallbackpdfgeneration")
                .map(|one| segment(&one))
                .unwrap_or_default();
            if own.is_empty() {
                return None;
            }

            let mut at = Path::new("FallbackPDFs").join(&own);
            if !generation.is_empty() {
                at.push(&generation);
            }
            at.push("FallbackPDF.pdf");

            let bytes = self.on_disk(&[at])?;
            Some(shown(&self.keep(id, "Scan.pdf", bytes)))
        }

        fn media_row(&self, id: &str) -> Option<(String, PathBuf)> {
            let media = self
                .db
                .query_row(
                    "SELECT zmedia FROM ziccloudsyncingobject WHERE zidentifier = ?1 LIMIT 1",
                    [id],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .ok()
                .flatten()?;

            let generation = if self.known.contains("zgeneration1") {
                "zgeneration1"
            } else {
                "''"
            };
            let query = format!(
                "SELECT zidentifier, zfilename, {generation}
                 FROM ziccloudsyncingobject WHERE z_pk = ?1"
            );

            let (folder, name, generation) = self
                .db
                .query_row(&query, [media], |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    ))
                })
                .ok()?;

            let (folder, name, generation) =
                (segment(&folder), segment(&name), segment(&generation));

            if name.is_empty() || folder.is_empty() {
                return None;
            }

            let mut at = PathBuf::from(folder);
            if !generation.is_empty() {
                at.push(generation);
            }
            at.push(&name);

            Some((name, at))
        }
    }

    impl Parts for Found<'_> {
        fn attachment(&mut self, id: &str, uti: &str) -> Option<String> {
            if uti == INTERNAL {
                return self.link(id).or_else(|| self.words(id));
            }

            if uti.starts_with(INLINE) {
                return self.words(id);
            }

            if uti == CARD {
                return self.card(id);
            }

            if uti == TABLE {
                let table = self.table(id);
                self.tables += u32::from(table.is_none());
                return table;
            }

            let drawn = if DRAWINGS.contains(&uti) {
                Some(self.drawing(id))
            } else if uti == SCAN {
                Some(self.scan(id))
            } else if uti == MARKED_SCAN {
                Some(self.marked_scan(id))
            } else {
                None
            };

            if let Some(drawn) = drawn {
                self.drawn += u32::from(drawn.is_none());
                return drawn;
            }

            self.file(id)
        }
    }

    fn shown(path: &str) -> String {
        let name = path.rsplit('/').next().unwrap_or(path);
        let extension = name.rsplit('.').next().unwrap_or("").to_lowercase();

        if PICTURES.contains(&extension.as_str()) {
            return format!("![]({})", target(path));
        }

        format!("[{}]({})", label(name), target(path))
    }

    fn label(words: &str) -> String {
        let said = words
            .replace('\\', "\\\\")
            .replace('[', "\\[")
            .replace(']', "\\]")
            .replace(['\n', '\r'], " ");

        let mut out = String::with_capacity(said.len());
        let mut chars = said.chars().peekable();
        while let Some(one) = chars.next() {
            if one == '<' && apple_text::opens_tag(chars.peek().copied()) {
                out.push('\\');
            }
            out.push(one);
        }
        out
    }

    fn target(path: &str) -> String {
        let mut out = String::with_capacity(path.len());
        for one in path.chars() {
            match one {
                '%' => out.push_str("%25"),
                ' ' => out.push_str("%20"),
                '(' => out.push_str("%28"),
                ')' => out.push_str("%29"),
                '#' => out.push_str("%23"),
                ':' => out.push_str("%3A"),
                '<' => out.push_str("%3C"),
                '>' => out.push_str("%3E"),
                '\n' | '\r' => {}
                _ => out.push(one),
            }
        }
        out
    }

    fn measure(points: f64) -> String {
        if points.fract().abs() < f64::EPSILON {
            format!("{points:.0}")
        } else {
            points.to_string()
        }
    }

    const FORBIDDEN: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

    fn segment(name: &str) -> String {
        let last = name.rsplit(['/', '\\']).next().unwrap_or(name);
        let said: String = last
            .chars()
            .map(|one| {
                if FORBIDDEN.contains(&one) || one.is_control() {
                    ' '
                } else {
                    one
                }
            })
            .collect();

        said.trim().trim_matches('.').trim().to_string()
    }

    fn free(name: &str, taken: &mut HashSet<String>) -> String {
        let (stem, extension) = match name.rsplit_once('.') {
            Some((stem, extension)) => (stem.to_string(), format!(".{extension}")),
            None => (name.to_string(), String::new()),
        };

        let mut said = name.to_string();
        let mut at = 1;

        while !taken.insert(said.to_lowercase()) {
            at += 1;
            said = format!("{stem} {at}{extension}");
        }

        said
    }

    #[cfg(test)]
    mod tests {
        use super::{read_from, segment};

        #[test]
        fn a_name_in_the_store_is_a_name_and_not_a_path() {
            assert_eq!(segment("photo.png"), "photo.png");
            assert_eq!(segment("Some paper (2).pdf"), "Some paper (2).pdf");

            assert_eq!(segment("../../../.ssh/authorized_keys"), "authorized_keys");
            assert_eq!(segment(r"..\..\Windows\win.ini"), "win.ini");
            assert_eq!(segment("/etc/passwd"), "passwd");
            assert_eq!(segment(r"C:\Windows\win.ini"), "win.ini");
            assert_eq!(segment("C:/Windows/win.ini"), "win.ini");
            assert_eq!(segment("a\nb.png"), "a b.png");

            assert_eq!(segment(".."), "");
            assert_eq!(segment("..."), "");
            assert_eq!(segment("/"), "");
            assert_eq!(segment(""), "");
        }

        #[test]
        fn a_link_to_a_note_holds_whatever_its_title_says() {
            assert_eq!(
                super::target("Work/Re: lunch (draft) #2 100%"),
                "Work/Re%3A%20lunch%20%28draft%29%20%232%20100%25"
            );
            assert_eq!(super::label("[Draft] plan ]"), "\\[Draft\\] plan \\]");
            assert_eq!(super::label("a < b <i>"), "a < b \\<i>");
        }

        fn store(columns: &[(&str, &str)]) -> rusqlite::Connection {
            let db = rusqlite::Connection::open_in_memory().expect("a database");
            db.execute_batch(
                "CREATE TABLE ziccloudsyncingobject \
                 (zidentifier TEXT, zalttext TEXT, zurlstring TEXT, ztitle TEXT)",
            )
            .expect("a table");
            db.execute(
                "INSERT INTO ziccloudsyncingobject (zidentifier) VALUES ('A')",
                [],
            )
            .expect("a row");
            for (name, value) in columns {
                db.execute(
                    &format!("UPDATE ziccloudsyncingobject SET {name} = ?1"),
                    [value],
                )
                .expect("a column");
            }
            db
        }

        fn attachment(db: &rusqlite::Connection, uti: &str) -> Option<String> {
            use crate::apple_text::Parts;

            let known = ["zidentifier", "zalttext", "zurlstring", "ztitle"]
                .into_iter()
                .map(String::from)
                .collect();
            let mut found =
                super::Found::new(db, Vec::new(), std::collections::HashMap::new(), known);
            found.attachment("A", uti)
        }

        #[test]
        fn a_cards_title_is_words_and_not_markup() {
            let db = store(&[
                ("zurlstring", "https://x.test/a"),
                ("ztitle", "Fine <img src=x onerror=alert(1)>"),
            ]);
            assert_eq!(
                attachment(&db, super::CARD).as_deref(),
                Some("[Fine \\<img src=x onerror=alert(1)>](https://x.test/a)")
            );

            let db = store(&[
                ("zurlstring", "https://x.test/a) <b>"),
                ("ztitle", "\\<img src=x>"),
            ]);
            assert_eq!(
                attachment(&db, super::CARD).as_deref(),
                Some("[\\\\\\<img src=x>](<https://x.test/a) %3Cb%3E>)")
            );
        }

        #[test]
        fn words_kept_on_an_attachment_are_not_markup() {
            let db = store(&[("zalttext", "#plans <img src=x onerror=alert(1)> \\</b>")]);
            assert_eq!(
                attachment(&db, "com.apple.notes.inlinetextattachment.hashtag").as_deref(),
                Some("#plans \\<img src=x onerror=alert(1)> \\\\\\</b>")
            );
        }

        fn fixture() -> std::path::PathBuf {
            crate::app_dir().join("tests/apple-notes")
        }

        #[test]
        fn every_note_arrives_under_the_folder_it_sat_in() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let paths: Vec<&str> = read.notes.iter().map(|note| note.path.as_str()).collect();

            assert!(paths.contains(&"Groceries.md"), "{paths:?}");
            assert!(paths.contains(&"Work/Ideas.md"), "{paths:?}");
            assert!(paths.contains(&"Work/Deeper/Nested.md"), "{paths:?}");
        }

        #[test]
        fn a_note_carries_its_words_its_title_and_its_day() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = read
                .notes
                .iter()
                .find(|note| note.path == "Groceries.md")
                .expect("the first note");

            assert_eq!(note.title, "Groceries");
            assert!(note.text.starts_with("# Groceries"), "{}", note.text);
            assert!(note.text.contains("- [x] Milk"), "{}", note.text);
            assert_eq!(note.created, 1_788_480_000);
        }

        #[test]
        fn a_locked_note_is_counted_and_the_bin_stays_the_bin() {
            let read = read_from(&fixture()).expect("the fixture reads");

            assert_eq!(read.locked, 1);
            assert_eq!(read.binned, 1);
            assert!(!read.notes.iter().any(|note| note.path.contains("Locked")));
        }

        #[test]
        fn an_attachment_arrives_beside_the_notes_and_the_note_shows_it() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = read
                .notes
                .iter()
                .find(|note| note.path == "Work/Ideas.md")
                .expect("the second note");

            assert!(note.text.contains("![](assets/photo.png)"), "{}", note.text);
            let photos = read
                .media
                .iter()
                .filter(|one| one.path == "assets/photo.png")
                .count();
            assert_eq!(photos, 1);
        }

        #[test]
        fn a_link_to_another_note_points_at_where_that_note_went() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = read
                .notes
                .iter()
                .find(|note| note.path == "Work/Ideas.md")
                .expect("the second note");

            assert!(
                note.text.contains("[Groceries](Groceries.md)"),
                "{}",
                note.text
            );
        }

        #[test]
        fn words_kept_on_an_attachment_come_over_as_words() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = read
                .notes
                .iter()
                .find(|note| note.path == "Work/Sums.md")
                .expect("the note with a sum in it");

            assert!(note.text.contains("2 + 2 = 4"), "{}", note.text);
            assert!(note.text.contains("See Locked"), "{}", note.text);
        }

        fn plans(read: &super::Read) -> &super::Note {
            read.notes
                .iter()
                .find(|note| note.path == "Work/Plans.md")
                .expect("the note with a table, sketches and scans in it")
        }

        #[test]
        fn a_table_arrives_as_a_markdown_table() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = plans(&read);

            assert!(
                note.text
                    .contains("Table\n\n| How much | Item |\n| --- | --- |\n| 2 litres | Milk |"),
                "{}",
                note.text
            );
            assert_eq!(read.tables, 0);
        }

        #[test]
        fn sketches_and_scans_arrive_as_the_pictures_notes_drew() {
            let read = read_from(&fixture()).expect("the fixture reads");
            let note = plans(&read);

            for shown in [
                "![](assets/Drawing.png)",
                "![](assets/Scan%20Page.jpg)",
                "![](assets/page-two.png)",
                "[Scan.pdf](assets/Scan.pdf)",
            ] {
                assert!(note.text.contains(shown), "{shown} in {}", note.text);
            }

            let written: Vec<&str> = read.media.iter().map(|one| one.path.as_str()).collect();
            for path in [
                "assets/Drawing.png",
                "assets/Scan Page.jpg",
                "assets/page-two.png",
                "assets/Scan.pdf",
            ] {
                assert!(written.contains(&path), "{path} in {written:?}");
            }
        }

        #[test]
        fn a_sketch_with_no_picture_on_this_mac_is_counted() {
            let read = read_from(&fixture()).expect("the fixture reads");

            assert_eq!(read.drawn, 1);
            assert!(plans(&read).text.contains("Lost"));
        }

        #[test]
        fn a_folder_with_no_database_in_it_says_so_rather_than_failing() {
            let empty = tempfile::tempdir().expect("a folder");
            assert_eq!(read_from(empty.path()).unwrap_err(), super::NO_DATABASE);
        }

        #[test]
        fn a_folder_that_is_not_there_reads_as_a_refusal() {
            let missing = fixture().join("nowhere");
            assert_eq!(read_from(&missing).unwrap_err(), super::NO_ACCESS);
        }
    }
}
