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
        glossshift-source = final.callPackage ./nix/source.nix { };
        glossshift-pnpm-deps = final.callPackage ./nix/pnpm-deps.nix { };
        glossshift-llama-server = final.callPackage ./nix/llama-server.nix { };
        glossshift-macos-helper = final.callPackage ./nix/macos-helper.nix { };
        glossshift = final.callPackage ./package.nix { };
        gshift = final.callPackage ./nix/gshift.nix { };
      };
      mkPkgs =
        system:
        import nixpkgs {
          inherit system;
          overlays = [ overlay ];
        };
    in
    {
      overlays.default = overlay;
      packages = forSystems appSystems (
        system:
        let
          pkgs = mkPkgs system;
        in
        {
          inherit (pkgs)
            glossshift
            gshift
            nsh
            glossshift-llama-server
            glossshift-macos-helper
            ;
          default = pkgs.glossshift;
          pnpm-deps = pkgs.glossshift-pnpm-deps;
        }
      );
      devShells = forSystems shellSystems (
        system:
        let
          pkgs = mkPkgs system;
          tooling = [
            pkgs.vite-plus
            pkgs.just
          ];
          ci = pkgs.mkShell { packages = tooling; };
        in
        {
          inherit ci;
        }
        // nixpkgs.lib.optionalAttrs (system == "aarch64-darwin") {
          default = pkgs.mkShell {
            GLOSSSHIFT_NODE_COMMAND = "${pkgs.nodejs_26}/bin/node";
            GLOSSSHIFT_LLAMA_SERVER = "${pkgs.glossshift-llama-server}/bin/llama-server";
            GLOSSSHIFT_MACOS_HELPER = "${pkgs.glossshift-macos-helper}/bin/glossshift-macos-helper";
            packages = tooling ++ [
              pkgs.nodejs_26
              pkgs.nsh
              pkgs.glossshift-llama-server
              pkgs.glossshift-macos-helper
            ];
            shellHook = ''
              if [ ! -f nsh.json ]; then
                printf '%s\n' 'Run nix develop from the GlossShift root.' >&2
                exit 1
              fi
              export GLOSSSHIFT_NODE_ENTRY="$PWD/node/main.ts"
              vp config
            '';
          };
        }
      );
    };
}
