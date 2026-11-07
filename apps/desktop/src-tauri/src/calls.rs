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

const MAIN: [&str; 12] = [
    "run_on_main_thread",
    "with_webview",
    "on_window_event",
    "on_webview_event",
    "on_menu_event",
    "on_tray_icon_event",
    "on_page_load",
    "run",
    "on_navigation",
    "on_new_window",
    "on_document_title_changed",
    "on_download",
];

const GUARDS: [&str; 3] = ["MutexGuard", "RwLockReadGuard", "RwLockWriteGuard"];

const TYPED_DEEPEST: usize = 16;

const RELEASING: [&str; 5] = [
    "wait",
    "wait_timeout",
    "wait_while",
    "wait_timeout_while",
    "wait_timeout_ms",
];

const WIDEST: usize = 8;

const DEREFS: [&str; 14] = [
    "Arc",
    "Rc",
    "Box",
    "State",
    "Ref",
    "RefMut",
    "MutexGuard",
    "RwLockReadGuard",
    "RwLockWriteGuard",
    "LazyLock",
    "Lazy",
    "Pin",
    "ManuallyDrop",
    "AssertUnwindSafe",
];

const WRAPS: [&str; 10] = [
    "Arc", "Rc", "Box", "Mutex", "RwLock", "RefCell", "Cell", "OnceLock", "Pin", "LazyLock",
];

const SAME: [&str; 22] = [
    "clone",
    "to_owned",
    "as_ref",
    "as_mut",
    "deref",
    "deref_mut",
    "borrow",
    "borrow_mut",
    "by_ref",
    "unwrap",
    "expect",
    "unwrap_or_else",
    "unwrap_or_default",
    "unwrap_or",
    "as_deref",
    "as_deref_mut",
    "ok",
    "map_err",
    "cloned",
    "copied",
    "into_inner",
    "get_or_init",
];

const SEQUENCES: [&str; 9] = [
    "Vec", "VecDeque", "HashSet", "BTreeSet", "[]", "Iter", "Option", "IndexSet", "SmallVec",
];

const MAPS: [&str; 3] = ["HashMap", "BTreeMap", "IndexMap"];

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
    env: Env,
    methods: Typed,
    output: Option<syn::Type>,
    inputs: Vec<Option<syn::Type>>,
    generics: Vec<String>,
}

#[derive(Default)]
struct Locks {
    takes: Vec<(Key, Chain)>,
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

#[derive(Clone)]
enum Key {
    Named(String),
    Path(Vec<String>),
    Call(Vec<String>),
    Field(Chain, String),
    Var(String),
}

#[derive(Clone)]
enum Guard {
    Lock(Key, Chain),
    Through(Vec<String>, Option<Key>, bool),
    Method(String, Chain, bool),
}

struct Hold {
    guards: Vec<Guard>,
    calls: Vec<Vec<String>>,
    methods: Typed,
    said: String,
}

struct Known<'a> {
    relays: &'a HashSet<String>,
    guarding: &'a HashSet<String>,
    accessors: &'a HashMap<String, Vec<String>>,
    helpers: &'a HashMap<String, Vec<String>>,
}

struct Handed {
    to: Vec<String>,
    calls: Vec<Vec<String>>,
    methods: Typed,
    said: String,
}

