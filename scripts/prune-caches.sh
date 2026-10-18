#!/usr/bin/env bash
# Keeps one generation of the release's caches on a ref: the newest of each kind, and
# none of the ones it replaced (#307). Run by release.yml once a build's caches are saved.
#
#   scripts/prune-caches.sh refs/heads/unstable            # delete
#   scripts/prune-caches.sh refs/heads/unstable --dry-run  # only say what would go
#
# A kind is what one job of the release saves for one target, whatever the toolchain and
# the lock file were: Swatinem/rust-cache names its caches
# `v0-rust-<target>-<job>-<os>-<arch>-<toolchain hash>-<lock hash>`, and a new toolchain or
# lock file starts a new one beside the old, which GitHub only evicts after a week unused
# or when the repository is past its 10 GB. setup-node names pnpm's store
# `node-cache-<os>-<arch>-pnpm-<lock hash>` the same way. Only the release's own jobs
# (`build`, `mac`) and pnpm's stores: the phones' caches (publish-mobile.yml) are kept as
# they are. And the universal Mac build's, which nothing has made since the Mac was split
# in two, whatever its age.
set -euo pipefail

ref=${1:?usage: prune-caches.sh <ref> [--dry-run]}
dry=${2:-}
repository=${GITHUB_REPOSITORY:-lxorb/orden}

# Every cache of the ref that is a generation older than the newest of its kind.
gh api --paginate "repos/$repository/actions/caches?ref=$ref&per_page=100" --jq '.actions_caches[]' |
  jq -rs '
    map(select(.key | test("^v0-rust-.+-(build|mac)-") or test("^node-cache-")))
    | map(. + {kind: (if (.key | startswith("v0-rust-"))
        then (.key | sub("-[^-]+-[^-]+$"; ""))
        else (.key | sub("-[^-]+$"; "")) end)})
    | group_by(.kind)
    | map(sort_by(.created_at) | reverse
        | if (.[0].kind | startswith("v0-rust-universal-apple-darwin-")) then .[] else .[1:][] end)
    | .[] | "\(.id)\t\(.key)"' |
  while IFS=$'\t' read -r id key; do
    if [ "$dry" = --dry-run ]; then
      echo "would delete $key"
    elif gh api -X DELETE "repos/$repository/actions/caches/$id" >/dev/null; then
      echo "deleted $key"
    else
      # Gone already, deleted by an overlapping run or evicted: nothing to do.
      echo "::warning::$key could not be deleted"
    fi
  done
