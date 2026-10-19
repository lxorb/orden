# Sourced by release.yml before it compiles the app (#307): an edge build - every build
# but a tag's, `rolling` in scripts/build-version.sh - compiles the crate with thin LTO
# over 16 codegen units instead of the release profile's fat LTO over one, which is most
# of the crate's six minutes on Windows arm. The binary comes out a little larger and may
# run a little slower, which edge can afford and a release does not have to: a tag's
# build keeps Cargo.toml's `[profile.release]` exactly as it is.
#
# The crate's caches stay apart without saying so: only `unstable` saves one, and it only
# ever builds edge, while a tag reads none of them (a cache is read on the ref that saved
# it and the default branch, and neither is a tag).
if [ "${ROLLING:-}" = true ]; then
  export CARGO_PROFILE_RELEASE_LTO=thin
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
  echo "edge: thin LTO over 16 codegen units"
else
  echo "release: Cargo.toml's profile as it is"
fi
