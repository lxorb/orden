use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use proc_macro2::{Delimiter, Spacing, TokenStream, TokenTree};
use quote::ToTokens;
use syn::punctuated::Punctuated;
use syn::visit::Visit;
use syn::visit_mut::VisitMut;

const DEEPEST: usize = 8;

const AWAY: [&str; 2] = ["spawn", "spawn_blocking"];

const PEELED: [&str; 4] = ["unwrap", "expect", "unwrap_or_else", "map_err"];

const MAIN: [&str; 8] = [
    "run_on_main_thread",
    "with_webview",
    "on_window_event",
    "on_webview_event",
    "on_menu_event",
    "on_tray_icon_event",
    "on_page_load",
    "run",
];

const GUARDS: [&str; 3] = ["MutexGuard", "RwLockReadGuard", "RwLockWriteGuard"];

#[derive(Default)]
struct Function {
    said: String,
    called: HashSet<String>,
    takes: Vec<String>,
    held: Vec<Held>,
}

struct Held {
    lock: String,
    said: String,
    called: HashSet<String>,
}

#[derive(Default)]
pub(crate) struct Waits {
    reached: HashSet<String>,
    locks: HashMap<String, String>,
    stops: HashSet<String>,
}

impl Waits {
    pub(crate) fn contains(&self, path: &str) -> bool {
        self.reached.contains(path)
    }
}

#[derive(Default)]
pub(crate) struct Crate {
    functions: HashMap<String, Function>,
    commands: Vec<String>,
    mains: Vec<String>,
    modules: usize,
}

impl Crate {
    pub(crate) fn commands(&self) -> &[String] {
        &self.commands
    }

    pub(crate) fn mains(&self) -> &[String] {
        &self.mains
    }

    pub(crate) fn modules(&self) -> usize {
        self.modules
    }

    pub(crate) fn chain(&self, from: &str, words: &[&str], waits: &Waits) -> Vec<String> {
        let words: Vec<String> = words.iter().map(|one| spaced(one)).collect();
        let mut seen: HashSet<String> = HashSet::new();
        let mut paths: Vec<Vec<String>> = vec![vec![from.to_owned()]];
        while let Some(path) = paths.first().cloned() {
            paths.remove(0);
            let last = path.last().expect("a step");
            let Some(function) = self.functions.get(last) else {
                continue;
            };
            if let Some(word) = words.iter().find(|word| function.said.contains(*word)) {
                let mut path = path.clone();
                path.push(word.trim().to_owned());
                return path;
            }
            if let Some(why) = waits.locks.get(last) {
                let mut path = path.clone();
                path.push(why.clone());
                return path;
            }
            for next in &function.called {
                if !waits.stops.contains(next) && seen.insert(next.clone()) {
                    let mut longer = path.clone();
                    longer.push(next.clone());
                    paths.push(longer);
                }
            }
        }
        Vec::new()
    }

    pub(crate) fn reaching(&self, words: &[&str], stops: &[&str]) -> HashSet<String> {
        self.reached(words, stops, &HashSet::new())
    }

    pub(crate) fn waiting(&self, words: &[&str], stops: &[&str]) -> Waits {
        let stopped: HashSet<String> = stops.iter().map(|one| (*one).to_owned()).collect();
        let mut waits = Waits {
            reached: self.reaching(words, stops),
            locks: HashMap::new(),
            stops: stopped.clone(),
        };
        loop {
            let held = self.held_across(words, &waits.reached);
            let locks: HashMap<String, String> = self
                .functions
                .iter()
                .filter_map(|(path, function)| {
                    function.takes.iter().find_map(|lock| {
                        held.iter()
                            .find(|(_, one)| same_lock(lock, one))
                            .map(|(holder, one)| {
                                (
                                    path.clone(),
                                    format!("locks {lock}, held across a wait in {holder} ({one})"),
                                )
                            })
                    })
                })
                .collect();
            let seeds: HashSet<String> = locks.keys().cloned().collect();
            let reached = self.reached(words, stops, &seeds);
            if reached.len() == waits.reached.len() {
                return Waits {
                    reached,
                    locks,
                    stops: stopped,
                };
            }
            waits = Waits {
                reached,
                locks,
                stops: stopped.clone(),
            };
        }
    }

    pub(crate) fn held_across(
        &self,
        words: &[&str],
        waits: &HashSet<String>,
    ) -> Vec<(String, String)> {
        let words: Vec<String> = words.iter().map(|one| spaced(one)).collect();
        let mut held: Vec<(String, String)> = self
            .functions
            .iter()
            .flat_map(|(path, function)| {
                function
                    .held
                    .iter()
                    .filter(|one| {
                        words.iter().any(|word| one.said.contains(word))
                            || one.called.iter().any(|called| waits.contains(called))
                    })
                    .map(|one| (path.clone(), one.lock.clone()))
            })
            .collect();
        held.sort();
        held.dedup();
        held
    }

