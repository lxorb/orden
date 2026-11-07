{
  description = "Orden, a markdown editor with realtime inline preview";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      release = {
        pname = "orden";
        version = "0.20.0";
        tag = "v0.20.0";
        asset = "Orden";
      };

      debs = {
        x86_64-linux = {
          suffix = "x64";
          hash = "sha256-IkxWshxZ+TG00z2OdvPfMhHenJiIrpNYhbyd3Tfyl10=";
        };
        aarch64-linux = {
          suffix = "arm64";
          hash = "sha256-NTiAuqFGs62xIaLOhTB6bE9I+TaXzj+y9jlr8J1UZl4=";
        };
      };

      stable = release // {
        hashes = builtins.mapAttrs (_: deb: deb.hash) debs;
      };
      edgePin =
        if builtins.pathExists ./edge.json then
          builtins.fromJSON (builtins.readFile ./edge.json)
        else
          null;

      fromSource = {
        pname = "orden-source";
        version = "0.0.0-unstable";
      };

      systems = builtins.attrNames debs;
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      workspace = self.sourceInfo.outPath;
      haveSources = builtins.pathExists "${workspace}/apps/desktop/src-tauri/Cargo.lock";

      gstPluginsFor =
        pkgs: with pkgs.gst_all_1; [
          gstreamer
          gst-plugins-base
          gst-plugins-good
          gst-plugins-bad
          gst-libav
        ];

      webkitInputsFor =
        pkgs:
        (with pkgs; [
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
        ])
        ++ gstPluginsFor pkgs;

      runtimeInputsFor =
        pkgs: with pkgs; [
          gtk4
          glib
          glib-networking
          cairo
          pango
          gdk-pixbuf
          dbus
          nss
          nspr
          atk
          at-spi2-atk
          at-spi2-core
          libdrm
          expat
          libxkbcommon
          libgbm
          alsa-lib
          cups
          libGL
          systemdLibs
          libxcb
          libx11
          libxcomposite
          libxdamage
          libxext
          libxfixes
          libxrandr
          libxshmfence
          stdenv.cc.cc.lib
        ];

      openedFor =
        pkgs: with pkgs; [
          libGL
          vulkan-loader
          systemdLibs
        ];

      cefFor =
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          arch =
            {
              x86_64-linux = "linux64";
              aarch64-linux = "linuxarm64";
            }
            .${system};
          sha1 =
            {
              x86_64-linux = "15c91ad767097217b2e82ba8b933fe30b134be69";
              aarch64-linux = "fa85793519eef199e6b6fa8cc8d6f0eb45c6dac2";
            }
            .${system};
          cef =
            (pkgs.cef-binary.override {
              version = "154.0.34";
              gitRevision = "14c5a08";
              chromiumVersion = "154.0.8037.98";
              srcHashes = {
                x86_64-linux = "sha256-6H4sdjBDct0ouJnOtu+ks1P1JwBZTdw1ioI37AfsZJI=";
                aarch64-linux = "sha256-RZizUOWkNRnbufHHMuixhDM1ctpTJE/1XMBjADw0xeQ=";
              };
            }).overrideAttrs
              (old: {
                installPhase = pkgs.lib.concatStringsSep "\n" (
                  builtins.filter (
                    line: !(pkgs.lib.hasInfix "/libEGL.so" line || pkgs.lib.hasInfix "/libGLESv2.so" line)
                  ) (pkgs.lib.splitString "\n" old.installPhase)
                );
              });
          archive = builtins.toJSON {
            type = "minimal";
            name = "cef_binary_154.0.34+g14c5a08+chromium-154.0.8037.98_${arch}_minimal.tar.bz2";
            inherit sha1;
          };
        in
        pkgs.runCommandCC "cef-distribution-154.0.34" { } ''
          mkdir -p $out
          for one in ${cef}/Release/* ${cef}/Resources/*; do
            ln -s "$one" "$out/$(basename "$one")"
          done
          for one in CMakeLists.txt cmake include libcef_dll; do
            ln -s "${cef}/$one" "$out/$one"
          done
          for angle in libEGL.so libGLESv2.so; do
            [ -e "$out/$angle" ] || cc -shared -o "$out/$angle" -x c /dev/null
          done
          echo '${archive}' > $out/archive.json
        '';

      mkRelease =
        channel: pkgs:
        let
          inherit (channel) pname version;
          inherit (debs.${pkgs.stdenv.hostPlatform.system}) suffix;
          hash = channel.hashes.${pkgs.stdenv.hostPlatform.system};
          edge = pname != "orden";
          onCef = nixpkgs.lib.versionOlder "0.16.0" version;
          gstPlugins = gstPluginsFor pkgs;
        in
        pkgs.stdenv.mkDerivation {
          inherit pname version;

          passthru.engine = if onCef then "cef" else "webkit";

          src = pkgs.fetchurl {
            url = "https://github.com/lxorb/orden/releases/download/${channel.tag}/${channel.asset}-${version}-linux-${suffix}.deb";
            inherit hash;
          };

          nativeBuildInputs = with pkgs; [
            dpkg
            autoPatchelfHook
            (if onCef then wrapGAppsHook4 else wrapGAppsHook3)
            makeShellWrapper
          ];

          buildInputs = if onCef then runtimeInputsFor pkgs else webkitInputsFor pkgs;
          runtimeDependencies = pkgs.lib.optionals onCef (openedFor pkgs);

          dontConfigure = true;
          dontBuild = true;
          dontStrip = onCef;

          installPhase = ''
            runHook preInstall
          ''
          + (
            if onCef then
              ''
                install -d $out/libexec
                cp -r usr/share/Orden $out/libexec/${pname}
                rm -f $out/libexec/${pname}/chrome-sandbox
              ''
            else
              ''
                install -Dm755 usr/bin/nib $out/libexec/${pname}/nib
              ''
          )
          + ''
            install -d $out/share/applications
            substitute ${./orden.desktop} $out/share/applications/${pname}.desktop \
              --replace-fail 'Name=Orden' 'Name=${if edge then "Orden Unstable" else "Orden"}' \
              --replace-fail 'Exec=orden' 'Exec=${pname}' \
              --replace-fail 'Icon=orden' 'Icon=${pname}' \
              --replace-fail 'StartupWMClass=orden' 'StartupWMClass=${pname}'
            for size in 32 128; do
              install -Dm644 usr/share/icons/hicolor/"$size"x"$size"/apps/nib.png \
                $out/share/icons/hicolor/"$size"x"$size"/apps/${pname}.png
            done
            install -Dm644 usr/share/icons/hicolor/256x256@2/apps/nib.png \
              $out/share/icons/hicolor/256x256/apps/${pname}.png
            runHook postInstall
          '';

          dontWrapGApps = true;
          dontAutoPatchelf = onCef;
          postFixup =
            pkgs.lib.optionalString onCef ''
              autoPatchelf $out
              for one in $out/libexec/${pname}/*.so $out/libexec/${pname}/*.so.*; do
                [ -f "$one" ] && [ ! -L "$one" ] || continue
                patchelf --add-rpath ${pkgs.lib.makeLibraryPath (openedFor pkgs)} "$one"
              done
            ''
            + ''
            makeShellWrapper $out/libexec/${pname}/nib $out/bin/${pname} \
              "''${gappsWrapperArgs[@]}" \
              --inherit-argv0 \
              --suffix PATH : ${pkgs.lib.makeBinPath [ pkgs.xdg-utils ]} \
          ''
          + pkgs.lib.optionalString onCef ''
            --run '. ${./userns.sh}'
          ''
          + pkgs.lib.optionalString (!onCef) ''
            --set GST_PLUGIN_SYSTEM_PATH_1_0 ${
              pkgs.lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" gstPlugins
            } \
            --unset GST_PLUGIN_PATH \
            --unset GST_PLUGIN_PATH_1_0 \
            --run 'export GST_REGISTRY_1_0="''${XDG_CACHE_HOME:-$HOME/.cache}/${pname}/gstreamer-registry-${pkgs.stdenv.hostPlatform.system}.bin"' \
            --run 'if [ -z "''${WEBKIT_DISABLE_DMABUF_RENDERER+set}" ] && [ -e /proc/driver/nvidia/version ]; then export WEBKIT_DISABLE_DMABUF_RENDERER=1; fi'
          ''
          + pkgs.lib.optionalString (!edge) ''
            ln -s orden $out/bin/nib
          '';

          meta = {
            description = "Markdown editor with realtime inline preview${pkgs.lib.optionalString edge ", the latest build of unstable"}";
            homepage = "https://orden.so";
            downloadPage = "https://github.com/lxorb/orden/releases";
            changelog = "https://github.com/lxorb/orden/releases/tag/${channel.tag}";
            license = pkgs.lib.licenses.agpl3Only;
            mainProgram = pname;
            platforms = systems;
            sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
          };
        };

      mkEdge =
        pkgs:
        if edgePin != null then
          mkRelease (edgePin // { pname = "orden-unstable"; }) pkgs
        else
          pkgs.stdenvNoCC.mkDerivation {
            pname = "orden-unstable";
            version = "0";
            buildCommand = ''
              echo "orden-unstable installs the edge pinned in edge.json, and this branch has none:" >&2
              echo "  nix profile install 'github:lxorb/orden/unstable?dir=packaging/nix#orden-unstable'" >&2
              exit 1
            '';
            meta = {
              mainProgram = "orden-unstable";
              platforms = systems;
            };
          };

      mkSource =
        pkgs:
        let
          lib = pkgs.lib;
          inherit (fromSource) pname version;
          cef = cefFor pkgs;
        in
        if !haveSources then
          pkgs.stdenvNoCC.mkDerivation {
            inherit pname version;
            buildCommand = ''
              echo "${pname} compiles the repository's own sources, and this flake was" >&2
              echo "fetched without them: packaging/nix was copied on its own." >&2
              echo "Name the repository instead, so Nix fetches the workspace with it:" >&2
              echo "  nix build 'github:lxorb/orden/unstable?dir=packaging/nix#${pname}'" >&2
              echo "  nix build '.?dir=packaging/nix#${pname}'   # from a checkout" >&2
              exit 1
            '';
            meta = {
              description = "Orden compiled from the sources beside this flake";
              homepage = "https://orden.so";
              license = lib.licenses.agpl3Only;
              mainProgram = pname;
              platforms = systems;
            };
          }
        else
          pkgs.rustPlatform.buildRustPackage {
            inherit pname version;
            TAURI_CONFIG = builtins.toJSON { inherit version; };
            src = workspace;
            cargoRoot = "apps/desktop/src-tauri";
            buildAndTestSubdir = "apps/desktop/src-tauri";
            doCheck = false;
            CARGO_PROFILE_RELEASE_LTO = "thin";
            CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "16";
            cargoLock.lockFile = "${workspace}/apps/desktop/src-tauri/linux/Cargo.lock";
            postPatch = ''
              cp apps/desktop/src-tauri/linux/Cargo.toml apps/desktop/src-tauri/Cargo.toml
              cp apps/desktop/src-tauri/linux/Cargo.lock apps/desktop/src-tauri/Cargo.lock
            '';
            CEF_PATH = cef;

            nativeBuildInputs = with pkgs; [
              pkg-config
              cmake
              nodejs_24
              pnpm_10
              pnpmConfigHook
              autoPatchelfHook
              wrapGAppsHook4
              makeWrapper
            ];
            dontUseCmakeConfigure = true;
            runtimeDependencies = openedFor pkgs;
            dontStrip = true;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit pname version;
              src = workspace;
              pnpm = pkgs.pnpm_10;
              fetcherVersion = 4;
              hash = "sha256-yOi7wQw/tu+4JdxHUIQnJ4aFDG6U39JQvFWAunLg/Vw=";
            };

            buildInputs = runtimeInputsFor pkgs;

            preBuild = ''
              pnpm --filter @orden/desktop build
            '';

            postInstall = ''
              install -Dm755 $out/bin/nib $out/libexec/${pname}/nib
              rm $out/bin/nib
              rm -f $out/bin/chrome-sandbox
              rm -rf $out/lib
              for one in ${cef}/*; do
                case "$(basename "$one")" in
                  CMakeLists.txt | cmake | include | libcef_dll | archive.json | chrome-sandbox) ;;
                  *) cp -rL "$one" $out/libexec/${pname}/ ;;
                esac
              done
              install -Dm644 ${./orden.desktop} $out/share/applications/${pname}.desktop
              substitute ${./orden.desktop} $out/share/applications/${pname}.desktop \
                --replace-fail 'Name=Orden' 'Name=Orden Source' \
                --replace-fail 'Exec=orden' 'Exec=${pname}' \
                --replace-fail 'Icon=orden' 'Icon=${pname}' \
                --replace-fail 'StartupWMClass=orden' 'StartupWMClass=${pname}'
              for size in 32 128; do
                install -Dm644 ${workspace}/apps/desktop/src-tauri/icons/"$size"x"$size".png \
                  $out/share/icons/hicolor/"$size"x"$size"/apps/${pname}.png
              done
              install -Dm644 ${workspace}/apps/desktop/src-tauri/icons/128x128@2x.png \
                $out/share/icons/hicolor/256x256/apps/${pname}.png
            '';

            dontWrapGApps = true;
            postFixup = ''
              makeWrapper $out/libexec/${pname}/nib $out/bin/${pname} \
                --inherit-argv0 \
                ''${gappsWrapperArgs[@]} \
                --prefix PATH : ${lib.makeBinPath [ pkgs.xdg-utils ]}
            '';

            meta = {
              description = "Orden compiled from the sources beside this flake";
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
      packages = forEach (
        pkgs:
        let
          orden = mkRelease stable pkgs;
        in
        {
          inherit orden;
          default = orden;
          nib = orden;
          orden-unstable = mkEdge pkgs;
          ${fromSource.pname} = mkSource pkgs;
        }
      );

      overlays.default = final: _prev: {
        orden = mkRelease stable final;
        orden-unstable = mkEdge final;
        ${fromSource.pname} = mkSource final;
      };

      homeManagerModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.programs.orden;
          inherit (lib) mkOption types;
          system = pkgs.stdenv.hostPlatform.system;
          folder = "so.orden.Orden";
          isId = id: builtins.stringLength id <= 39 && builtins.match "[a-z0-9][a-z0-9-]*" id != null;
          stylesheet = types.either types.lines types.path;
          file = value: if builtins.isString value then { text = value; } else { source = value; };

          schema = builtins.fromJSON (
            builtins.readFile (
              if builtins.pathExists ./settings-schema.json then
                ./settings-schema.json
              else
                ./packaging/nix/settings-schema.json
            )
          );
          oneOf = setting: if setting ? enum then types.enum setting.enum else types.str;
          typeOf =
            setting:
            if setting.type == "list" then
              types.listOf (oneOf setting)
            else if setting.type == "boolean" then
              types.bool
            else if setting.type == "number" then
              (
                if setting ? min && setting ? max then
                  types.numbers.between setting.min setting.max
                else
                  types.number
              )
            else
              oneOf setting;
          optionOf =
            setting:
            mkOption {
              type = types.nullOr (typeOf setting);
              default = null;
              description =
                let
                  initial = " Orden's own default: ${builtins.toJSON setting.default}.";
                  only = " Only on ${lib.concatStringsSep ", " (setting.platforms or [ ])}.";
                in
                setting.description
                + lib.optionalString (setting ? default) initial
                + lib.optionalString (setting ? platforms) only;
            };
          settingsOptions = lib.foldl' lib.recursiveUpdate { } (
            lib.mapAttrsToList (
              key: setting: lib.setAttrByPath (lib.splitString "." key) (optionOf setting)
            ) schema
          );
          pruned =
            attrs:
            lib.filterAttrs (_: value: value != null && value != { }) (
              lib.mapAttrs (_: value: if builtins.isAttrs value then pruned value else value) attrs
            );
          declared = pruned cfg.settings;
        in
        {
          options.programs.orden = {
            enable = lib.mkEnableOption "Orden, a markdown editor with realtime inline preview";

            package = mkOption {
              type = types.package;
              default =
                self.packages.${system}.default
                  or (throw "Orden's flake has packages for ${lib.concatStringsSep " and " systems} only, not ${system}");
              defaultText = lib.literalExpression "orden.packages.\${pkgs.stdenv.hostPlatform.system}.default";
              example = lib.literalExpression "orden.packages.\${pkgs.stdenv.hostPlatform.system}.orden-unstable";
              description = "The Orden to install: this flake's release by default.";
            };

            themes = mkOption {
              type = types.attrsOf stylesheet;
              default = { };
              example = lib.literalExpression "{ paper = ./paper.css; }";
              description = ''
                Theme stylesheets, each written to themes/<name>.css in Orden's
                settings folder and offered in Settings by that name, capitalised. A name is
                lower-case letters, digits and hyphens. Themes installed from inside
                the app go into the same folder and stay the app's.
              '';
            };

            customCss = mkOption {
              type = types.nullOr stylesheet;
              default = null;
              example = "body { font-size: 18px; }";
              description = ''
                custom.css, applied on top of whichever theme is active. Null leaves
                the file to the app, which starts it with a comment and nothing else.
              '';
            };

            settings = settingsOptions;

            snippets = mkOption {
              type = types.nullOr (types.attrsOf types.str);
              default = null;
              example = {
                todo = "- [ ] ";
              };
              description = ''
                snippets.json: abbreviations the editor completes while typing, each
                to the text it inserts. Null leaves the file to the app, which starts
                it with a couple of examples.
              '';
            };
          };

          config = lib.mkIf cfg.enable {
            assertions = [
              {
                assertion = pkgs.stdenv.hostPlatform.isLinux;
                message = "programs.orden: this flake packages Orden for Linux only.";
              }
            ]
            ++ map (name: {
              assertion = isId name;
              message = "programs.orden.themes.${name}: not a name Orden takes for a theme (lower-case letters, digits and hyphens, at most 39).";
            }) (builtins.attrNames cfg.themes);

            home.packages = [ cfg.package ];

            xdg.configFile =
              lib.mapAttrs' (name: css: lib.nameValuePair "${folder}/themes/${name}.css" (file css)) cfg.themes
              // lib.optionalAttrs (cfg.customCss != null) { "${folder}/custom.css" = file cfg.customCss; }
              // lib.optionalAttrs (cfg.snippets != null) {
                "${folder}/snippets.json".text = builtins.toJSON cfg.snippets;
              }
              // lib.optionalAttrs (declared != { }) {
                "${folder}/settings.json".text = builtins.toJSON declared;
              };
          };
        };

      checks = forEach (
        pkgs:
        let
          inherit (pkgs) lib;
          stand-ins = {
            options = {
              home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; };
              xdg.configFile = lib.mkOption { type = lib.types.attrsOf lib.types.attrs; };
              assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; };
            };
          };
          evaluated = lib.evalModules {
            modules = [
              self.homeManagerModules.default
              stand-ins
              {
                _module.args.pkgs = pkgs;
                programs.orden = {
                  enable = true;
                  package = pkgs.hello;
                  settings = {
                    editor.textSize = 1.1;
                    editor.focusMode = true;
                    appearance.mode = "dark";
                    general.dns = "quad9";
                    spelling.languages = [
                      "de-DE"
                      "en-US"
                    ];
                    themes.wallpaper.blur = 12;
                    themes.glass.material = "mica";
                    shortcuts.app-focus = "Mod-Alt-f";
                  };
                };
              }
            ];
          };
          written = evaluated.config.xdg.configFile."so.orden.Orden/settings.json".text;
          expected = ''{"appearance":{"mode":"dark"},"editor":{"focusMode":true,"textSize":1.1},"general":{"dns":"quad9"},"shortcuts":{"app-focus":"Mod-Alt-f"},"spelling":{"languages":["de-DE","en-US"]},"themes":{"glass":{"material":"mica"},"wallpaper":{"blur":12}}}'';
        in
        {
          settings-file =
            assert lib.assertMsg (written == expected) "settings.json is ${written}";
            pkgs.runCommand "orden-settings-file" { } "touch $out";
        }
      );

      apps = forEach (pkgs: {
        default = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          meta.description = "Orden, a markdown editor with realtime inline preview";
        };
        orden-unstable = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.orden-unstable;
          meta.description = "Orden, the latest build of unstable";
        };
        ${fromSource.pname} = {
          type = "app";
          program = pkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.${fromSource.pname};
          meta.description = "Orden compiled from the sources beside this flake";
        };
      });
    };
}
