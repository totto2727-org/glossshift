{
  description = "A native macOS translation popup and Markdown CLI";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1";
    nixpkgs-llama.url = "github:NixOS/nixpkgs/d4f25a3e562008648d45bcf2d70bcc7422cad84e";
    vite-plus = {
      url = "github:ryoppippi/nix-vite-plus";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      nixpkgs-llama,
      vite-plus,
      ...
    }:
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
        glossshift-cli-source = final.callPackage ./nix/cli-source.nix { };
        glossshift-pnpm-deps = final.callPackage ./nix/pnpm-deps.nix { };
        glossshift-llama-server =
          nixpkgs-llama.legacyPackages.${final.stdenv.hostPlatform.system}.llama-cpp;
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
          default =
            let
              runtimeTools = [
                pkgs.coreutils
                pkgs.curl
                pkgs.glossshift-llama-server
                pkgs.glossshift-macos-helper
              ];
            in
            pkgs.mkShell {
              GLOSSSHIFT_LLAMA_SERVER = "llama-server";
              GLOSSSHIFT_MACOS_HELPER = "glossshift-macos-helper";
              GLOSSSHIFT_COREUTILS = "coreutils";
              GLOSSSHIFT_CURL = "curl";
              SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
              packages =
                tooling
                ++ [
                  pkgs.nodejs_26
                  pkgs.nsh
                  pkgs.swift
                ]
                ++ runtimeTools;
              shellHook = ''
                if [ ! -f nsh.json ]; then
                  printf '%s\n' 'Run nix develop from the GlossShift root.' >&2
                  exit 1
                fi
                export PATH="${pkgs.lib.makeBinPath runtimeTools}:$PATH"
                vp config
              '';
            };
        }
      );
    };
}