    fn reached(&self, words: &[&str], stops: &[&str], seeds: &HashSet<String>) -> HashSet<String> {
        let words: Vec<String> = words.iter().map(|one| spaced(one)).collect();
        let going = |path: &String| !stops.contains(&path.as_str());

        let mut reached: HashSet<String> = self
            .functions
            .iter()
            .filter(|(path, function)| {
                going(path)
                    && (seeds.contains(*path)
                        || words.iter().any(|word| function.said.contains(word)))
            })
            .map(|(path, _)| path.clone())
            .collect();

        loop {
            let found: Vec<String> = self
                .functions
                .iter()
                .filter(|(path, function)| {
                    going(path)
                        && !reached.contains(*path)
                        && function.called.iter().any(|one| reached.contains(one))
                })
                .map(|(path, _)| path.clone())
                .collect();
            if found.is_empty() {
                return reached;
            }
            reached.extend(found);
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Target {
    os: &'static str,
    cef: bool,
}

impl Default for Target {
    fn default() -> Self {
        Self::WINDOWS
    }
}

impl Target {
    pub(crate) const WINDOWS: Self = Self {
        os: "windows",
        cef: false,
    };
    pub(crate) const MACOS: Self = Self {
        os: "macos",
        cef: false,
    };
    pub(crate) const LINUX: Self = Self {
        os: "linux",
        cef: true,
    };

    fn allows(self, attrs: &[syn::Attribute]) -> bool {
        attrs
            .iter()
            .filter(|attr| attr.path().is_ident("cfg"))
            .all(|attr| {
                attr.parse_args::<syn::Meta>()
                    .is_ok_and(|one| self.holds(&one))
            })
    }

    fn holds(self, said: &syn::Meta) -> bool {
        let name = said
            .path()
            .get_ident()
            .map(ToString::to_string)
            .unwrap_or_default();
        match said {
            syn::Meta::Path(_) => match name.as_str() {
                "windows" => self.os == "windows",
                "unix" => self.os != "windows",
                "mobile" | "test" | "doc" | "miri" => false,
                _ => true,
            },
            syn::Meta::NameValue(pair) => {
                let syn::Expr::Lit(syn::ExprLit {
                    lit: syn::Lit::Str(value),
                    ..
                }) = &pair.value
                else {
                    return true;
                };
                let value = value.value();
                match name.as_str() {
                    "target_os" => value == self.os,
                    "target_family" => (value == "windows") == (self.os == "windows"),
                    "target_vendor" => (value == "apple") == (self.os == "macos"),
                    "feature" => value == "cef" && self.cef,
                    _ => true,
                }
            }
            syn::Meta::List(list) => {
                let Ok(inner) =
                    list.parse_args_with(Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated)
                else {
                    return true;
                };
                match name.as_str() {
                    "all" => inner.iter().all(|one| self.holds(one)),
                    "any" => inner.iter().any(|one| self.holds(one)),
                    "not" => !inner.iter().all(|one| self.holds(one)),
                    _ => true,
                }
            }
        }
    }
}

struct Cut(Target);

impl VisitMut for Cut {
    fn visit_block_mut(&mut self, block: &mut syn::Block) {
        let target = self.0;
        block.stmts.retain(|statement| match statement {
            syn::Stmt::Local(local) => target.allows(&local.attrs),
            syn::Stmt::Item(item) => item_allowed(target, item),
            syn::Stmt::Expr(expr, _) => target.allows(expr_attrs(expr)),
            syn::Stmt::Macro(called) => target.allows(&called.attrs),
        });
        syn::visit_mut::visit_block_mut(self, block);
    }

    fn visit_expr_match_mut(&mut self, matched: &mut syn::ExprMatch) {
        let target = self.0;
        matched.arms.retain(|arm| target.allows(&arm.attrs));
        syn::visit_mut::visit_expr_match_mut(self, matched);
    }

    fn visit_macro_mut(&mut self, called: &mut syn::Macro) {
        if let Ok(mut arguments) =
            called.parse_body_with(Punctuated::<syn::Expr, syn::Token![,]>::parse_terminated)
        {
            for argument in &mut arguments {
                self.visit_expr_mut(argument);
            }
            called.tokens = arguments.to_token_stream();
        }
    }
}

fn item_allowed(target: Target, item: &syn::Item) -> bool {
    match item {
        syn::Item::Fn(one) => target.allows(&one.attrs),
        syn::Item::Use(one) => target.allows(&one.attrs),
        syn::Item::Impl(one) => target.allows(&one.attrs),
        syn::Item::Mod(one) => target.allows(&one.attrs),
        syn::Item::Static(one) => target.allows(&one.attrs),
        syn::Item::Const(one) => target.allows(&one.attrs),
        _ => true,
    }
}

fn expr_attrs(expr: &syn::Expr) -> &[syn::Attribute] {
    match expr {
        syn::Expr::Block(one) => &one.attrs,
        syn::Expr::Call(one) => &one.attrs,
        syn::Expr::MethodCall(one) => &one.attrs,
        syn::Expr::If(one) => &one.attrs,
        syn::Expr::Match(one) => &one.attrs,
        syn::Expr::Macro(one) => &one.attrs,
        syn::Expr::Return(one) => &one.attrs,
        syn::Expr::Assign(one) => &one.attrs,
        syn::Expr::Path(one) => &one.attrs,
        syn::Expr::Unsafe(one) => &one.attrs,
        syn::Expr::Let(one) => &one.attrs,
        syn::Expr::Try(one) => &one.attrs,
        _ => &[],
    }
}

pub(crate) fn read(lib: &Path, target: Target) -> Crate {
    let mut gathered = Gathered {
        target,
        ..Gathered::default()
    };
    gathered.file("crate", lib, true);
    gathered.resolved()
}

pub(crate) fn of(modules: &[(&str, &str)]) -> Crate {
    let mut gathered = Gathered::default();
    for (module, source) in modules {
        let parsed = syn::parse_file(source).expect("a module's source");
        gathered.items(module, &parsed.items, None, &Scope::default());
    }
    gathered.resolved()
}

pub(crate) fn called(source: &str) -> HashSet<String> {
    let mut found = Vec::new();
    calls(source.parse().expect("tokens"), &mut found);
    found.into_iter().map(|path| path.join("::")).collect()
}

#[derive(Clone, Default)]
struct Scope {
    named: HashMap<String, Vec<Vec<String>>>,
    globs: Vec<Vec<String>>,
}

impl Scope {
    fn joined(&mut self, other: &Scope) {
        for (name, targets) in &other.named {
            self.named
                .entry(name.clone())
                .or_default()
                .extend(targets.iter().cloned());
        }
        self.globs.extend(other.globs.iter().cloned());
    }
}

struct Found {
    path: String,
    module: String,
    owner: Option<String>,
    scope: Scope,
    calls: Vec<Vec<String>>,
    said: String,
    command: bool,
    locks: Locks,
    params: Vec<String>,
    shape: Shape,
    mains: Vec<Vec<String>>,
    main: bool,
    passed_to: Option<Vec<String>>,
}

#[derive(Default)]
struct Locks {
    takes: Vec<Key>,
    passes: Vec<(Vec<String>, Key)>,
    held: Vec<Hold>,
    handed: Vec<Handed>,
}

#[derive(Default)]
struct Shape {
    accessor: bool,
    helper: bool,
    relay: bool,
}

fn locks_in(place: &str, module: &str, visit: impl FnOnce(&mut Taking, &mut Holding)) -> Locks {
    let mut taking = Taking {
        owner: place,
        module,
        takes: Vec::new(),
        passes: Vec::new(),
    };
    let mut holding = Holding {
        owner: place,
        module,
        held: Vec::new(),
        handed: Vec::new(),
    };
    visit(&mut taking, &mut holding);
    Locks {
        takes: taking.takes,
        passes: taking.passes,
        held: holding.held,
        handed: holding.handed,
    }
}

#[derive(Clone, Debug)]
enum Key {
    Named(String),
    Path(Vec<String>),
    Call(Vec<String>),
}

#[derive(Clone, Debug)]
enum Guard {
    Lock(Key),
    Through(Vec<String>, Option<Key>),
    Method(String),
}

struct Hold {
    guard: Guard,
    calls: Vec<Vec<String>>,
    said: String,
}

struct Known<'a> {
    relays: &'a HashSet<String>,
    accessors: &'a HashMap<String, Vec<String>>,
    helpers: &'a HashMap<String, Vec<String>>,
}

struct Handed {
    to: Vec<String>,
    calls: Vec<Vec<String>>,
    said: String,
}

#[derive(Default)]
struct Gathered {
    target: Target,
    modules: HashMap<String, Scope>,
    owners: HashSet<String>,
    found: Vec<Found>,
    known: HashSet<String>,
}

#[derive(Default)]
struct Body<'a> {
    nested: Vec<&'a syn::ItemFn>,
    scope: Scope,
}

impl<'a> Visit<'a> for Body<'a> {
    fn visit_item_fn(&mut self, function: &'a syn::ItemFn) {
        if !tested(&function.attrs) {
            self.nested.push(function);
        }
    }

