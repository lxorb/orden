use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use super::walk::{found, ignored_path, present, walk, Found};
use crate::tree::MAX_ENTRIES;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Seen {
    Created(Found),
    Modified(Found),
    Removed {
        rel: PathBuf,
        dir: bool,
        id: Option<String>,
    },
    Renamed {
        from: PathBuf,
        to: Found,
    },
}

#[derive(Clone, Debug)]
struct Known {
    dir: bool,
    size: u64,
    stamp: u128,
    id: Option<String>,
}

impl From<&Found> for Known {
    fn from(one: &Found) -> Self {
        Self {
            dir: one.dir,
            size: one.size,
            stamp: one.stamp,
            id: one.id.clone(),
        }
    }
}

#[derive(Default, Debug)]
pub struct Space {
    paths: BTreeMap<PathBuf, Known>,
    ids: HashMap<String, PathBuf>,
}

impl Space {
    pub fn read(root: &Path) -> Result<Self, String> {
        let mut space = Self::default();
        let mut left = MAX_ENTRIES;
        walk(root, Path::new(""), &mut left, &mut |one| {
            space.insert(&one);
        })?;
        Ok(space)
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.paths.len()
    }

    fn insert(&mut self, one: &Found) {
        if let Some(id) = &one.id {
            self.ids.insert(id.clone(), one.rel.clone());
        }
        self.paths.insert(one.rel.clone(), Known::from(one));
    }

    fn remove_tree(&mut self, rel: &Path) -> Option<Known> {
        let under: Vec<PathBuf> = self.under(rel).collect();
        let mut was = None;
        for path in under {
            if let Some(known) = self.paths.remove(&path) {
                if let Some(id) = &known.id {
                    if self.ids.get(id) == Some(&path) {
                        self.ids.remove(id);
                    }
                }
                if path == rel {
                    was = Some(known);
                }
            }
        }
        was
    }

    fn move_tree(&mut self, from: &Path, to: &Path) {
        let under: Vec<PathBuf> = self.under(from).collect();
        for path in under {
            let Some(known) = self.paths.remove(&path) else {
                continue;
            };
            let rest = path.strip_prefix(from).unwrap_or(Path::new(""));
            let moved = if rest.as_os_str().is_empty() {
                to.to_path_buf()
            } else {
                to.join(rest)
            };
            if let Some(id) = &known.id {
                self.ids.insert(id.clone(), moved.clone());
            }
            self.paths.insert(moved, known);
        }
    }

    fn under<'a>(&'a self, rel: &'a Path) -> impl Iterator<Item = PathBuf> + 'a {
        self.paths
            .range(rel.to_path_buf()..)
            .map(|(path, _)| path)
            .take_while(move |path| path.starts_with(rel))
            .cloned()
    }

    pub fn settle(
        &mut self,
        root: &Path,
        touched: &BTreeSet<PathBuf>,
        hold: bool,
        released: &BTreeSet<PathBuf>,
    ) -> (Vec<Seen>, Vec<PathBuf>) {
        let mut order: Vec<&PathBuf> = touched
            .iter()
            .filter(|rel| !rel.as_os_str().is_empty() && !ignored_path(rel))
            .collect();
        order.sort_by_key(|rel| (rel.components().count(), (*rel).clone()));

        let mut seen = Vec::new();
        let mut waiting = Vec::new();

        for _ in 0..2 {
            for rel in &order {
                self.arrived(root, rel, &mut seen);
            }
        }

        for rel in &order {
            if !self.paths.contains_key(*rel) || present(root, rel) {
                continue;
            }
            if hold && !released.contains(*rel) {
                waiting.push((*rel).clone());
                continue;
            }
            if let Some(was) = self.remove_tree(rel) {
                seen.push(Seen::Removed {
                    rel: (*rel).clone(),
                    dir: was.dir,
                    id: was.id,
                });
            }
        }

        for rel in &order {
            self.stayed(root, rel, &mut seen);
        }

        (seen, waiting)
    }

    fn arrived(&mut self, root: &Path, rel: &Path, seen: &mut Vec<Seen>) {
        if self.paths.contains_key(rel) {
            return;
        }
        let Some(now) = found(root, rel) else {
            return;
        };

        let mut above = PathBuf::new();
        for part in rel.parent().into_iter().flat_map(Path::components) {
            above.push(part);
            if !self.paths.contains_key(&above) {
                if let Some(folder) = found(root, &above) {
                    self.insert(&folder);
                    seen.push(Seen::Created(folder));
                }
            }
        }

        self.arriving(root, now, seen);
    }