#[derive(Default)]
struct Gathered {
    target: Target,
    modules: HashMap<String, Scope>,
    owners: HashSet<String>,
    found: Vec<Found>,
    known: HashSet<String>,
    defs: HashMap<String, Def>,
    statics: HashMap<String, (String, syn::Type)>,
    by_path: HashMap<String, Vec<usize>>,
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
                syn::Item::Struct(_)
                | syn::Item::Enum(_)
                | syn::Item::Static(_)
                | syn::Item::Const(_) => self.shaped(module, item),
                syn::Item::Mod(inner) if !tested(&inner.attrs) => {
                    self.module(module, inner, files);
                }
                _ => {}
            }
        }
    }

    fn shaped(&mut self, module: &str, item: &syn::Item) {
        let named = |at: usize, field: &syn::Field| {
            field
                .ident
                .as_ref()
                .map_or_else(|| at.to_string(), ToString::to_string)
        };
        let mut fields = HashMap::new();
        let (name, attrs) = match item {
            syn::Item::Struct(shape) => {
                for (at, field) in shape.fields.iter().enumerate() {
                    fields.insert(named(at, field), field.ty.clone());
                }
                (&shape.ident, &shape.attrs)
            }
            syn::Item::Enum(shape) => {
                for variant in &shape.variants {
                    for (at, field) in variant.fields.iter().enumerate() {
                        let name = format!("{}.{}", variant.ident, named(at, field));
                        fields.insert(name, field.ty.clone());
                    }
                }
                (&shape.ident, &shape.attrs)
            }
            syn::Item::Static(one) => {
                self.statics.insert(
                    format!("{module}::{}", one.ident),
                    (module.to_owned(), (*one.ty).clone()),
                );
                return;
            }
            syn::Item::Const(one) => {
                self.statics.insert(
                    format!("{module}::{}", one.ident),
                    (module.to_owned(), (*one.ty).clone()),
                );
                return;
            }
            _ => return,
        };
        if !tested(attrs) {
            self.defs.insert(
                format!("{module}::{name}"),
                Def {
                    module: module.to_owned(),
                    fields,
                },
            );
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
        let (env, taken) = Bindings::of(sig, block);
        let mut mains = Mains::default();
        mains.visit_block(block);
        for (at, body) in mains.closures.iter().enumerate() {
            self.closure(
                module,
                owner,
                &format!("{path}::main#{at}"),
                body,
                (&scope, &env),
                None,
            );
        }
        for (at, (to, body)) in mains.passed.iter().enumerate() {
            self.closure(
                module,
                owner,
                &format!("{path}::passed#{at}"),
                body,
                (&scope, &env),
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
            env,
            methods: Methods::of_block(block),
            output: output_of(sig),
            inputs: taken,
            generics: generics_of(sig),
        });
    }

    fn closure(
        &mut self,
        module: &str,
        owner: Option<&str>,
        path: &str,
        body: &syn::Expr,
        (scope, env): (&Scope, &Env),
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
            env: env.clone(),
            methods: Methods::of_expr(body),
            output: None,
            inputs: Vec::new(),
            generics: Vec::new(),
        });
    }

    fn resolved(mut self) -> Crate {
        self.known = self.found.iter().map(|one| one.path.clone()).collect();
        for (at, found) in self.found.iter().enumerate() {
            self.by_path.entry(found.path.clone()).or_default().push(at);
        }

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

            let typed = self.typed(found, &found.methods);
            let function = own.functions.entry(found.path.clone()).or_default();
            function.said.push_str(&found.said);
            function.called.extend(called);
            function.called.extend(typed);

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
            for (key, call) in &found.locks.takes {
                if !matches!(self.taken_as(found, call), Taken::Lock) {
                    continue;
                }
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
        let guarding: HashSet<String> = self
            .found
            .iter()
            .filter(|found| found.shape.accessor && relays.contains(&found.path))
            .map(|found| found.path.clone())
            .collect();
        let known = Known {
            relays: &relays,
            guarding: &guarding,
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
            let mut locks: Vec<String> = Vec::new();
            let mut through: Vec<String> = Vec::new();
            for guard in &hold.guards {
                let (taken, by) = self.guarded(found, guard, known);
                if !taken.is_empty() {
                    locks.extend(taken);
                    through.extend(by);
                }
            }
            if locks.is_empty() {
                continue;
            }
            let mut called = self.resolve_all(found, &hold.calls);
            called.extend(self.typed(found, &hold.methods));
            called.retain(|one| !through.contains(one));
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
            let mut called = self.resolve_all(found, &handed.calls);
            called.extend(self.typed(found, &handed.methods));
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

    fn guarded(
        &self,
        found: &Found,
        guard: &Guard,
        known: &Known<'_>,
    ) -> (Vec<String>, Vec<String>) {
        match guard {
            Guard::Lock(key, call) => match self.taken_as(found, call) {
                Taken::Lock => (vec![self.key(found, key)], Vec::new()),
                Taken::Own(receiver) => self.guarded(
                    found,
                    &Guard::Method("lock".to_owned(), receiver, true),
                    known,
                ),
                Taken::Not(method, receiver) => {
                    self.guarded(found, &Guard::Method(method, receiver, true), known)
                }
            },
            Guard::Through(path, first, strict) => {
                let called = self.resolve(found, path);
                let relays = if *strict {
                    known.guarding
                } else {
                    known.relays
                };
                let locks = match first {
                    Some(first) if called.iter().any(|one| relays.contains(one)) => {
                        vec![self.key(found, first)]
                    }
                    _ => called
                        .iter()
                        .filter_map(|one| known.accessors.get(one))
                        .flatten()
                        .cloned()
                        .collect(),
                };
                (locks, called)
            }
            Guard::Method(name, receiver, strict) => {
                let targets: HashSet<String> = self
                    .types(found, receiver, &mut Vec::new(), 0)
                    .iter()
                    .flat_map(|one| self.targets(one, name))
                    .collect();
                if !targets.is_empty() || *strict {
                    let locks = targets
                        .iter()
                        .filter_map(|one| known.accessors.get(one))
                        .flatten()
                        .cloned()
                        .collect();
                    return (locks, targets.into_iter().collect());
                }
                let named: Vec<(&String, &Vec<String>)> = known
                    .accessors
                    .iter()
                    .filter(|(path, _)| path.ends_with(&format!("::{name}")))
                    .collect();
                (
                    named
                        .iter()
                        .flat_map(|(_, keys)| keys.iter().cloned())
                        .collect(),
                    named.iter().map(|(path, _)| (*path).clone()).collect(),
                )
            }
        }
    }

    fn taken_as(&self, found: &Found, call: &Chain) -> Taken {
        let Some((Step::Method(method, _), steps)) = call.steps.split_last() else {
            return Taken::Lock;
        };
        let receiver = Chain {
            root: call.root.clone(),
            steps: steps.to_vec(),
        };
        let tys = self.types(found, &receiver, &mut Vec::new(), 0);
        if method == "lock" {
            if tys.iter().any(|one| !self.targets(one, "lock").is_empty()) {
                return Taken::Own(receiver);
            }
            return Taken::Lock;
        }
        let shared = tys.iter().any(|one| {
            let mut at = Some(one);
            while let Some(layer) = at {
                if layer.last() == "RwLock" {
                    return true;
                }
                at = layer.inside();
            }
            false
        });
        if shared {
            Taken::Lock
        } else {
            Taken::Not(method.clone(), receiver)
        }
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
            Key::Field(base, name) => self
                .field_key(found, base, name)
                .unwrap_or_else(|| unknown_key(name, &found.module)),
            Key::Var(name) => self
                .var_key(found, name, &mut Vec::new())
                .unwrap_or_else(|| format!("?{name}@{}", found.module)),
        }
    }

    fn field_key(&self, found: &Found, base: &Chain, name: &str) -> Option<String> {
        self.types(found, base, &mut Vec::new(), 0)
            .iter()
            .find_map(|one| self.field_owner(one, name))
            .map(|owner| format!("{owner}::{name}"))
    }

    fn var_key(&self, found: &Found, name: &str, visiting: &mut Vec<String>) -> Option<String> {
        if visiting.iter().any(|one| one == name) || visiting.len() > TYPED_DEEPEST {
            return None;
        }
        visiting.push(name.to_owned());
        let key = found.env.get(name).into_iter().flatten().find_map(|chain| {
            let mut steps = chain.steps.as_slice();
            while let Some((Step::Method(method, _), rest)) = steps.split_last() {
                if !SAME.contains(&method.as_str()) {
                    break;
                }
                steps = rest;
            }
            match (&chain.root, steps.split_last()) {
                (_, Some((Step::Field(field), rest))) => {
                    let base = Chain {
                        root: chain.root.clone(),
                        steps: rest.to_vec(),
                    };
                    self.field_key(found, &base, field)
                }
                (Root::Var(other), None) => self.var_key(found, other, visiting),
                (Root::Path(path), None) => Some(self.key(found, &Key::Path(path.clone()))),
                _ => None,
            }
        });
        visiting.pop();
        key
    }

    fn field_owner(&self, ty: &Ty, name: &str) -> Option<String> {
        let mut at = Some(ty);
        while let Some(one) = at {
            if self
                .defs
                .get(&one.name)
                .is_some_and(|def| def.fields.contains_key(name))
            {
                return Some(one.name.clone());
            }
            at = one.inside();
        }
        None
    }

    fn typed(&self, found: &Found, methods: &Typed) -> HashSet<String> {
        let mut called = HashSet::new();
        for (receiver, method) in methods {
            for ty in self.types(found, receiver, &mut Vec::new(), 0) {
                if method == "drop" {
                    self.dropping(&ty, &mut called, 0);
                } else {
                    called.extend(self.targets(&ty, method));
                }
            }
        }
        called
    }

    fn dropping(&self, ty: &Ty, called: &mut HashSet<String>, depth: usize) {
        if depth > TYPED_DEEPEST {
            return;
        }
        if self.is_def(&ty.name) {
            called.extend(self.landing(&format!("{}::drop", ty.name), 0));
        }
        if let Some(def) = self.defs.get(&ty.name) {
            for raw in def.fields.values() {
                if let Some(field) = self.def_ty(&ty.name, raw) {
                    self.dropping(&field, called, depth + 1);
                }
            }
        }
        for one in &ty.args {
            self.dropping(one, called, depth + 1);
        }
    }

    fn targets(&self, ty: &Ty, method: &str) -> Vec<String> {
        let mut at = Some(ty);
        while let Some(one) = at {
            if self.is_def(&one.name) {
                let landed = self.landing(&format!("{}::{method}", one.name), 0);
                if !landed.is_empty() {
                    return landed;
                }
            }
            at = one.inside();
        }
        Vec::new()
    }

    fn is_def(&self, name: &str) -> bool {
        self.defs.contains_key(name) || self.owners.contains(name)
    }

    fn ty_in(&self, place: Place<'_>, raw: &syn::Type, depth: usize) -> Option<Ty> {
        if depth > TYPED_DEEPEST {
            return None;
        }
        let (module, scope, owner) = place;
        let inner = |one: &syn::Type| {
            self.ty_in(place, one, depth + 1)
                .unwrap_or_else(|| Ty::plain("?"))
        };
        match raw {
            syn::Type::Reference(one) => self.ty_in(place, &one.elem, depth + 1),
            syn::Type::Paren(one) => self.ty_in(place, &one.elem, depth + 1),
            syn::Type::Group(one) => self.ty_in(place, &one.elem, depth + 1),
            syn::Type::Ptr(one) => self.ty_in(place, &one.elem, depth + 1),
            syn::Type::Tuple(tuple) => Some(Ty {
                name: "()".to_owned(),
                args: tuple.elems.iter().map(inner).collect(),
            }),
            syn::Type::Array(array) => Some(Ty::wrapping("[]", inner(&array.elem))),
            syn::Type::Slice(slice) => Some(Ty::wrapping("[]", inner(&slice.elem))),
            syn::Type::Path(path) if path.qself.is_none() => {
                let said = segments(&path.path);
                if said == ["Self"] {
                    return owner.map(Ty::plain);
                }
                let args = match path.path.segments.last().map(|last| &last.arguments) {
                    Some(syn::PathArguments::AngleBracketed(kinds)) => kinds
                        .args
                        .iter()
                        .filter_map(|one| match one {
                            syn::GenericArgument::Type(kind) => Some(inner(kind)),
                            _ => None,
                        })
                        .collect(),
                    _ => Vec::new(),
                };
                let name = self
                    .absolute(module, scope, owner, &said, 0)
                    .into_iter()
                    .find(|one| self.is_def(one))
                    .or_else(|| said.last().cloned())?;
                Some(Ty { name, args })
            }
            _ => None,
        }
    }

    fn ty_of(&self, found: &Found, raw: &syn::Type) -> Option<Ty> {
        self.ty_in(
            (&found.module, Some(&found.scope), found.owner.as_deref()),
            raw,
            0,
        )
    }

    fn def_ty(&self, owner: &str, raw: &syn::Type) -> Option<Ty> {
        let def = self.defs.get(owner)?;
        self.ty_in((&def.module, None, Some(owner)), raw, 0)
    }

    fn types(
        &self,
        found: &Found,
        chain: &Chain,
        visiting: &mut Vec<String>,
        depth: usize,
    ) -> Vec<Ty> {
        if depth > TYPED_DEEPEST {
            return Vec::new();
        }
        let mut tys = self.rooted(found, &chain.root, visiting, depth);
        for step in &chain.steps {
            tys = match step {
                Step::Method(method, kinds) if method == "state" || method == "try_state" => kinds
                    .first()
                    .and_then(|kind| self.ty_of(found, kind))
                    .map(|kind| {
                        let state = Ty::wrapping("State", kind);
                        if method == "state" {
                            state
                        } else {
                            Ty::wrapping("Option", state)
                        }
                    })
                    .into_iter()
                    .collect(),
                _ => {
                    let mut next: Vec<Ty> = Vec::new();
                    for one in &tys {
                        for stepped in self.stepped(one, step) {
                            if !next.contains(&stepped) {
                                next.push(stepped);
                            }
                        }
                    }
                    next.truncate(WIDEST);
                    next
                }
            };
            if tys.is_empty() {
                break;
            }
        }
        tys
    }

    fn rooted(
        &self,
        found: &Found,
        root: &Root,
        visiting: &mut Vec<String>,
        depth: usize,
    ) -> Vec<Ty> {
        let place = (&*found.module, Some(&found.scope), found.owner.as_deref());
        match root {
            Root::Me => found.owner.as_deref().map(Ty::plain).into_iter().collect(),
            Root::Var(name) => {
                let Some(chains) = found.env.get(name) else {
                    return self.rooted(found, &Root::Path(vec![name.clone()]), visiting, depth);
                };
                if visiting.iter().any(|one| one == name) {
                    return Vec::new();
                }
                visiting.push(name.clone());
                let mut tys: Vec<Ty> = Vec::new();
                for chain in chains {
                    for one in self.types(found, chain, visiting, depth + 1) {
                        if !tys.contains(&one) {
                            tys.push(one);
                        }
                    }
                }
                visiting.pop();
                tys.truncate(WIDEST);
                tys
            }
            Root::Path(path) => self
                .absolute(place.0, place.1, place.2, path, 0)
                .iter()
                .filter_map(|one| self.statics.get(one))
                .filter_map(|(module, raw)| self.ty_in((module, None, None), raw, 0))
                .collect(),
            Root::Call(path, arguments) => self.returned(found, path, arguments, visiting, depth),
            Root::Raw(raw) => self.ty_of(found, raw).into_iter().collect(),
            Root::Built(path) => self.def_named(place, path),
            Root::Unknown => Vec::new(),
        }
    }

    fn def_named(&self, place: Place<'_>, path: &[String]) -> Vec<Ty> {
        self.absolute(place.0, place.1, place.2, path, 0)
            .into_iter()
            .find(|one| self.is_def(one))
            .map(|one| Ty::plain(&one))
            .into_iter()
            .collect()
    }

    fn returned(
        &self,
        found: &Found,
        path: &[String],
        arguments: &[Chain],
        visiting: &mut Vec<String>,
        depth: usize,
    ) -> Vec<Ty> {
        let mut tys = Vec::new();
        for callee in self.resolve(found, path) {
            for &at in self.by_path.get(&callee).into_iter().flatten() {
                let called = &self.found[at];
                let Some(output) = called
                    .output
                    .as_ref()
                    .and_then(|raw| self.ty_of(called, raw))
                else {
                    continue;
                };
                let mut bound: HashMap<String, Ty> = HashMap::new();
                if !called.generics.is_empty() {
                    for (input, argument) in called.inputs.iter().zip(arguments) {
                        let Some(input) = input.as_ref().and_then(|raw| self.ty_of(called, raw))
                        else {
                            continue;
                        };
                        if let Some(given) =
                            self.types(found, argument, visiting, depth + 1).first()
                        {
                            unify(&input, given, &called.generics, &mut bound);
                        }
                    }
                }
                tys.push(substituted(&output, &bound));
            }
        }
        if !tys.is_empty() {
            return tys;
        }
        let mut first = || {
            arguments
                .first()
                .and_then(|one| self.types(found, one, visiting, depth + 1).first().cloned())
                .unwrap_or_else(|| Ty::plain("?"))
        };
        match path {
            [one] if one == "Some" => return vec![Ty::wrapping("Option", first())],
            [one] if one == "Ok" => return vec![Ty::wrapping("Result", first())],
            [.., kind, made] if WRAPS.contains(&kind.as_str()) && made == "new" => {
                return vec![Ty::wrapping(kind, first())];
            }
            _ => {}
        }
        let place = (&*found.module, Some(&found.scope), found.owner.as_deref());
        match path {
            [.., last] if last.starts_with(char::is_uppercase) => self.def_named(place, path),
            [shape @ .., last] if !shape.is_empty() && (last == "default" || last == "new") => {
                self.def_named(place, shape)
            }
            _ => Vec::new(),
        }
    }

    fn stepped(&self, ty: &Ty, step: &Step) -> Vec<Ty> {
        let mut at = Some(ty);
        while let Some(one) = at {
            if let Some(next) = self.step_on(one, step) {
                return next;
            }
            at = one.inside();
        }
        match step {
            Step::Method(method, _) if SAME.contains(&method.as_str()) => vec![ty.clone()],
            Step::Variant(variant, 0) if variant == "Some" || variant == "Ok" => vec![ty.clone()],
            Step::Tried => vec![ty.clone()],
            _ => Vec::new(),
        }
    }

    fn step_on(&self, ty: &Ty, step: &Step) -> Option<Vec<Ty>> {
        let kind = ty.last();
        let def = self.defs.get(&ty.name);
        let field = |name: &str| {
            def.and_then(|def| def.fields.get(name))
                .and_then(|raw| self.def_ty(&ty.name, raw))
                .map(|one| vec![one])
        };
        match step {
            Step::Field(name) if kind == "()" => name
                .parse::<usize>()
                .ok()
                .and_then(|at| ty.arg(at))
                .map(|one| vec![one]),
            Step::Field(name) => field(name),
            Step::Named(variant, name) => {
                field(name).or_else(|| field(&format!("{variant}.{name}")))
            }
            Step::Variant(variant, at) => match (kind, variant.as_str()) {
                ("Option" | "Result", "Some" | "Ok") => ty.arg(0).map(|one| vec![one]),
                ("Result", "Err") => ty.arg(1).map(|one| vec![one]),
                _ => field(&format!("{variant}.{at}"))
                    .or_else(|| (kind == variant).then(|| field(&at.to_string())).flatten()),
            },
            Step::Item if MAPS.contains(&kind) && ty.args.len() == 2 => Some(vec![Ty {
                name: "()".to_owned(),
                args: ty.args.clone(),
            }]),
            Step::Item => SEQUENCES
                .contains(&kind)
                .then(|| ty.args.last().cloned())
                .flatten()
                .map(|one| vec![one]),
            Step::Tried => ["Option", "Result"]
                .contains(&kind)
                .then(|| ty.arg(0))
                .flatten()
                .map(|one| vec![one]),
            Step::Method(method, _) => self.method_on(ty, method),
        }
    }

    fn method_on(&self, ty: &Ty, method: &str) -> Option<Vec<Ty>> {
        if self.is_def(&ty.name) {
            let tys: Vec<Ty> = self
                .landing(&format!("{}::{method}", ty.name), 0)
                .iter()
                .flat_map(|one| self.by_path.get(one).into_iter().flatten())
                .filter_map(|&at| {
                    let called = &self.found[at];
                    called
                        .output
                        .as_ref()
                        .and_then(|raw| self.ty_of(called, raw))
                })
                .collect();
            if !tys.is_empty() {
                return Some(tys);
            }
        }
        std_method(ty, method).map(|one| vec![one])
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
        let owner = format!("{module}::{first}");
        if self.owners.contains(&owner)
            || self.defs.contains_key(&owner)
            || self.known.contains(&here)
            || self.statics.contains_key(&here)
        {
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
            let name = member_name(&field.member);
            if matches!(&*field.base, syn::Expr::Path(base) if base.path.is_ident("self")) {
                Key::Named(format!("{owner}::{name}"))
            } else {
                Key::Field(chain_of(&field.base), name)
            }
        }
        syn::Expr::Path(path) => {
            let path = segments(&path.path);
            match path.as_slice() {
                [one] if one.starts_with(|letter: char| letter.is_lowercase()) => {
                    Key::Var(one.clone())
                }
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
        syn::Expr::MethodCall(call) if locked(call) => Some(Guard::Lock(
            key_of(&call.receiver, owner, module),
            taking(call),
        )),
        syn::Expr::MethodCall(call) => Some(Guard::Method(
            call.method.to_string(),
            chain_of(&call.receiver),
            false,
        )),
        syn::Expr::Call(call) => match &*call.func {
            syn::Expr::Path(path) => Some(Guard::Through(
                segments(&path.path),
                call.args.first().map(|first| key_of(first, owner, module)),
                false,
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
    takes: Vec<(Key, Chain)>,
    passes: Vec<(Vec<String>, Key)>,
}

impl<'a> Visit<'a> for Taking<'_> {
    fn visit_expr_method_call(&mut self, call: &'a syn::ExprMethodCall) {
        if locked(call) {
            self.takes.push((
                key_of(&call.receiver, self.owner, self.module),
                taking(call),
            ));
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

struct Temporaries<'o> {
    owner: &'o str,
    module: &'o str,
    found: Vec<Guard>,
}

impl<'a> Visit<'a> for Temporaries<'_> {
    fn visit_expr_method_call(&mut self, call: &'a syn::ExprMethodCall) {
        if locked(call) {
            self.found.push(Guard::Lock(
                key_of(&call.receiver, self.owner, self.module),
                taking(call),
            ));
        } else if !AWAY.iter().any(|one| call.method == one) {
            self.found.push(Guard::Method(
                call.method.to_string(),
                chain_of(&call.receiver),
                true,
            ));
        }
        if RELEASING.iter().any(|one| call.method == one) {
            self.visit_expr(&call.receiver);
            for argument in call.args.iter().skip(1) {
                self.visit_expr(argument);
            }
            return;
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_call(&mut self, call: &'a syn::ExprCall) {
        if let syn::Expr::Path(path) = &*call.func {
            self.found.push(Guard::Through(
                segments(&path.path),
                call.args
                    .first()
                    .map(|first| key_of(first, self.owner, self.module)),
                true,
            ));
        }
        syn::visit::visit_expr_call(self, call);
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
    fn hold(&mut self, guards: Vec<Guard>, tokens: TokenStream, methods: Typed) {
        self.held.push(Hold {
            guards,
            calls: found_calls(tokens.clone()),
            methods,
            said: said_of(tokens),
        });
    }

    fn temporaries(&mut self, expr: &syn::Expr) {
        let mut temporaries = Temporaries {
            owner: self.owner,
            module: self.module,
            found: Vec::new(),
        };
        temporaries.visit_expr(expr);
        if temporaries.found.is_empty() {
            return;
        }
        self.hold(
            temporaries.found,
            expr.to_token_stream(),
            Methods::of_expr(expr),
        );
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
                        let kept = block.stmts[at + 1..]
                            .iter()
                            .take_while(|one| !dropped(one, name.as_deref()))
                            .count();
                        let mut kept = block.stmts[at + 1..at + 1 + kept].to_vec();
                        if let Some(name) = &name {
                            let mut released = Released { name };
                            for statement in &mut kept {
                                released.visit_stmt_mut(statement);
                            }
                        }
                        let rest: TokenStream =
                            kept.iter().map(ToTokens::to_token_stream).collect();
                        self.hold(vec![guard], rest, Methods::of_statements(&kept));
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
                        methods: Methods::of_expr(&closure.body),
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

#[derive(Clone)]
enum Root {
    Me,
    Var(String),
    Path(Vec<String>),
    Call(Vec<String>, Vec<Chain>),
    Raw(Box<syn::Type>),
    Built(Vec<String>),
    Unknown,
}

#[derive(Clone)]
enum Step {
    Field(String),
    Method(String, Vec<syn::Type>),
    Variant(String, usize),
    Named(String, String),
    Item,
    Tried,
}

#[derive(Clone)]
struct Chain {
    root: Root,
    steps: Vec<Step>,
}

impl Chain {
    fn rooted(root: Root) -> Self {
        Self {
            root,
            steps: Vec::new(),
        }
    }

    fn then(mut self, step: Step) -> Self {
        self.steps.push(step);
        self
    }
}

type Env = HashMap<String, Vec<Chain>>;

type Typed = Vec<(Chain, String)>;

#[derive(Clone, PartialEq)]
struct Ty {
    name: String,
    args: Vec<Ty>,
}

impl Ty {
    fn plain(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            args: Vec::new(),
        }
    }

    fn wrapping(name: &str, inner: Ty) -> Self {
        Self {
            name: name.to_owned(),
            args: vec![inner],
        }
    }

    fn last(&self) -> &str {
        self.name.rsplit("::").next().unwrap_or(&self.name)
    }

    fn arg(&self, at: usize) -> Option<Ty> {
        self.args.get(at).cloned()
    }

    fn inside(&self) -> Option<&Ty> {
        DEREFS
            .contains(&self.last())
            .then(|| self.args.first())
            .flatten()
    }
}

struct Def {
    module: String,
    fields: HashMap<String, syn::Type>,
}

fn member_name(member: &syn::Member) -> String {
    match member {
        syn::Member::Named(name) => name.to_string(),
        syn::Member::Unnamed(index) => index.index.to_string(),
    }
}

fn kinds_of(turbofish: Option<&syn::AngleBracketedGenericArguments>) -> Vec<syn::Type> {
    turbofish
        .map(|kinds| {
            kinds
                .args
                .iter()
                .filter_map(|one| match one {
                    syn::GenericArgument::Type(kind) => Some(kind.clone()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn chain_of(expr: &syn::Expr) -> Chain {
    match expr {
        syn::Expr::Path(path) if path.qself.is_none() => {
            let said = segments(&path.path);
            match said.as_slice() {
                [one] if one == "self" => Chain::rooted(Root::Me),
                [one] if one.starts_with(|letter: char| letter.is_lowercase() || letter == '_') => {
                    Chain::rooted(Root::Var(one.clone()))
                }
                _ => Chain::rooted(Root::Path(said)),
            }
        }
        syn::Expr::Field(field) => {
            chain_of(&field.base).then(Step::Field(member_name(&field.member)))
        }
        syn::Expr::MethodCall(call) => chain_of(&call.receiver).then(Step::Method(
            call.method.to_string(),
            kinds_of(call.turbofish.as_ref()),
        )),
        syn::Expr::Call(call) => match &*call.func {
            syn::Expr::Path(path) if path.qself.is_none() => Chain::rooted(Root::Call(
                segments(&path.path),
                call.args.iter().map(chain_of).collect(),
            )),
            _ => Chain::rooted(Root::Unknown),
        },
        syn::Expr::Reference(inner) => chain_of(&inner.expr),
        syn::Expr::Paren(inner) => chain_of(&inner.expr),
        syn::Expr::Group(inner) => chain_of(&inner.expr),
        syn::Expr::Await(inner) => chain_of(&inner.base),
        syn::Expr::Unary(inner) if matches!(inner.op, syn::UnOp::Deref(_)) => chain_of(&inner.expr),
        syn::Expr::Try(inner) => chain_of(&inner.expr).then(Step::Tried),
        syn::Expr::Index(inner) => chain_of(&inner.expr).then(Step::Item),
        syn::Expr::Struct(built) if built.qself.is_none() => {
            Chain::rooted(Root::Built(segments(&built.path)))
        }
        syn::Expr::Cast(cast) => Chain::rooted(Root::Raw(cast.ty.clone())),
        syn::Expr::Block(block) => match block.block.stmts.last() {
            Some(syn::Stmt::Expr(last, None)) => chain_of(last),
            _ => Chain::rooted(Root::Unknown),
        },
        _ => Chain::rooted(Root::Unknown),
    }
}

fn bind(pattern: &syn::Pat, chain: &Chain, env: &mut Env) {
    match pattern {
        syn::Pat::Ident(name) => {
            env.entry(name.ident.to_string())
                .or_default()
                .push(chain.clone());
            if let Some((_, inner)) = &name.subpat {
                bind(inner, chain, env);
            }
        }
        syn::Pat::Type(typed) => bind(&typed.pat, &Chain::rooted(Root::Raw(typed.ty.clone())), env),
        syn::Pat::Reference(inner) => bind(&inner.pat, chain, env),
        syn::Pat::Paren(inner) => bind(&inner.pat, chain, env),
        syn::Pat::Or(cases) => {
            for case in &cases.cases {
                bind(case, chain, env);
            }
        }
        syn::Pat::Tuple(tuple) => {
            for (at, one) in tuple.elems.iter().enumerate() {
                bind(one, &chain.clone().then(Step::Field(at.to_string())), env);
            }
        }
        syn::Pat::TupleStruct(tuple) => {
            let variant = segments(&tuple.path).pop().unwrap_or_default();
            for (at, one) in tuple.elems.iter().enumerate() {
                bind(
                    one,
                    &chain.clone().then(Step::Variant(variant.clone(), at)),
                    env,
                );
            }
        }
        syn::Pat::Struct(shape) => {
            let variant = segments(&shape.path).pop().unwrap_or_default();
            for field in &shape.fields {
                bind(
                    &field.pat,
                    &chain
                        .clone()
                        .then(Step::Named(variant.clone(), member_name(&field.member))),
                    env,
                );
            }
        }
        syn::Pat::Slice(slice) => {
            for one in &slice.elems {
                bind(one, &chain.clone().then(Step::Item), env);
            }
        }
        _ => {}
    }
}

fn macro_arguments(called: &syn::Macro) -> Vec<syn::Expr> {
    called
        .parse_body_with(Punctuated::<syn::Expr, syn::Token![,]>::parse_terminated)
        .map(|arguments| arguments.into_iter().collect())
        .unwrap_or_default()
}

#[derive(Default)]
struct Bindings {
    env: Env,
}

impl Bindings {
    fn of(sig: &syn::Signature, block: &syn::Block) -> (Env, Vec<Option<syn::Type>>) {
        let mut bindings = Self::default();
        let mut taken = Vec::new();
        for input in &sig.inputs {
            match input {
                syn::FnArg::Typed(typed) => {
                    bind(
                        &typed.pat,
                        &Chain::rooted(Root::Raw(typed.ty.clone())),
                        &mut bindings.env,
                    );
                    taken.push(Some((*typed.ty).clone()));
                }
                syn::FnArg::Receiver(_) => taken.push(None),
            }
        }
        bindings.visit_block(block);
        (bindings.env, taken)
    }
}

impl<'a> Visit<'a> for Bindings {
    fn visit_local(&mut self, local: &'a syn::Local) {
        let chain = local
            .init
            .as_ref()
            .map_or(Chain::rooted(Root::Unknown), |init| chain_of(&init.expr));
        bind(&local.pat, &chain, &mut self.env);
        syn::visit::visit_local(self, local);
    }

    fn visit_expr_let(&mut self, matched: &'a syn::ExprLet) {
        bind(&matched.pat, &chain_of(&matched.expr), &mut self.env);
        syn::visit::visit_expr_let(self, matched);
    }

    fn visit_expr_match(&mut self, matched: &'a syn::ExprMatch) {
        let chain = chain_of(&matched.expr);
        for arm in &matched.arms {
            bind(&arm.pat, &chain, &mut self.env);
        }
        syn::visit::visit_expr_match(self, matched);
    }

    fn visit_expr_for_loop(&mut self, looped: &'a syn::ExprForLoop) {
        bind(
            &looped.pat,
            &chain_of(&looped.expr).then(Step::Item),
            &mut self.env,
        );
        syn::visit::visit_expr_for_loop(self, looped);
    }

    fn visit_expr_closure(&mut self, closure: &'a syn::ExprClosure) {
        for input in &closure.inputs {
            bind(input, &Chain::rooted(Root::Unknown), &mut self.env);
        }
        syn::visit::visit_expr_closure(self, closure);
    }

    fn visit_macro(&mut self, called: &'a syn::Macro) {
        for argument in macro_arguments(called) {
            self.visit_expr(&argument);
        }
    }

    fn visit_item_fn(&mut self, _: &'a syn::ItemFn) {}

    fn visit_item_impl(&mut self, _: &'a syn::ItemImpl) {}

    fn visit_item_mod(&mut self, _: &'a syn::ItemMod) {}
}

#[derive(Default)]
struct Methods {
    found: Typed,
}

impl Methods {
    fn of_expr(expr: &syn::Expr) -> Typed {
        let mut methods = Self::default();
        methods.visit_expr(expr);
        methods.found
    }

    fn of_block(block: &syn::Block) -> Typed {
        let mut methods = Self::default();
        methods.visit_block(block);
        methods.found
    }

    fn of_statements(statements: &[syn::Stmt]) -> Typed {
        let mut methods = Self::default();
        for statement in statements {
            methods.visit_stmt(statement);
        }
        methods.found
    }
}

impl<'a> Visit<'a> for Methods {
    fn visit_expr_method_call(&mut self, call: &'a syn::ExprMethodCall) {
        if !matches!(&*call.receiver, syn::Expr::Path(path) if path.path.is_ident("self")) {
            self.found
                .push((chain_of(&call.receiver), call.method.to_string()));
        }
        if AWAY.iter().any(|one| call.method == one) {
            self.visit_expr(&call.receiver);
            return;
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_call(&mut self, call: &'a syn::ExprCall) {
        let Some(last) = (match &*call.func {
            syn::Expr::Path(path) => path.path.segments.last(),
            _ => None,
        }) else {
            syn::visit::visit_expr_call(self, call);
            return;
        };
        if AWAY.iter().any(|away| last.ident == away) {
            return;
        }
        if let (true, Some(dropped)) = (last.ident == "drop", call.args.first()) {
            self.found.push((chain_of(dropped), "drop".to_owned()));
        }
        syn::visit::visit_expr_call(self, call);
    }

    fn visit_macro(&mut self, called: &'a syn::Macro) {
        for argument in macro_arguments(called) {
            self.visit_expr(&argument);
        }
    }

    fn visit_item_fn(&mut self, _: &'a syn::ItemFn) {}

    fn visit_item_impl(&mut self, _: &'a syn::ItemImpl) {}

    fn visit_item_mod(&mut self, _: &'a syn::ItemMod) {}
}

type Place<'a> = (&'a str, Option<&'a Scope>, Option<&'a str>);

fn unknown_key(name: &str, module: &str) -> String {
    if name.starts_with(|letter: char| letter.is_ascii_digit()) {
        "?".to_owned()
    } else {
        format!("?{name}@{module}")
    }
}

fn unify(input: &Ty, given: &Ty, generics: &[String], bound: &mut HashMap<String, Ty>) {
    if input.args.is_empty() && generics.contains(&input.name) {
        bound
            .entry(input.name.clone())
            .or_insert_with(|| given.clone());
        return;
    }
    if input.last() == given.last() {
        for (one, other) in input.args.iter().zip(&given.args) {
            unify(one, other, generics, bound);
        }
    } else if let Some(inside) = given.inside() {
        unify(input, inside, generics, bound);
    }
}

fn substituted(ty: &Ty, bound: &HashMap<String, Ty>) -> Ty {
    if ty.args.is_empty() {
        if let Some(one) = bound.get(&ty.name) {
            return one.clone();
        }
    }
    Ty {
        name: ty.name.clone(),
        args: ty.args.iter().map(|one| substituted(one, bound)).collect(),
    }
}

fn std_method(ty: &Ty, method: &str) -> Option<Ty> {
    let kind = ty.last();
    let first = ty.arg(0);
    let element = ty.args.last().cloned();
    let optional = |inner: Ty| Ty::wrapping("Option", inner);
    let mapped = MAPS.contains(&kind);
    let sequence = SEQUENCES.contains(&kind) && kind != "Option";
    match (kind, method) {
        (
            "Option" | "Result",
            "unwrap" | "expect" | "unwrap_or_else" | "unwrap_or_default" | "unwrap_or"
            | "unwrap_unchecked",
        )
        | (
            "Mutex" | "RwLock",
            "lock" | "read" | "write" | "try_lock" | "try_read" | "try_write" | "blocking_lock"
            | "blocking_read" | "blocking_write" | "get_mut" | "into_inner",
        )
        | (
            "RefCell",
            "borrow" | "borrow_mut" | "try_borrow" | "try_borrow_mut" | "get_mut" | "into_inner",
        )
        | ("Cell", "get" | "take" | "replace")
        | ("OnceLock" | "OnceCell", "get_or_init" | "get_or_try_init")
        | ("Entry", "or_insert" | "or_insert_with" | "or_default" | "or_insert_with_key") => first,
        (
            "Option" | "Result",
            "as_ref" | "as_mut" | "as_deref" | "as_deref_mut" | "cloned" | "copied" | "take"
            | "clone" | "or" | "or_else" | "filter" | "inspect" | "map_err",
        )
        | (
            "Iter",
            "filter" | "rev" | "skip" | "take" | "cloned" | "copied" | "peekable" | "by_ref"
            | "fuse" | "step_by" | "skip_while" | "take_while" | "chain" | "inspect",
        ) => Some(ty.clone()),
        ("Result", "ok") | ("OnceLock" | "OnceCell", "get" | "get_mut") => first.map(optional),
        ("Weak", "upgrade") => first.map(|inner| optional(Ty::wrapping("Arc", inner))),
        ("Iter", "enumerate") => first.map(|inner| {
            Ty::wrapping(
                "Iter",
                Ty {
                    name: "()".to_owned(),
                    args: vec![Ty::plain("usize"), inner],
                },
            )
        }),
        (_, "get" | "get_mut" | "remove") if mapped => element.map(optional),
        (_, "values" | "values_mut" | "into_values") if mapped => {
            element.map(|inner| Ty::wrapping("Iter", inner))
        }
        (_, "keys" | "into_keys") if mapped => first.map(|inner| Ty::wrapping("Iter", inner)),
        (_, "entry") if mapped => element.map(|inner| Ty::wrapping("Entry", inner)),
        (_, "iter" | "iter_mut" | "into_iter" | "drain") if mapped && ty.args.len() == 2 => {
            Some(Ty::wrapping(
                "Iter",
                Ty {
                    name: "()".to_owned(),
                    args: ty.args.clone(),
                },
            ))
        }
        (
            _,
            "get" | "get_mut" | "first" | "last" | "pop" | "pop_front" | "pop_back" | "first_mut"
            | "last_mut" | "next" | "find" | "nth" | "max_by_key" | "min_by_key" | "max_by"
            | "min_by" | "next_back",
        ) if sequence => element.map(optional),
        (_, "iter" | "iter_mut" | "into_iter" | "drain") if sequence || kind == "Option" => {
            element.map(|inner| Ty::wrapping("Iter", inner))
        }
        _ => None,
    }
}

fn locked(call: &syn::ExprMethodCall) -> bool {
    ["lock", "read", "write"]
        .iter()
        .any(|one| call.method == one)
        && call.args.is_empty()
        && !matches!(&*call.receiver, syn::Expr::Path(path) if path.path.is_ident("self"))
}

fn taking(call: &syn::ExprMethodCall) -> Chain {
    chain_of(&call.receiver).then(Step::Method(call.method.to_string(), Vec::new()))
}

enum Taken {
    Lock,
    Own(Chain),
    Not(String, Chain),
}

struct Released<'a> {
    name: &'a str,
}

impl VisitMut for Released<'_> {
    fn visit_block_mut(&mut self, block: &mut syn::Block) {
        if let Some(at) = block
            .stmts
            .iter()
            .position(|one| dropped(one, Some(self.name)))
        {
            block.stmts.truncate(at);
        }
        syn::visit_mut::visit_block_mut(self, block);
    }

    fn visit_expr_mut(&mut self, expr: &mut syn::Expr) {
        if let syn::Expr::MethodCall(call) = expr {
            let handed = matches!(call.args.first(), Some(syn::Expr::Path(path)) if path.path.is_ident(self.name));
            if handed && RELEASING.iter().any(|one| call.method == one) {
                let rest: Punctuated<syn::Expr, syn::Token![,]> =
                    call.args.iter().skip(1).cloned().collect();
                *expr = syn::Expr::Tuple(syn::ExprTuple {
                    attrs: Vec::new(),
                    paren_token: syn::token::Paren::default(),
                    elems: rest,
                });
            }
        }
        syn::visit_mut::visit_expr_mut(self, expr);
    }
}

fn output_of(sig: &syn::Signature) -> Option<syn::Type> {
    match &sig.output {
        syn::ReturnType::Type(_, output) => Some((**output).clone()),
        syn::ReturnType::Default => None,
    }
}

fn generics_of(sig: &syn::Signature) -> Vec<String> {
    sig.generics
        .type_params()
        .map(|one| one.ident.to_string())
        .collect()
}
