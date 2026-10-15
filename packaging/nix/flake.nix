{
  # This branch's Nix package compiles its own source. The release flake stays
  # on main; this one can be installed side by side as orden-unstable:
  #
  #   nix profile install github:lxorb/orden/unstable?dir=packaging/nix
  description = "Orden unstable, built from source";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      mkOrden = pkgs:
        let
          lib = pkgs.lib;
          pname = "orden-unstable";
          # A prerelease version makes a source-built Nix install follow the
          # unstable updater stream by default. Stable and edge release builds
          # have a higher semantic version than this local source build.
          version = "0.0.0-unstable";
          # This flake lives in packaging/nix, so its own outPath contains
          # only that directory. Fetch the repository root at the same commit
          # so Cargo and pnpm can see the workspace files next to it.
          source =
            if self ? rev then
              builtins.fetchGit {
                url = "https://github.com/lxorb/orden.git";
                rev = self.rev;
              }
            else
              self.outPath;
          gstPlugins = with pkgs.gst_all_1; [
            gstreamer
            gst-plugins-base
            gst-plugins-good
            gst-plugins-bad
            gst-libav
          ];
        in
        pkgs.rustPlatform.buildRustPackage {
          inherit pname version;
          TAURI_CONFIG = builtins.toJSON { inherit version; };
          src = source;
          cargoRoot = "apps/desktop/src-tauri";
          cargoLock.lockFile = "${source}/apps/desktop/src-tauri/Cargo.lock";
          cargoHash = lib.fakeHash;

          nativeBuildInputs = with pkgs; [
            pkg-config
            nodejs_24
            pnpm_10
            pnpmConfigHook
            wrapGAppsHook3
            makeWrapper
          ];

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit pname version;
            src = source;
            pnpm = pkgs.pnpm_10;
            fetcherVersion = 4;
            hash = lib.fakeHash;
          };

          buildInputs = with pkgs; [
            webkitgtk_4_1
            gtk3
            libsoup_3
            glib
            glib-networking
            cairo
            pango
            gdk-pixbuf
            dbus
            openssl
            xdotool
            stdenv.cc.cc.lib
          ] ++ gstPlugins;

          preBuild = ''
            pnpm --filter @nib/desktop build
          '';

          postInstall = ''
            install -Dm755 $out/bin/nib $out/libexec/${pname}/nib
            rm $out/bin/nib
            install -Dm644 ${./orden.desktop} $out/share/applications/${pname}.desktop
            substitute ${./orden.desktop} $out/share/applications/${pname}.desktop \
              --replace-fail 'Name=Orden' 'Name=Orden Unstable' \
              --replace-fail 'Exec=orden' 'Exec=${pname}' \
              --replace-fail 'Icon=orden' 'Icon=${pname}' \
              --replace-fail 'StartupWMClass=orden' 'StartupWMClass=${pname}'
            for size in 32 128; do
              install -Dm644 ${source}/apps/desktop/src-tauri/icons/"$size"x"$size".png \
                $out/share/icons/hicolor/"$size"x"$size"/apps/${pname}.png
            done
            install -Dm644 ${source}/apps/desktop/src-tauri/icons/128x128@2x.png \
              $out/share/icons/hicolor/256x256/apps/${pname}.png
          '';

          dontWrapGApps = true;
          postFixup = ''
            wrapProgram $out/libexec/${pname}/nib $out/bin/${pname} \
              --inherit-argv0 \
              ''${gappsWrapperArgs[@]} \
              --prefix PATH : ${lib.makeBinPath [ pkgs.xdg-utils ]} \
              --set GST_PLUGIN_SYSTEM_PATH_1_0 ${lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" gstPlugins} \
              --unset GST_PLUGIN_PATH \
              --unset GST_PLUGIN_PATH_1_0 \
              --run 'if [ -z "''${WEBKIT_DISABLE_DMABUF_RENDERER+set}" ] && [ -e /proc/driver/nvidia/version ]; then export WEBKIT_DISABLE_DMABUF_RENDERER=1; fi' \
              --run 'export GST_REGISTRY_1_0="''${XDG_CACHE_HOME:-$HOME/.cache}/${pname}/gstreamer-registry-${pkgs.stdenv.hostPlatform.system}.bin"'
          '';

          meta = {
            description = "Orden unstable, built from the unstable branch sources";
            homepage = "https://orden.so";
            downloadPage = "https://github.com/lxorb/orden/tree/unstable/packaging/nix";
            license = lib.licenses.agpl3Only;
            mainProgram = pname;
            platforms = systems;
            sourceProvenance = [ lib.sourceTypes.fromSource ];
          };
        };
    in
    {
      packages = forEach (pkgs: {
        default = mkOrden pkgs;
        orden-unstable = mkOrden pkgs;
      });
      overlays.default = final: _prev: { orden-unstable = mkOrden final; };
      apps = forEach (pkgs: {
        default = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          meta.description = "Orden unstable, built from source";
        };
      });
    };
}