    fn visit_item_use(&mut self, used: &'a syn::ItemUse) {
        named(&used.tree, Vec::new(), &mut self.scope);
    }

    fn visit_item_impl(&mut self, _: &'a syn::ItemImpl) {}

    fn visit_item_mod(&mut self, _: &'a syn::ItemMod) {}
}

impl Gathered {
    fn file(&mut self, module: &str, file: &Path, owns: bool) {
        let source = fs::read_to_string(file)
            .unwrap_or_else(|error| panic!("{} could not be read: {error}", file.display()));
        let parsed = syn::parse_file(&source)
            .unwrap_or_else(|error| panic!("{} could not be parsed: {error}", file.display()));
        let here = file.parent().expect("a module's folder").to_path_buf();
        let children = if owns {
            here.clone()
        } else {
            here.join(file.file_stem().expect("a module's name"))
        };
        self.items(
            module,
            &parsed.items,
            Some((children.as_path(), here.as_path())),
            &Scope::default(),
        );
    }

    fn items(
        &mut self,
        module: &str,
        items: &[syn::Item],
        files: Option<(&Path, &Path)>,
        outer: &Scope,
    ) {
        self.modules.entry(module.to_owned()).or_default();
        self.owners.insert(module.to_owned());

        for item in items {
            if !item_allowed(self.target, item) {
                continue;
            }
            match item {
                syn::Item::Fn(function) if !tested(&function.attrs) => {
                    self.function(
                        module,
                        None,
                        &function.attrs,
                        &function.sig,
                        &function.block,
                        outer,
                    );
                }
                syn::Item::Impl(block) if !tested(&block.attrs) => {
                    let Some(owner) = owner_of(&block.self_ty) else {
                        continue;
                    };
                    let owner = format!("{module}::{owner}");
                    self.owners.insert(owner.clone());
                    for inner in &block.items {
                        if let syn::ImplItem::Fn(function) = inner {
                            if !tested(&function.attrs) && self.target.allows(&function.attrs) {
                                self.function(
                                    module,
                                    Some(&owner),
                                    &function.attrs,
                                    &function.sig,
                                    &function.block,
                                    outer,
                                );
                            }
                        }
                    }
                }
                syn::Item::Trait(shape) if !tested(&shape.attrs) => {
                    let owner = format!("{module}::{}", shape.ident);
                    self.owners.insert(owner.clone());
                    for inner in &shape.items {
                        if let syn::TraitItem::Fn(function) = inner {
                            if !self.target.allows(&function.attrs) {
                                continue;
                            }
                            if let Some(block) = &function.default {
                                self.function(
                                    module,
                                    Some(&owner),
                                    &function.attrs,
                                    &function.sig,
                                    block,
                                    outer,
                                );
                            }
                        }
                    }
                }
                syn::Item::Use(used) if !tested(&used.attrs) => {
                    let scope = self.modules.entry(module.to_owned()).or_default();
                    named(&used.tree, Vec::new(), scope);
                }
                syn::Item::Mod(inner) if !tested(&inner.attrs) => {
                    self.module(module, inner, files);
                }
                _ => {}
            }
        }
    }

    fn module(&mut self, module: &str, inner: &syn::ItemMod, files: Option<(&Path, &Path)>) {
        let path = format!("{module}::{}", inner.ident);
        let name = inner.ident.to_string();

        if let Some((_, content)) = &inner.content {
            let nested = files.map(|(children, _)| children.join(&name));
            let files = nested.as_deref().map(|children| (children, children));
            self.items(&path, content, files, &Scope::default());
            return;
        }

        let Some((children, here)) = files else {
            return;
        };
        let alone = children.join(format!("{name}.rs"));
        let (file, owns) = if let Some(file) = placed(&inner.attrs, here) {
            (file, true)
        } else if alone.exists() {
            (alone, false)
        } else {
            (children.join(&name).join("mod.rs"), true)
        };
        self.file(&path, &file, owns);
    }

    fn function(
        &mut self,
        module: &str,
        owner: Option<&str>,
        attrs: &[syn::Attribute],
        sig: &syn::Signature,
        block: &syn::Block,
        outer: &Scope,
    ) {
        let path = format!("{}::{}", owner.unwrap_or(module), sig.ident);
        let mut block = block.clone();
        Cut(self.target).visit_block_mut(&mut block);
        let block = &block;

        let mut body = Body::default();
        body.visit_block(block);
        let mut scope = outer.clone();
        scope.joined(&body.scope);

        let tokens = block.to_token_stream();
        let mut found = Vec::new();
        calls(tokens.clone(), &mut found);
        let mut said = String::from(" ");
        spoken(tokens, &mut said);

        let locks = locks_in(owner.unwrap_or(module), module, |taking, holding| {
            taking.visit_block(block);
            holding.visit_block(block);
        });
        let mut mains = Mains::default();
        mains.visit_block(block);
        for (at, body) in mains.closures.iter().enumerate() {
            self.closure(
                module,
                owner,
                &format!("{path}::main#{at}"),
                body,
                &scope,
                None,
            );
        }
        for (at, (to, body)) in mains.passed.iter().enumerate() {
            self.closure(
                module,
                owner,
                &format!("{path}::passed#{at}"),
                body,
                &scope,
                Some(to.clone()),
            );
        }
        let params: Vec<String> = sig
            .inputs
            .iter()
            .filter_map(|one| match one {
                syn::FnArg::Typed(typed) => bound(&typed.pat),
                syn::FnArg::Receiver(_) => None,
            })
            .collect();
        let relay = mains.closures.iter().any(|body| {
            let said = said_of(body.to_token_stream());
            params
                .iter()
                .any(|param| said.contains(&spaced(&format!("{param}("))))
        }) || mains
            .named
            .iter()
            .any(|named| matches!(named.as_slice(), [one] if params.contains(one)));
        let output = sig.output.to_token_stream().to_string();
        let inputs = format!(
            "{} {}",
            sig.inputs.to_token_stream(),
            sig.generics.to_token_stream()
        );

        for nested in &body.nested {
            self.function(
                module,
                None,
                &nested.attrs,
                &nested.sig,
                &nested.block,
                &scope,
            );
        }

        self.found.push(Found {
            path,
            module: module.to_owned(),
            owner: owner.map(str::to_owned),
            scope,
            calls: found,
            said,
            command: command(attrs, sig),
            locks,
            params,
            shape: Shape {
                accessor: GUARDS.iter().any(|guard| output.contains(guard)),
                helper: ["Fn (", "FnOnce (", "FnMut ("]
                    .iter()
                    .any(|one| inputs.contains(one)),
                relay,
            },
            mains: mains.named,
            main: false,
            passed_to: None,
        });
    }

    fn closure(
        &mut self,
        module: &str,
        owner: Option<&str>,
        path: &str,
        body: &syn::Expr,
        scope: &Scope,
        passed_to: Option<Vec<String>>,
    ) {
        let locks = locks_in(owner.unwrap_or(module), module, |taking, holding| {
            taking.visit_expr(body);
            holding.visit_expr(body);
        });
        let tokens = body.to_token_stream();
        self.found.push(Found {
            path: path.to_owned(),
            module: module.to_owned(),
            owner: owner.map(str::to_owned),
            scope: scope.clone(),
            calls: found_calls(tokens.clone()),
            said: said_of(tokens),
            command: false,
            locks,
            params: Vec::new(),
            shape: Shape::default(),
            mains: Vec::new(),
            main: passed_to.is_none(),
            passed_to,
        });
    }

    fn resolved(mut self) -> Crate {
        self.known = self.found.iter().map(|one| one.path.clone()).collect();

        let mut own = Crate {
            modules: self.modules.len(),
            ..Crate::default()
        };

        for (path, takes, held) in self.locked() {
            let function = own.functions.entry(path).or_default();
            function.takes.extend(takes);
            function.held.extend(held);
        }

        let relays_main: HashSet<String> = self
            .found
            .iter()
            .filter(|found| found.shape.relay)
            .map(|found| found.path.clone())
            .collect();
        for found in &self.found {
            let called: Vec<String> = found
                .calls
                .iter()
                .flat_map(|path| {
                    self.absolute(
                        &found.module,
                        Some(&found.scope),
                        found.owner.as_deref(),
                        path,
                        0,
                    )
                })
                .flat_map(|path| self.landing(&path, 0))
                .collect();

            let function = own.functions.entry(found.path.clone()).or_default();
            function.said.push_str(&found.said);
            function.called.extend(called);

            if found.command && !own.commands.contains(&found.path) {
                own.commands.push(found.path.clone());
            }
            if found.main && !own.mains.contains(&found.path) {
                own.mains.push(found.path.clone());
            }
            for named in &found.mains {
                for one in self.resolve(found, named) {
                    if !own.mains.contains(&one) {
                        own.mains.push(one);
                    }
                }
            }
            let relayed = found.passed_to.as_ref().is_some_and(|to| {
                self.resolve(found, to)
                    .iter()
                    .any(|one| relays_main.contains(one))
            });
            if relayed && !own.mains.contains(&found.path) {
                own.mains.push(found.path.clone());
            }
        }

        own
    }

    fn locked(&self) -> Vec<(String, Vec<String>, Vec<Held>)> {
        let mut relays: HashSet<String> = HashSet::new();
        let mut takes: Vec<Vec<String>> = Vec::new();
        for found in &self.found {
            let mut keys = Vec::new();
            for key in &found.locks.takes {
                let key = self.key(found, key);
                if unknown(&key).is_some_and(|(name, _)| found.params.iter().any(|one| one == name))
                {
                    relays.insert(found.path.clone());
                } else {
                    keys.push(key);
                }
            }
            takes.push(keys);
        }
        for (found, keys) in self.found.iter().zip(takes.iter_mut()) {
            for (to, key) in &found.locks.passes {
                if self
                    .resolve(found, to)
                    .iter()
                    .any(|one| relays.contains(one))
                {
                    keys.push(self.key(found, key));
                }
            }
        }
        let mut accessors: HashMap<String, Vec<String>> = HashMap::new();
        let mut helpers: HashMap<String, Vec<String>> = HashMap::new();
        for (found, keys) in self.found.iter().zip(&takes) {
            if keys.is_empty() {
                continue;
            }
            if found.shape.accessor {
                accessors
                    .entry(found.path.clone())
                    .or_default()
                    .extend(keys.iter().cloned());
            }
            if found.shape.helper {
                helpers
                    .entry(found.path.clone())
                    .or_default()
                    .extend(keys.iter().cloned());
            }
        }
        let known = Known {
            relays: &relays,
            accessors: &accessors,
            helpers: &helpers,
        };
        self.found
            .iter()
            .zip(takes)
            .map(|(found, keys)| (found.path.clone(), keys, self.held_in(found, &known)))
            .collect()
    }

    fn held_in(&self, found: &Found, known: &Known<'_>) -> Vec<Held> {
        let mut held = Vec::new();
        for hold in &found.locks.held {
            let locks: Vec<String> = match &hold.guard {
                Guard::Lock(key) => vec![self.key(found, key)],
                Guard::Through(path, first) => {
                    let called = self.resolve(found, path);
                    match first {
                        Some(first) if called.iter().any(|one| known.relays.contains(one)) => {
                            vec![self.key(found, first)]
                        }
                        _ => called
                            .iter()
                            .filter_map(|one| known.accessors.get(one))
                            .flatten()
                            .cloned()
                            .collect(),
                    }
                }
                Guard::Method(name) => known
                    .accessors
                    .iter()
                    .filter(|(path, _)| path.ends_with(&format!("::{name}")))
                    .flat_map(|(_, keys)| keys.iter().cloned())
                    .collect(),
            };
            let called = self.resolve_all(found, &hold.calls);
            for lock in locks {
                held.push(Held {
                    lock,
                    said: hold.said.clone(),
                    called: called.clone(),
                });
            }
        }
        for handed in &found.locks.handed {
            let locks: Vec<String> = self
                .resolve(found, &handed.to)
                .iter()
                .filter_map(|one| known.helpers.get(one))
                .flatten()
                .cloned()
                .collect();
            let called = self.resolve_all(found, &handed.calls);
            for lock in locks {
                held.push(Held {
                    lock,
                    said: handed.said.clone(),
                    called: called.clone(),
                });
            }
        }
        held
    }

    fn resolve(&self, found: &Found, path: &[String]) -> Vec<String> {
        self.absolute(
            &found.module,
            Some(&found.scope),
            found.owner.as_deref(),
            path,
            0,
        )
        .into_iter()
        .flat_map(|one| self.landing(&one, 0))
        .collect()
    }

    fn resolve_all(&self, found: &Found, calls: &[Vec<String>]) -> HashSet<String> {
        calls
            .iter()
            .flat_map(|path| self.resolve(found, path))
            .collect()
    }

    fn key(&self, found: &Found, key: &Key) -> String {
        match key {
            Key::Named(name) => name.clone(),
            Key::Path(path) => self
                .absolute(
                    &found.module,
                    Some(&found.scope),
                    found.owner.as_deref(),
                    path,
                    0,
                )
                .into_iter()
                .next()
                .unwrap_or_else(|| joined(&found.module, path)),
            Key::Call(path) => {
                let called = self
                    .resolve(found, path)
                    .into_iter()
                    .next()
                    .unwrap_or_else(|| joined(&found.module, path));
                format!("{called}()")
            }
        }
    }

    fn absolute(
        &self,
        module: &str,
        local: Option<&Scope>,
        owner: Option<&str>,
        segments: &[String],
        depth: usize,
    ) -> Vec<String> {
        let Some(first) = segments.first() else {
            return Vec::new();
        };
        if depth > DEEPEST {
            return Vec::new();
        }

        match first.as_str() {
            "crate" => vec![joined("crate", &segments[1..])],
            "self" => vec![joined(module, &segments[1..])],
            "Self" => owner
                .map(|owner| joined(owner, &segments[1..]))
                .into_iter()
                .collect(),
            "super" => {
                let mut base = module;
                let mut rest = segments;
                while rest.first().is_some_and(|one| one == "super") {
                    base = base.rsplit_once("::").map_or(base, |(parent, _)| parent);
                    rest = &rest[1..];
                }
                vec![joined(base, rest)]
            }
            _ => self.named(module, local, segments, depth),
        }
    }

    fn named(
        &self,
        module: &str,
        local: Option<&Scope>,
        segments: &[String],
        depth: usize,
    ) -> Vec<String> {
        let first = &segments[0];
        let rest = &segments[1..];
        let scopes: Vec<&Scope> = local.into_iter().chain(self.modules.get(module)).collect();

        let mut found: Vec<String> = scopes
            .iter()
            .filter_map(|scope| scope.named.get(first))
            .flatten()
            .flat_map(|target| self.absolute(module, None, None, target, depth + 1))
            .map(|base| joined(&base, rest))
            .collect();

        let here = joined(module, segments);
        if self.owners.contains(&format!("{module}::{first}")) || self.known.contains(&here) {
            found.push(here);
        }
        if !found.is_empty() {
            return found;
        }

        scopes
            .iter()
            .flat_map(|scope| scope.globs.iter())
            .flat_map(|glob| self.absolute(module, None, None, glob, depth + 1))
            .map(|base| joined(&base, segments))
            .collect()
    }

    fn landing(&self, path: &str, depth: usize) -> Vec<String> {
        if self.known.contains(path) {
            return vec![path.to_owned()];
        }
        if depth > DEEPEST {
            return Vec::new();
        }

        let segments: Vec<String> = path.split("::").map(str::to_owned).collect();
        for at in (1..segments.len()).rev() {
            let base = segments[..at].join("::");
            let Some(scope) = self.modules.get(&base) else {
                continue;
            };
            if !scope.named.contains_key(&segments[at]) && scope.globs.is_empty() {
                continue;
            }
            let landed: Vec<String> = self
                .named(&base, None, &segments[at..], depth + 1)
                .into_iter()
                .filter(|one| one != path)
                .flat_map(|one| self.landing(&one, depth + 1))
                .collect();
            if !landed.is_empty() {
                return landed;
            }
        }
        Vec::new()
    }
}

fn joined(base: &str, rest: &[String]) -> String {
    let mut path = base.to_owned();
    for one in rest {
        path.push_str("::");
        path.push_str(one);
    }
    path
}

fn named(tree: &syn::UseTree, mut prefix: Vec<String>, scope: &mut Scope) {
    match tree {
        syn::UseTree::Path(path) => {
            prefix.push(path.ident.to_string());
            named(&path.tree, prefix, scope);
        }
        syn::UseTree::Name(name) => {
            if name.ident != "self" {
                prefix.push(name.ident.to_string());
            }
            if let Some(alias) = prefix.last().cloned() {
                scope.named.entry(alias).or_default().push(prefix);
            }
        }
        syn::UseTree::Rename(rename) => {
            if rename.rename == "_" {
                return;
            }
            if rename.ident != "self" {
                prefix.push(rename.ident.to_string());
            }
            scope
                .named
                .entry(rename.rename.to_string())
                .or_default()
                .push(prefix);
        }
        syn::UseTree::Glob(_) => scope.globs.push(prefix),
        syn::UseTree::Group(group) => {
            for one in &group.items {
                named(one, prefix.clone(), scope);
            }
        }
    }
}

fn tested(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path().is_ident("cfg")
            && matches!(&attr.meta, syn::Meta::List(list) if list.tokens.to_string() == "test")
    })
}