    fn arriving(&mut self, root: &Path, now: Found, seen: &mut Vec<Seen>) {
        let rel = now.rel.clone();
        if !self.placed(root, now, seen) {
            return;
        }

        let mut inside = Vec::new();
        let mut left = MAX_ENTRIES.saturating_sub(self.paths.len());
        let _ = walk(root, &rel, &mut left, &mut |one| inside.push(one));
        for one in inside {
            if !self.paths.contains_key(&one.rel) {
                self.placed(root, one, seen);
            }
        }
    }

    fn placed(&mut self, root: &Path, now: Found, seen: &mut Vec<Seen>) -> bool {
        let from = now
            .id
            .as_ref()
            .and_then(|id| self.ids.get(id))
            .filter(|old| {
                old.as_path() != now.rel && found(root, old).and_then(|there| there.id) != now.id
            })
            .cloned();

        if let Some(from) = from {
            self.move_tree(&from, &now.rel);
            self.insert(&now);
            seen.push(Seen::Renamed { from, to: now });
            false
        } else {
            let dir = now.dir;
            self.insert(&now);
            seen.push(Seen::Created(now));
            dir
        }
    }

    fn stayed(&mut self, root: &Path, rel: &Path, seen: &mut Vec<Seen>) {
        let Some(known) = self.paths.get(rel).cloned() else {
            return;
        };
        let Some(now) = found(root, rel) else {
            return;
        };

        if now.dir != known.dir {
            self.remove_tree(rel);
            seen.push(Seen::Removed {
                rel: rel.to_path_buf(),
                dir: known.dir,
                id: known.id,
            });
            self.arriving(root, now, seen);
            return;
        }
        if known.dir || (now.size == known.size && now.stamp == known.stamp && now.id == known.id) {
            return;
        }

        if let Some(old) = &known.id {
            if self.ids.get(old).is_some_and(|there| there == rel) {
                self.ids.remove(old);
            }
        }
        self.insert(&now);
        seen.push(Seen::Modified(now));
    }
}

#[cfg(test)]
mod tests {
    use super::{Seen, Space};
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn settle(space: &mut Space, root: &Path, touched: &[&str]) -> Vec<Seen> {
        let touched: BTreeSet<PathBuf> = touched.iter().map(PathBuf::from).collect();
        space.settle(root, &touched, false, &BTreeSet::new()).0
    }

    fn said(seen: &[Seen]) -> Vec<String> {
        seen.iter()
            .map(|one| match one {
                Seen::Created(to) => format!("created {}", slash(&to.rel)),
                Seen::Modified(to) => format!("modified {}", slash(&to.rel)),
                Seen::Removed { rel, .. } => format!("removed {}", slash(rel)),
                Seen::Renamed { from, to } => {
                    format!("renamed {} {}", slash(from), slash(&to.rel))
                }
            })
            .collect()
    }

    fn slash(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn space_with(files: &[&str]) -> (tempfile::TempDir, Space) {
        let dir = tempfile::tempdir().expect("a folder");
        for file in files {
            let path = dir.path().join(file);
            if let Some(folder) = path.parent() {
                fs::create_dir_all(folder).expect("its folder");
            }
            fs::write(path, "words").expect("a file");
        }
        let space = Space::read(dir.path()).expect("read");
        (dir, space)
    }

    #[test]
    fn a_new_file_and_a_new_folder_with_everything_in_it() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::write(root.join("Idea.md"), "new").expect("a note");
        fs::create_dir_all(root.join("Trip").join("Days")).expect("folders");
        fs::write(root.join("Trip").join("Days").join("One.md"), "").expect("a note inside");

        assert_eq!(
            said(&settle(&mut space, root, &["Idea.md", "Trip"])),
            [
                "created Idea.md",
                "created Trip",
                "created Trip/Days",
                "created Trip/Days/One.md"
            ]
        );
    }

    #[test]
    fn written_again_is_modified_and_touched_alone_is_nothing() {
        let (dir, mut space) = space_with(&["Plan.md", "Other.md"]);
        let root = dir.path();
        fs::write(root.join("Plan.md"), "words, and more of them").expect("edited");

        assert_eq!(
            said(&settle(&mut space, root, &["Plan.md", "Other.md"])),
            ["modified Plan.md"]
        );
        assert!(
            settle(&mut space, root, &["Plan.md"]).is_empty(),
            "nothing moved since"
        );
    }

    #[test]
    fn a_rename_and_a_move_into_a_folder_keep_their_identity() {
        let (dir, mut space) = space_with(&["Plan.md", "Idea.md", "Projects/Keep.md"]);
        let root = dir.path();
        let plan = space
            .ids
            .iter()
            .find(|(_, rel)| rel.as_path() == Path::new("Plan.md"));
        let plan = plan.map(|(id, _)| id.clone()).expect("an identity");

        fs::rename(root.join("Plan.md"), root.join("Roadmap.md")).expect("renamed");
        fs::rename(root.join("Idea.md"), root.join("Projects").join("Idea.md")).expect("moved");

        let seen = settle(
            &mut space,
            root,
            &["Plan.md", "Roadmap.md", "Idea.md", "Projects/Idea.md"],
        );
        assert_eq!(
            said(&seen),
            [
                "renamed Plan.md Roadmap.md",
                "renamed Idea.md Projects/Idea.md"
            ]
        );
        let Seen::Renamed { to, .. } = &seen[0] else {
            panic!("not a rename");
        };
        assert_eq!(to.id.as_ref(), Some(&plan));
    }

