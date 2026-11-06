#!/usr/bin/env bash
set -euo pipefail

ref=${1:?usage: prune-caches.sh <ref> [--dry-run]}
dry=${2:-}
repository=${GITHUB_REPOSITORY:-lxorb/orden}

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
      echo "::warning::$key could not be deleted"
    fi
  done
