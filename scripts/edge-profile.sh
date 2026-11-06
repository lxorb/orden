if [ "${ROLLING:-}" = true ]; then
  export CARGO_PROFILE_RELEASE_LTO=thin
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
  echo "edge: thin LTO over 16 codegen units"
else
  echo "release: Cargo.toml's profile as it is"
fi