    #[test]
    fn a_folder_renamed_is_one_answer_and_its_notes_follow_it() {
        let (dir, mut space) = space_with(&["Projects/One.md", "Projects/Deep/Two.md"]);
        let root = dir.path();
        fs::rename(root.join("Projects"), root.join("Archive")).expect("renamed");

        let seen = settle(
            &mut space,
            root,
            &["Projects", "Archive", "Projects/One.md", "Archive/One.md"],
        );
        assert_eq!(said(&seen), ["renamed Projects Archive"]);

        fs::write(
            root.join("Archive").join("Deep").join("Two.md"),
            "later, and longer",
        )
        .expect("edited");
        assert_eq!(
            said(&settle(&mut space, root, &["Archive/Deep/Two.md"])),
            ["modified Archive/Deep/Two.md"],
            "what was in it is known at its new place"
        );
    }

    #[test]
    fn a_folder_removed_is_one_answer() {
        let (dir, mut space) = space_with(&["Old/One.md", "Old/Two.md", "Keep.md"]);
        let root = dir.path();
        fs::remove_dir_all(root.join("Old")).expect("removed");

        assert_eq!(
            said(&settle(
                &mut space,
                root,
                &["Old/One.md", "Old/Two.md", "Old"]
            )),
            ["removed Old"]
        );
        assert_eq!(space.len(), 1);
    }

    #[test]
    fn a_save_by_rename_is_modified() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::write(root.join("Plan.md.tmp"), "saved by another editor").expect("the temp file");
        fs::rename(root.join("Plan.md.tmp"), root.join("Plan.md")).expect("renamed over");

        assert_eq!(
            said(&settle(&mut space, root, &["Plan.md.tmp", "Plan.md"])),
            ["modified Plan.md"]
        );
    }

    #[test]
    fn a_rename_over_another_note_is_that_note_written_and_the_first_removed() {
        let (dir, mut space) = space_with(&["A.md", "B.md"]);
        let root = dir.path();
        fs::write(root.join("B.md"), "B's longer words").expect("B edited");
        let _ = settle(&mut space, root, &["B.md"]);
        fs::rename(root.join("B.md"), root.join("A.md")).expect("B over A");

        assert_eq!(
            said(&settle(&mut space, root, &["B.md", "A.md"])),
            ["removed B.md", "modified A.md"]
        );
    }

    #[test]
    fn a_note_renamed_away_and_made_again_is_both() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::rename(root.join("Plan.md"), root.join("Plan (old).md")).expect("renamed");
        fs::write(root.join("Plan.md"), "new").expect("made again");

        assert_eq!(
            said(&settle(&mut space, root, &["Plan.md", "Plan (old).md"])),
            ["renamed Plan.md Plan (old).md", "created Plan.md"]
        );
    }

    #[test]
    fn a_move_split_across_two_batches_is_still_a_move() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::create_dir_all(root.join("Later")).expect("a folder");
        fs::rename(root.join("Plan.md"), root.join("Later").join("Plan.md")).expect("moved");

        let first: BTreeSet<PathBuf> = [PathBuf::from("Plan.md")].into();
        let (seen, held) = space.settle(root, &first, true, &BTreeSet::new());
        assert!(seen.is_empty());
        assert_eq!(held, [PathBuf::from("Plan.md")]);

        let second: BTreeSet<PathBuf> =
            [PathBuf::from("Plan.md"), Path::new("Later").join("Plan.md")].into();
        let released: BTreeSet<PathBuf> = held.into_iter().collect();
        let (seen, held) = space.settle(root, &second, true, &released);
        assert!(held.is_empty());
        assert_eq!(
            said(&seen),
            ["created Later", "renamed Plan.md Later/Plan.md"]
        );
    }

    #[test]
    fn what_sync_leaves_alone_is_never_an_answer() {
        let (dir, mut space) = space_with(&["Plan.md"]);
        let root = dir.path();
        fs::write(root.join(".Plan.md.1-0.orden.tmp"), "half").expect("a temp file");
        fs::create_dir_all(root.join(".git")).expect("a repository");

        assert!(settle(
            &mut space,
            root,
            &[".Plan.md.1-0.orden.tmp", ".git", ".git/HEAD"]
        )
        .is_empty());
    }
}