fn placed(attrs: &[syn::Attribute], here: &Path) -> Option<PathBuf> {
    attrs.iter().find_map(|attr| {
        let syn::Meta::NameValue(pair) = &attr.meta else {
            return None;
        };
        if !pair.path.is_ident("path") {
            return None;
        }
        let syn::Expr::Lit(syn::ExprLit {
            lit: syn::Lit::Str(place),
            ..
        }) = &pair.value
        else {
            return None;
        };
        Some(here.join(place.value()))
    })
}

fn owner_of(shape: &syn::Type) -> Option<String> {
    let syn::Type::Path(path) = shape else {
        return None;
    };
    path.path.segments.last().map(|one| one.ident.to_string())
}

fn command(attrs: &[syn::Attribute], sig: &syn::Signature) -> bool {
    sig.asyncness.is_none()
        && attrs.iter().any(|attr| {
            let path = attr.path();
            let said: Vec<String> = path
                .segments
                .iter()
                .map(|one| one.ident.to_string())
                .collect();
            said == ["tauri", "command"]
                && match &attr.meta {
                    syn::Meta::List(list) => !list
                        .tokens
                        .clone()
                        .into_iter()
                        .any(|one| matches!(&one, TokenTree::Ident(word) if word == "async")),
                    _ => true,
                }
        })
}

