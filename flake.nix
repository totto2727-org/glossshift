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
          default =
            let
              runtimeTools = [
                pkgs.coreutils
                pkgs.curl
                pkgs.glossshift-llama-server
                pkgs.glossshift-macos-helper
              ];
              batchLauncher = pkgs.writeTextFile {
                name = "glossshift-source-batch";
                executable = true;
                text = import ./nix/batch-launcher.nix {
                  inherit (pkgs) coreutils jq;
                  shell = pkgs.stdenvNoCC.shell;
                  host = "${pkgs.nsh}/libexec/nsh/runtime/tui/nsh-tui-host";
                  tuiBundle = ''"$PWD/terminal/.nsh/out/bundle.js"'';
                  batchBundle = ''"$PWD/batch/.nsh/out/bundle.js"'';
                  capabilities = ''"$PWD/batch/.nsh/out/capabilities.json"'';
                  runtimeEnvironment = ''
                    export GLOSSSHIFT_COREUTILS='${pkgs.coreutils}/bin/coreutils'
                    export GLOSSSHIFT_CURL='${pkgs.curl}/bin/curl'
                    export GLOSSSHIFT_LLAMA_SERVER='${pkgs.glossshift-llama-server}/bin/llama-server'
                    export SSL_CERT_FILE='${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt'
                  '';
                };
              };
            in
            pkgs.mkShell {
              GLOSSSHIFT_LLAMA_SERVER = "llama-server";
              GLOSSSHIFT_MACOS_HELPER = "glossshift-macos-helper";
              GLOSSSHIFT_COREUTILS = "coreutils";
              GLOSSSHIFT_CURL = "curl";
              GLOSSSHIFT_BATCH_LAUNCHER = "${batchLauncher}";
              GLOSSSHIFT_TEST_TUI_HOST = "${pkgs.nsh}/libexec/nsh/runtime/tui/nsh-tui-host";
              GLOSSSHIFT_TEST_COREUTILS = "${pkgs.coreutils}/bin/coreutils";
              GLOSSSHIFT_TEST_JQ = "${pkgs.jq}/bin/jq";
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
