use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use proc_macro2::{Delimiter, Spacing, TokenStream, TokenTree};
use quote::ToTokens;
use syn::visit::Visit;

const DEEPEST: usize = 8;

#[derive(Default)]
struct Function {
    said: String,
    called: HashSet<String>,
}

#[derive(Default)]
pub(crate) struct Crate {
    functions: HashMap<String, Function>,
    commands: Vec<String>,
    modules: usize,
}

impl Crate {
    pub(crate) fn commands(&self) -> &[String] {
        &self.commands
    }

    pub(crate) fn modules(&self) -> usize {
        self.modules
    }

    pub(crate) fn reaching(&self, words: &[&str], stops: &[&str]) -> HashSet<String> {
        let words: Vec<String> = words.iter().map(|one| spaced(one)).collect();
        let going = |path: &String| !stops.contains(&path.as_str());

        let mut reached: HashSet<String> = self
            .functions
            .iter()
            .filter(|(path, function)| {
                going(path) && words.iter().any(|word| function.said.contains(word))
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

pub(crate) fn read(lib: &Path) -> Crate {
    let mut gathered = Gathered::default();
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
}

#[derive(Default)]
struct Gathered {
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
                            if !tested(&function.attrs) {
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

        let mut body = Body::default();
        body.visit_block(block);
        let mut scope = outer.clone();
        scope.joined(&body.scope);

        let tokens = block.to_token_stream();
        let mut found = Vec::new();
        calls(tokens.clone(), &mut found);
        let mut said = String::from(" ");
        spoken(tokens, &mut said);

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
        });
    }

    fn resolved(mut self) -> Crate {
        self.known = self.found.iter().map(|one| one.path.clone()).collect();
        let mut own = Crate {
            modules: self.modules.len(),
            ..Crate::default()
        };

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
        }

        own
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
            calls(group.stream(), found);
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

fn spoken(stream: TokenStream, said: &mut String) {
    for token in stream {
        match token {
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