fn calls(stream: TokenStream, found: &mut Vec<Vec<String>>) {
    let tokens: Vec<TokenTree> = stream.into_iter().collect();
    let mut at = 0;

    while at < tokens.len() {
        if let TokenTree::Group(group) = &tokens[at] {
            if !away(&tokens, at) {
                calls(group.stream(), found);
            }
            at += 1;
            continue;
        }
        if let Some(method) = method_at(&tokens, at) {
            found.push(method);
            at += 1;
            continue;
        }
        if !matches!(tokens[at], TokenTree::Ident(_)) || (at > 0 && not_a_call(&tokens, at)) {
            at += 1;
            continue;
        }

        let (path, next) = path_at(&tokens, at);
        if matches!(tokens.get(next), Some(TokenTree::Group(group)) if group.delimiter() == Delimiter::Parenthesis)
        {
            found.push(path);
        }
        at = next;
    }
}

fn method_at(tokens: &[TokenTree], at: usize) -> Option<Vec<String>> {
    let TokenTree::Ident(name) = &tokens[at] else {
        return None;
    };
    let dotted = at > 0 && matches!(&tokens[at - 1], TokenTree::Punct(dot) if dot.as_char() == '.');
    let called = matches!(tokens.get(at + 1), Some(TokenTree::Group(group)) if group.delimiter() == Delimiter::Parenthesis);
    if !dotted || !called {
        return None;
    }
    let on_self = at > 1 && matches!(&tokens[at - 2], TokenTree::Ident(word) if word == "self");
    let after_a_path =
        at > 2 && matches!(&tokens[at - 3], TokenTree::Punct(colon) if colon.as_char() == ':');
    (on_self && !after_a_path).then(|| vec!["Self".to_owned(), name.to_string()])
}

