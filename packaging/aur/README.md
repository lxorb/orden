# Orden AUR deployment

`.github/workflows/aur.yml` builds x86_64 and aarch64 Debian packages on every
push to `main`, validates both AUR packages with Arch's `makepkg`, then publishes
`orden-bin`. Pull requests and branch dispatches validate without publishing.
Install or update with `yay -S orden-bin`; these builds need no updater signing key.
App version `0.14.0-12` becomes Arch version `0.14.0pre12`, before `0.14.0`.

Builds keep their binaries on one rolling `aur-edge` GitHub prerelease, apart
from `edge`, which is remade on every push. The AUR recipe pins their URLs and
SHA-256 hashes, so an older build's files are deleted only after the AUR push.

The GitHub environment `aur` permits only `main`. Its secret `AUR_SSH_PRIVATE_KEY`
is a dedicated Ed25519 key; add its public half (`~/.ssh/orden_aur_ci.pub`) to
the activated AUR account registered with `bendik@arbogast.dev`.
The upload uses GitHub's short-lived job token; no PAT is needed. The AUR push
verifies the pinned server key, removes the private key on exit, and never forces.

To rotate credentials, generate a new dedicated key, replace the public key in
the AUR account and the secret in the `aur` environment, then remove the old key
from both places. Retry publishing with a workflow dispatch on `main`.
