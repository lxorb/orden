#!/usr/bin/env bash
set -euo pipefail

if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
  echo "version=${GITHUB_REF_NAME#v}" >>"$GITHUB_OUTPUT"
  echo "tag=$GITHUB_REF_NAME" >>"$GITHUB_OUTPUT"
  echo "rolling=false" >>"$GITHUB_OUTPUT"
  if [[ "${GITHUB_REF_NAME#v}" == *-* ]]; then
    echo 'channel=unstable' >>"$GITHUB_OUTPUT"
  else
    echo 'channel=stable' >>"$GITHUB_OUTPUT"
  fi
  exit 0
fi

latest=$(git tag --list 'v*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)
latest=${latest:-v0.0.0}
IFS=. read -r major minor patch <<<"${latest#v}"
echo "version=$major.$minor.$((patch + 1))-$GITHUB_RUN_NUMBER" >>"$GITHUB_OUTPUT"
echo "tag=edge" >>"$GITHUB_OUTPUT"
echo "rolling=true" >>"$GITHUB_OUTPUT"
echo 'channel=unstable' >>"$GITHUB_OUTPUT"