fn not_a_call(tokens: &[TokenTree], at: usize) -> bool {
    match &tokens[at - 1] {
        TokenTree::Punct(punct) if punct.as_char() == '.' => true,
        TokenTree::Punct(punct) if punct.as_char() == ':' => {
            at > 1 && matches!(&tokens[at - 2], TokenTree::Punct(before) if before.as_char() == ':')
        }
        TokenTree::Ident(word) => word == "fn",
        _ => false,
    }
}

fn path_at(tokens: &[TokenTree], from: usize) -> (Vec<String>, usize) {
    let mut path = vec![tokens[from].to_string()];
    let mut at = from + 1;

    while colons(tokens, at) {
        match tokens.get(at + 2) {
            Some(TokenTree::Ident(next)) => {
                path.push(next.to_string());
                at += 3;
            }
            Some(TokenTree::Punct(open)) if open.as_char() == '<' => {
                at = past_angles(tokens, at + 2);
            }
            _ => break,
        }
    }

    (path, at)
}

fn colons(tokens: &[TokenTree], at: usize) -> bool {
    matches!(
        (tokens.get(at), tokens.get(at + 1)),
        (Some(TokenTree::Punct(one)), Some(TokenTree::Punct(two)))
            if one.as_char() == ':' && one.spacing() == Spacing::Joint && two.as_char() == ':'
    )
}

