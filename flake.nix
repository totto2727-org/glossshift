{
  description = "A native macOS translation popup and Markdown CLI";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";
    vite-plus = {
      url = "github:ryoppippi/nix-vite-plus";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, vite-plus, ... }:
    let
      appSystems = [ "aarch64-darwin" ];
      shellSystems = appSystems ++ [ "x86_64-linux" ];
      forSystems = systems: nixpkgs.lib.genAttrs systems;
      overlay = final: _previous: {
        vite-plus = vite-plus.packages.${final.stdenv.hostPlatform.system}.vp.override {
          nodejs = final.nodejs_26;
        };
        nsh = final.callPackage ./nix/nsh.nix { };
        nsh-source = final.callPackage ./nix/nsh-source.nix { };
        glossshift-source = final.callPackage ./nix/source.nix { };
        glossshift-pnpm-deps = final.callPackage ./nix/pnpm-deps.nix { };
        glossshift = final.callPackage ./package.nix { };
        gshift = final.callPackage ./nix/gshift.nix { };
      };
      mkPkgs = system: import nixpkgs { inherit system; overlays = [ overlay ]; };
    in
    {
      overlays.default = overlay;
      packages = forSystems appSystems (
        system:
        let pkgs = mkPkgs system;
        in {
          inherit (pkgs) glossshift gshift nsh nsh-source;
          default = pkgs.glossshift;
          pnpm-deps = pkgs.glossshift-pnpm-deps;
        }
      );
      devShells = forSystems shellSystems (
        system:
        let
          pkgs = mkPkgs system;
          tooling = [ pkgs.vite-plus pkgs.just ];
          ci = pkgs.mkShell { packages = tooling; };
        in
        { inherit ci; }
        // nixpkgs.lib.optionalAttrs (system == "aarch64-darwin") {
          default = pkgs.mkShell {
            NSH_SOURCE = pkgs.nsh-source;
            packages = tooling ++ [
              pkgs.nodejs_26
              pkgs.nsh
              pkgs.cargo
              pkgs.rustc
              pkgs.clippy
              pkgs.rustfmt
            ];
            shellHook = ''
              if [ ! -f native/Cargo.toml ] || [ ! -f nsh.json ] || [ -L .nsh ]; then
                printf '%s\n' 'Run nix develop from the GlossShift root with a regular .nsh cache directory.' >&2
                exit 1
              fi
              mkdir -p .nsh || exit 1
              upstream="$PWD/.nsh/upstream"
              stamp="$upstream/.glossshift-source"
              if [ -L "$upstream" ] || { [ -e "$upstream" ] && [ ! -f "$stamp" ]; }; then
                printf '%s\n' "Refusing to replace unmanaged $upstream. Move it aside, then run nix develop again." >&2
                exit 1
              fi
              if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "${pkgs.nsh-source}" ]; then
                staging="$(mktemp -d "$PWD/.nsh/upstream-stage.XXXXXX")" || exit 1
                if ! cp -R "${pkgs.nsh-source}/." "$staging/"; then
                  printf '%s\n' 'Could not copy the pinned NSH source. Existing source was not changed.' >&2
                  exit 1
                fi
                chmod -R u+w "$staging" || exit 1
                test -f "$staging/crates/nsh-core/Cargo.toml" || exit 1
                printf '%s\n' "${pkgs.nsh-source}" > "$staging/.glossshift-source" || exit 1
                if [ -d "$upstream" ]; then
                  backup="$(mktemp -d "$PWD/.nsh/upstream-backup.XXXXXX")" || exit 1
                  mv "$upstream" "$backup/source" || exit 1
                  printf '%s\n' "Previous managed NSH source retained at $backup/source"
                fi
                mv "$staging" "$upstream" || exit 1
              fi
              vp config
            '';
          };
        }
      );
    };
}