fn past_angles(tokens: &[TokenTree], from: usize) -> usize {
    let mut depth = 0usize;
    let mut at = from;

    while let Some(token) = tokens.get(at) {
        at += 1;
        let TokenTree::Punct(punct) = token else {
            continue;
        };
        match punct.as_char() {
            '<' => depth += 1,
            '>' if !arrow(tokens, at - 1) => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
    }

    at
}

fn arrow(tokens: &[TokenTree], at: usize) -> bool {
    at > 0
        && matches!(&tokens[at - 1], TokenTree::Punct(dash) if dash.as_char() == '-' && dash.spacing() == Spacing::Joint)
}

fn away(tokens: &[TokenTree], at: usize) -> bool {
    matches!(&tokens[at], TokenTree::Group(group) if group.delimiter() == Delimiter::Parenthesis)
        && at > 0
        && matches!(&tokens[at - 1], TokenTree::Ident(word) if AWAY.iter().any(|one| word == one))
}

fn spoken(stream: TokenStream, said: &mut String) {
    let tokens: Vec<TokenTree> = stream.into_iter().collect();
    for (at, token) in tokens.iter().enumerate() {
        if away(&tokens, at) {
            said.push_str("( ) ");
            continue;
        }
        match token.clone() {
            TokenTree::Group(group) => {
                let (open, close) = match group.delimiter() {
                    Delimiter::Parenthesis => ("( ", ") "),
                    Delimiter::Brace => ("{ ", "} "),
                    Delimiter::Bracket => ("[ ", "] "),
                    Delimiter::None => ("", ""),
                };
                said.push_str(open);
                spoken(group.stream(), said);
                said.push_str(close);
            }
            TokenTree::Punct(punct) => {
                said.push(punct.as_char());
                said.push(' ');
            }
            other => {
                said.push_str(&other.to_string());
                said.push(' ');
            }
        }
    }
}

fn spaced(word: &str) -> String {
    let mut said = String::from(" ");
    for letter in word.chars().filter(|one| !one.is_whitespace()) {
        if letter.is_alphanumeric() || letter == '_' {
            said.push(letter);
        } else {
            if !said.ends_with(' ') {
                said.push(' ');
            }
            said.push(letter);
            said.push(' ');
        }
    }
    if !said.ends_with(' ') {
        said.push(' ');
    }
    said
}

fn same_lock(one: &str, other: &str) -> bool {
    if one == "?" || other == "?" {
        return false;
    }
    match (unknown(one), unknown(other)) {
        (None, None) => one == other,
        (Some((name, module)), None) | (None, Some((name, module))) => {
            let known = if unknown(one).is_some() { other } else { one };
            known.ends_with(&format!("::{name}")) && known.starts_with(top(module))
        }
        (Some(one), Some(other)) => one == other,
    }
}

fn unknown(key: &str) -> Option<(&str, &str)> {
    key.strip_prefix('?')?.split_once('@')
}

fn top(module: &str) -> &str {
    let mut cut = module.match_indices("::").map(|(at, _)| at);
    cut.nth(1).map_or(module, |at| &module[..at])
}

fn segments(path: &syn::Path) -> Vec<String> {
    path.segments
        .iter()
        .map(|one| one.ident.to_string())
        .collect()
}

fn found_calls(tokens: TokenStream) -> Vec<Vec<String>> {
    let mut found = Vec::new();
    calls(tokens, &mut found);
    found
}

fn said_of(tokens: TokenStream) -> String {
    let mut said = String::from(" ");
    spoken(tokens, &mut said);
    said
}

fn key_of(expr: &syn::Expr, owner: &str, module: &str) -> Key {
    let unknown = |name: &str| Key::Named(format!("?{name}@{module}"));
    match expr {
        syn::Expr::Field(field) => {
            let name = match &field.member {
                syn::Member::Named(name) => name.to_string(),
                syn::Member::Unnamed(index) => index.index.to_string(),
            };
            if matches!(&*field.base, syn::Expr::Path(base) if base.path.is_ident("self")) {
                Key::Named(format!("{owner}::{name}"))
            } else if matches!(field.member, syn::Member::Unnamed(_)) {
                Key::Named("?".to_owned())
            } else {
                unknown(&name)
            }
        }
        syn::Expr::Path(path) => {
            let path = segments(&path.path);
            match path.as_slice() {
                [one] if one.starts_with(|letter: char| letter.is_lowercase()) => unknown(one),
                _ => Key::Path(path),
            }
        }
        syn::Expr::Call(call) => match &*call.func {
            syn::Expr::Path(path) => Key::Call(segments(&path.path)),
            _ => Key::Named("?".to_owned()),
        },
        syn::Expr::MethodCall(call) => {
            let kind: String = call
                .turbofish
                .to_token_stream()
                .to_string()
                .chars()
                .filter(|one| !one.is_whitespace())
                .collect();
            unknown(&format!("{}{kind}()", call.method))
        }
        syn::Expr::Paren(inner) => key_of(&inner.expr, owner, module),
        syn::Expr::Reference(inner) => key_of(&inner.expr, owner, module),
        syn::Expr::Unary(inner) => key_of(&inner.expr, owner, module),
        _ => Key::Named("?".to_owned()),
    }
}

fn guard_of(expr: &syn::Expr, owner: &str, module: &str) -> Option<Guard> {
    let mut at = expr;
    loop {
        match at {
            syn::Expr::MethodCall(call) if PEELED.iter().any(|one| call.method == one) => {
                at = &call.receiver;
            }
            syn::Expr::Try(inner) => at = &inner.expr,
            syn::Expr::Paren(inner) => at = &inner.expr,
            _ => break,
        }
    }
    match at {
        syn::Expr::MethodCall(call) if call.method == "lock" && call.args.is_empty() => {
            Some(Guard::Lock(key_of(&call.receiver, owner, module)))
        }
        syn::Expr::MethodCall(call) => Some(Guard::Method(call.method.to_string())),
        syn::Expr::Call(call) => match &*call.func {
            syn::Expr::Path(path) => Some(Guard::Through(
                segments(&path.path),
                call.args.first().map(|first| key_of(first, owner, module)),
            )),
            _ => None,
        },
        _ => None,
    }
}

fn bound(pattern: &syn::Pat) -> Option<String> {
    match pattern {
        syn::Pat::Ident(name) => Some(name.ident.to_string()),
        syn::Pat::Type(typed) => bound(&typed.pat),
        _ => None,
    }
}

fn dropped(statement: &syn::Stmt, name: Option<&str>) -> bool {
    let (Some(name), syn::Stmt::Expr(syn::Expr::Call(call), _)) = (name, statement) else {
        return false;
    };
    matches!(&*call.func, syn::Expr::Path(path) if path.path.segments.last().is_some_and(|one| one.ident == "drop"))
        && matches!(call.args.first(), Some(syn::Expr::Path(path)) if path.path.is_ident(name))
}

struct Taking<'o> {
    owner: &'o str,
    module: &'o str,
    takes: Vec<Key>,
    passes: Vec<(Vec<String>, Key)>,
}

impl<'a> Visit<'a> for Taking<'_> {
    fn visit_expr_method_call(&mut self, call: &'a syn::ExprMethodCall) {
        if call.method == "lock" && call.args.is_empty() {
            self.takes
                .push(key_of(&call.receiver, self.owner, self.module));
        }
        if AWAY.iter().any(|one| call.method == one) {
            self.visit_expr(&call.receiver);
            return;
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_call(&mut self, call: &'a syn::ExprCall) {
        if matches!(&*call.func, syn::Expr::Path(path) if path.path.segments.last().is_some_and(|one| AWAY.iter().any(|away| one.ident == away)))
        {
            return;
        }
        if let (syn::Expr::Path(path), Some(first)) = (&*call.func, call.args.first()) {
            self.passes
                .push((segments(&path.path), key_of(first, self.owner, self.module)));
        }
        syn::visit::visit_expr_call(self, call);
    }

    fn visit_item_fn(&mut self, _: &'a syn::ItemFn) {}

    fn visit_item_impl(&mut self, _: &'a syn::ItemImpl) {}

    fn visit_item_mod(&mut self, _: &'a syn::ItemMod) {}
}

#[derive(Default)]
struct Temporaries {
    found: Vec<syn::Expr>,
}

impl<'a> Visit<'a> for Temporaries {
    fn visit_expr_method_call(&mut self, call: &'a syn::ExprMethodCall) {
        if call.method == "lock" && call.args.is_empty() {
            self.found.push((*call.receiver).clone());
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_block(&mut self, _: &'a syn::Block) {}

    fn visit_expr_match(&mut self, matched: &'a syn::ExprMatch) {
        self.visit_expr(&matched.expr);
    }

    fn visit_expr_closure(&mut self, _: &'a syn::ExprClosure) {}

    fn visit_expr_async(&mut self, _: &'a syn::ExprAsync) {}

    fn visit_item_fn(&mut self, _: &'a syn::ItemFn) {}
}

struct Holding<'o> {
    owner: &'o str,
    module: &'o str,
    held: Vec<Hold>,
    handed: Vec<Handed>,
}

impl Holding<'_> {
    fn hold(&mut self, guard: Guard, tokens: TokenStream) {
        self.held.push(Hold {
            guard,
            calls: found_calls(tokens.clone()),
            said: said_of(tokens),
        });
    }

    fn temporaries(&mut self, expr: &syn::Expr) {
        let mut temporaries = Temporaries::default();
        temporaries.visit_expr(expr);
        for receiver in temporaries.found {
            let key = key_of(&receiver, self.owner, self.module);
            self.hold(Guard::Lock(key), expr.to_token_stream());
        }
    }
}

impl<'a> Visit<'a> for Holding<'_> {
    fn visit_block(&mut self, block: &'a syn::Block) {
        for (at, statement) in block.stmts.iter().enumerate() {
            match statement {
                syn::Stmt::Local(local) => {
                    let Some(init) = &local.init else {
                        continue;
                    };
                    if let Some(guard) = guard_of(&init.expr, self.owner, self.module) {
                        let name = bound(&local.pat);
                        let rest: TokenStream = block.stmts[at + 1..]
                            .iter()
                            .take_while(|one| !dropped(one, name.as_deref()))
                            .map(ToTokens::to_token_stream)
                            .collect();
                        self.hold(guard, rest);
                    }
                    self.temporaries(&init.expr);
                }
                syn::Stmt::Expr(expr, _) => self.temporaries(expr),
                _ => {}
            }
        }
        syn::visit::visit_block(self, block);
    }

    fn visit_expr_match(&mut self, matched: &'a syn::ExprMatch) {
        for arm in &matched.arms {
            if !matches!(&*arm.body, syn::Expr::Block(_)) {
                self.temporaries(&arm.body);
            }
        }
        syn::visit::visit_expr_match(self, matched);
    }

    fn visit_expr_call(&mut self, call: &'a syn::ExprCall) {
        if let syn::Expr::Path(path) = &*call.func {
            for argument in &call.args {
                if let syn::Expr::Closure(closure) = argument {
                    let tokens = closure.body.to_token_stream();
                    self.handed.push(Handed {
                        to: segments(&path.path),
                        calls: found_calls(tokens.clone()),
                        said: said_of(tokens),
                    });
                }
            }
        }
        syn::visit::visit_expr_call(self, call);
    }

    fn visit_item_fn(&mut self, _: &'a syn::ItemFn) {}

    fn visit_item_impl(&mut self, _: &'a syn::ItemImpl) {}

    fn visit_item_mod(&mut self, _: &'a syn::ItemMod) {}
}

#[derive(Default)]
struct Mains {
    closures: Vec<syn::Expr>,
    named: Vec<Vec<String>>,
    passed: Vec<(Vec<String>, syn::Expr)>,
}

impl<'a> Visit<'a> for Mains {
    fn visit_expr_call(&mut self, call: &'a syn::ExprCall) {
        if let syn::Expr::Path(path) = &*call.func {
            for argument in &call.args {
                if let syn::Expr::Closure(closure) = argument {
                    self.passed
                        .push((segments(&path.path), (*closure.body).clone()));
                }
            }
        }
        syn::visit::visit_expr_call(self, call);
    }

    fn visit_macro(&mut self, called: &'a syn::Macro) {
        if called
            .path
            .segments
            .last()
            .is_some_and(|one| one.ident == "with_platform")
        {
            if let Ok(arguments) =
                called.parse_body_with(Punctuated::<syn::Expr, syn::Token![,]>::parse_terminated)
            {
                for argument in arguments {
                    if let syn::Expr::Closure(closure) = argument {
                        self.closures.push(*closure.body);
                    }
                }
            }
        }
    }

    fn visit_expr_method_call(&mut self, call: &'a syn::ExprMethodCall) {
        if MAIN.iter().any(|one| call.method == one) {
            for argument in &call.args {
                match argument {
                    syn::Expr::Closure(closure) => self.closures.push((*closure.body).clone()),
                    syn::Expr::Path(path) => self.named.push(segments(&path.path)),
                    _ => {}
                }
            }
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_item_fn(&mut self, _: &'a syn::ItemFn) {}

    fn visit_item_impl(&mut self, _: &'a syn::ItemImpl) {}

    fn visit_item_mod(&mut self, _: &'a syn::ItemMod) {}
}
